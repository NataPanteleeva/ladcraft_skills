import type { HistoryMessage } from "../eai/session";
import { stripTaskMarkup } from "./task-parse";

const LEAKED_TASK_ARRAY_RE =
  /\[\s*\{[\s\S]*?"type"\s*:\s*"(?:deliver_inline|deliver_file|paste|paste_text|share_link)"[\s\S]*?\}\s*\]/gi;

const LEAKED_TOOL_JSON_RE =
  /\{[\s\S]*?"(?:content_base64|contentBase64|delivery|inline_base64|fileId|file_id)"[\s\S]*?\}/gi;

/** Fenced ```json block with doc-compare skill payload — not for chat display. */
const DOC_COMPARE_JSON_FENCE_RE =
  /```(?:json)?\s*\{[\s\S]*?"schema"\s*:\s*"doc-compare\/v1"[\s\S]*?\}\s*```/gi;

/** Unfenced doc-compare JSON pasted after markdown report. */
const DOC_COMPARE_JSON_BLOB_RE =
  /\{[\s\S]*?"schema"\s*:\s*"doc-compare\/v1"[\s\S]*?\}(?=\s*(?:\n---|\n\*r7\.task|\n```|$))/gi;

const LONG_BASE64_LINE_RE = /^[^\n]*[A-Za-z0-9+/=]{120,}[^\n]*$/gm;

const ORPHAN_R7_FENCE_RE = /```r7\.task[\s\S]*/gi;

const TRAILING_FENCE_RE = /```\s*$/;

const ORPHAN_R7_TASK_LABEL_RE = /^\*r7\.task\*:\s*$/gm;

const DISK_SAVE_ACK_LINE_RE = /^\*{0,2}Отчёт сохранён на Р7-Диск/;

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

/** Remove provider tool-call XML leaked into assistant text (MiniMax invoke, etc.). */
export function stripAgentServiceMarkup(text: string): string {
  let out = text;
  out = out.replace(INVOKE_BLOCK_RE, "");
  out = out.replace(PARAMETER_BLOCK_RE, "");
  out = out.replace(GENERIC_TOOL_CALL_BLOCK_RE, "");
  out = out.replace(MINIMAX_TOOL_CALL_OPEN_RE, "");
  out = out.replace(MINIMAX_TOOL_CALL_CLOSE_RE, "");
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

/** Remove r7.task blocks, tool JSON, compare JSON, and base64 blobs from assistant chat display. */
export function sanitizeAssistantChatText(text: string): string {
  let out = stripAgentServiceMarkup(stripTaskMarkup(text));
  out = out.replace(DOC_COMPARE_JSON_FENCE_RE, "");
  out = out.replace(DOC_COMPARE_JSON_BLOB_RE, "");
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
