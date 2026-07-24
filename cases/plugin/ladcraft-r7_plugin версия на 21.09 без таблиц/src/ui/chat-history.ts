import type { EditorType } from "../config";
import type { HistoryMessage } from "../eai/session";
import {
  extractText,
  extractVisibleText,
  extractApplySourceText,
  isAssistantInProgress,
  isAssistantTurnStalled,
} from "../eai/session";

const STALLED_ASSISTANT_TEXT =
  "Агент не завершил ответ. Отправьте сообщение ещё раз или откройте чат заново.";
import {
  extractWidgetPayload,
  findPendingWidgetIndex,
  isWidgetMessage,
} from "../eai/widget";
import {
  appendToolWebHints,
  sanitizeAssistantChatText,
} from "../apply/display-sanitize";
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
    if (item.role !== "user" && item.role !== "assistant") continue;

    const widgetPayload = extractWidgetPayload(item);
    if (item.kind === "widget" && widgetPayload) {
      const previous = messages[messages.length - 1];
      if (previous?.role === "assistant" && !previous.widget) {
        previous.widget = {
          ...widgetPayload,
          interactive: index === pendingWidgetIndex,
        };
        continue;
      }

      messages.push({
        id: item.id,
        role: "assistant",
        text: "",
        widget: {
          ...widgetPayload,
          interactive: index === pendingWidgetIndex,
        },
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
      const hasWidget = Boolean(widgetPayload) || isWidgetMessage(item);
      const isPendingWidget = index === pendingWidgetIndex;
      const widgetChoices =
        isPendingWidget && !widgetPayload
          ? extractWidgetChoices(item, items, index)
          : undefined;
      const comparisonReport = isComparisonReport(rawVisible.trim());
      const waitingForInput =
        isPendingWidget && !hasWidget && !widgetChoices?.length && !comparisonReport;

      let text = sanitizeAssistantChatText(rawVisible).trim();
      if (!text) {
        if (isAssistantInProgress(item)) {
          text = "Агент выполняет запрос…";
        } else if (isAssistantTurnStalled(item)) {
          text = STALLED_ASSISTANT_TEXT;
        }
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
    (m) => m.text.trim() || m.widget || m.widgetChoices?.length,
  );
}
