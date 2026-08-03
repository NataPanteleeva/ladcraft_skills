/**
 * Local Word format intents: transform last draft / selection markdown → paste.
 * No CharacterFormat API — same PasteHtml path as normal insert.
 */

import type { ChatMessage } from "../ui/chat";
import {
  demoteAllTablesInMarkdown,
  demoteProseTablesInMarkdown,
} from "../markdown/html";
import { resolveInsertableText, resolveActionTarget } from "./action-buttons-shared";
import type { R7Task } from "./task-parse";
import type { DocumentApplyPlan } from "./intent-apply";

export type WordFormatKind =
  | "remove_box"
  | "as_quote"
  | "make_bold"
  | "remove_bold"
  | "demote_table";

export interface WordFormatIntent {
  kind: WordFormatKind;
  summary: string;
}

/** Detect local format-change phrase (RU). */
export function detectWordFormatIntent(userText: string): WordFormatIntent | null {
  const t = String(userText || "")
    .toLowerCase()
    .replace(/[*_~`]+/g, "")
    .replace(/[?!.,;:…]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!t || t.length > 96) return null;

  // Concrete edit tasks → agent / other intents
  if (
    /исправь\s+все|исправь\s+\d|замени\s+.+\s+на\s+|проверь|перепиши|сгенерируй|напиши\s+письм/.test(
      t,
    )
  ) {
    return null;
  }

  if (
    /убери\s+(рамк|фон|оформлен|blockquote|цитатн)|сними\s+(рамк|фон|оформлен)|без\s+(рамк|фона|оформлен)|plain\s*text|убери\s+выделен/.test(
      t,
    )
  ) {
    return { kind: "remove_box", summary: "Убрано оформление (рамка/фон)" };
  }

  if (
    /оформи\s+как\s+цитат|как\s+цитат|добавь\s+(рамк|фон)|с\s+рамк|в\s+рамк|blockquote/.test(t)
  ) {
    return { kind: "as_quote", summary: "Оформлено как цитата" };
  }

  if (/убери\s+жирн|сними\s+жирн|без\s+жирн|не\s+жирн/.test(t)) {
    return { kind: "remove_bold", summary: "Убран жирный" };
  }

  if (/сделай\s+жирн|жирным|выдели\s+жирн|bold/.test(t)) {
    return { kind: "make_bold", summary: "Сделано жирным" };
  }

  if (
    /без\s+таблиц|не\s+таблиц|списком|в\s+виде\s+списк|убери\s+таблиц|разложи\s+таблиц/.test(t)
  ) {
    return { kind: "demote_table", summary: "Таблица разложена списком" };
  }

  return null;
}

export function transformMarkdownFormat(md: string, kind: WordFormatKind): string {
  const raw = String(md || "");
  switch (kind) {
    case "remove_box":
      return raw
        .split("\n")
        .map((line) => line.replace(/^>\s?/, ""))
        .join("\n")
        .trim();
    case "as_quote":
      return raw
        .split("\n")
        .map((line) => {
          const t = line.trimEnd();
          if (!t.trim()) return "";
          if (/^>\s?/.test(t)) return t;
          return `> ${t.replace(/^>\s?/, "")}`;
        })
        .join("\n")
        .trim();
    case "make_bold": {
      const stripped = raw.replace(/\*\*/g, "").trim();
      if (!stripped) return raw;
      // Whole blob as one bold block if short; else bold each non-empty paragraph line.
      if (stripped.length <= 240 && !stripped.includes("\n")) {
        return `**${stripped}**`;
      }
      return stripped
        .split("\n")
        .map((line) => {
          const t = line.trim();
          if (!t) return "";
          if (/^#{1,6}\s/.test(t) || /^\|/.test(t)) return line;
          return `**${t.replace(/\*\*/g, "")}**`;
        })
        .join("\n")
        .trim();
    }
    case "remove_bold":
      return raw.replace(/\*\*/g, "").trim();
    case "demote_table":
      return demoteAllTablesInMarkdown(raw);
    default:
      return raw;
  }
}

/**
 * Build apply plan from format intent.
 * Prefer replace_selection when editor has a selection (caller checks);
 * otherwise paste last insertable draft at cursor.
 */
export function planWordFormatTransform(
  kind: WordFormatKind,
  sourceMarkdown: string,
  options: { hasSelection: boolean },
): DocumentApplyPlan | null {
  const next = transformMarkdownFormat(sourceMarkdown, kind);
  if (!next.trim()) return null;
  if (next.trim() === String(sourceMarkdown || "").trim() && kind !== "demote_table") {
    // Still allow demote / no-op detection upstream
  }

  if (options.hasSelection) {
    const task: R7Task = {
      type: "replace_selection",
      data: { text: next },
    };
    return {
      tasks: [task],
      dedupeKeys: [`word-fmt:${kind}:${taskContentFinger(next)}`],
      requireSelection: true,
      source: "proposal",
      statusHint: "Меняю оформление…",
    };
  }

  const task: R7Task = {
    type: "paste_text",
    data: { text: next, position: "cursor" },
  };
  return {
    tasks: [task],
    dedupeKeys: [`word-fmt:${kind}:${taskContentFinger(next)}`],
    requireSelection: false,
    source: "proposal",
    statusHint: "Меняю оформление…",
  };
}

function taskContentFinger(text: string): string {
  return String(text || "").slice(0, 120);
}

/** Resolve markdown source: selection text, else last insertable from chat. */
export function resolveWordFormatSourceMarkdown(
  messages: ChatMessage[],
  selectionText: string,
): string {
  const sel = String(selectionText || "").trim();
  if (sel) return sel;
  const target = resolveActionTarget(messages);
  if (!target) return "";
  return resolveInsertableText(target.raw) || "";
}

export { demoteProseTablesInMarkdown };
