import type { HistoryMessage } from "../eai/session";
import { extractVisibleText, hasCompletedToolCall } from "../eai/session";
import { findPendingWidgetIndex } from "../eai/widget";
import {
  isComparisonReport,
  isSubstantiveResult,
  isTemplatePickerMessage,
} from "./content-extract";
import { getMessageFullText } from "./executor";
import { extractChoicesFromMetadata } from "../ui/widget-choices";

export type SuggestedActionSource = "r7.actions" | "widget" | "metadata" | "text_hint";

export interface SuggestedAction {
  id?: string;
  label: string;
  send: string;
  primary?: boolean;
  source: SuggestedActionSource;
}

const ACTIONS_BLOCK_RE = /```r7\.actions\s*([\s\S]*?)```/gi;
const ORPHAN_ACTIONS_FENCE_RE = /```r7\.actions[\s\S]*/gi;

const TEXT_HINT_RE =
  /(?:^|\n)\s*(?:[-*•]\s*)?Чтобы\s+(.+?),\s*напишите:\s*\*{0,2}([^*\n]+?)\*{0,2}\s*$/gim;

export const ACTION_HINT_LINE_RE =
  /^(?:\s*(?:[-*•]\s*))?Чтобы\s+.+,\s*напишите:\s*\*{0,2}[^*\n]+\*{0,2}\s*$/gim;

const ACTION_SEND_ALLOWLIST_RE =
  /^(?:встав(?:ить|ь|ку)?|insert|скач(?:ать|ай|ивание)?(?:\s+(?:md|html|docx|отчёт|отчет))?|download(?:\s+docx)?|сохранить(?:\s+на\s+диск)?|на\s+диск)$/i;

const COMPARE_WIDGET_TOOLS = [
  "r7_show_compare_actions_widget",
  "compareActionsWidget",
] as const;

export interface ExtractSuggestedActionsOptions {
  rawText: string;
  widgetHtml?: string | null;
  suppress?: boolean;
}

function normalizeSend(value: string): string {
  const body = value.trim().replace(/\s+/g, " ");
  if (/^скач(?:ать|ай)$/i.test(body)) return "скачать md";
  return body;
}

function isAllowedSend(send: string): boolean {
  const body = normalizeSend(send);
  if (!body) return false;
  return ACTION_SEND_ALLOWLIST_RE.test(body);
}

function dedupeActions(actions: SuggestedAction[]): SuggestedAction[] {
  const seen = new Set<string>();
  const out: SuggestedAction[] = [];
  for (const action of actions) {
    const key = normalizeSend(action.send).toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push({
      ...action,
      send: normalizeSend(action.send),
      label: action.label.trim() || normalizeSend(action.send),
    });
  }
  return collapseDocxDiskDuplicates(out);
}

/** Drop «скачать docx» when «сохранить на диск» is present — same user intent. */
function collapseDocxDiskDuplicates(actions: SuggestedAction[]): SuggestedAction[] {
  const hasSaveToDisk = actions.some((a) => /^сохранить(?:\s+на\s+диск)?$/i.test(a.send));
  if (!hasSaveToDisk) return actions;
  return actions.filter((a) => !/^скач(?:ать|ай)(?:\s+docx)?$/i.test(a.send));
}

function parseSuggestedActionRecord(
  raw: unknown,
  source: SuggestedActionSource,
): SuggestedAction | null {
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;
  const send = typeof record.send === "string" ? record.send : typeof record.value === "string" ? record.value : "";
  const label =
    typeof record.label === "string"
      ? record.label
      : typeof record.title === "string"
        ? record.title
        : send;
  if (!isAllowedSend(send)) return null;
  return {
    id: typeof record.id === "string" ? record.id : undefined,
    label: label.trim() || normalizeSend(send),
    send: normalizeSend(send),
    primary: record.primary === true,
    source,
  };
}

/** Parse ```r7.actions fenced JSON array from assistant text. */
export function parseR7Actions(text: string): SuggestedAction[] {
  const actions: SuggestedAction[] = [];
  for (const match of text.matchAll(ACTIONS_BLOCK_RE)) {
    const payload = match[1].trim();
    if (!payload) continue;
    try {
      const parsed = JSON.parse(payload);
      if (!Array.isArray(parsed)) continue;
      for (const item of parsed) {
        const action = parseSuggestedActionRecord(item, "r7.actions");
        if (action) actions.push(action);
      }
    } catch {
      continue;
    }
  }
  return actions;
}

/** Remove r7.actions blocks from chat display. */
export function stripActionsMarkup(text: string): string {
  let out = text.replace(ACTIONS_BLOCK_RE, "").trim();
  out = out.replace(ORPHAN_ACTIONS_FENCE_RE, "").trim();
  return out.replace(/\n{3,}/g, "\n\n").trim();
}

/** Remove imperative hint lines when plugin renders equivalent buttons. */
export function stripActionHintLines(text: string): string {
  const lines = text.split("\n");
  const filtered = lines.filter((line) => !ACTION_HINT_LINE_RE.test(line.trim()));
  return filtered.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

/** Parse label/send pairs from widget HTML buttons. */
export function extractActionsFromWidgetHtml(html: string): SuggestedAction[] {
  const actions: SuggestedAction[] = [];
  for (const match of html.matchAll(/<button\b[^>]*>[\s\S]*?<\/button>/gi)) {
    const tag = match[0];
    const openTag = tag.match(/^<button\b[^>]*>/i)?.[0] ?? "";
    const send = openTag.match(/data-value=["']([^"']+)["']/i)?.[1]?.trim() ?? "";
    if (!isAllowedSend(send)) continue;
    const label = tag
      .replace(/<button\b[^>]*>/i, "")
      .replace(/<\/button>/i, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    actions.push({
      label: label || send,
      send: normalizeSend(send),
      primary: /\bprimary\b/i.test(openTag),
      source: "widget",
    });
  }
  return actions;
}

function extractActionsFromTextHints(text: string): SuggestedAction[] {
  const actions: SuggestedAction[] = [];
  for (const match of text.matchAll(TEXT_HINT_RE)) {
    const description = match[1].replace(/\*+/g, "").trim();
    const send = match[2].replace(/\*+/g, "").trim();
    if (!isAllowedSend(send)) continue;
    actions.push({
      label: description || send,
      send: normalizeSend(send),
      source: "text_hint",
    });
  }
  return actions;
}

function hasCompletedCompareWidgetTool(message: HistoryMessage): boolean {
  return COMPARE_WIDGET_TOOLS.some((name) => hasCompletedToolCall(message, name));
}

function isEligibleForSuggestedActions(text: string, message: HistoryMessage): boolean {
  const body = text.trim();
  if (!body || isTemplatePickerMessage(body)) return false;
  if (parseR7Actions(getMessageFullText(message)).length > 0) return true;
  if (extractActionsFromTextHints(body).length > 0) return true;
  if (isSubstantiveResult(body) || isComparisonReport(body)) return true;
  if (hasCompletedCompareWidgetTool(message)) return true;
  return false;
}

/** Collect chat trigger buttons for an assistant message (layer 1). */
export function extractSuggestedActions(
  message: HistoryMessage,
  items: HistoryMessage[],
  index: number,
  options: ExtractSuggestedActionsOptions,
): SuggestedAction[] {
  if (options.suppress) return [];

  const rawText = options.rawText.trim();
  const fullText = getMessageFullText(message);
  if (!isEligibleForSuggestedActions(rawText, message)) return [];

  const pendingWidgetIndex = findPendingWidgetIndex(items);
  const collected: SuggestedAction[] = [];

  collected.push(...parseR7Actions(fullText));

  if (options.widgetHtml?.trim()) {
    collected.push(...extractActionsFromWidgetHtml(options.widgetHtml));
  }

  if (index === pendingWidgetIndex) {
    for (const choice of extractChoicesFromMetadata(message)) {
      if (!isAllowedSend(choice)) continue;
      collected.push({
        label: choice,
        send: normalizeSend(choice),
        source: "metadata",
      });
    }
  }

  // Always merge text hints — r7.actions / widget may list only a subset (e.g. insert + save).
  collected.push(...extractActionsFromTextHints(rawText));

  return dedupeActions(collected);
}
