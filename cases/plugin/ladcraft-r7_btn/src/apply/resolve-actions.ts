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
  docxInlineToActionSource,
  extractDocxFromToolCalls,
} from "./docx-from-tools";
import {
  buildDeliverablesFromTasks,
  hasExportDeliverables,
} from "./deliverable-from-tasks";
import type { DeliverableCard } from "./deliverable";
import { extractTasksFromReply, stripR7TaskBlock } from "./executor";
import { suggestBaseName } from "./download";
import { hasDocxExportAfterReport } from "./user-action-intent";
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
  /** Bubble that should host insert/download buttons (user message after intent). */
  actionAnchorIndex?: number;
}

/** Resolve contextual action blocks for one chat bubble (assistant report, export, or user anchor). */
export function resolveMessageActions(
  message: HistoryMessage,
  options: ResolveActionsOptions,
): MessageActionPlan {
  const {
    editorType,
    items,
    messageIndex,
    blocked,
    userIntent,
    payloadSourceIndex,
    actionAnchorIndex,
  } = options;
  const blocks: ActionBlock[] = [];

  if (!userIntent?.insert && !userIntent?.download) {
    return { blocks };
  }

  const sourceIndex = payloadSourceIndex ?? messageIndex;
  const anchorIndex = actionAnchorIndex ?? sourceIndex;
  const renderMessage = items[messageIndex] ?? message;
  const showAtAnchor = messageIndex === anchorIndex;

  if (renderMessage.role === "assistant" && blocked) {
    return { blocks };
  }

  const sourceMessage = items[sourceIndex];
  if (!sourceMessage || sourceMessage.role !== "assistant") {
    return { blocks };
  }

  if (renderMessage.role === "assistant") {
    const widgetPayload = extractWidgetPayload(renderMessage);
    const hasWidget = Boolean(widgetPayload) || isWidgetMessage(renderMessage);
    if (hasWidget) {
      return { blocks };
    }
  }

  const sourceVisible = extractVisibleText(sourceMessage);
  const sourceDisplay = stripR7TaskBlock(sourceVisible);

  if (isTemplatePickerMessage(sourceDisplay) && !isComparisonReport(sourceDisplay)) {
    return { blocks };
  }

  const tasks = collectExportTasks(
    items,
    showAtAnchor && anchorIndex !== sourceIndex ? sourceIndex : messageIndex,
    sourceIndex,
  );
  const deliverables = buildDeliverablesFromTasks(tasks);
  const hasExport = hasExportDeliverables(tasks, deliverables) || hasExportCardTasks(tasks);

  const reportContext = getCompareReportContext(items, sourceIndex);
  const skillReport = extractCompareReportFromMessage(sourceMessage, reportContext);
  const deferredContent = extractDeferredInsertContent(tasks);
  const chatFallback =
    extractReportActionContent(deferredContent ?? sourceDisplay) || "";

  const resolvedText = resolveInsertContent(sourceMessage, reportContext, chatFallback);
  const primaryCard = pickPrimaryDeliverable(deliverables);
  const docxCard = pickDocxDeliverable(deliverables);
  const isCompare =
    isComparisonReport(sourceDisplay) ||
    Boolean(skillReport) ||
    Boolean(chatFallback);

  let textPayload: ActionContentSource | undefined;
  let docxPayload: ActionContentSource | undefined = docxCard
    ? { kind: "card", card: docxCard }
    : undefined;

  if (!docxPayload) {
    const inline = extractDocxFromToolCalls(renderMessage);
    if (inline) docxPayload = docxInlineToActionSource(inline);
  }

  if (primaryCard && !isDocxDeliverableCard(primaryCard)) {
    const cardText = inlineCardText(primaryCard);
    if (cardText && isCompare) {
      const sanitized = sanitizeExportContent(cardText, true);
      if (sanitized.length >= 40) {
        textPayload = {
          kind: "text",
          text: sanitized,
          fileName: skillReport?.suggestedFileName ?? primaryCard.fileName ?? "отчёт.md",
          mimeType: "text/markdown",
        };
      }
    }
    if (!textPayload) {
      textPayload = { kind: "card", card: primaryCard };
    }
  }

  if (!textPayload && resolvedText) {
    const sanitized = sanitizeExportContent(resolvedText, isCompare);
    if (sanitized.length >= 40) {
      textPayload = {
        kind: "text",
        text: sanitized,
        fileName: skillReport?.suggestedFileName ?? "отчёт.md",
        mimeType: "text/markdown",
      };
    }
  } else if (!textPayload && isSubstantiveResult(sourceDisplay)) {
    const sanitized = sanitizeExportContent(sourceDisplay, isCompare);
    if (sanitized.length >= 40) {
      textPayload = {
        kind: "text",
        text: sanitized,
        fileName: "ответ.md",
        mimeType: "text/markdown",
      };
    }
  }

  const downloadPayload = textPayload ?? docxPayload;

  const hasResult =
    Boolean(textPayload) ||
    Boolean(docxPayload) ||
    hasExport ||
    isComparisonReport(sourceDisplay) ||
    Boolean(skillReport) ||
    isSubstantiveResult(sourceDisplay);

  if (!hasResult || (!textPayload && !docxPayload)) {
    return { blocks };
  }

  const baseName = suggestBaseName(textPayload ?? docxPayload ?? downloadPayload!);

  const showDocxDownload = messageHostsDownloadBlock(renderMessage, docxPayload);
  if (!showAtAnchor && !showDocxDownload) {
    return { blocks };
  }

  if (editorType === "word" && userIntent.insert && textPayload && showAtAnchor) {
    blocks.push({
      kind: "insert",
      label: INSERT_BLOCK_LABEL,
      payload: textPayload,
    });
  }

  const showMarkdownDownload = Boolean(textPayload) && showAtAnchor;
  const requestDocx =
    userIntent.download &&
    showMarkdownDownload &&
    isComparisonReport(sourceDisplay) &&
    !hasDocxExportAfterReport(items, sourceIndex);

  if (userIntent.download && downloadPayload && (showMarkdownDownload || showDocxDownload)) {
    blocks.push({
      kind: "download",
      label: DOWNLOAD_BLOCK_LABEL,
      payload: downloadPayload,
      docxPayload: showDocxDownload ? docxPayload : undefined,
      baseName,
      requestDocx: requestDocx || undefined,
    });
  }

  return { blocks };
}

function collectExportTasks(
  items: HistoryMessage[],
  messageIndex: number,
  sourceIndex: number,
): ReturnType<typeof filterExportUiTasks> {
  const current = items[messageIndex];
  const source = items[sourceIndex];
  const merged = [
    ...(current ? filterExportUiTasks(extractTasksFromReply(current)) : []),
    ...(source && sourceIndex !== messageIndex
      ? filterExportUiTasks(extractTasksFromReply(source))
      : []),
  ];
  if (merged.length) return merged;
  return source ? filterExportUiTasks(extractTasksFromReply(source)) : [];
}

function pickPrimaryDeliverable(cards: DeliverableCard[]): DeliverableCard | undefined {
  if (!cards.length) return undefined;
  const vfs = cards.find((c) => c.kind === "vfs");
  if (vfs) return vfs;
  const inline = cards.find((c) => c.kind === "inline");
  if (inline) return inline;
  return cards[0];
}

function pickDocxDeliverable(cards: DeliverableCard[]): DeliverableCard | undefined {
  return cards.find((c) => isDocxDeliverableCard(c));
}

function isDocxDeliverableCard(card: DeliverableCard): boolean {
  if (card.kind !== "vfs" || !card.fileId) return false;
  return (
    /\.docx?$/i.test(card.fileName) ||
    Boolean(card.mimeType?.includes("wordprocessingml"))
  );
}

function inlineCardText(card: DeliverableCard): string | undefined {
  if (card.kind !== "inline" || card.content == null) return undefined;
  return String(card.content).trim() || undefined;
}

/** DOCX download UI only when export payload is attached to this assistant bubble. */
function messageHostsDownloadBlock(
  message: HistoryMessage,
  docxPayload: ActionContentSource | undefined,
): boolean {
  if (!docxPayload) return false;
  if (docxPayload.kind === "base64") {
    return Boolean(extractDocxFromToolCalls(message));
  }
  if (docxPayload.kind === "card" && docxPayload.card.kind === "vfs") {
    const card = docxPayload.card;
    const tasks = filterExportUiTasks(extractTasksFromReply(message));
    const cards = buildDeliverablesFromTasks(tasks);
    return cards.some((c) => c.kind === "vfs" && c.fileId === card.fileId);
  }
  return false;
}
