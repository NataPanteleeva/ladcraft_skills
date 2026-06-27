import type { EditorType } from "../config";
import type { HistoryMessage } from "../eai/session";
import { extractVisibleText } from "../eai/session";
import {
  extractWidgetPayload,
  isWidgetMessage,
} from "../eai/widget";
import {
  extractCompareReportFromMessage,
  filterExportUiTasks,
  getCompareReportContext,
  resolveInsertContent,
} from "./compare-report";
import {
  extractDeferredInsertContent,
  extractReportActionContent,
  hasExportCardTasks,
  isComparisonReport,
  isSubstantiveResult,
  isTemplatePickerMessage,
  sanitizeExportContent,
} from "./content-extract";
import {
  buildDeliverablesFromTasks,
  hasExportDeliverables,
} from "./deliverable-from-tasks";
import type { DeliverableCard } from "./deliverable";
import { extractTasksFromReply, getMessageFullText, stripR7TaskBlock } from "./executor";
import { suggestBaseName } from "./download";
import {
  DOWNLOAD_BLOCK_LABEL,
  INSERT_BLOCK_LABEL,
  type ActionBlock,
  type ActionContentSource,
  type MessageActionPlan,
} from "./types";
import type { UserActionIntent } from "./user-action-intent";

export interface ResolveActionsOptions {
  editorType: EditorType;
  items: HistoryMessage[];
  messageIndex: number;
  /** Widget, template picker, or waiting for user input — skip all blocks. */
  blocked?: boolean;
  /** Set when user later wrote «вставить» / «скачать» in chat — required to show buttons. */
  userIntent?: UserActionIntent | null;
  /** Assistant history index that holds compare report content (defaults to messageIndex). */
  payloadSourceIndex?: number;
}

/** Resolve contextual action blocks for one assistant history message. */
export function resolveMessageActions(
  message: HistoryMessage,
  options: ResolveActionsOptions,
): MessageActionPlan {
  const { editorType, items, messageIndex, blocked, userIntent, payloadSourceIndex } =
    options;
  const blocks: ActionBlock[] = [];

  if (message.role !== "assistant" || blocked) {
    return { blocks };
  }

  if (!userIntent?.insert && !userIntent?.download) {
    return { blocks };
  }

  const sourceIndex = payloadSourceIndex ?? messageIndex;
  const sourceMessage = items[sourceIndex];
  if (!sourceMessage || sourceMessage.role !== "assistant") {
    return { blocks };
  }

  const widgetPayload = extractWidgetPayload(message);
  const hasWidget = Boolean(widgetPayload) || isWidgetMessage(message);
  if (hasWidget) {
    return { blocks };
  }

  const sourceVisible = extractVisibleText(sourceMessage);
  const sourceDisplay = stripR7TaskBlock(sourceVisible);
  const extractSource =
    stripR7TaskBlock(getMessageFullText(sourceMessage)) || sourceDisplay;

  if (isTemplatePickerMessage(sourceDisplay) && !isComparisonReport(sourceDisplay)) {
    return { blocks };
  }

  const tasks = filterExportUiTasks(extractTasksFromReply(sourceMessage));
  const deliverables = buildDeliverablesFromTasks(tasks);
  const hasExport = hasExportDeliverables(tasks, deliverables) || hasExportCardTasks(tasks);

  const reportContext = getCompareReportContext(items, sourceIndex);
  const skillReport = extractCompareReportFromMessage(sourceMessage, reportContext);
  const deferredContent = extractDeferredInsertContent(tasks);
  const chatFallback =
    extractReportActionContent(deferredContent ?? extractSource) ||
    extractReportActionContent(sourceDisplay) ||
    "";

  const resolvedText = resolveInsertContent(sourceMessage, reportContext, chatFallback);
  const primaryCard = pickPrimaryDeliverable(deliverables);
  const isCompare =
    isComparisonReport(sourceDisplay) ||
    Boolean(skillReport) ||
    Boolean(chatFallback);

  let payload: ActionContentSource | undefined;
  if (primaryCard) {
    const cardPayload: ActionContentSource = { kind: "card", card: primaryCard };
    const cardText = inlineCardText(primaryCard);
    if (cardText && isCompare) {
      const sanitized = sanitizeExportContent(cardText, true);
      if (sanitized.length >= 40) {
        payload = {
          kind: "text",
          text: sanitized,
          fileName: skillReport?.suggestedFileName ?? primaryCard.fileName ?? "отчёт.md",
          mimeType: "text/markdown",
        };
      }
    }
    if (!payload) payload = cardPayload;
  }

  if (!payload && resolvedText) {
    const sanitized = sanitizeExportContent(resolvedText, isCompare);
    if (sanitized.length >= 40) {
      payload = {
        kind: "text",
        text: sanitized,
        fileName: skillReport?.suggestedFileName ?? "отчёт.md",
        mimeType: "text/markdown",
      };
    }
  } else if (!payload && isSubstantiveResult(sourceDisplay)) {
    const sanitized = sanitizeExportContent(sourceDisplay, isCompare);
    if (sanitized.length >= 40) {
      payload = {
        kind: "text",
        text: sanitized,
        fileName: "ответ.md",
        mimeType: "text/markdown",
      };
    }
  }

  const hasResult =
    Boolean(payload) ||
    hasExport ||
    isComparisonReport(sourceDisplay) ||
    Boolean(skillReport) ||
    isSubstantiveResult(sourceDisplay);

  if (!hasResult || !payload) {
    return { blocks };
  }

  const baseName = suggestBaseName(payload);

  if (editorType === "word" && userIntent.insert) {
    blocks.push({
      kind: "insert",
      label: INSERT_BLOCK_LABEL,
      payload,
    });
  }

  if (userIntent.download) {
    blocks.push({
      kind: "download",
      label: DOWNLOAD_BLOCK_LABEL,
      payload,
      baseName,
    });
  }

  return { blocks };
}

function pickPrimaryDeliverable(cards: DeliverableCard[]): DeliverableCard | undefined {
  if (!cards.length) return undefined;
  const vfs = cards.find((c) => c.kind === "vfs");
  if (vfs) return vfs;
  const inline = cards.find((c) => c.kind === "inline");
  if (inline) return inline;
  return cards[0];
}

function inlineCardText(card: DeliverableCard): string | undefined {
  if (card.kind !== "inline" || card.content == null) return undefined;
  return String(card.content).trim() || undefined;
}
