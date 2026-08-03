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
  source: "proposal" | "markdown-fallback" | "missing-proposal" | "lexical";
  statusHint?: string;
}

/** UI status when approval has no proposal — message is forwarded to the agent. */
export const MISSING_PROPOSAL_STATUS = "Готовлю ответ…";

/** Appended to the user turn so the agent regenerates with a fence (visible on Ladcraft site). */
export const MISSING_PROPOSAL_AGENT_NOTE =
  "[Плагин: в предыдущем ответе ассистента нет валидного r7.proposal. Повтори insertable текст (саммари/черновик) целиком и добавь в конец fence ```r7.proposal с полным text. Вставку в документ сделает плагин после следующей фразы «вставь».]";

/** @deprecated single-intent shape kept for tests / exports */
export interface DocumentApplyIntent {
  kind: IntentApplyKind;
  position: InsertPosition;
  text: string;
}

const APPROVAL_RE =
  /(?:^|\s)(?:вставь(?:те)?(?:\s+это)?|вставим|одобряю|примени(?:ть)?|в\s+документ|запиши(?:те)?)(?:\s|$|[.!,])/i;
const APPROVAL_SHORT_RE = /^(?:да|ок|ok|yes|ага|угу)[.!]?$/i;
/** Bare «замени» = replace selection with last draft (not «замени X на Y»). */
const REPLACE_SHORT_RE = /^замени(?:те)?[.!]?$/i;
const ADD_COMMENT_RE =
  /(?:добавь(?:те)?|внеси(?:те)?|вставь(?:те)?|оставь(?:те)?)\s+комментар\S*/i;
const COMMENT_APPROVAL_RE =
  /^(?:да|ок|ok|добавь(?:те)?|одобряю|примени(?:ть)?)[.!]?$/i;
/** Short «добавь» / «добавь комментарий» = approve pending comment proposal. */
const COMMENT_APPROVAL_SHORT_RE =
  /^(?:добавь(?:те)?|внеси(?:те)?|вставь(?:те)?)(?:\s+комментар\S*)?[.!]?$/i;

/**
 * New task with anchor/text («добавь комментарий к слову X: …») — not approval of a prior draft.
 * Must go to local Asc plan or agent skill, never to «apply last blob».
 */
export function isNewCommentComposeRequest(userText: string): boolean {
  const body = stripUserContextBlocks(userText).trim();
  if (!body || !ADD_COMMENT_RE.test(body)) return false;
  if (COMMENT_APPROVAL_SHORT_RE.test(body)) return false;
  if (COMMENT_APPROVAL_RE.test(body) && body.length <= 12) return false;
  return (
    /(?:к\s+(?:слову|фразе|выделени\w*)|:\s*\S)/i.test(body) || body.length > 40
  );
}

/** User asks to replace the current editor selection with the last draft/proposal. */
const REPLACE_SELECTION_USER_RE =
  /замени(?:те)?\s+(?:выделен\w*|фрагмент|абзац)|вместо\s+выделен|замени(?:те)?[\s\S]{0,48}\s+на\s+(?:это|предложенн\w*)\s+(?:предложение|текст|фрагмент)?|вставь(?:те)?\s+вместо\s+выделен/i;

/**
 * Lexical «замени слово X на Y» / «замени "a" на "b"».
 * Plugin applies Asc SearchAndReplace locally when pairs parse cleanly.
 */
const LEXICAL_SEARCH_REPLACE_RE =
  /замени(?:те)?\s+(?:слово\s+|фрагмент\s+|текст\s+)?(?:«[^»]+»|"[^"]+"|„[^“]+“|'[^']+'|[^\s«»"]+)\s+на\s+(?!это\b|предложенн|выделен)(?:«[^»]+»|"[^"]+"|„[^“]+“|'[^']+'|[^\s«»"]+)/i;

/** Pronouns that mean «last findings», not literal search text. */
const FINDINGS_PRONOUN_TOKEN_RE =
  /^(?:их|эти|найденн\w*|эти\s+вхожден\w*|эти\s+слова|эти\s+ошибк\w*|все\s+эти)$/i;

/**
 * «замени их [на Y]» / «исправь их» after a findings table —
 * resolve pronoun to last proposal searches (not literal «их»).
 */
const FINDINGS_PRONOUN_REPLACE_RE =
  /^(?:замени(?:те)?|исправь(?:те)?)\s+(?:все\s+)?(эти\s+вхожден\w*|эти\s+слова|эти\s+ошибк\w*|найденн\w*|все\s+эти|их|эти)(?:\s+на\s+(?!это\b|предложенн|выделен)(«[^»]+»|"[^"]+"|„[^“]+“|'[^']+'|[^\s«»"—–,-]+))?/i;

/** One `A на B` pair (quoted or bare token). */
const LEXICAL_PAIR_RE =
  /(?:слово\s+|фрагмент\s+|текст\s+)?(«[^»]+»|"[^"]+"|„[^“]+“|'[^']+'|[^\s«»"]+)\s+на\s+(?!это\b|предложенн|выделен)(«[^»]+»|"[^"]+"|„[^“]+“|'[^']+'|[^\s«»"]+)/i;

const POS_START_RE = /в\s+начал(?:о|е)(?:\s+документ)?/i;
const POS_END_RE = /в\s+конец(?:\s+документ)?/i;
const POS_CURSOR_RE = /(?:у|в\s+позици\w*)\s+курсор/i;

const FIX_ALL_RE =
  /исправь(?:те)?\s+(?:все|остальн\w*)|да,?\s*исправь(?:те)?|исправь(?:те)?\s+опечатк|примени(?:ть)?\s+все\s+замен/i;
const FIX_IDS_RE =
  /(?:исправь(?:те)?|только)\s+((?:\d+\s*[,и]?\s*)+)/i;
/** «исправь орфографию / пунктуацию / грамматику / стилистику / речевые / логику» */
const FIX_CATEGORY_RE =
  /исправь(?:те)?\s+(орфограф\w*|пунктуац\w*|грамматич\w*|стилист\w*|речев\w*|логик\w*|правописан\w*)/i;

/**
 * Mechanical «правописание» categories — safe for one-click chips / «исправь все».
 * speech / logic stay chat-only (no auto chips).
 */
export const MECHANICAL_FINDING_CATEGORIES = [
  "orthography",
  "punctuation",
  "grammar",
] as const;

export type MechanicalFindingCategory =
  (typeof MECHANICAL_FINDING_CATEGORIES)[number];

export function isMechanicalFindingCategory(
  category: string | null | undefined,
): boolean {
  const c = String(category || "")
    .trim()
    .toLowerCase();
  return (MECHANICAL_FINDING_CATEGORIES as readonly string[]).includes(c);
}

export function findingsHaveCategoryTags(
  items: { category?: string }[],
): boolean {
  return items.some(
    (it) => typeof it.category === "string" && Boolean(it.category.trim()),
  );
}

/** Map user phrase → proposal item.category (LCA). */
export function fixCategoryFromPhrase(phrase: string): string | null {
  const p = String(phrase || "").toLowerCase();
  if (/правописан/.test(p)) return "__mechanical__";
  if (/орфограф/.test(p)) return "orthography";
  if (/пунктуац/.test(p)) return "punctuation";
  if (/грамматич/.test(p)) return "grammar";
  if (/стилист|речев/.test(p)) return "speech";
  if (/логик/.test(p)) return "logic";
  return null;
}

/** «измени только согласно» / «исправь только в течении» — match findings by search text. */
const FIX_ONLY_WORD_RE =
  /(?:измени(?:те)?|замени(?:те)?|исправь(?:те)?)\s+только\s+(.+?)\s*$/i;

/** Matches «Черновик:», «**Черновик (одной фразой):**», «### Черновик» etc. */
const DRAFT_HEADER_RE =
  /(?:^|\n)#{0,3}\s*\*{0,2}\s*черновик(?:\s*\([^)]*\))?\s*\*{0,2}\s*:?\s*\*{0,2}\s*(?:\n|$)/i;
const ANCHOR_RE = /исходный\s+якорь/i;
const REWRITE_HINT_RE = /заменю\s+выделен|вместо\s+выделен|replace_selection/i;
const COMMENT_HINT_RE = /комментари[йя]|добавить\s+комментар/i;
const HTML_HINT_RE = /<[a-z][\s\S]*>/i;

const ASK_INSERT_RE =
  /(?:^|\n)(?:---\s*\n)?[ \t]*(?:\*{1,2}|_{1,2})?[ \t]*(?:заменить\s+(?:абзац|выделен\w*)|вставить(?:те)?(?:\s+(?:текст|это|черновик))?(?:\s+в\s+документ)?[ \t]*\??|заменю\s+выделен|«вставь»|"вставь"|вставь(?:те)?[ \t]*\??)[ \t]*(?:\*{1,2}|_{1,2})?/i;

/** Chat CTA / follow-up after the insertable body (not part of document). */
const CTA_FOLLOWUP_RE =
  /(?:^|\n)(?:---\s*\n)?[ \t]*(?:\*{1,2}|_{1,2})?[ \t]*(?:хотите[,.]?\s+чтобы|могу\s+(?:ещё\s+)?(?:вставить|проверить|подготовить)|подготов\w*\s+proposal\s+для|что\s+дальше\s*\??)[ \t]*(?:\*{1,2}|_{1,2})?/i;

/** Single trailing line that is only an insert CTA (with optional bold/---). */
const INSERT_CTA_LINE_RE =
  /^(?:---\s*)?(?:\*{1,2}|_{1,2})?\s*(?:хотите[,.]?\s+чтобы\s+)?(?:вставить(?:те)?(?:\s+(?:текст|это|черновик))?(?:\s+в\s+документ)?\s*\??|заменю\s+выделен\w*|заменить\s+(?:абзац|выделен\w*)|«вставь»|"вставь"|вставь(?:те)?\s*\??)\s*(?:\*{1,2}|_{1,2})?\s*$/i;

/**
 * Hard chat/doc separator: a line that is only the speech-bubble marker.
 * Ordinary markdown `---` / `__________` stay inside the insertable body.
 */
const CHAT_SEP_LINE_RE = /^💬(?:\s*[·•.]?)?\s*$/u;

/**
 * First line after separator that marks chat-only commentary.
 * Avoid \\b — in JS it does not treat Cyrillic as word chars.
 */
const CHAT_COMMENT_HEAD_RE =
  /^(?:#{0,3}\s*)?(?:\*{1,2}|_{1,2})?\s*(?:кстати|что\s+дальше|вставить\s+в\s+документ|если\s+нужно|могу\s+(?:ещё\s+)?(?:проверить|вставить|показать)|пояснени|исправить\s+\d|напишите\s+\*\*исправь)/i;

/** Short analyze one-liner without Черновик (for «да» / «вставь это» / replace). */
const APPLYABLE_BLOB_MAX_CHARS = 800;
/** Structured summary / long draft via markdown-fallback. */
const INSERTABLE_DRAFT_MAX_CHARS = 12000;

const MAX_FINDINGS = 40;

export type FixIntent =
  | { mode: "all" }
  | { mode: "ids"; ids: number[] }
  | { mode: "category"; category: string };

/** True when user asks to replace the current selection with the last draft. */
export function isReplaceSelectionUserIntent(userText: string): boolean {
  const body = stripUserContextBlocks(userText).trim();
  if (!body) return false;
  if (REPLACE_SHORT_RE.test(body)) return true;
  return REPLACE_SELECTION_USER_RE.test(body);
}

/**
 * True for lexical search/replace («замени слово плагин на plugin»).
 * Must not trigger local draft-paste; plugin uses planLexicalSearchReplace instead.
 */
export function isLexicalSearchReplaceIntent(userText: string): boolean {
  const body = stripUserContextBlocks(userText).trim();
  if (!body) return false;
  if (isReplaceSelectionUserIntent(body)) return false;
  if (isFindingsPronounReplaceIntent(body)) return false;
  return LEXICAL_SEARCH_REPLACE_RE.test(body);
}

/** True when «замени их [на Y]» / «исправь их» refers to last findings. */
export function isFindingsPronounReplaceIntent(userText: string): boolean {
  const body = stripUserContextBlocks(userText).trim();
  if (!body || body.length > 240) return false;
  if (isReplaceSelectionUserIntent(body)) return false;
  return FINDINGS_PRONOUN_REPLACE_RE.test(body);
}

function unwrapLexicalToken(raw: string): string {
  const s = String(raw || "").trim();
  if (
    (s.startsWith("«") && s.endsWith("»")) ||
    (s.startsWith('"') && s.endsWith('"')) ||
    (s.startsWith("'") && s.endsWith("'")) ||
    (s.startsWith("„") && s.endsWith("“"))
  ) {
    return s.slice(1, -1).trim();
  }
  return s;
}

/** Parse 1..15 literal search→replace pairs from «замени A на B [и C на D]». */
export function parseLexicalSearchReplacePairs(
  userText: string,
): Array<{ search: string; replace: string }> {
  const body = stripUserContextBlocks(userText).trim();
  if (!isLexicalSearchReplaceIntent(body)) return [];
  let rest = body.replace(/^замени(?:те)?\s+/i, "");
  // Split multi-pair «A на B и C на D» on standalone «и» between pairs.
  const chunks = rest
    .split(/\s+и\s+(?=(?:слово\s+|фрагмент\s+|текст\s+)?(?:«|"|'|„|\S+\s+на\s+))/i)
    .map((c) => c.trim())
    .filter(Boolean);
  const pairs: Array<{ search: string; replace: string }> = [];
  for (const chunk of chunks) {
    if (pairs.length >= MAX_FINDINGS) break;
    const re = new RegExp(LEXICAL_PAIR_RE.source, "i");
    const m = chunk.match(re);
    if (!m) continue;
    const search = unwrapLexicalToken(m[1]);
    const replace = unwrapLexicalToken(m[2]);
    if (!search || replace === undefined) continue;
    if (search === replace) continue;
    // «замени их на под» must not become SearchAndReplace("их"→"под").
    if (FINDINGS_PRONOUN_TOKEN_RE.test(search)) continue;
    pairs.push({ search, replace });
  }
  return pairs;
}

/** Local Asc plan for literal X→Y (no agent turn). */
export function planLexicalSearchReplace(userText: string): DocumentApplyPlan | null {
  const pairs = parseLexicalSearchReplacePairs(userText);
  if (!pairs.length) return null;
  const tasks: R7Task[] = pairs.map((p) => ({
    type: "search_replace" as const,
    data: { search: p.search, replace: p.replace, matchCase: false },
  }));
  const label = pairs
    .slice(0, 3)
    .map((p) => `«${p.search}»→«${p.replace}»`)
    .join(", ");
  return {
    tasks,
    dedupeKeys: [
      `intent:lexical:${pairs.map((p) => `${p.search}=>${p.replace}`).join("|")}`,
      ...tasks.map((t) => `intent-plan:${taskContentFingerprint(t)}`),
    ],
    requireSelection: false,
    source: "lexical",
    statusHint:
      pairs.length === 1
        ? `Заменяю ${label}…`
        : `Заменяю ${pairs.length} пар (${label}${pairs.length > 3 ? "…" : ""})…`,
  };
}

/**
 * «замени их на Y» / «исправь их» → last findings proposal.
 * With «на Y»: override each finding's replace with Y (keep search phrases).
 * Without «на Y»: apply findings as proposed (search→replace).
 */
export function planFindingsPronounReplace(
  userText: string,
  messages: ChatMessage[],
): DocumentApplyPlan | null {
  const body = stripUserContextBlocks(userText).trim();
  if (!isFindingsPronounReplaceIntent(body)) return null;
  const m = body.match(FINDINGS_PRONOUN_REPLACE_RE);
  if (!m) return null;
  const replaceOverride = m[2] ? unwrapLexicalToken(m[2]) : null;

  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role !== "assistant" || msg.widget || msg.waitingForInput) continue;
    if (String(msg.id || "").startsWith("local-")) continue;
    const raw = assistantApplySource(msg);
    const proposal = parseR7Proposal(raw);
    if (proposal?.kind !== "findings" || !proposal.items?.length) {
      // Keep scanning if this assistant turn had no findings fence.
      continue;
    }
    const items = proposal.items.slice(0, MAX_FINDINGS);
    if (replaceOverride != null && replaceOverride !== "") {
      const tasks: R7Task[] = items.map((it) => ({
        type: "search_replace" as const,
        data: {
          search: it.search,
          replace: replaceOverride,
          matchCase: it.matchCase === true,
        },
      }));
      const ids = items.map((it) => it.id);
      const sample = items
        .slice(0, 3)
        .map((it) => `«${it.search}»`)
        .join(", ");
      return {
        tasks,
        dedupeKeys: [
          `intent:findings-pronoun:${replaceOverride}:${ids.join(",")}`,
          ...tasks.map((t) => `intent-plan:${taskContentFingerprint(t)}`),
        ],
        requireSelection: false,
        itemIds: ids,
        source: "proposal",
        statusHint: `Заменяю найденные (${sample}${items.length > 3 ? "…" : ""}) на «${replaceOverride}»…`,
      };
    }
    return findingsToPlan(items, { mode: "all" }, proposal.revision);
  }

  return {
    tasks: [],
    dedupeKeys: [],
    requireSelection: false,
    source: "proposal",
    statusHint:
      "Нет таблицы замечаний для «их». Сначала найдите вхождения или укажите «замени „X“ на „Y“».",
  };
}

/**
 * «измени только X» / «исправь только X» against last findings proposal (plugin-local).
 */
export function planFindingsBySearchHint(
  userText: string,
  messages: ChatMessage[],
): DocumentApplyPlan | null {
  const body = stripUserContextBlocks(userText).trim();
  if (!body || parseFixIntent(body) || isLexicalSearchReplaceIntent(body)) return null;
  const m = body.match(FIX_ONLY_WORD_RE);
  if (!m) return null;
  let hint = unwrapLexicalToken(m[1].replace(/[.!?…]+$/u, "").trim());
  hint = hint.replace(/^(?:слово|фрагмент|текст)\s+/i, "").trim();
  if (!hint || hint.length > 120) return null;

  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role !== "assistant" || msg.widget || msg.waitingForInput) continue;
    if (String(msg.id || "").startsWith("local-")) continue;
    const raw = assistantApplySource(msg);
    const proposal = parseR7Proposal(raw);
    if (proposal?.kind !== "findings" || !proposal.items?.length) break;
    const hintNorm = hint.toLowerCase();
    const matched = proposal.items.filter((it) => {
      const s = String(it.search || "").toLowerCase();
      const r = String(it.replace || "").toLowerCase();
      return (
        s === hintNorm ||
        r === hintNorm ||
        s.includes(hintNorm) ||
        hintNorm.includes(s) ||
        (s.length >= 3 && hintNorm.includes(s.slice(0, Math.min(s.length, 24))))
      );
    });
    if (!matched.length) {
      return {
        tasks: [],
        dedupeKeys: [],
        requireSelection: false,
        source: "proposal",
        statusHint: `В findings нет пары для «${hint}» — укажите номер из таблицы`,
      };
    }
    return findingsToPlan(matched, { mode: "ids", ids: matched.map((it) => it.id) }, proposal.revision);
  }
  return null;
}

/**
 * «убери все комментарии» / «удали комментарии» — Desktop Asc has no RemoveComments.
 * Handled by the plugin locally (explain limitation); do not send to the agent.
 */
export function isRemoveCommentsIntent(userText: string): boolean {
  const body = stripUserContextBlocks(userText).trim();
  if (!body || body.length > 160) return false;
  if (!/комментар/i.test(body)) return false;
  return /(?:убери|удали|сними|очисти|уберём|удалим)\s+(?:все\s+)?комментар/i.test(body);
}

/**
 * «добавь комментарий к слову арбитраж: тон слишком жёсткий…» → Asc locally (no agent).
 */
export function parseLocalCommentRequest(
  userText: string,
): { search: string; text: string } | null {
  const body = stripUserContextBlocks(userText).trim();
  if (!isNewCommentComposeRequest(body)) return null;

  const selectionOnly = body.match(
    /комментар\S*[\s\S]{0,80}?к\s+выделени\S*\s*[:—–\-]\s*([\s\S]+)$/i,
  );
  if (selectionOnly) {
    const text = selectionOnly[1].replace(/\s+/g, " ").trim();
    if (text) return { search: "", text };
  }

  const withAnchor = body.match(
    /комментар\S*[\s\S]{0,80}?(?:к\s+(?:слову|фразе)\s+)[«"„']?([^«"”'»:.\n]{1,80})[»"“']?\s*[:—–\-]\s*([\s\S]+)$/i,
  );
  if (withAnchor) {
    const search = unwrapLexicalToken(withAnchor[1]).trim();
    const text = withAnchor[2].replace(/\s+/g, " ").trim();
    if (text) return { search, text };
  }

  const colonOnly = body.match(/комментар\S*[^\n]{0,80}?\s*[:—–\-]\s*([\s\S]+)$/i);
  if (colonOnly) {
    const text = colonOnly[1].replace(/\s+/g, " ").trim();
    if (text) return { search: "", text };
  }

  return null;
}

/** Local Asc plan for comment with user-supplied text (skip LLM). */
export function planLocalComment(userText: string): DocumentApplyPlan | null {
  const parsed = parseLocalCommentRequest(userText);
  if (!parsed?.text) return null;
  const search = parsed.search.trim();
  const task: R7Task = {
    type: "add_comment",
    data: search ? { text: parsed.text, search } : { text: parsed.text },
  };
  return {
    tasks: [task],
    dedupeKeys: [`intent:local-comment:${hashText(parsed.text + "|" + search)}`],
    requireSelection: !search,
    source: "lexical",
    statusHint: search
      ? `Добавляю комментарий к «${search}»…`
      : "Добавляю комментарий…",
  };
}

/**
 * After agent reply: auto-apply findings when the user asked for lexical replace
 * (morphology / multi-form analysis). Not for bare «проверь».
 */
export function resolveFindingsAutoApplyPlan(
  messages: ChatMessage[],
  triggeringUserText?: string,
): DocumentApplyPlan | null {
  const trigger = stripUserContextBlocks(triggeringUserText || "").trim();
  let userBody = trigger;
  if (!userBody) {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === "user") {
        userBody = stripUserContextBlocks(messages[i].text || "").trim();
        break;
      }
    }
  }
  if (!userBody) return null;
  // Explicit replace request → apply findings immediately.
  // «исправь все» is handled on the next user send via parseFixIntent — skip here
  // unless the trigger itself is lexical (agent produced findings for X→Y).
  if (!isLexicalSearchReplaceIntent(userBody)) return null;

  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role !== "assistant" || m.widget || m.waitingForInput) continue;
    if (String(m.id || "").startsWith("local-")) continue;
    const raw = assistantApplySource(m);
    const proposal = parseR7Proposal(raw);
    if (proposal?.kind === "findings" && proposal.items?.length) {
      return planFromFindingsItems(proposal.items, { mode: "all" }, proposal.revision);
    }
    break;
  }
  return null;
}

/** Build search_replace plan from findings items (exported for buttons / auto-apply). */
export function planFromFindingsItems(
  items: ProposalFindingItem[],
  fix: FixIntent,
  revision?: number,
): DocumentApplyPlan | null {
  return findingsToPlan(items, fix, revision);
}

/** True when user text is an approval to apply a pending chat draft into the document. */
export function isDocumentApplyApproval(userText: string): boolean {
  const body = stripUserContextBlocks(userText).trim();
  if (!body) return false;
  // Lexical X→Y is handled by planLexicalSearchReplace, not draft paste approval.
  if (isLexicalSearchReplaceIntent(body)) return false;
  // «добавь комментарий к слову …: текст» is a new task, not approval of prior rewrite.
  if (isNewCommentComposeRequest(body)) return false;
  if (parseFixIntent(body)) return true;
  if (APPROVAL_SHORT_RE.test(body)) return true;
  if (COMMENT_APPROVAL_SHORT_RE.test(body) || COMMENT_APPROVAL_RE.test(body)) return true;
  if (isReplaceSelectionUserIntent(body)) return true;
  if (APPROVAL_RE.test(body)) return true;
  if (/^да[.!]?\s*(?:вставь|одобряю|примени)/i.test(body)) return true;
  return false;
}

export function parseFixIntent(userText: string): FixIntent | null {
  const body = stripUserContextBlocks(userText).trim();
  if (!body) return null;
  // Category before «все» / ids — «исправь стилистику» must not fall through.
  const catM = body.match(FIX_CATEGORY_RE);
  if (catM) {
    const category = fixCategoryFromPhrase(catM[1] || "");
    // «исправь правописание» ≡ mechanical all (орфо+пункт+грамм).
    if (category === "__mechanical__") return { mode: "all" };
    if (category) return { mode: "category", category };
  }
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

  // «замени слово X на Y» — local lexical plan (planLexicalSearchReplace), not draft paste.
  if (isLexicalSearchReplaceIntent(userBody)) return null;

  const draftMsg = findLastAssistantDraft(messages);
  if (!draftMsg) return null;

  const raw = assistantApplySource(draftMsg);
  if (!raw || isAssistantWorkingPlaceholderText(raw)) return null;

  const proposal = parseR7Proposal(raw);
  const fix = parseFixIntent(userBody);

  if (fix) {
    if (proposal?.kind === "findings" && proposal.items?.length) {
      return findingsToPlan(proposal.items, fix, proposal.revision);
    }
    // «исправь все» без актуальной таблицы — не запускать пустой/чужой SearchAndReplace.
    return {
      tasks: [],
      dedupeKeys: [],
      requireSelection: false,
      source: "missing-proposal",
      statusHint:
        "Нет таблицы замечаний для замены. Сначала выполните проверку (опечатки / стиль) — или укажите «замени „X“ на „Y“».",
    };
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

  // Fallback without fence: Черновик, else substantive summary (genre/CTA stripped).
  const hasDraftHeader = DRAFT_HEADER_RE.test(raw);
  const text = hasDraftHeader
    ? extractChernovikBody(raw)
    : extractInsertableSummaryBody(raw);
  if (!text.trim()) {
    return missingProposalPlan();
  }

  const wantsReplace = isReplaceSelectionUserIntent(userBody);
  const wantsInsertEto =
    /(?:^|\s)вставь(?:те)?\s+это(?:\s|$|[.!,])/i.test(userBody);
  const wantsInsertText = /вставь(?:те)?\s+текст/i.test(userBody);
  const wantsExplicitPosition =
    POS_START_RE.test(userBody) ||
    POS_END_RE.test(userBody) ||
    POS_CURSOR_RE.test(userBody);
  const wantsExplicitPaste =
    wantsInsertEto || wantsInsertText || wantsExplicitPosition;
  const isShortDa = APPROVAL_SHORT_RE.test(userBody);
  const summaryOk =
    isStructuredSummaryBlob(raw) ||
    isGenericInsertableDraft(raw) ||
    (hasDraftHeader && text.trim().length >= 20);

  if (
    !hasDraftHeader &&
    !summaryOk &&
    !APPROVAL_RE.test(userBody) &&
    !wantsReplace &&
    !isShortDa &&
    !wantsExplicitPaste
  ) {
    return missingProposalPlan();
  }

  if (
    !APPROVAL_RE.test(userBody) &&
    !wantsReplace &&
    !isShortDa &&
    !wantsExplicitPaste
  ) {
    // Buttons may show summary; silent auto-apply still needs approval phrase.
    return missingProposalPlan();
  }

  const position = parseInsertPosition(userText);
  let kind: IntentApplyKind = "paste_text";
  let requireSelection = false;

  if (ADD_COMMENT_RE.test(userBody) || (COMMENT_HINT_RE.test(raw) && COMMENT_APPROVAL_RE.test(userBody))) {
    kind = "add_comment";
    requireSelection = true;
  } else if (
    wantsReplace ||
    ANCHOR_RE.test(raw) ||
    REWRITE_HINT_RE.test(raw) ||
    REPLACE_SHORT_RE.test(userBody)
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

function missingProposalPlan(): DocumentApplyPlan {
  return {
    tasks: [],
    dedupeKeys: [],
    requireSelection: false,
    source: "missing-proposal",
    statusHint: MISSING_PROPOSAL_STATUS,
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
    const search = String(proposal.search || proposal.anchor || "").trim();
    const task: R7Task = {
      type: "add_comment",
      data: search ? { text, search } : { text },
    };
    return {
      tasks: [task],
      dedupeKeys: [`intent:comment:${hashText(text + "|" + search)}`],
      requireSelection: !search,
      source: "proposal",
      statusHint: "Добавляю комментарий…",
    };
  }

  // blob — full proposal.text (no HR pickBestBody; sections with --- stay intact)
  const text = sanitizeProposalText(proposal.text || "");
  if (!text) return null;
  const position =
    parseInsertPosition(userText) !== "cursor"
      ? parseInsertPosition(userText)
      : proposal.defaultPosition || "cursor";

  let op = proposal.op || "paste_text";
  let requireSelection = false;
  if (
    proposal.preferReplaceSelection ||
    op === "replace_selection" ||
    isReplaceSelectionUserIntent(userBody)
  ) {
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
    kind: op as IntentApplyKind,
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
  const anyTagged = findingsHaveCategoryTags(items);
  if (fix.mode === "ids") {
    const want = new Set(fix.ids);
    selected = items.filter((it) => want.has(it.id));
  } else if (fix.mode === "category") {
    const cat = fix.category;
    const withCat = items.filter(
      (it) => typeof it.category === "string" && it.category.toLowerCase() === cat,
    );
    // No category fields on any item → fail closed (other agents / old replies).
    if (!anyTagged) {
      return {
        tasks: [],
        dedupeKeys: [],
        requireSelection: false,
        source: "proposal",
        statusHint:
          "В ответе нет категорий ошибок. Укажите номера («исправь 1, 3») или запросите проверку заново.",
      };
    }
    selected = withCat;
  } else if (fix.mode === "all" && anyTagged) {
    // Tagged LCA findings: «все» / «Правописание» = mechanical only.
    selected = items.filter((it) => isMechanicalFindingCategory(it.category));
  }
  selected = selected.slice(0, MAX_FINDINGS);
  if (!selected.length) {
    if (fix.mode === "category") {
      return {
        tasks: [],
        dedupeKeys: [],
        requireSelection: false,
        source: "proposal",
        statusHint: "В таблице нет пунктов этой категории. Укажите номера или другую категорию.",
      };
    }
    if (fix.mode === "all" && anyTagged) {
      return {
        tasks: [],
        dedupeKeys: [],
        requireSelection: false,
        source: "proposal",
        statusHint:
          "Правописание уже исправлено (или его не было). Стилистику и логику — «исправь стилистику» / «исправь логику».",
      };
    }
    return null;
  }

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
  const catLabel: Record<string, string> = {
    orthography: "орфография",
    punctuation: "пунктуация",
    grammar: "грамматика",
    speech: "стилистика",
    logic: "логика",
  };
  const catHint =
    fix.mode === "category"
      ? tasks.length === 1
        ? `Вношу замену (${catLabel[fix.category] || fix.category})…`
        : `Вношу ${tasks.length} замен (${catLabel[fix.category] || fix.category})…`
      : null;
  const allHint =
    fix.mode === "all" && anyTagged
      ? tasks.length === 1
        ? "Исправляю правописание…"
        : `Вношу ${tasks.length} замен (правописание)…`
      : fix.mode === "all"
        ? tasks.length === 1
          ? "Исправляю замечание…"
          : `Вношу ${tasks.length} замен…`
        : null;
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
      catHint ||
      allHint ||
      (tasks.length === 1
        ? `Исправляю пункт ${ids[0]}…`
        : `Вношу ${tasks.length} замен…`),
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
  // Only whole-plan keys. Per-task `intent-plan:…` must NOT short-circuit a larger
  // plan (e.g. «исправь 1» then «Все» — item 1 key must not block items 2..N).
  return plan.dedupeKeys.some(
    (k) => !k.startsWith("intent-plan:") && appliedKeys.has(k),
  );
}

function findLastAssistantDraft(messages: ChatMessage[]): ChatMessage | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role !== "assistant") continue;
    // Same as resolveDocumentActionTarget — skip plugin acks so «исправь N»
    // still sees the findings table after a prior local-notice.
    if (String(m.id || "").startsWith("local-")) continue;
    const t = assistantApplySource(m);
    if (!t || isAssistantWorkingPlaceholderText(t)) continue;
    if (m.widget || m.waitingForInput) continue;
    return m;
  }
  return null;
}

/** Prefer applyText (keeps r7.proposal); display text is sanitized. */
export function assistantApplySource(message: ChatMessage): string {
  return (message.applyText || message.text || "").trim();
}

/**
 * Prefer content under Черновик:; otherwise empty (no full-chat dump).
 */
export function extractDraftBody(assistantText: string): string {
  return extractChernovikBody(assistantText);
}

/** @deprecated alias — use extractChernovikBody / extractInsertableSummaryBody */
export function extractInsertableMarkdown(assistantText: string): string {
  const draft = extractChernovikBody(assistantText);
  if (draft.trim()) return draft;
  return extractInsertableSummaryBody(assistantText);
}

/** @deprecated alias */
export function extractInsertableFullBody(assistantText: string): string {
  return extractInsertableMarkdown(assistantText);
}

/**
 * Insertable body when proposal is missing: only text under Черновик:.
 * Keeps --- inside the draft; no HR pickBestBody; genre/CTA outside header are ignored.
 */
export function extractChernovikBody(assistantText: string): string {
  const raw = assistantText.trim();
  if (!raw || !DRAFT_HEADER_RE.test(raw)) return "";

  const parts = raw.split(DRAFT_HEADER_RE);
  let body = stripFencedBlocks((parts[parts.length - 1] || "").trim());
  body = finalizeDraftBody(body);
  body = stripInsertCtaTail(body);

  return sanitizeProposalText(stripChatMetaLines(body));
}

/**
 * When model forgot Черновик/proposal: substantive markdown summary for buttons/paste.
 * Strips genre / CTA / English reasoning; keeps --- sections (no pickBestBody).
 */
export function extractInsertableSummaryBody(assistantText: string): string {
  const raw = assistantText.trim();
  if (!raw) return "";
  if (DRAFT_HEADER_RE.test(raw)) return extractChernovikBody(raw);

  const variant = extractRewriteVariantBody(raw);
  if (variant) return sanitizeProposalText(variant);

  let body = stripFencedBlocks(raw);
  body = stripChatMetaLines(body);
  body = stripInsertCtaTail(body);

  body = finalizeDraftBody(body);
  if (body.length <= APPLYABLE_BLOB_MAX_CHARS) {
    body = unwrapSingleEmphasis(body);
  }
  return sanitizeProposalText(body);
}

/** Drop genre / English thought / typo digests / «Активирую навык» from insertable body. */
function stripChatMetaLines(text: string): string {
  let body = text
    .split("\n")
    .filter((line) => {
      const t = line.trim();
      if (/^\*{0,2}жанр\s*:/i.test(t)) return false;
      if (/^активирую\b/i.test(t)) return false;
      if (/^активирован\b/i.test(t)) return false;
      if (/^slug\s*=/i.test(t)) return false;
      if (/проверка на опечатки\s*[—–-]\s*навык/i.test(t)) return false;
      if (/сначала читаю (?:документ|файл|контекст)/i.test(t)) return false;
      if (/^документ прочитан\b/i.test(t)) return false;
      if (/читаю правила\.?$/i.test(t)) return false;
      if (/определяю slug|формирую findings/i.test(t)) return false;
      if (/^the user is asking\b/i.test(t)) return false;
      if (/^let me (?:provide|read|check)\b/i.test(t)) return false;
      if (/^i (?:successfully|need to|will)\b/i.test(t)) return false;
      if (INSERT_CTA_LINE_RE.test(t)) return false;
      if (/^кстати(?:\s|,|:|—|–|-)/i.test(t) || /^кстати$/i.test(t)) return false;
      if (/^что\s+дальше/i.test(t)) return false;
      return true;
    })
    .join("\n");

  // Whole paragraphs about typos (must not ride along into analyze paste).
  body = body.replace(
    /(?:^|\n)\s*Текст содержит опечатк[\s\S]*?(?=\n\s*\n|\n\s*#{1,3}\s|\n\s*\*\*Черновик|\n```|$)/gi,
    "\n",
  );
  body = body.replace(
    /(?:^|\n)\s*(?:Нашёл|Найдены|Обнаружен\w*)\s+опечатк[\s\S]*?(?=\n\s*\n|\n```|$)/gi,
    "\n",
  );

  return body.replace(/\n{3,}/g, "\n\n").trim();
}

/**
 * Sanitize proposal.text / full-body fallback for document insert.
 * Always strip chat CTAs and anything after the `💬` chat separator.
 */
export function sanitizeProposalText(text: string): string {
  let body = String(text || "").replace(/^\uFEFF/, "").trim();
  if (!body) return "";
  const variant = extractRewriteVariantBody(body);
  if (variant) body = variant;
  body = stripAfterChatSeparator(body);
  body = stripChatMetaLines(body);
  body = stripInsertCtaTail(body);
  body = dedupeExactDouble(body);
  body = stripLeadingRewriteMeta(body);
  body = stripTrailingRewriteMeta(body);
  body = stripAfterChatSeparator(body);
  body = stripInsertCtaTail(body);
  body = finalizeDraftBody(body);
  body = dedupeExactDouble(body);
  return body.trim();
}

/**
 * Hard cut at first `💬` line: keep only text above.
 * Agent puts chat commentary («Кстати…», «Что дальше?») below this marker;
 * never paste the marker or anything after it into Word.
 */
export function stripAfterChatSeparator(text: string): string {
  const raw = String(text || "");
  if (!raw.trim()) return "";
  const lines = raw.split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (!CHAT_SEP_LINE_RE.test(lines[i].trim())) continue;
    // Skip a leading/only fence with no body above (malformed) — keep looking.
    const before = lines.slice(0, i).join("\n").trim();
    if (!before) continue;
    return before;
  }
  return raw.trim();
}

/**
 * Cut chat CTAs and trailing «💬 / Вставить…?» so they never enter Word.
 * Safe for short drafts: only cuts when CTA is after enough body (or CTA-only line).
 */
export function stripInsertCtaTail(text: string): string {
  let body = stripAfterChatSeparator(String(text || "").trim());
  if (!body) return "";

  const askIdx = body.search(ASK_INSERT_RE);
  if (askIdx > 40) body = body.slice(0, askIdx).trim();
  else if (askIdx === 0) body = "";

  const ctaIdx = body.search(CTA_FOLLOWUP_RE);
  if (ctaIdx > 40) body = body.slice(0, ctaIdx).trim();

  const lines = body.split("\n");
  while (lines.length) {
    const last = lines[lines.length - 1].trim();
    if (
      !last ||
      CHAT_SEP_LINE_RE.test(last) ||
      INSERT_CTA_LINE_RE.test(last) ||
      CHAT_COMMENT_HEAD_RE.test(last)
    ) {
      lines.pop();
      continue;
    }
    break;
  }
  return lines.join("\n").trim();
}

/**
 * Strip rewrite preamble/postamble and accidental doubled body before paste/replace.
 * Handles patterns like «Переписываю… --- body --- Что изменилось…» (sometimes twice).
 * Prefer sanitizeProposalText when source is r7.proposal.
 */
export function sanitizeInsertableBlob(text: string): string {
  let body = String(text || "").replace(/^\uFEFF/, "").trim();
  if (!body) return "";

  body = dedupeExactDouble(body);

  const hrBodies = extractBodiesBetweenHr(body);
  if (hrBodies.length) {
    body = pickBestBody(hrBodies);
  } else {
    body = stripLeadingRewriteMeta(body);
    body = stripTrailingRewriteMeta(body);
  }

  body = stripTrailingRewriteMeta(body);
  body = finalizeDraftBody(body);
  body = dedupeExactDouble(body);
  return body.trim();
}

function extractBodiesBetweenHr(text: string): string[] {
  if (!/\n---\s*\n/.test(text) && !/^---\s*\n/.test(text)) return [];
  const parts = text.split(/\n?---\s*\n/);
  if (parts.length < 2) return [];
  const out: string[] = [];
  for (let i = 1; i < parts.length; i++) {
    let seg = (parts[i] || "").trim();
    if (!seg) continue;
    if (isRewriteMetaSegment(seg)) continue;
    seg = stripTrailingRewriteMeta(seg);
    if (seg.length >= 20 && !isRewriteMetaSegment(seg)) out.push(seg);
  }
  return out;
}

function isRewriteMetaSegment(seg: string): boolean {
  const head = seg.slice(0, 160);
  return (
    /^переписываю\b/i.test(head) ||
    /^перепишу\b/i.test(head) ||
    /^что\s+изменилось\b/i.test(head) ||
    /^что\s+сокращено\b/i.test(head) ||
    /^изменения\s*:/i.test(head) ||
    /^исходный\s+якорь\b/i.test(head)
  );
}

function stripLeadingRewriteMeta(text: string): string {
  return text
    .replace(
      /^(?:переписываю|перепишу|ниже\s+(?:новый\s+)?(?:текст|черновик)|исходный\s+якорь|вариант\s+[^\n:]{0,60})[^\n]*(?:\n+|$)/i,
      "",
    )
    .trim();
}

function stripTrailingRewriteMeta(text: string): string {
  return text
    .replace(/\n+что\s+изменилось\s*:[\s\S]*$/i, "")
    .replace(/\n+что\s+сокращено\s*:[\s\S]*$/i, "")
    .replace(/\n+изменения\s*:[\s\S]*$/i, "")
    .replace(/\n+пояснени[ея]\s*:[\s\S]*$/i, "")
    .replace(/\n+(?:\*{1,2}|_{1,2})?\s*вставить(?:те)?(?:\s+(?:текст|это|черновик))?(?:\s+в\s+документ)?\s*\??\s*(?:\*{1,2}|_{1,2})?[\s\S]*$/i, "")
    .trim();
}

/**
 * Prefer body under «Вариант …:» / first blockquote before --- meta (rewrite chat dump).
 */
function extractRewriteVariantBody(text: string): string {
  const raw = String(text || "").trim();
  if (!raw) return "";
  const variant = raw.match(
    /(?:^|\n)(?:#{0,3}\s*)?(?:\*{0,2})?вариант[^\n:]{0,80}:\s*\*{0,2}\s*\n+([\s\S]+?)(?=\n---|\n+#{0,3}\s*\*{0,2}что\s+|\n+вставить\s*\?|$)/i,
  );
  if (variant?.[1]) {
    let body = variant[1].trim();
    body = body.replace(/^>\s?/gm, "").trim();
    if (body.length >= 12) return body;
  }
  // First fenced or blockquote paragraph before --- meta
  const beforeHr = raw.split(/\n---\s*\n/)[0] || raw;
  const bq = beforeHr.match(/(?:^|\n)>\s*([^\n]+(?:\n>\s*[^\n]+)*)/);
  if (bq?.[1]) {
    const body = bq[1].replace(/^>\s?/gm, "").trim();
    if (body.length >= 12 && !/^что\s+/i.test(body)) return body;
  }
  return "";
}

function pickBestBody(bodies: string[]): string {
  const uniq: string[] = [];
  for (const b of bodies) {
    if (!uniq.some((u) => u === b || normalizeForCompare(u) === normalizeForCompare(b))) {
      uniq.push(b);
    }
  }
  return uniq.sort((a, b) => b.length - a.length)[0] || bodies[0];
}

function normalizeForCompare(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

/** If payload is the same block pasted twice back-to-back, keep one copy. */
function dedupeExactDouble(text: string): string {
  const t = text.trim();
  if (t.length < 80) return t;

  const half = Math.floor(t.length / 2);
  const left = t.slice(0, half).trim();
  const right = t.slice(half).trim();
  if (left.length >= 40 && left === right) return left;

  for (const sep of ["\n\n", "\n---\n", "\n"]) {
    const min = Math.floor(t.length * 0.35);
    const max = Math.floor(t.length * 0.65);
    let from = min;
    while (from < max) {
      const idx = t.indexOf(sep, from);
      if (idx < 0 || idx > max) break;
      const a = t.slice(0, idx).trim();
      const b = t.slice(idx + sep.length).trim();
      if (a.length >= 40 && a === b) return a;
      from = idx + sep.length;
    }
  }

  const norm = normalizeForCompare(t);
  const nHalf = Math.floor(norm.length / 2);
  if (nHalf >= 40 && norm.slice(0, nHalf) === norm.slice(nHalf)) {
    return t.slice(0, Math.ceil(t.length / 2)).trim();
  }
  return t;
}

function extractBodyAfterHeaderSplit(raw: string, headerRe: RegExp): string {
  const parts = raw.split(headerRe);
  let body = stripFencedBlocks((parts[parts.length - 1] || "").trim());
  body = body.split(/\n---\s*\n/)[0]?.trim() ?? body;
  const askIdx = body.search(ASK_INSERT_RE);
  if (askIdx >= 0) body = body.slice(0, askIdx).trim();
  return finalizeDraftBody(body);
}

function finalizeDraftBody(body: string): string {
  return body
    .replace(/^\*{0,2}черновик(?:\s*\([^)]*\))?\s*:?\*{0,2}\s*/i, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function stripFencedBlocks(text: string): string {
  return text
    .replace(/```r7\.proposal[\s\S]*?```/gi, "")
    .replace(/```r7\.event[\s\S]*?```/gi, "")
    .replace(/```r7\.task[\s\S]*?```/gi, "")
    .trim();
}

function unwrapSingleEmphasis(text: string): string {
  const t = text.trim();
  const bold = t.match(/^\*\*([\s\S]+?)\*\*$/);
  if (bold) return bold[1].trim();
  const italic = t.match(/^\*([^*\n][\s\S]*?)\*$/);
  if (italic) return italic[1].trim();
  return t;
}

/** Short plain analyze reply suitable as insert/replace without Черновик. */
export function isApplyableAssistantBlob(
  raw: string,
  maxChars: number = APPLYABLE_BLOB_MAX_CHARS,
): boolean {
  const cleaned = stripFencedBlocks(raw.trim());
  if (!cleaned) return false;
  if (cleaned.length > maxChars) return false;
  if (isStructuredEditDraft(cleaned)) return false;
  if (/^\s*\|.+\|/m.test(cleaned)) return false;
  if (/исправь\s+(?:все|\d)/i.test(cleaned)) return false;
  const paragraphs = cleaned.split(/\n\s*\n/).filter((p) => p.trim());
  if (paragraphs.length > 2) return false;
  return !!unwrapSingleEmphasis(finalizeDraftBody(cleaned)).trim();
}

/** Multi-field summary (Название / Тип / Разделы…) — safe for «вставь» without proposal. */
export function isStructuredSummaryBlob(raw: string): boolean {
  const cleaned = stripFencedBlocks(raw.trim());
  if (!cleaned) return false;
  if (cleaned.length > INSERTABLE_DRAFT_MAX_CHARS) return false;
  if (isStructuredEditDraft(cleaned)) return false;
  const fieldLabels = cleaned.match(/\*\*[^*\n]{1,60}:\*\*/g) || [];
  if (fieldLabels.length >= 2) return true;
  if (
    /(?:кратк\w*\s+)?(?:summary|саммари|резюме)/i.test(cleaned) &&
    cleaned.length >= 200 &&
    (cleaned.match(/^\s*\d+\.\s+/gm) || []).length >= 2
  ) {
    return true;
  }
  return false;
}

/**
 * Substantial assistant body for explicit «вставь текст» / position phrases.
 * Broader than structured summary; still refuses findings / «Читаю контекст».
 */
export function isGenericInsertableDraft(raw: string): boolean {
  const cleaned = stripFencedBlocks(raw.trim());
  if (!cleaned) return false;
  if (cleaned.length > INSERTABLE_DRAFT_MAX_CHARS) return false;
  if (isStructuredEditDraft(cleaned)) return false;
  if (/^\s*читаю\s+контекст/i.test(cleaned)) return false;
  if (isAssistantWorkingPlaceholderText(cleaned)) return false;
  const askIdx = cleaned.search(ASK_INSERT_RE);
  if (askIdx >= 0 && askIdx < 40) return false;
  const body = extractInsertableSummaryBody(raw);
  return body.trim().length >= 40;
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
