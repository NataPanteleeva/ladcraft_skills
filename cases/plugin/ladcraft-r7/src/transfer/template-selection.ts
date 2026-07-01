/** @see plugins/ladcraft-r7/docs/02-chat-rules.md — compare turn template matching */

import type { HistoryMessage } from "../eai/session";
import { extractVisibleText } from "../eai/session";
import {
  extractChoicesFromText,
  extractWidgetChoices,
} from "../ui/widget-choices";

const TEMPLATE_FILE_RE = /([^\s`/\\|]+\.(?:md|docx))/i;

export interface TemplateSelectionResult {
  matched: boolean;
  canonicalMd?: string;
}

function canonicalTemplateName(name: string): string {
  const trimmed = name.trim().replace(/^`+|`+$/g, "");
  if (/\.(md|docx)$/i.test(trimmed)) return trimmed;
  return `${trimmed}.md`;
}

function stemOf(fileName: string): string {
  return fileName.replace(/\.(md|docx)$/i, "");
}

function isTemplateFileName(cell: string): boolean {
  return TEMPLATE_FILE_RE.test(cell.trim().replace(/^`+|`+$/g, ""));
}

/** Ordered template filenames from markdown table or numbered list. */
export function extractOrderedTemplateNames(text: string): string[] {
  const names: string[] = [];
  const seen = new Set<string>();

  const add = (raw: string): void => {
    const file = raw.match(TEMPLATE_FILE_RE)?.[1]?.trim();
    if (!file) return;
    const key = file.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    names.push(file);
  };

  const tableMatch = text.match(
    /\|[^\n]*(?:шаблон|название)[^\n]*\|\s*\n\|[-\s|]+\|\s*\n([\s\S]*?)(?:\n\n|\n#|\n---|$)/i,
  );
  if (tableMatch) {
    for (const row of tableMatch[1].split("\n")) {
      const cells = row
        .split("|")
        .map((c) => c.trim())
        .filter(Boolean);
      for (const cell of cells) {
        if (isTemplateFileName(cell)) add(cell);
      }
    }
    if (names.length) return names;
  }

  for (const match of text.matchAll(/^\s*\d+[\.\):\-]\s*(.+)$/gim)) {
    add(match[1].trim());
  }
  if (names.length) return names;

  for (const match of text.matchAll(/([^\s/\\|]+\.(?:md|docx))/gi)) {
    add(match[1]);
  }
  return names;
}

function isLikelyTemplatePicker(text: string, choices: string[]): boolean {
  if (choices.length === 0) return false;
  if (/\|[^\n]*(?:шаблон|название)[^\n]*\|/i.test(text)) return true;
  if (/номер\s+шаблон|выберите\s+шаблон|укажите\s+номер/i.test(text)) return true;
  if (/^\s*\d+[\.\):\-]\s*[^\n]+\.(?:md|docx)/im.test(text)) return true;
  return choices.some((c) => /\.(md|docx)$/i.test(c));
}

/** All template options from the last assistant turn that presented a picker. */
export function collectPresentedTemplateChoices(
  messages: HistoryMessage[],
): string[] {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (message.role !== "assistant") continue;

    const text = extractVisibleText(message);
    const ordered = extractOrderedTemplateNames(text);
    if (ordered.length && isLikelyTemplatePicker(text, ordered)) {
      return ordered;
    }

    const widgetChoices = extractWidgetChoices(message, messages, i)
      .map(canonicalTemplateName)
      .filter((c) => /\.(md|docx)$/i.test(c) && !/^\d+\.(?:md|docx)$/i.test(c));
    const fromText = extractChoicesFromText(text)
      .map(canonicalTemplateName)
      .filter((c) => /\.(md|docx)$/i.test(c) && !/^\d+\.(?:md|docx)$/i.test(c));

    const merged = [...ordered];
    for (const choice of [...widgetChoices, ...fromText]) {
      if (!merged.some((x) => x.toLowerCase() === choice.toLowerCase())) {
        merged.push(choice);
      }
    }

    if (isLikelyTemplatePicker(text, merged)) return merged;
  }
  return [];
}

/** Match user input to one of the templates shown in the last picker. */
export function resolveTemplateSelection(
  userText: string,
  messages: HistoryMessage[],
): TemplateSelectionResult {
  const t = userText.trim();
  if (!t) return { matched: false };

  const choices = collectPresentedTemplateChoices(messages);

  if (!choices.length) {
    if (/\.(md|docx)$/i.test(t)) {
      return { matched: true, canonicalMd: canonicalTemplateName(t) };
    }
    return { matched: false };
  }

  const canonicalList = choices.map(canonicalTemplateName);

  for (const canonical of canonicalList) {
    const stem = stemOf(canonical);
    if (t.toLowerCase() === canonical.toLowerCase()) {
      return { matched: true, canonicalMd: canonical };
    }
    if (t.toLowerCase() === stem.toLowerCase()) {
      return { matched: true, canonicalMd: canonical };
    }
  }

  const numMatch = t.match(/^(?:№\s*)?(\d+)\s*$/);
  if (numMatch) {
    const idx = parseInt(numMatch[1], 10) - 1;
    if (idx >= 0 && idx < canonicalList.length) {
      return { matched: true, canonicalMd: canonicalList[idx] };
    }
  }

  const partialMatches = canonicalList.filter((c) => {
    const stem = stemOf(c);
    return (
      stem.toLowerCase().includes(t.toLowerCase()) ||
      t.toLowerCase().includes(stem.toLowerCase())
    );
  });
  if (partialMatches.length === 1) {
    return { matched: true, canonicalMd: partialMatches[0] };
  }

  return { matched: false };
}

/** Outbound POST content: canonical `*.md` when user picked from the template table. */
export function normalizeTemplateSelection(
  userText: string,
  messages: HistoryMessage[],
): string {
  const { matched, canonicalMd } = resolveTemplateSelection(userText, messages);
  if (matched && canonicalMd) return canonicalMd;
  return userText;
}
