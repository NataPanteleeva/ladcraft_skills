import type { HistoryMessage } from "../eai/session";
import { extractText, extractVisibleText } from "../eai/session";
import { stripR7TaskBlock } from "./executor";
import {
  isComparisonReport,
  isSubstantiveResult,
} from "./content-extract";

/** Parsed insert/download request from user chat text. */
export interface UserActionIntent {
  insert: boolean;
  download: boolean;
}

/** Where to show action buttons and which assistant message holds the report payload. */
export interface ActionBinding {
  userIntent: UserActionIntent;
  payloadSourceIndex: number;
}

// No \b — JS word boundaries are ASCII-only and miss Cyrillic («скачать», «вставить»).
const INSERT_RE = /(?:встав(?:ить|ь|ку|ить в документ)|insert)/i;
const INSERT_IN_DOC_RE = /встав\w*[\s\S]{0,40}в документ/i;
const DOWNLOAD_RE = /(?:скач(?:ать|ай|ивание)?|download|выгруз(?:ить|и)?)/i;
const DOWNLOAD_EXT_RE = /\.(?:md|docx?|html)\b/i;

/**
 * Detect whether the user explicitly asked for insert and/or download actions.
 * Buttons in the plugin UI appear only when this returns a matching flag.
 */
export function parseUserActionIntent(text: string): UserActionIntent {
  const body = text.trim();
  if (!body) return { insert: false, download: false };

  const insert =
    INSERT_RE.test(body) ||
    INSERT_IN_DOC_RE.test(body);
  const download =
    DOWNLOAD_RE.test(body) ||
    DOWNLOAD_EXT_RE.test(body);

  return { insert, download };
}

/**
 * User action intent from messages after an assistant result.
 * Stops at a newer substantive assistant reply (another report).
 */
export function findUserActionIntentAfter(
  items: HistoryMessage[],
  assistantIndex: number,
): UserActionIntent | null {
  let merged: UserActionIntent = { insert: false, download: false };

  for (let j = assistantIndex + 1; j < items.length; j++) {
    const item = items[j];
    if (item.role === "assistant") {
      const text = stripR7TaskBlock(extractVisibleText(item));
      // Stop only at another compare report — not at short acks after user intent.
      if (isComparisonReport(text)) {
        break;
      }
      continue;
    }
    if (item.role !== "user") continue;

    const intent = parseUserActionIntent(extractText(item) || extractVisibleText(item));
    if (intent.insert) merged.insert = true;
    if (intent.download) merged.download = true;
    if (merged.insert || merged.download) {
      return merged;
    }
  }

  return null;
}

/**
 * Bind user intent to an assistant bubble and the history index that holds report content.
 * Covers: user writes «скачать» after the report, or agent ack immediately after that request.
 */
export function resolveActionBinding(
  items: HistoryMessage[],
  assistantIndex: number,
): ActionBinding | null {
  const after = findUserActionIntentAfter(items, assistantIndex);
  if (after) {
    return { userIntent: after, payloadSourceIndex: assistantIndex };
  }

  const prev = items[assistantIndex - 1];
  if (prev?.role !== "user") return null;

  const intent = parseUserActionIntent(
    extractText(prev) || extractVisibleText(prev),
  );
  if (!intent.insert && !intent.download) return null;

  const source = findReportPayloadSource(items, assistantIndex);
  if (source == null) return null;

  return { userIntent: intent, payloadSourceIndex: source };
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
    if (isComparisonReport(text) || isSubstantiveResult(text)) {
      return j;
    }
  }
  return null;
}
