import type { HistoryMessage } from "./session";

export interface ChatWidgetPayload {
  id?: string;
  name?: string;
  html: string;
}

/** Widget fields on a history message (kind=widget or embedded widget_html). */
export function extractWidgetPayload(message: HistoryMessage): ChatWidgetPayload | null {
  const html = message.widget_html?.trim();
  if (!html) return null;
  return {
    id: message.widget_id,
    name: message.widget_name,
    html,
  };
}

export function isWidgetMessage(message: HistoryMessage): boolean {
  return message.kind === "widget" || Boolean(message.widget_html?.trim());
}

/** Agent run is waiting for clarification / user choice. */
export function isWaitingForUserInput(message: HistoryMessage): boolean {
  const meta = message.metadata;
  if (!meta || typeof meta !== "object") return false;

  const record = meta as Record<string, unknown>;
  if (record.waiting_state === "waiting_user_response") return true;

  const events = record.operational_events;
  if (!Array.isArray(events)) return false;

  return events.some((event) => {
    if (!event || typeof event !== "object") return false;
    const code = (event as Record<string, unknown>).code;
    return code === "user_input_requested";
  });
}

/** Index of the last history item that still expects a widget answer. */
export function findPendingWidgetIndex(items: HistoryMessage[]): number {
  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i];
    if (item.role === "user") return -1;
    if (item.role === "assistant" && isWidgetMessage(item)) return i;
    if (item.role === "assistant" && isWaitingForUserInput(item)) return i;
  }
  return -1;
}

/** Latest widget-bearing message after a given offset. */
export function findLatestWidgetAfter(
  messages: HistoryMessage[],
  afterCount: number,
): HistoryMessage | null {
  for (let i = messages.length - 1; i >= afterCount; i--) {
    const message = messages[i];
    if (isWidgetMessage(message)) return message;
  }
  return null;
}
