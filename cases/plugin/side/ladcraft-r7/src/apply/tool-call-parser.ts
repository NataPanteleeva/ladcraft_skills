import type { ToolCallRecord } from "../eai/session";
import { parseR7Tasks, type R7Task, type R7TaskType } from "./task-parse";

const TOOL_NAME_TO_TYPE: Record<string, R7TaskType> = {
  r7_paste: "paste",
  r7_paste_html: "paste",
  r7_paste_text: "paste_text",
  r7_cell_paste: "cell_paste",
  r7_add_comment: "add_comment",
  r7_search_replace: "search_replace",
  r7_remove_selection: "remove_selection",
  r7_replace_selection: "replace_selection",
  r7_deliver_inline: "deliver_inline",
  r7_deliver_file: "deliver_file",
  r7_share_link: "share_link",
  r7_open_file: "open_file",
  "r7-export": "deliver_file",
  "r7-add-comment": "add_comment",
  "r7-search-replace": "search_replace",
  "r7-replace-selection": "replace_selection",
};

/** Parse EAI tool_calls from history into r7.task-shaped operations. */
export function parseToolCalls(calls: ToolCallRecord[] | null | undefined): R7Task[] {
  if (!calls?.length) return [];

  const tasks: R7Task[] = [];
  for (const call of calls) {
    for (const field of [call.result, call.arguments, call.args]) {
      if (typeof field === "string") {
        tasks.push(...parseR7Tasks(field));
      }
    }
    const task = toolCallToTask(call);
    if (task && !tasks.some((t) => taskKey(t) === taskKey(task))) {
      tasks.push(task);
    }
  }
  return tasks;
}

function taskKey(task: R7Task): string {
  return `${task.type}:${JSON.stringify(task.data)}`;
}

function toolCallToTask(call: ToolCallRecord): R7Task | null {
  for (const field of [call.result, call.arguments, call.args]) {
    if (typeof field === "string") {
      const fromBlock = parseR7Tasks(field);
      if (fromBlock.length === 1) return fromBlock[0];
    }
  }

  const raw = call.arguments ?? call.args ?? call.result;
  const parsed = normalizePayload(raw);

  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
    const obj = parsed as Record<string, unknown>;
    if (obj.type && obj.data !== undefined) {
      return buildTask(String(obj.type) as R7TaskType, obj.data);
    }
  }

  const name = (call.name ?? call.tool_name ?? "").toLowerCase();
  const type = TOOL_NAME_TO_TYPE[name];
  if (!type) return null;

  return buildTask(type, parsed);
}

function normalizePayload(raw: unknown): unknown {
  if (raw == null) return null;
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw);
    } catch {
      return raw;
    }
  }
  if (typeof raw === "object") {
    const obj = raw as Record<string, unknown>;
    if (obj.type && obj.data !== undefined) {
      return obj.data;
    }
    return obj;
  }
  return null;
}

function buildTask(type: R7TaskType, data: unknown): R7Task | null {
  switch (type) {
    case "paste":
      return typeof data === "string" ? { type, data } : null;
    case "paste_text":
      return typeof data === "string"
        ? { type, data }
        : typeof (data as { text?: string })?.text === "string"
          ? { type, data: (data as { text: string }).text }
          : null;
    case "add_comment": {
      const text =
        typeof data === "string"
          ? data
          : (data as { text?: string })?.text ?? (data as { comment?: string })?.comment;
      return typeof text === "string" ? { type, data: { text } } : null;
    }
    case "search_replace": {
      if (!data || typeof data !== "object") return null;
      const d = data as { search?: string; replace?: string; matchCase?: boolean };
      if (!d.search || d.replace === undefined) return null;
      return { type, data: { search: d.search, replace: d.replace, matchCase: d.matchCase } };
    }
    case "remove_selection":
      return { type, data: {} };
    case "replace_selection":
      return typeof data === "string"
        ? { type, data }
        : data && typeof data === "object" && !Array.isArray(data)
          ? { type, data: data as Record<string, string | number> }
          : null;
    case "cell_paste":
      return data && typeof data === "object" && !Array.isArray(data)
        ? { type, data: data as Record<string, string | number> }
        : null;
    case "deliver_inline":
    case "deliver_file":
    case "share_link":
    case "open_file":
      return data && typeof data === "object" && !Array.isArray(data)
        ? ({ type, data } as R7Task)
        : null;
    default:
      return null;
  }
}
