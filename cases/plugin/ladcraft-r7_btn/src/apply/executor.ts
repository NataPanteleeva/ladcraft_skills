import type { HistoryMessage } from "../eai/session";
import { extractText } from "../eai/session";
import { parseToolCalls } from "./tool-call-parser";
import { parseR7Tasks, stripTaskMarkup, type R7Task } from "./task-parse";

export type {
  R7Task,
  R7TaskType,
  R7PasteTask,
  R7PasteTextTask,
  R7CellPasteTask,
  R7AddCommentTask,
  R7SearchReplaceTask,
  R7RemoveSelectionTask,
  R7ReplaceSelectionTask,
  R7DeliverInlineTask,
  R7DeliverFileTask,
  R7ShareLinkTask,
  R7OpenFileTask,
} from "./task-parse";

/** Collect all text fields from a history message for task parsing. */
export function getMessageFullText(message: HistoryMessage): string {
  const parts: string[] = [];
  if (message.content) parts.push(message.content);
  for (const item of message.response_timeline ?? []) {
    if (item.content) parts.push(item.content);
  }
  for (const call of message.tool_calls ?? []) {
    for (const field of [call.result, call.arguments, call.args]) {
      if (typeof field === "string") parts.push(field);
    }
  }
  return parts.join("\n");
}

/**
 * Extract tasks from assistant reply: all r7.task blocks, inline JSON, tool_calls.
 */
export function extractTasksFromReply(message: HistoryMessage): R7Task[] {
  const tasks: R7Task[] = [];
  const seen = new Set<string>();

  const addAll = (list: R7Task[]) => {
    for (const task of list) {
      const key = `${task.type}:${JSON.stringify(task.data)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      tasks.push(task);
    }
  };

  addAll(parseR7Tasks(getMessageFullText(message)));
  addAll(parseR7Tasks(extractText(message)));
  addAll(parseToolCalls(message.tool_calls));

  return tasks;
}

/** Replace r7.task blocks and raw task JSON for chat display. */
export function stripR7TaskBlock(text: string): string {
  const out = stripTaskMarkup(text).trim();
  if (!out) return "Готово!";
  return out;
}
