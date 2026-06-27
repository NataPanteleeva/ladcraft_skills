import type { HistoryMessage } from "../eai/session";
import { getMessageFullText } from "../utils/message-text";
import { extractWidgetPayload } from "../eai/widget";

const MD_FILE = /([^\s/\\|]+\.md)/gi;

/** Parse radio / option labels from Ladcraft widget HTML. */
export function extractChoicesFromWidgetHtml(html: string): string[] {
  const choices = new Set<string>();

  for (const match of html.matchAll(/<input[^>]+type=["'](?:radio|checkbox)["'][^>]*>/gi)) {
    const tag = match[0];
    const value = tag.match(/value=["']([^"']+)["']/i)?.[1];
    if (value?.trim()) choices.add(value.trim());
  }

  for (const match of html.matchAll(/<label[^>]*>([\s\S]*?)<\/label>/gi)) {
    const label = match[1].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    if (label.length >= 2 && label.length <= 120) choices.add(label);
  }

  for (const match of html.matchAll(/data-value=["']([^"']+)["']/gi)) {
    choices.add(match[1].trim());
  }

  return [...choices].filter((c) => c.length > 0);
}

/** Options from message metadata (Ladcraft widget schema). */
export function extractChoicesFromMetadata(message: HistoryMessage): string[] {
  const meta = message.metadata;
  if (!meta || typeof meta !== "object") return [];

  const out: string[] = [];
  const record = meta as Record<string, unknown>;

  const tryArray = (value: unknown): void => {
    if (!Array.isArray(value)) return;
    for (const item of value) {
      if (typeof item === "string" && item.trim()) out.push(item.trim());
      else if (item && typeof item === "object") {
        const obj = item as Record<string, unknown>;
        const label = obj.label ?? obj.title ?? obj.name ?? obj.value;
        if (typeof label === "string" && label.trim()) out.push(label.trim());
      }
    }
  };

  for (const key of ["options", "choices", "items", "widget_options", "input_options"]) {
    tryArray(record[key]);
  }

  const widget = record.widget;
  if (widget && typeof widget === "object") {
    const w = widget as Record<string, unknown>;
    tryArray(w.options);
    tryArray(w.choices);
  }

  return out;
}

/** Template filenames and numbered options from assistant text. */
export function extractChoicesFromText(text: string): string[] {
  const choices = new Set<string>();

  for (const match of text.matchAll(/^\s*\d+[\.\):\-]\s*(.+)$/gim)) {
    const line = match[1].trim();
    if (line.length >= 2 && line.length <= 120) choices.add(line);
  }

  for (const match of text.matchAll(MD_FILE)) {
    const name = match[1].trim();
    if (name.length >= 4) choices.add(name);
  }

  for (const match of text.matchAll(/\|\s*шаблон\s*\|[^\n]*\n\|[-\s|]+\|\n([\s\S]*?)(?:\n\n|\n#|\n---|$)/i)) {
    for (const row of match[1].split("\n")) {
      const cell = row.split("|").map((c) => c.trim()).filter(Boolean)[0];
      if (cell && !/^[-—]+$/.test(cell)) choices.add(cell);
    }
  }

  return [...choices];
}

/** Collect selectable options for a pending clarification turn. */
export function extractWidgetChoices(
  message: HistoryMessage,
  items: HistoryMessage[],
  index: number,
): string[] {
  const widget = extractWidgetPayload(message);
  if (widget?.html) {
    const fromHtml = extractChoicesFromWidgetHtml(widget.html);
    if (fromHtml.length) return dedupeChoices(fromHtml);
  }

  const next = items[index + 1];
  if (next && (next.kind === "widget" || next.widget_html)) {
    const nextWidget = extractWidgetPayload(next);
    if (nextWidget?.html) {
      const fromHtml = extractChoicesFromWidgetHtml(nextWidget.html);
      if (fromHtml.length) return dedupeChoices(fromHtml);
    }
  }

  const fromMeta = extractChoicesFromMetadata(message);
  if (fromMeta.length) return dedupeChoices(fromMeta);

  const contextParts: string[] = [];
  for (let i = 0; i <= index; i++) {
    const item = items[i];
    if (item.role === "assistant") {
      contextParts.push(getMessageFullText(item));
    }
  }
  const fromText = extractChoicesFromText(contextParts.join("\n\n"));
  return dedupeChoices(fromText);
}

function dedupeChoices(choices: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const choice of choices) {
    const key = choice.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(choice);
  }
  return out;
}
