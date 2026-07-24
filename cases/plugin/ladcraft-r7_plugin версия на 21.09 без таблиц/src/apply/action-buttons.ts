/**
 * Action-bar buttons from last assistant draft (same target as intent-apply).
 * Explicit actionId → plan / download; no NLP, no agent turn.
 */
import type { EditorType } from "../config";
import type { ChatMessage } from "../ui/chat";
import type { InsertPosition } from "./types";
import type { R7Task } from "./task-parse";
import {
  assistantApplySource,
  extractInsertableMarkdown,
  intentApplyKey,
  intentToR7Task,
  isGenericInsertableDraft,
  isStructuredSummaryBlob,
  type DocumentApplyIntent,
  type DocumentApplyPlan,
  type IntentApplyKind,
} from "./intent-apply";
import { parseR7Proposal } from "./proposal-parse";

export type ActionId =
  | "replace_selection"
  | "paste_cursor"
  | "paste_start"
  | "paste_end"
  | "fix_all"
  | "add_comment"
  | "cell_write"
  | "download_md"
  | "download_word_html";

export interface ActionButtonSpec {
  id: ActionId;
  label: string;
  glyph: string;
  title: string;
  primary?: boolean;
  kind: "apply" | "download";
}

export interface ActionTarget {
  message: ChatMessage;
  raw: string;
  fingerprint: string;
}

const DRAFT_HEADER_RE =
  /(?:^|\n)#{0,3}\s*\*{0,2}\s*черновик(?:\s*\([^)]*\))?\s*\*{0,2}\s*:?\s*\*{0,2}\s*(?:\n|$)/i;

/** Last assistant draft suitable for apply/download (same scan as intent-apply). */
export function resolveActionTarget(messages: ChatMessage[]): ActionTarget | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role !== "assistant") continue;
    const raw = assistantApplySource(m);
    if (!raw || /агент (?:выполняет|формирует)/i.test(raw)) continue;
    if (m.widget || m.waitingForInput) continue;
    return { message: m, raw, fingerprint: `${m.id}:${raw.length}:${hashText(raw)}` };
  }
  return null;
}

/** Buttons for the action bar from last AI result + editor type. */
export function resolveActionButtons(
  target: ActionTarget | null,
  editorType: EditorType,
): ActionButtonSpec[] {
  if (!target) return [];
  const proposal = parseR7Proposal(target.raw);

  if (proposal?.kind === "findings" && proposal.items?.length) {
    return [
      {
        id: "fix_all",
        label: "Все",
        glyph: "✓",
        title: "Исправить все",
        primary: true,
        kind: "apply",
      },
    ];
  }

  if (proposal?.kind === "comment" && (proposal.text || "").trim()) {
    return [
      {
        id: "add_comment",
        label: "Коммент",
        glyph: "💬",
        title: "Добавить комментарий к выделению",
        primary: true,
        kind: "apply",
      },
    ];
  }

  if (proposal?.kind === "cell_map" && proposal.data && editorType === "cell") {
    const buttons: ActionButtonSpec[] = [
      {
        id: "cell_write",
        label: "Запись",
        glyph: "▦",
        title: "Записать в таблицу",
        primary: true,
        kind: "apply",
      },
    ];
    const body = cellMapToText(proposal.data);
    if (body) {
      buttons.push({
        id: "download_md",
        label: "MD",
        glyph: "⇩",
        title: "Скачать .md",
        kind: "download",
      });
    }
    return buttons;
  }

  const insertable = resolveInsertableText(target.raw);
  if (!insertable) return [];

  const preferReplace =
    proposal?.kind === "blob" &&
    (proposal.preferReplaceSelection === true || proposal.op === "replace_selection");

  const buttons: ActionButtonSpec[] = [];

  if (editorType === "word") {
    if (preferReplace) {
      buttons.push({
        id: "replace_selection",
        label: "Заменить",
        glyph: "⇄",
        title: "Заменить выделение",
        primary: true,
        kind: "apply",
      });
      buttons.push({
        id: "paste_cursor",
        label: "Курсор",
        glyph: "⎣",
        title: "Вставить у курсора",
        kind: "apply",
      });
    } else {
      buttons.push({
        id: "paste_cursor",
        label: "Курсор",
        glyph: "⎣",
        title: "Вставить у курсора",
        primary: true,
        kind: "apply",
      });
      buttons.push({
        id: "replace_selection",
        label: "Заменить",
        glyph: "⇄",
        title: "Заменить выделение",
        kind: "apply",
      });
    }
    buttons.push({
      id: "paste_end",
      label: "Конец",
      glyph: "↓",
      title: "Вставить в конец",
      kind: "apply",
    });
  } else {
    // Cell: downloads primary; optional paste at active area via cursor paste_text if supported
    buttons.push({
      id: "paste_cursor",
      label: "Вставить",
      glyph: "⎣",
      title: "Вставить у активной ячейки",
      primary: true,
      kind: "apply",
    });
  }

  buttons.push(
    {
      id: "download_md",
      label: "MD",
      glyph: "⇩",
      title: "Скачать .md",
      kind: "download",
    },
    {
      id: "download_word_html",
      label: "Word",
      glyph: "W",
      title: "Скачать для Word (.html)",
      kind: "download",
    },
  );

  return buttons;
}

/** Build apply plan for an explicit action bar click (overrides proposal preferReplace). */
export function planFromActionId(
  actionId: ActionId,
  target: ActionTarget,
): DocumentApplyPlan | null {
  if (actionId === "download_md" || actionId === "download_word_html") return null;

  const proposal = parseR7Proposal(target.raw);

  if (actionId === "fix_all") {
    if (proposal?.kind !== "findings" || !proposal.items?.length) return null;
    const tasks: R7Task[] = proposal.items.slice(0, 15).map((it) => ({
      type: "search_replace" as const,
      data: {
        search: it.search,
        replace: it.replace,
        matchCase: it.matchCase === true,
      },
    }));
    return {
      tasks,
      dedupeKeys: [
        `intent:findings:r${proposal.revision ?? 1}:all`,
        ...tasks.map((t) => `intent-plan:${t.type}:${JSON.stringify(t.data)}`),
      ],
      requireSelection: false,
      itemIds: proposal.items.map((it) => it.id),
      source: "proposal",
      statusHint: `Вношу ${tasks.length} замен…`,
    };
  }

  if (actionId === "cell_write") {
    if (proposal?.kind !== "cell_map" || !proposal.data) return null;
    const task: R7Task = { type: "cell_paste", data: proposal.data };
    return {
      tasks: [task],
      dedupeKeys: [`intent:cell_map:${task.type}:${JSON.stringify(task.data)}`],
      requireSelection: false,
      source: "proposal",
      statusHint: "Записываю ячейки…",
    };
  }

  if (actionId === "add_comment") {
    const text = (proposal?.kind === "comment" ? proposal.text : resolveInsertableText(target.raw)) || "";
    if (!text.trim()) return null;
    const task: R7Task = { type: "add_comment", data: { text: text.trim() } };
    return {
      tasks: [task],
      dedupeKeys: [`intent:comment:${hashText(text.trim())}`],
      requireSelection: true,
      source: proposal?.kind === "comment" ? "proposal" : "markdown-fallback",
      statusHint: "Добавляю комментарий…",
    };
  }

  const text = resolveInsertableText(target.raw);
  if (!text.trim()) return null;

  let kind: IntentApplyKind = "paste_text";
  let position: InsertPosition = "cursor";
  let requireSelection = false;

  if (actionId === "replace_selection") {
    kind = "replace_selection";
    requireSelection = true;
  } else if (actionId === "paste_start") {
    position = "start";
  } else if (actionId === "paste_end") {
    position = "end";
  } else {
    position = "cursor";
  }

  const intent: DocumentApplyIntent = { kind, position, text: text.trim() };
  const task = intentToR7Task(intent);
  return {
    tasks: [task],
    dedupeKeys: [
      intentApplyKey(intent),
      `intent-plan:${task.type}:${JSON.stringify(task.data)}`,
    ],
    requireSelection,
    source: proposal?.kind === "blob" ? "proposal" : "markdown-fallback",
    statusHint:
      kind === "replace_selection" ? "Заменяю выделение…" : "Вставляю в документ…",
  };
}

/** Text body for download / paste from last draft. */
export function resolveInsertableText(raw: string): string {
  const proposal = parseR7Proposal(raw);
  if (proposal?.kind === "blob" && (proposal.text || "").trim()) {
    return proposal.text!.trim();
  }
  if (proposal?.kind === "comment" && (proposal.text || "").trim()) {
    return proposal.text!.trim();
  }
  if (proposal?.kind === "cell_map" && proposal.data) {
    return cellMapToText(proposal.data);
  }
  if (
    DRAFT_HEADER_RE.test(raw) ||
    isStructuredSummaryBlob(raw) ||
    isGenericInsertableDraft(raw)
  ) {
    return extractInsertableMarkdown(raw);
  }
  const extracted = extractInsertableMarkdown(raw);
  return extracted.trim().length >= 40 ? extracted : "";
}

function cellMapToText(data: Record<string, string | number | boolean | null>): string {
  return Object.keys(data)
    .sort()
    .map((k) => `${k}\t${data[k] == null ? "" : String(data[k])}`)
    .join("\n");
}

function hashText(text: string): string {
  let h = 0;
  for (let i = 0; i < text.length; i++) {
    h = (h * 31 + text.charCodeAt(i)) | 0;
  }
  return String(h);
}
