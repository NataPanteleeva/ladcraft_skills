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
