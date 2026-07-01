import type { HistoryMessage } from "../eai/session";
import { extractText, extractVisibleText } from "../eai/session";
import { filterExportUiTasks } from "./compare-report";
import {
  isComparisonReport,
  isTemplatePickerMessage,
} from "./content-extract";
import { buildDeliverablesFromTasks } from "./deliverable-from-tasks";
import { extractDocxFromToolCalls } from "./docx-from-tools";
import { extractTasksFromReply, stripR7TaskBlock } from "./executor";
import { resolveTemplateSelection } from "../transfer/template-selection";

/** Parsed insert/download request from user chat text. */
export interface UserActionIntent {
  insert: boolean;
  download: boolean;
}

/** Where to show action buttons and which assistant message holds the report payload. */
export interface ActionBinding {
  userIntent: UserActionIntent;
  payloadSourceIndex: number;
  /** History index of the bubble that hosts download/insert buttons. */
  actionAnchorIndex: number;
}

export interface ParseUserActionIntentOptions {
  items?: HistoryMessage[];
}

// No \b — JS word boundaries are ASCII-only and miss Cyrillic («скачать», «вставить»).
const INSERT_RE = /(?:встав(?:ить|ь|ку|ить в документ)|insert)/i;
const INSERT_IN_DOC_RE = /встав\w*[\s\S]{0,40}в документ/i;
const DOWNLOAD_RE = /(?:скач(?:ать|ай|ивание)?|download|выгруз(?:ить|и)?)/i;
const DOCX_REQUEST_RE =
  /(?:сохран\w*[\s\S]{0,24}(?:word|docx|ворд)|(?:скач\w*|download|выгруз\w*)[\s\S]{0,32}docx)/i;
const EXT_ONLY_RE = /^\.(?:md|docx?|html)\b/i;
const VERB_EXT_RE = /^(?:скач(?:ать|ай)\s+)?\.(?:md|docx?|html)\b/i;

function isTemplateSelectionText(text: string, items?: HistoryMessage[]): boolean {
  if (!items?.length) return false;
  return resolveTemplateSelection(text.trim(), items).matched;
}

/**
 * Detect whether the user explicitly asked for insert and/or download actions.
 * Buttons in the plugin UI appear only when this returns a matching flag.
 */
export function parseUserActionIntent(
  text: string,
  options: ParseUserActionIntentOptions = {},
): UserActionIntent {
  const body = text.trim();
  if (!body) return { insert: false, download: false };

  const insert =
    INSERT_RE.test(body) ||
    INSERT_IN_DOC_RE.test(body);

  const templatePick = isTemplateSelectionText(body, options.items);
  const downloadByVerb =
    DOWNLOAD_RE.test(body) ||
    DOCX_REQUEST_RE.test(body);
  const downloadByExt =
    !templatePick &&
    (EXT_ONLY_RE.test(body) || VERB_EXT_RE.test(body));

  const download = downloadByVerb || downloadByExt;

  return { insert, download };
}

/**
 * User action intent from messages after an assistant result.
 * Stops at a newer substantive assistant reply (another report).
 */
export function findUserActionIntentAfter(
  items: HistoryMessage[],
  assistantIndex: number,
): { intent: UserActionIntent; intentMessageIndex: number } | null {
  let merged: UserActionIntent = { insert: false, download: false };

  for (let j = assistantIndex + 1; j < items.length; j++) {
    const item = items[j];
    if (item.role === "assistant") {
      const text = stripR7TaskBlock(extractVisibleText(item));
      if (isComparisonReport(text)) {
        break;
      }
      continue;
    }
    if (item.role !== "user") continue;

    const intent = parseUserActionIntent(
      extractText(item) || extractVisibleText(item),
      { items },
    );
    if (intent.insert) merged.insert = true;
    if (intent.download) merged.download = true;
    if (merged.insert || merged.download) {
      return { intent: merged, intentMessageIndex: j };
    }
  }

  return null;
}

/**
 * Bind user intent to an assistant bubble and the history index that holds report content.
 * Only compare-report and docx-export bubbles receive bindings.
 */
export function resolveActionBinding(
  items: HistoryMessage[],
  assistantIndex: number,
): ActionBinding | null {
  const message = items[assistantIndex];
  if (!message || message.role !== "assistant") return null;

  const visible = stripR7TaskBlock(extractVisibleText(message));
  if (isTemplatePickerMessage(visible)) return null;

  const isReport = isComparisonReport(visible);
  const isExport = messageHasDocxExport(items, assistantIndex);
  if (!isReport && !isExport) return null;

  if (isReport) {
    const found = findUserActionIntentAfter(items, assistantIndex);
    if (!found?.intent.insert && !found?.intent.download) return null;
    return {
      userIntent: found.intent,
      payloadSourceIndex: assistantIndex,
      actionAnchorIndex: found.intentMessageIndex,
    };
  }

  const reportSource = findReportPayloadSource(items, assistantIndex);

  const pendingIntent = findExportIntentAfterReport(items, assistantIndex);
  if (pendingIntent) {
    return {
      userIntent: pendingIntent,
      payloadSourceIndex: reportSource ?? assistantIndex,
      actionAnchorIndex: assistantIndex,
    };
  }

  const prev = items[assistantIndex - 1];
  if (prev?.role === "user") {
    const intent = parseUserActionIntent(
      extractText(prev) || extractVisibleText(prev),
      { items },
    );
    if (intent.insert || intent.download) {
      return {
        userIntent: intent,
        payloadSourceIndex: reportSource ?? assistantIndex,
        actionAnchorIndex: assistantIndex,
      };
    }
  }

  return null;
}

/** Binding whose action buttons should render on a user message bubble. */
export function findBindingForUserAnchor(
  items: HistoryMessage[],
  userIndex: number,
): ActionBinding | null {
  const item = items[userIndex];
  if (!item || item.role !== "user") return null;

  for (let i = 0; i < items.length; i++) {
    const binding = resolveActionBinding(items, i);
    if (binding?.actionAnchorIndex === userIndex) {
      return binding;
    }
  }
  return null;
}

function findExportIntentAfterReport(
  items: HistoryMessage[],
  assistantIndex: number,
): UserActionIntent | null {
  const reportSource = findReportPayloadSource(items, assistantIndex);
  const stopAt = reportSource ?? -1;
  let merged: UserActionIntent = { insert: false, download: false };

  for (let j = assistantIndex - 1; j > stopAt; j--) {
    const item = items[j];
    if (item.role !== "user") continue;
    const intent = parseUserActionIntent(
      extractText(item) || extractVisibleText(item),
      { items },
    );
    if (intent.insert) merged.insert = true;
    if (intent.download) merged.download = true;
  }

  return merged.insert || merged.download ? merged : null;
}

function findReportPayloadSource(
  items: HistoryMessage[],
  beforeIndex: number,
): number | null {
  for (let j = beforeIndex - 1; j >= 0; j--) {
    const item = items[j];
    if (item.role === "user") break;
    if (item.role !== "assistant") continue;

    const text = stripR7TaskBlock(extractVisibleText(item));
    if (isComparisonReport(text)) {
      return j;
    }
  }
  return null;
}

/** True when a docx export exists after reportIndex in history. */
export function hasDocxExportAfterReport(
  items: HistoryMessage[],
  reportIndex: number,
): boolean {
  for (let j = reportIndex + 1; j < items.length; j++) {
    const item = items[j];
    if (item.role === "assistant" && messageHasDocxExport(items, j)) {
      return true;
    }
  }
  return false;
}

/** Assistant message includes deliver_file (*.docx) or inline content_base64 export. */
function messageHasDocxExport(items: HistoryMessage[], index: number): boolean {
  const message = items[index];
  if (!message || message.role !== "assistant") return false;

  if (extractDocxFromToolCalls(message)) return true;

  const tasks = filterExportUiTasks(extractTasksFromReply(message));
  const cards = buildDeliverablesFromTasks(tasks);
  return cards.some(
    (c) =>
      c.kind === "vfs" &&
      Boolean(c.fileId) &&
      (/\.docx?$/i.test(c.fileName) || Boolean(c.mimeType?.includes("wordprocessingml"))),
  );
}
