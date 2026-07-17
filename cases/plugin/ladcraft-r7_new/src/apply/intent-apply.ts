import type { ChatMessage } from "../ui/chat";
import type { InsertPosition } from "./types";
import type { R7Task } from "./task-parse";
import {
  parseR7Proposal,
  type ProposalFindingItem,
  type R7ProposalV1,
} from "./proposal-parse";

export type IntentApplyKind =
  | "paste_text"
  | "paste"
  | "replace_selection"
  | "add_comment"
  | "search_replace"
  | "cell_paste";

/** Batch of editor tasks from user approval + last proposal/draft. */
export interface DocumentApplyPlan {
  tasks: R7Task[];
  dedupeKeys: string[];
  requireSelection: boolean;
  itemIds?: number[];
  source: "proposal" | "markdown-fallback";
  statusHint?: string;
}

/** @deprecated single-intent shape kept for tests / exports */
export interface DocumentApplyIntent {
  kind: IntentApplyKind;
  position: InsertPosition;
  text: string;
}

const APPROVAL_RE =
  /(?:^|\s)(?:вставь(?:те)?(?:\s+это)?|вставим|одобряю|примени(?:ть)?|замени(?:ть)?|в\s+документ|запиши(?:те)?)(?:\s|$|[.!,])/i;
const APPROVAL_SHORT_RE = /^(?:да|ок|ok|yes|ага|угу)[.!]?$/i;
const ADD_COMMENT_RE = /(?:добавь(?:те)?|внеси(?:те)?)\s+комментар/i;
const COMMENT_APPROVAL_RE =
  /^(?:да|ок|ok|добавь(?:те)?|одобряю|примени(?:ть)?)[.!]?$/i;

const POS_START_RE = /в\s+начал(?:о|е)(?:\s+документ)?/i;
const POS_END_RE = /в\s+конец(?:\s+документ)?/i;
const POS_CURSOR_RE = /(?:у|в\s+позици\w*)\s+курсор/i;

const FIX_ALL_RE =
  /исправь(?:те)?\s+все|да,?\s*исправь(?:те)?|исправь(?:те)?\s+опечатк|примени(?:ть)?\s+все\s+замен/i;
const FIX_IDS_RE =
  /(?:исправь(?:те)?|только)\s+((?:\d+\s*[,и]?\s*)+)/i;

/** Matches «Черновик:», «**Черновик (одной фразой):**», «### Черновик» etc. */
const DRAFT_HEADER_RE =
  /(?:^|\n)#{0,3}\s*\*{0,2}\s*черновик(?:\s*\([^)]*\))?\s*\*{0,2}\s*:?\s*\*{0,2}\s*(?:\n|$)/i;
const ANCHOR_RE = /исходный\s+якорь/i;
const REWRITE_HINT_RE = /заменю\s+выделен|вместо\s+выделен|replace_selection/i;
const COMMENT_HINT_RE = /комментари[йя]|добавить\s+комментар/i;
const HTML_HINT_RE = /<[a-z][\s\S]*>/i;

const ASK_INSERT_RE =
  /(?:^|\n)(?:---\s*\n)?(?:заменить\s+(?:абзац|выделен\w*)|вставить\s+(?:текст|это|черновик)?\s*(?:в\s+документ)?|заменю\s+выделен|вставить\s*\?|«вставь»|"вставь")/i;

const MAX_FINDINGS = 15;

export type FixIntent = { mode: "all" } | { mode: "ids"; ids: number[] };

/** True when user text is an approval to apply a pending chat draft into the document. */
export function isDocumentApplyApproval(userText: string): boolean {
  const body = stripUserContextBlocks(userText).trim();
  if (!body) return false;
  if (parseFixIntent(body)) return true;
  if (APPROVAL_SHORT_RE.test(body)) return true;
  if (ADD_COMMENT_RE.test(body)) return true;
  if (APPROVAL_RE.test(body)) return true;
  if (/^да[.!]?\s*(?:вставь|одобряю|примени)/i.test(body)) return true;
  return false;
}

export function parseFixIntent(userText: string): FixIntent | null {
  const body = stripUserContextBlocks(userText).trim();
  if (!body) return null;
  if (FIX_ALL_RE.test(body)) return { mode: "all" };
  const m = body.match(FIX_IDS_RE);
  if (m) {
    const ids = (m[1].match(/\d+/g) || [])
      .map((n) => parseInt(n, 10))
      .filter((n) => n >= 1);
    const uniq = Array.from(new Set(ids));
    if (uniq.length) return { mode: "ids", ids: uniq };
  }
  return null;
}

/** Parse insert position from user phrasing; default cursor. */
export function parseInsertPosition(userText: string): InsertPosition {
  const body = stripUserContextBlocks(userText);
  if (POS_START_RE.test(body)) return "start";
  if (POS_END_RE.test(body)) return "end";
  if (POS_CURSOR_RE.test(body)) return "cursor";
  return "cursor";
}

/**
 * Build editor tasks from user approval + last assistant proposal/draft.
 */
export function resolveDocumentApplyPlan(
  userText: string,
  messages: ChatMessage[],
): DocumentApplyPlan | null {
  const userBody = stripUserContextBlocks(userText).trim();
  if (!userBody) return null;

  const draftMsg = findLastAssistantDraft(messages);
  if (!draftMsg) return null;

  const raw = draftMsg.text.trim();
  if (!raw || isAssistantWorkingPlaceholderText(raw)) return null;

  const proposal = parseR7Proposal(raw);
  const fix = parseFixIntent(userBody);

  if (fix) {
    if (proposal?.kind === "findings" && proposal.items?.length) {
      return findingsToPlan(proposal.items, fix, proposal.revision);
    }
    return null;
  }

  if (!isDocumentApplyApproval(userText)) return null;

  // Short «да» must not apply findings / typo tables (need «исправь все» / N).
  if (APPROVAL_SHORT_RE.test(userBody)) {
    if (proposal?.kind === "findings") return null;
    if (!proposal && isStructuredEditDraft(raw)) return null;
  }

  if (proposal) {
    return planFromProposal(proposal, userText, userBody);
  }

  // Markdown fallback: only with explicit Черновик (never whole window).
  if (!DRAFT_HEADER_RE.test(raw) && !ANCHOR_RE.test(raw)) {
    return null;
  }

  const text = extractDraftBody(raw);
  if (!text.trim()) return null;

  const position = parseInsertPosition(userText);
  let kind: IntentApplyKind = "paste_text";
  let requireSelection = false;

  if (ADD_COMMENT_RE.test(userBody) || (COMMENT_HINT_RE.test(raw) && COMMENT_APPROVAL_RE.test(userBody))) {
    kind = "add_comment";
  } else if (
    ANCHOR_RE.test(raw) ||
    REWRITE_HINT_RE.test(raw) ||
    (/замени/i.test(userBody) && DRAFT_HEADER_RE.test(raw))
  ) {
    kind = "replace_selection";
    requireSelection = true;
  } else if (HTML_HINT_RE.test(text) && /<\/(?:p|div|table|span|strong|em)>/i.test(text)) {
    kind = "paste";
  }

  const intent: DocumentApplyIntent = { kind, position, text: text.trim() };
  const task = intentToR7Task(intent);
  return {
    tasks: [task],
    dedupeKeys: [intentApplyKey(intent), `intent-plan:${taskContentFingerprint(task)}`],
    requireSelection,
    source: "markdown-fallback",
  };
}

/** @deprecated use resolveDocumentApplyPlan */
export function resolveDocumentApplyIntent(
  userText: string,
  messages: ChatMessage[],
): DocumentApplyIntent | null {
  const plan = resolveDocumentApplyPlan(userText, messages);
  if (!plan || plan.tasks.length !== 1) return null;
  const t = plan.tasks[0];
  if (t.type === "search_replace" || t.type === "cell_paste") return null;
  const text =
    typeof t.data === "string"
      ? t.data
      : t.data && typeof t.data === "object" && typeof (t.data as { text?: string }).text === "string"
        ? (t.data as { text: string }).text
        : "";
  if (!text && t.type !== "add_comment") return null;
  const position =
    t.data && typeof t.data === "object" && "position" in (t.data as object)
      ? ((t.data as { position?: InsertPosition }).position ?? "cursor")
      : "cursor";
  return {
    kind: t.type as IntentApplyKind,
    position,
    text:
      t.type === "add_comment" && t.data && typeof t.data === "object"
        ? String((t.data as { text?: string }).text ?? "")
        : text,
  };
}

function planFromProposal(
  proposal: R7ProposalV1,
  userText: string,
  userBody: string,
): DocumentApplyPlan | null {
  if (proposal.kind === "findings") {
    // «да» alone after findings — refuse; need «исправь …»
    return null;
  }

  if (proposal.kind === "cell_map" && proposal.data) {
    const task: R7Task = { type: "cell_paste", data: proposal.data };
    return {
      tasks: [task],
      dedupeKeys: [`intent:cell_map:${taskContentFingerprint(task)}`],
      requireSelection: false,
      source: "proposal",
      statusHint: "Записываю ячейки…",
    };
  }

  if (proposal.kind === "comment") {
    const text = (proposal.text || "").trim();
    if (!text) return null;
    if (
      !(
        ADD_COMMENT_RE.test(userBody) ||
        COMMENT_APPROVAL_RE.test(userBody) ||
        APPROVAL_SHORT_RE.test(userBody) ||
        APPROVAL_RE.test(userBody)
      )
    ) {
      return null;
    }
    const task: R7Task = { type: "add_comment", data: { text } };
    return {
      tasks: [task],
      dedupeKeys: [`intent:comment:${hashText(text)}`],
      requireSelection: true,
      source: "proposal",
      statusHint: "Добавляю комментарий…",
    };
  }

  // blob
  const text = (proposal.text || "").trim();
  if (!text) return null;
  const position =
    parseInsertPosition(userText) !== "cursor"
      ? parseInsertPosition(userText)
      : proposal.defaultPosition || "cursor";

  let op = proposal.op || "paste_text";
  let requireSelection = false;
  if (proposal.preferReplaceSelection || op === "replace_selection") {
    op = "replace_selection";
    requireSelection = true;
  }
  if (ADD_COMMENT_RE.test(userBody)) {
    const task: R7Task = { type: "add_comment", data: { text } };
    return {
      tasks: [task],
      dedupeKeys: [`intent:comment:${hashText(text)}`],
      requireSelection: true,
      source: "proposal",
    };
  }

  const intent: DocumentApplyIntent = {
    kind: op,
    position,
    text,
  };
  const task = intentToR7Task(intent);
  return {
    tasks: [task],
    dedupeKeys: [intentApplyKey(intent), `intent-plan:${taskContentFingerprint(task)}`],
    requireSelection,
    source: "proposal",
  };
}

function findingsToPlan(
  items: ProposalFindingItem[],
  fix: FixIntent,
  revision?: number,
): DocumentApplyPlan | null {
  let selected = items;
  if (fix.mode === "ids") {
    const want = new Set(fix.ids);
    selected = items.filter((it) => want.has(it.id));
  }
  selected = selected.slice(0, MAX_FINDINGS);
  if (!selected.length) return null;

  const tasks: R7Task[] = selected.map((it) => ({
    type: "search_replace" as const,
    data: {
      search: it.search,
      replace: it.replace,
      matchCase: it.matchCase === true,
    },
  }));
  const ids = selected.map((it) => it.id);
  const rev = revision ?? 1;
  return {
    tasks,
    dedupeKeys: [
      `intent:findings:r${rev}:${ids.join(",")}`,
      ...tasks.map((t) => `intent-plan:${taskContentFingerprint(t)}`),
    ],
    requireSelection: false,
    itemIds: ids,
    source: "proposal",
    statusHint:
      fix.mode === "all"
        ? `Вношу ${tasks.length} замен…`
        : `Вношу замены по пунктам ${ids.join(", ")}…`,
  };
}

/** Convert intent into an R7Task for applyEditorTasks. */
export function intentToR7Task(intent: DocumentApplyIntent): R7Task {
  if (intent.kind === "add_comment") {
    return { type: "add_comment", data: { text: intent.text } };
  }
  if (intent.kind === "replace_selection") {
    return { type: "replace_selection", data: intent.text };
  }
  if (intent.kind === "paste") {
    return intent.position === "cursor"
      ? { type: "paste", data: intent.text }
      : { type: "paste", data: { text: intent.text, position: intent.position } };
  }
  if (intent.kind === "search_replace" || intent.kind === "cell_paste") {
    throw new Error(`intentToR7Task: use plan for ${intent.kind}`);
  }
  return intent.position === "cursor"
    ? { type: "paste_text", data: intent.text }
    : { type: "paste_text", data: { text: intent.text, position: intent.position } };
}

/** Stable fingerprint for dedupe of intent-applied tasks. */
export function intentApplyKey(intent: DocumentApplyIntent): string {
  return `intent:${intent.kind}:${intent.position}:${intent.text.length}:${hashText(intent.text)}`;
}

export function planDedupeHit(
  plan: DocumentApplyPlan,
  appliedKeys: Set<string>,
): boolean {
  return plan.dedupeKeys.some((k) => appliedKeys.has(k));
}

function findLastAssistantDraft(messages: ChatMessage[]): ChatMessage | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role !== "assistant") continue;
    const t = (m.text || "").trim();
    if (!t || isAssistantWorkingPlaceholderText(t)) continue;
    if (m.widget || m.waitingForInput) continue;
    return m;
  }
  return null;
}

/**
 * Prefer content under Черновик:; never paste status / якорь / «Заменить…?».
 */
export function extractDraftBody(assistantText: string): string {
  const raw = assistantText.trim();
  if (!raw) return "";

  if (DRAFT_HEADER_RE.test(raw)) {
    const parts = raw.split(DRAFT_HEADER_RE);
    let body = (parts[parts.length - 1] || "").trim();
    body = body.split(/\n---\s*\n/)[0]?.trim() ?? body;
    const askIdx = body.search(ASK_INSERT_RE);
    if (askIdx >= 0) body = body.slice(0, askIdx).trim();
    return finalizeDraftBody(body);
  }

  let body = raw;
  const askIdx = body.search(ASK_INSERT_RE);
  if (askIdx > 40) body = body.slice(0, askIdx).trim();

  if (ANCHOR_RE.test(body)) {
    const afterAnchor = body.split(/\n---\s*\n/);
    if (afterAnchor.length > 1) {
      body = afterAnchor.slice(1).join("\n---\n").trim();
    }
  }

  return finalizeDraftBody(body);
}

function finalizeDraftBody(body: string): string {
  return body
    .replace(/^\*{0,2}черновик(?:\s*\([^)]*\))?\s*:?\*{0,2}\s*/i, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function stripUserContextBlocks(text: string): string {
  return text
    .replace(/\n*---\s*\n\[Контекст R7:[^\]]*\][\s\S]*?\n---/g, "")
    .replace(/\n*\[Контекст R7: диск\][\s\S]*$/g, "")
    .replace(/```r7\.event[\s\S]*?```/gi, "")
    .replace(/```r7\.proposal[\s\S]*?```/gi, "")
    .trim();
}

function isAssistantWorkingPlaceholderText(text: string): boolean {
  return /агент (?:выполняет|формирует)/i.test(text.trim());
}

function isStructuredEditDraft(text: string): boolean {
  if (/\|\s*№\s*\|\s*Было\s*\|\s*Стало\s*\|/i.test(text)) return true;
  if (/исправь\s+все|исправь\s+\d/i.test(text)) return true;
  if (/записать\s+эти\s+значения|адрес\s*→\s*значение/i.test(text)) return true;
  if (/^\s*[A-Z]{1,3}\d+\s*[:=]/m.test(text) && (text.match(/[A-Z]{1,3}\d+/g) || []).length >= 2) {
    return true;
  }
  return false;
}

function taskContentFingerprint(task: R7Task): string {
  return `${task.type}:${JSON.stringify(task.data)}`;
}

function hashText(text: string): string {
  let h = 0;
  for (let i = 0; i < text.length; i++) {
    h = (h * 31 + text.charCodeAt(i)) | 0;
  }
  return String(h);
}
