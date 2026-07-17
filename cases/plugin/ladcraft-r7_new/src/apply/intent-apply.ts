import type { ChatMessage } from "../ui/chat";
import type { InsertPosition } from "./types";
import type { R7Task } from "./task-parse";

export type IntentApplyKind = "paste_text" | "paste" | "replace_selection" | "add_comment";

export interface DocumentApplyIntent {
  kind: IntentApplyKind;
  position: InsertPosition;
  text: string;
}

const APPROVAL_RE =
  /(?:^|\s)(?:вставь(?:те)?(?:\s+это)?|вставим|одобряю|примени(?:ть)?|замени(?:ть)?|в\s+документ)(?:\s|$|[.!,])/i;
const APPROVAL_SHORT_RE = /^(?:да|ок|ok|yes|ага|угу)[.!]?$/i;
const ADD_COMMENT_RE = /(?:добавь(?:те)?|внеси(?:те)?)\s+комментар/i;
const COMMENT_APPROVAL_RE =
  /^(?:да|ок|ok|добавь(?:те)?|одобряю|примени(?:ть)?)[.!]?$/i;

const POS_START_RE = /в\s+начал(?:о|е)(?:\s+документ)?/i;
const POS_END_RE = /в\s+конец(?:\s+документ)?/i;
const POS_CURSOR_RE = /(?:у|в\s+позици\w*)\s+курсор/i;

/** Matches «Черновик:», «**Черновик (одной фразой):**», «### Черновик» etc. */
const DRAFT_HEADER_RE =
  /(?:^|\n)#{0,3}\s*\*{0,2}\s*черновик(?:\s*\([^)]*\))?\s*\*{0,2}\s*:?\s*\*{0,2}\s*(?:\n|$)/i;
const ANCHOR_RE = /исходный\s+якорь/i;
const REWRITE_HINT_RE = /заменю\s+выделен|вместо\s+выделен|replace_selection/i;
const COMMENT_HINT_RE = /комментари[йя]|добавить\s+комментар/i;
const HTML_HINT_RE = /<[a-z][\s\S]*>/i;

/** Trailing confirmation / CTA — must not go into the document. */
const ASK_INSERT_RE =
  /(?:^|\n)(?:---\s*\n)?(?:заменить\s+(?:абзац|выделен\w*)|вставить\s+(?:текст|это|черновик)?\s*(?:в\s+документ)?|заменю\s+выделен|вставить\s*\?|«вставь»|"вставь")/i;

/** True when user text is an approval to apply a pending chat draft into the document. */
export function isDocumentApplyApproval(userText: string): boolean {
  const body = stripUserContextBlocks(userText).trim();
  if (!body) return false;
  if (APPROVAL_SHORT_RE.test(body)) return true;
  if (ADD_COMMENT_RE.test(body)) return true;
  if (APPROVAL_RE.test(body)) return true;
  if (/^да[.!]?\s*(?:вставь|одобряю|примени)/i.test(body)) return true;
  return false;
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
 * Build an editor task from user approval + last assistant draft.
 * Returns null when there is nothing safe to apply.
 */
export function resolveDocumentApplyIntent(
  userText: string,
  messages: ChatMessage[],
): DocumentApplyIntent | null {
  if (!isDocumentApplyApproval(userText)) return null;

  const draftMsg = findLastAssistantDraft(messages);
  if (!draftMsg) return null;

  const raw = draftMsg.text.trim();
  if (!raw || isAssistantWorkingPlaceholderText(raw)) return null;

  const userBody = stripUserContextBlocks(userText).trim();

  // Short «да» must not steal proofread/cell flows (those need search_replace / cell_paste tools).
  if (APPROVAL_SHORT_RE.test(userBody)) {
    if (isStructuredEditDraft(raw)) return null;
  }

  const text = extractDraftBody(raw);
  if (!text.trim()) return null;

  const position = parseInsertPosition(userText);

  if (ADD_COMMENT_RE.test(userBody) || (COMMENT_HINT_RE.test(raw) && COMMENT_APPROVAL_RE.test(userBody))) {
    return { kind: "add_comment", position: "cursor", text: text.trim() };
  }

  // Rewrite drafts: anchor + Черновик → replace selection (ignore start/end position).
  if (ANCHOR_RE.test(raw) || REWRITE_HINT_RE.test(raw) || (/замени/i.test(userBody) && DRAFT_HEADER_RE.test(raw))) {
    return { kind: "replace_selection", position: "cursor", text: text.trim() };
  }

  if (HTML_HINT_RE.test(text) && /<\/(?:p|div|table|span|strong|em)>/i.test(text)) {
    return { kind: "paste", position, text: text.trim() };
  }

  return { kind: "paste_text", position, text: text.trim() };
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
  return intent.position === "cursor"
    ? { type: "paste_text", data: intent.text }
    : { type: "paste_text", data: { text: intent.text, position: intent.position } };
}

/** Stable fingerprint for dedupe of intent-applied tasks. */
export function intentApplyKey(intent: DocumentApplyIntent): string {
  return `intent:${intent.kind}:${intent.position}:${intent.text.length}:${hashText(intent.text)}`;
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
 * Example rewrite bubble:
 *   Читаю контекст…
 *   **Исходный якорь** … --- **Черновик (одной фразой):** <draft> --- Заменить абзац?
 */
export function extractDraftBody(assistantText: string): string {
  const raw = assistantText.trim();
  if (!raw) return "";

  // Rewrite / generate: take only the section after the Черновик header.
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

  // Drop leading status / anchor blocks when no explicit Черновик header.
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
    .trim();
}

function isAssistantWorkingPlaceholderText(text: string): boolean {
  return /агент (?:выполняет|формирует)/i.test(text.trim());
}

/** Proofread tables / cell maps — not single-blob paste; keep tool_call path. */
function isStructuredEditDraft(text: string): boolean {
  if (/\|\s*№\s*\|\s*Было\s*\|\s*Стало\s*\|/i.test(text)) return true;
  if (/исправь\s+все|исправь\s+\d/i.test(text)) return true;
  if (/записать\s+эти\s+значения|адрес\s*→\s*значение/i.test(text)) return true;
  if (/^\s*[A-Z]{1,3}\d+\s*[:=]/m.test(text) && (text.match(/[A-Z]{1,3}\d+/g) || []).length >= 2) {
    return true;
  }
  return false;
}

function hashText(text: string): string {
  let h = 0;
  for (let i = 0; i < text.length; i++) {
    h = (h * 31 + text.charCodeAt(i)) | 0;
  }
  return String(h);
}
