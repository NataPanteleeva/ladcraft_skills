import type { EditorType } from "../config";
import type { HistoryMessage } from "../eai/session";
import { extractText, extractVisibleText, isAssistantInProgress } from "../eai/session";
import {
  extractWidgetPayload,
  findPendingWidgetIndex,
  isWidgetMessage,
} from "../eai/widget";
import { resolveMessageActions } from "../apply/resolve-actions";
import { resolveActionBinding } from "../apply/user-action-intent";
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
  const editorType = options.editorType ?? "word";

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

    const visibleText = extractVisibleText(item);
    let text = visibleText.trim();
    if (!text && item.role === "assistant" && isAssistantInProgress(item)) {
      text = "Агент выполняет запрос…";
    }
    if (!text && item.role === "user") continue;

    if (item.role === "assistant") {
      const hasWidget = Boolean(widgetPayload) || isWidgetMessage(item);
      const isPendingWidget = index === pendingWidgetIndex;
      const widgetChoices =
        isPendingWidget && !widgetPayload
          ? extractWidgetChoices(item, items, index)
          : undefined;
      const comparisonReport = isComparisonReport(text);
      const waitingForInput =
        isPendingWidget && !hasWidget && !widgetChoices?.length && !comparisonReport;

      const blocked =
        hasWidget ||
        Boolean(widgetChoices?.length) ||
        waitingForInput;

      const binding = resolveActionBinding(items, index);

      const actionPlan = resolveMessageActions(item, {
        editorType,
        items,
        messageIndex: index,
        blocked,
        userIntent: binding?.userIntent,
        payloadSourceIndex: binding?.payloadSourceIndex,
      });

      messages.push({
        id: item.id,
        role: "assistant",
        text,
        widget: widgetPayload
          ? { ...widgetPayload, interactive: isPendingWidget }
          : undefined,
        widgetChoices: widgetChoices?.length ? widgetChoices : undefined,
        waitingForInput,
        actionPlan: actionPlan.blocks.length ? actionPlan : undefined,
      });
      continue;
    }

    messages.push({
      id: item.id,
      role: "user",
      text: (extractText(item) || visibleText).trim(),
    });
  }

  return messages.filter((m) => m.text.trim() || m.widget || m.widgetChoices?.length || m.actionPlan?.blocks.length);
}
