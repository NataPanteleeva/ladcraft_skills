import type { HistoryMessage } from "../eai/session";

/** Collect all text fields from a history message. */
export function getMessageFullText(message: HistoryMessage): string {
  const parts: string[] = [];
  if (message.content) parts.push(message.content);
  for (const item of message.response_timeline ?? []) {
    if (item.content) parts.push(item.content);
  }
  for (const call of message.tool_calls ?? []) {
    for (const field of [call.result, call.arguments, call.args]) {
      if (typeof field === "string") parts.push(field);
    }
  }
  return parts.join("\n");
}

const R7_FENCED_SUPPLEMENT_RE =
  /\n*---\s*\n\[Контекст R7:[^\]]*\][\s\S]*?\n---/g;

const R7_DISK_SUPPLEMENT_RE = /\n*\[Контекст R7: диск\][\s\S]*$/;

const R7_EVENT_FENCE_RE = /```r7\.event\s*[\s\S]*?```/gi;
const ORPHAN_R7_EVENT_FENCE_RE = /```r7\.event[\s\S]*/gi;

/** Strip R7 API supplements and service r7.event from user bubble display. */
export function stripUserMessageSupplements(text: string): string {
  let out = text.trim();
  out = out.replace(R7_EVENT_FENCE_RE, "");
  out = out.replace(ORPHAN_R7_EVENT_FENCE_RE, "");
  out = out.replace(R7_FENCED_SUPPLEMENT_RE, "");
  out = out.replace(R7_DISK_SUPPLEMENT_RE, "");
  return out.replace(/\n{3,}/g, "\n\n").trim();
}

/** True when content is only a silent r7.event feedback turn. */
export function isServiceFeedbackContent(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  const stripped = stripUserMessageSupplements(trimmed);
  return !stripped && /```r7\.event/i.test(trimmed);
}
