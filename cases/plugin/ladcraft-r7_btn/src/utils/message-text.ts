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

/** Strip R7 API supplements from user message text for chat bubble display. */
export function stripUserMessageSupplements(text: string): string {
  let out = text.trim();
  out = out.replace(R7_FENCED_SUPPLEMENT_RE, "");
  out = out.replace(R7_DISK_SUPPLEMENT_RE, "");
  return out.trim();
}
