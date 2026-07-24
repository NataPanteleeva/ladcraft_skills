import type { EditorType } from "../config";
import type { HistoryMessage } from "../eai/session";
import {
  collapseDuplicatedAssistantBody,
  extractText,
  extractVisibleText,
  extractApplySourceText,
  isAssistantInProgress,
  isAssistantTurnStalled,
} from "../eai/session";

const STALLED_ASSISTANT_TEXT =
  "Агент не завершил ответ. Отправьте сообщение ещё раз или откройте чат заново.";
const WIDGET_WAIT_FALLBACK_TEXT =
  "Агент ждёт ваш выбор. Ответьте в форме или текстом.";
import {
  extractWidgetPayload,
  findPendingWidgetIndex,
  isAgentWidgetOrWait,
} from "../eai/widget";
import {
  appendToolWebHints,
  sanitizeAssistantChatText,
} from "../apply/display-sanitize";
import { resolveAssistantDeliverableText } from "../apply/agent-deliverables";
import { stripUserMessageSupplements, isServiceFeedbackContent } from "../utils/message-text";
import { isComparisonReport } from "../apply/content-extract";
import { extractWidgetChoices } from "./widget-choices";
import type { ChatMessage } from "./chat";

export interface HistoryToChatOptions {
  editorType?: EditorType;
}

/** Map Ladcraft session history to chat messages for the plugin UI. */
export function historyToChatMessages(
  items: HistoryMessage[],
  options: HistoryToChatOptions = {},
): ChatMessage[] {
  const messages: ChatMessage[] = [];
  const pendingWidgetIndex = findPendingWidgetIndex(items);
  void options;

  for (let index = 0; index < items.length; index++) {
    const item = items[index];

    // Server-side turn failures (e.g. AGENT_ERROR) arrive as system/error rows.
    if (item.role === "system") {
      const errMsg =
        (item.error && typeof item.error.message === "string" && item.error.message.trim()) ||
        (typeof item.content === "string" && item.content.trim()) ||
        "";
      if (!errMsg) continue;
      if (item.kind === "error" || item.error || /не удалось/i.test(errMsg)) {
        messages.push({
          id: item.id,
          role: "system",
          text: errMsg,
        });
      }
      continue;
    }

    if (item.role !== "user" && item.role !== "assistant") continue;

    const widgetPayload = extractWidgetPayload(item);
    const isPendingWidget = index === pendingWidgetIndex;

    // Dedicated widget row (often follows assistant text). Always keep UI, even if HTML slug failed.
    if (item.kind === "widget") {
      const widgetChoices = !widgetPayload
        ? extractWidgetChoices(item, items, index)
        : undefined;
      const previous = messages[messages.length - 1];
      if (previous?.role === "assistant") {
        if (widgetPayload && !previous.widget) {
          previous.widget = {
            ...widgetPayload,
            interactive: isPendingWidget,
          };
        }
        if (widgetChoices?.length && !previous.widgetChoices?.length) {
          previous.widgetChoices = widgetChoices;
        }
        if (isPendingWidget) previous.waitingForInput = !previous.widget && !previous.widgetChoices?.length;
        continue;
      }

      messages.push({
        id: item.id,
        role: "assistant",
        text: widgetPayload || widgetChoices?.length ? "" : WIDGET_WAIT_FALLBACK_TEXT,
        widget: widgetPayload
          ? { ...widgetPayload, interactive: isPendingWidget }
          : undefined,
        widgetChoices: widgetChoices?.length ? widgetChoices : undefined,
        waitingForInput: isPendingWidget && !widgetPayload && !widgetChoices?.length,
      });
      continue;
    }

    const rawVisible =
      item.role === "assistant"
        ? appendToolWebHints(item, extractVisibleText(item))
        : extractVisibleText(item);
    const applySource =
      item.role === "assistant" ? extractApplySourceText(item).trim() : "";

    if (item.role === "assistant") {
      const hasRenderableWidget = Boolean(widgetPayload);
      const widgetChoices =
        isPendingWidget && !hasRenderableWidget
          ? extractWidgetChoices(item, items, index)
          : undefined;
      const comparisonReport = isComparisonReport(rawVisible.trim());
      const waitingForInput =
        isPendingWidget &&
        !hasRenderableWidget &&
        !widgetChoices?.length &&
        !comparisonReport;

      let text = sanitizeAssistantChatText(rawVisible).trim();
      // Timeline/content can still land with a repeated body after sanitize.
      text = collapseDuplicatedAssistantBody(text);
      text = resolveAssistantDeliverableText(text, item);
      if (!text) {
        if (hasRenderableWidget || widgetChoices?.length) {
          text = "";
        } else if (isPendingWidget && isAgentWidgetOrWait(item)) {
          text = WIDGET_WAIT_FALLBACK_TEXT;
        } else if (isAssistantInProgress(item)) {
          text = "Агент выполняет запрос…";
        } else if (isAssistantTurnStalled(item)) {
          text = STALLED_ASSISTANT_TEXT;
        }
      }

      const failed =
        (item.status || "").toLowerCase() === "failed" ||
        (item.status || "").toLowerCase() === "error";
      const failNote =
        (item.error && typeof item.error.message === "string" && item.error.message.trim()) ||
        "";
      // Partial tool work may already be in text; still surface the terminal failure.
      if (failed && failNote && !text.includes(failNote)) {
        text = text ? `${text}\n\n${failNote}` : failNote;
      }

      messages.push({
        id: item.id,
        role: "assistant",
        text,
        // Full raw (content+timeline), prefers chunks that still contain r7.proposal.
        applyText: applySource || undefined,
        widget: widgetPayload
          ? { ...widgetPayload, interactive: isPendingWidget }
          : undefined,
        widgetChoices: widgetChoices?.length ? widgetChoices : undefined,
        waitingForInput,
      });
      continue;
    }

    const visibleText = rawVisible;
    let text = visibleText.trim();
    if (!text && item.role === "user") continue;
    if (item.role === "user" && isServiceFeedbackContent(extractText(item) || visibleText)) {
      continue;
    }

    messages.push({
      id: item.id,
      role: "user",
      text: stripUserMessageSupplements((extractText(item) || visibleText).trim()),
    });
  }

  return messages.filter(
    (m) =>
      m.text.trim() ||
      m.widget ||
      m.widgetChoices?.length ||
      m.waitingForInput,
  );
}
