/**
 * Action-bar buttons from last assistant draft (same target as intent-apply).
 * Explicit actionId → plan / download; no NLP, no agent turn.
 */
import type { ContextFamily, EditorType } from "../config";
import type { ChatMessage } from "../ui/chat";
import type { InsertPosition } from "./types";
import type { R7Task } from "./task-parse";
import {
  intentApplyKey,
  intentToR7Task,
  planFromFindingsItems,
  type DocumentApplyIntent,
  type DocumentApplyPlan,
  type FixIntent,
  type IntentApplyKind,
} from "./intent-apply";
import { parseR7Proposal } from "./proposal-parse";
import { resolveDocumentActionButtons } from "./action-buttons-document";
import { resolveSpreadsheetActionButtons } from "./action-buttons-spreadsheet";
import {
  hashText,
  isFindingsFixActionId,
  resolveActionTarget,
  resolveInsertableText,
  type ActionButtonSpec,
  type ActionId,
  type ActionTarget,
} from "./action-buttons-shared";

export type { ActionId, ActionButtonSpec, ActionTarget } from "./action-buttons-shared";
export {
  actionTargetKey,
  hashText,
  isFindingsFixActionId,
  resolveActionTarget,
  resolveDocumentActionTarget,
  resolveInsertableText,
} from "./action-buttons-shared";

import type { HistoryMessageLike } from "./agent-deliverables";

/** Map action-bar id → fix intent (findings only). */
export function fixIntentFromActionId(actionId: ActionId): FixIntent | null {
  if (actionId === "fix_all") return { mode: "all" };
  if (actionId === "fix_orthography") {
    return { mode: "category", category: "orthography" };
  }
  if (actionId === "fix_punctuation") {
    return { mode: "category", category: "punctuation" };
  }
  if (actionId === "fix_grammar") {
    return { mode: "category", category: "grammar" };
  }
  return null;
}

/** Buttons for the action bar from last AI result + context family. */
export function resolveActionButtons(
  target: ActionTarget | null,
  editorType: EditorType,
  contextFamily: ContextFamily,
  messages: ChatMessage[] = [],
  options: {
    history?: HistoryMessageLike[];
    selectedXlsxPath?: string | null;
    excludePath?: string | null;
    appliedActionKeys?: Set<string>;
    dismissedActionKeys?: Set<string>;
    appliedFindingIds?: Set<number>;
  } = {},
): ActionButtonSpec[] {
  if (contextFamily === "spreadsheet") {
    return resolveSpreadsheetActionButtons(target, messages, {
      history: options.history,
      selectedPath: options.selectedXlsxPath,
      excludePath: options.excludePath,
    });
  }
  if (!target) return [];
  void editorType;
  return resolveDocumentActionButtons(target, {
    appliedActionKeys: options.appliedActionKeys,
    dismissedActionKeys: options.dismissedActionKeys,
    appliedFindingIds: options.appliedFindingIds,
  });
}

/** Build apply plan for an explicit action bar click (overrides proposal preferReplace). */
export function planFromActionId(
  actionId: ActionId,
  target: ActionTarget,
): DocumentApplyPlan | null {
  if (
    actionId === "download_md" ||
    actionId === "download_word_html" ||
    actionId === "download_csv" ||
    actionId === "download_vfs_xlsx" ||
    actionId === "sheet_from_xlsx" ||
    actionId === "paste_xlsx_matrix"
  ) {
    return null;
  }

  const proposal = parseR7Proposal(target.raw);

  if (isFindingsFixActionId(actionId)) {
    if (proposal?.kind !== "findings" || !proposal.items?.length) return null;
    const fix = fixIntentFromActionId(actionId);
    if (!fix) return null;
    return planFromFindingsItems(proposal.items, fix, proposal.revision);
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
    const search =
      proposal?.kind === "comment"
        ? String(proposal.search || proposal.anchor || "").trim()
        : "";
    const task: R7Task = {
      type: "add_comment",
      data: search ? { text: text.trim(), search } : { text: text.trim() },
    };
    return {
      tasks: [task],
      dedupeKeys: [`intent:comment:${hashText(text.trim() + "|" + search)}`],
      // With search/anchor the plugin finds the phrase; no manual selection required.
      requireSelection: !search,
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
