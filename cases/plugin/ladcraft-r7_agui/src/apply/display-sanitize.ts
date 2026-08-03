import type { HistoryMessage } from "../eai/session";
import { stripTaskMarkup } from "./task-parse";
import { stripR7EventMarkup } from "./apply-feedback";
import { stripR7ProposalMarkup } from "./proposal-parse";

const LEAKED_TASK_ARRAY_RE =
  /\[\s*\{[\s\S]*?"type"\s*:\s*"(?:deliver_inline|deliver_file|paste|paste_text|share_link)"[\s\S]*?\}\s*\]/gi;

const LEAKED_TOOL_JSON_RE =
  /\{[\s\S]*?"(?:content_base64|contentBase64|delivery|inline_base64|fileId|file_id)"[\s\S]*?\}/gi;

/** Fenced ```json block with legacy compare-report schema — not for chat display. */
const LEGACY_COMPARE_REPORT_JSON_FENCE_RE =
  /```(?:json)?\s*\{[\s\S]*?"schema"\s*:\s*"doc-compare\/v1"[\s\S]*?\}\s*```/gi;

/** Unfenced legacy compare-report JSON pasted after markdown report. */
const LEGACY_COMPARE_REPORT_JSON_BLOB_RE =
  /\{[\s\S]*?"schema"\s*:\s*"doc-compare\/v1"[\s\S]*?\}(?=\s*(?:\n---|\n\*r7\.task|\n```|$))/gi;

const LONG_BASE64_LINE_RE = /^[^\n]*[A-Za-z0-9+/=]{120,}[^\n]*$/gm;

const ORPHAN_R7_FENCE_RE = /```r7\.task[\s\S]*/gi;

const TRAILING_FENCE_RE = /```\s*$/;

const ORPHAN_R7_TASK_LABEL_RE = /^\*r7\.task\*:\s*$/gm;

const DISK_SAVE_ACK_LINE_RE = /^\*{0,2}Отчёт сохранён на Р7-Диск/;

const ACTIONS_BLOCK_RE = /```r7\.actions\s*([\s\S]*?)```/gi;
const ORPHAN_ACTIONS_FENCE_RE = /```r7\.actions[\s\S]*/gi;
const ACTION_HINT_LINE_RE =
  /^(?:\s*(?:[-*•]\s*))?Чтобы\s+.+,\s*напишите:\s*\*{0,2}[^*\n]+\*{0,2}\s*$/gim;

/** Plugin action-bar boilerplate — only for new VFS deliverables, not open-sheet apply. */
const DELIVERABLE_BUTTONS_HINT_RE =
  /^\s*Результат можно скачать\s*\(XLSX\).*кнопками плагина\.?\s*$/gim;

const WEB_HINT_FIELDS = [
  "web_ui_hint",
  "web_ui_url",
  "download_link",
  "web_open_url",
] as const;

const HTTP_URL_RE = /^https?:\/\//i;

const INVOKE_BLOCK_RE = /<invoke\b[^>]*>[\s\S]*?<\/invoke>/gi;
const PARAMETER_BLOCK_RE = /<parameter\b[^>]*>[\s\S]*?<\/parameter>/gi;
const GENERIC_TOOL_CALL_BLOCK_RE = /<tool_call\b[^>]*>[\s\S]*?<\/tool_call>/gi;
const MINIMAX_TOOL_CALL_OPEN_RE = /<minimax:tool_call\b[^>]*>/gi;
const MINIMAX_TOOL_CALL_CLOSE_RE = /<\/minimax:tool_call>/gi;
const END_TURN_RE = /<\/?end_turn>/gi;

/** Remove provider tool-call XML leaked into assistant text (MiniMax invoke, etc.). */
export function stripAgentServiceMarkup(text: string): string {
  let out = text;
  out = out.replace(INVOKE_BLOCK_RE, "");
  out = out.replace(PARAMETER_BLOCK_RE, "");
  out = out.replace(GENERIC_TOOL_CALL_BLOCK_RE, "");
  out = out.replace(MINIMAX_TOOL_CALL_OPEN_RE, "");
  out = out.replace(MINIMAX_TOOL_CALL_CLOSE_RE, "");
  out = out.replace(END_TURN_RE, "");
  out = out.replace(/\n{3,}/g, "\n\n").trim();
  return out;
}

/** Append disk web link from tool result when absent from visible assistant text. */
export function appendToolWebHints(message: HistoryMessage, text: string): string {
  const urls = collectWebHintUrls(message);
  if (!urls.length) return text;

  let out = text.trim();
  for (const url of urls) {
    if (out.includes(url)) return out;
    out += `\n\nОткройте папку в веб-интерфейсе диска: ${url}`;
    break;
  }
  return out;
}

/** Remove r7.actions fence from display. */
export function stripActionsMarkup(text: string): string {
  let out = text.replace(ACTIONS_BLOCK_RE, "").trim();
  out = out.replace(ORPHAN_ACTIONS_FENCE_RE, "").trim();
  return out.replace(/\n{3,}/g, "\n\n").trim();
}

/** Remove imperative «Чтобы …, напишите:» hint lines. */
export function stripActionHintLines(text: string): string {
  const lines = text.split("\n");
  const filtered = lines.filter((line) => !ACTION_HINT_LINE_RE.test(line.trim()));
  return filtered.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

/** Drop XLSX/Лист/Вставить boilerplate (open-sheet apply must not show it). */
export function stripDeliverableButtonsHint(text: string): string {
  return String(text || "")
    .replace(DELIVERABLE_BUTTONS_HINT_RE, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Hide agent "thinking out loud" while skills run (not for the end user).
 * Keeps the final findings table / «Готово. Нашёл…».
 */
export function stripSkillProgressNarrative(text: string): string {
  const lines = String(text || "").split("\n");
  const filtered = lines.filter((line) => {
    const t = line.trim();
    if (!t) return true;
    // Avoid \\b with Cyrillic — JS word boundaries are ASCII-only without /u quirks.
    if (/проверка на опечатки\s*[—–-]\s*навык/i.test(t)) return false;
    if (/активирую/i.test(t)) return false;
    if (/^активирован/i.test(t)) return false;
    if (/^slug\s*=/i.test(t)) return false;
    if (/сначала читаю (?:документ|файл|контекст)/i.test(t)) return false;
    if (/^документ прочитан/i.test(t)) return false;
    if (/читаю правила\.?\s*$/i.test(t)) return false;
    if (/определяю slug|формирую findings/i.test(t)) return false;
    if (/навык\s+`?lca-[\w-]+`?/i.test(t) && /чита|актив/i.test(t)) return false;
    return true;
  });
  return filtered.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

/** Remove r7.task / r7.actions / r7.event / r7.proposal blocks, tool JSON, compare JSON, and base64 blobs from assistant chat display. */
export function sanitizeAssistantChatText(text: string): string {
  let out = stripAgentServiceMarkup(
    stripActionsMarkup(
      stripR7ProposalMarkup(stripR7EventMarkup(stripTaskMarkup(text))),
    ),
  );
  out = stripSkillProgressNarrative(out);
  out = stripActionHintLines(out);
  // XLSX/Лист/Вставить boilerplate only belongs next to a new VFS file.
  if (!/^\s*Файл:\s*\/session\//im.test(out)) {
    out = stripDeliverableButtonsHint(out);
  }
  out = out.replace(LEGACY_COMPARE_REPORT_JSON_FENCE_RE, "");
  out = out.replace(LEGACY_COMPARE_REPORT_JSON_BLOB_RE, "");
  out = out.replace(LEAKED_TASK_ARRAY_RE, "");
  out = out.replace(LEAKED_TOOL_JSON_RE, "");
  out = out.replace(LONG_BASE64_LINE_RE, "");
  out = out.replace(ORPHAN_R7_FENCE_RE, "");
  out = out.replace(TRAILING_FENCE_RE, "");
  out = out.replace(ORPHAN_R7_TASK_LABEL_RE, "");
  out = out.replace(/```\s*```/g, "");
  out = dedupeDiskSaveAck(out);
  out = out.replace(/\n{3,}/g, "\n\n").trim();
  return out;
}

function dedupeDiskSaveAck(text: string): string {
  const lines = text.split("\n");
  const ackLines = lines
    .map((line, index) => ({ line, index }))
    .filter(({ line }) => DISK_SAVE_ACK_LINE_RE.test(line.trim()));
  if (ackLines.length < 2) return text;

  const keep =
    ackLines.find(({ line }) => line.includes("папка «")) ??
    ackLines[ackLines.length - 1];
  const remove = new Set(
    ackLines.filter((entry) => entry.index !== keep.index).map((entry) => entry.index),
  );
  return lines.filter((_, index) => !remove.has(index)).join("\n");
}

function collectWebHintUrls(message: HistoryMessage): string[] {
  const urls: string[] = [];
  for (const call of message.tool_calls ?? []) {
    for (const field of [call.result, call.arguments, call.args]) {
      extractUrlsFromField(field, urls);
    }
  }
  return urls.filter((url, index, all) => all.indexOf(url) === index);
}

function extractUrlsFromField(field: unknown, urls: string[]): void {
  if (typeof field === "string") {
    try {
      extractUrlsFromObject(JSON.parse(field), urls);
    } catch {
      const match = field.match(/https?:\/\/[^\s"'<>]+/);
      if (match && HTTP_URL_RE.test(match[0])) urls.push(match[0]);
    }
    return;
  }
  if (field && typeof field === "object") {
    extractUrlsFromObject(field as Record<string, unknown>, urls);
  }
}

function extractUrlsFromObject(obj: Record<string, unknown>, urls: string[]): void {
  for (const key of WEB_HINT_FIELDS) {
    const value = obj[key];
    if (typeof value === "string" && HTTP_URL_RE.test(value.trim())) {
      urls.push(value.trim());
    }
  }
}
