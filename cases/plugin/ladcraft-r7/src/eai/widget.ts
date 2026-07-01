import type { HistoryMessage } from "./session";

export interface ChatWidgetPayload {
  id?: string;
  name?: string;
  html: string;
}

/** Ladcraft may emit widget slug instead of rendered HTML when skill publish omitted template. */
const WIDGET_SLUG_HTML: Record<string, string> = {
  compareActionsWidget: `<style>
  .r7-compare-actions {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    margin-top: 4px;
  }
  .r7-compare-actions-title {
    font-size: 12px;
    font-weight: 600;
    color: #64748b;
    margin: 0 0 8px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .r7-compare-actions-row {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }
  .r7-compare-actions button {
    appearance: none;
    border: 1px solid #cbd5e1;
    background: #f8fafc;
    color: #0f172a;
    border-radius: 8px;
    padding: 8px 12px;
    font-size: 13px;
    line-height: 1.2;
    cursor: pointer;
  }
  .r7-compare-actions button:hover {
    background: #e2e8f0;
    border-color: #94a3b8;
  }
  .r7-compare-actions button.primary {
    background: #1e293b;
    border-color: #1e293b;
    color: #fff;
  }
  .r7-compare-actions button.primary:hover {
    background: #334155;
    border-color: #334155;
  }
</style>
<div class="r7-compare-actions">
  <p class="r7-compare-actions-title">Действия с отчётом</p>
  <div class="r7-compare-actions-row">
    <button type="button" class="primary" data-value="вставить">Вставить в конец документа</button>
    <button type="button" data-value="скачать md">Скачать md</button>
    <button type="button" data-value="скачать html">Скачать html</button>
    <button type="button" data-value="сохранить на диск">Сохранить на Р7-диск</button>
  </div>
</div>`,
  r7_show_compare_actions_widget: `<style>
  .r7-compare-actions {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    margin-top: 4px;
  }
  .r7-compare-actions-title {
    font-size: 12px;
    font-weight: 600;
    color: #64748b;
    margin: 0 0 8px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .r7-compare-actions-row {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }
  .r7-compare-actions button {
    appearance: none;
    border: 1px solid #cbd5e1;
    background: #f8fafc;
    color: #0f172a;
    border-radius: 8px;
    padding: 8px 12px;
    font-size: 13px;
    line-height: 1.2;
    cursor: pointer;
  }
  .r7-compare-actions button:hover {
    background: #e2e8f0;
    border-color: #94a3b8;
  }
  .r7-compare-actions button.primary {
    background: #1e293b;
    border-color: #1e293b;
    color: #fff;
  }
  .r7-compare-actions button.primary:hover {
    background: #334155;
    border-color: #334155;
  }
</style>
<div class="r7-compare-actions">
  <p class="r7-compare-actions-title">Действия с отчётом</p>
  <div class="r7-compare-actions-row">
    <button type="button" class="primary" data-value="вставить">Вставить в конец документа</button>
    <button type="button" data-value="скачать md">Скачать md</button>
    <button type="button" data-value="скачать html">Скачать html</button>
    <button type="button" data-value="сохранить на диск">Сохранить на Р7-диск</button>
  </div>
</div>`,
};

const COMPARE_WIDGET_SLUGS = [
  "compareActionsWidget",
  "r7_show_compare_actions_widget",
] as const;

function resolveWidgetHtml(raw: string): string | null {
  const html = raw.trim();
  if (!html) return null;
  const slugHtml = WIDGET_SLUG_HTML[html];
  if (slugHtml) return slugHtml;
  if (html.includes("<%") || html.includes("compareActionsWidget")) {
    return WIDGET_SLUG_HTML.compareActionsWidget ?? null;
  }
  if (html.includes("<")) return html;
  return null;
}

/** Widget fields on a history message (kind=widget or embedded widget_html). */
export function extractWidgetPayload(message: HistoryMessage): ChatWidgetPayload | null {
  const raw = message.widget_html?.trim();
  if (!raw) return null;
  const html = resolveWidgetHtml(raw);
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

/** Build local fallback payload when runtime omitted widget_html. */
export function buildCompareActionsFallbackWidget(): ChatWidgetPayload {
  return {
    id: "r7_show_compare_actions_widget:fallback",
    name: "r7_show_compare_actions_widget",
    html:
      WIDGET_SLUG_HTML.r7_show_compare_actions_widget ??
      WIDGET_SLUG_HTML.compareActionsWidget,
  };
}

export function isCompareActionsWidgetName(value: string | null | undefined): boolean {
  const name = (value ?? "").trim();
  return COMPARE_WIDGET_SLUGS.some((slug) => slug === name);
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
