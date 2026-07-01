import type { EditorType } from "../config";
import type { HistoryMessage } from "../eai/session";
import {
  extractText,
  extractVisibleText,
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
import { sanitizeAssistantChatText } from "../apply/display-sanitize";
import { resolveMessageActions } from "../apply/resolve-actions";
import { resolveActionBinding, findBindingForUserAnchor } from "../apply/user-action-intent";
import { isComparisonReport, isTemplatePickerMessage } from "../apply/content-extract";
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

    const visibleText =
      item.role === "assistant"
        ? sanitizeAssistantChatText(extractVisibleText(item))
        : extractVisibleText(item);
    let text = visibleText.trim();
    if (!text && item.role === "assistant") {
      if (isAssistantInProgress(item)) {
        text = "Агент выполняет запрос…";
      } else if (isAssistantTurnStalled(item)) {
        text = STALLED_ASSISTANT_TEXT;
      }
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
        waitingForInput ||
        isTemplatePickerMessage(text);

      const binding = resolveActionBinding(items, index);

      const actionPlan = resolveMessageActions(item, {
        editorType,
        items,
        messageIndex: index,
        blocked,
        userIntent: binding?.userIntent,
        payloadSourceIndex: binding?.payloadSourceIndex,
        actionAnchorIndex: binding?.actionAnchorIndex,
      });

      const hideActionsOnReport =
        binding &&
        binding.actionAnchorIndex !== index &&
        binding.payloadSourceIndex === index;

      messages.push({
        id: item.id,
        role: "assistant",
        text,
        widget: widgetPayload
          ? { ...widgetPayload, interactive: isPendingWidget }
          : undefined,
        widgetChoices: widgetChoices?.length ? widgetChoices : undefined,
        waitingForInput,
        actionPlan:
          !hideActionsOnReport && actionPlan.blocks.length ? actionPlan : undefined,
      });
      continue;
    }

    const userBinding = findBindingForUserAnchor(items, index);
    let userActionPlan;
    if (userBinding) {
      const sourceMessage = items[userBinding.payloadSourceIndex];
      if (sourceMessage?.role === "assistant") {
        userActionPlan = resolveMessageActions(sourceMessage, {
          editorType,
          items,
          messageIndex: index,
          userIntent: userBinding.userIntent,
          payloadSourceIndex: userBinding.payloadSourceIndex,
          actionAnchorIndex: userBinding.actionAnchorIndex,
        });
      }
    }

    messages.push({
      id: item.id,
      role: "user",
      text: (extractText(item) || visibleText).trim(),
      actionPlan: userActionPlan?.blocks.length ? userActionPlan : undefined,
    });
  }

  return messages.filter((m) => m.text.trim() || m.widget || m.widgetChoices?.length || m.actionPlan?.blocks.length);
}
