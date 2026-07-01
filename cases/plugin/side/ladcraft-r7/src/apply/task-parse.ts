export type R7TaskType =
  | "paste"
  | "paste_text"
  | "cell_paste"
  | "add_comment"
  | "search_replace"
  | "remove_selection"
  | "replace_selection"
  | "deliver_inline"
  | "deliver_file"
  | "share_link"
  | "open_file";

export type DeliverAction = "download" | "paste_text" | "paste" | "share_link" | "open";
export type ImportAs = "paste_text" | "paste_html" | null;

export interface R7PasteTask {
  type: "paste";
  data: string;
}

export interface R7PasteTextTask {
  type: "paste_text";
  data: string;
}

export interface R7CellPasteTask {
  type: "cell_paste";
  data: Record<string, string | number>;
}

export interface R7AddCommentTask {
  type: "add_comment";
  data: { text: string };
}

export interface R7SearchReplaceTask {
  type: "search_replace";
  data: { search: string; replace: string; matchCase?: boolean };
}

export interface R7RemoveSelectionTask {
  type: "remove_selection";
  data: Record<string, never>;
}

export interface R7ReplaceSelectionTask {
  type: "replace_selection";
  data: string | Record<string, string | number>;
}

export interface R7DeliverInlineTask {
  type: "deliver_inline";
  data: {
    fileName: string;
    mimeType?: string;
    encoding?: string;
    content: string;
    actions?: DeliverAction[];
  };
}

export interface R7DeliverFileTask {
  type: "deliver_file";
  data: {
    fileId: string;
    fileName: string;
    mimeType?: string;
    actions?: DeliverAction[];
    importAs?: ImportAs;
  };
}

export interface R7ShareLinkTask {
  type: "share_link";
  data: {
    fileId: string;
    fileName?: string;
    label?: string;
  };
}

export interface R7OpenFileTask {
  type: "open_file";
  data: {
    fileId: string;
    fileName: string;
  };
}

export type R7Task =
  | R7PasteTask
  | R7PasteTextTask
  | R7CellPasteTask
  | R7AddCommentTask
  | R7SearchReplaceTask
  | R7RemoveSelectionTask
  | R7ReplaceSelectionTask
  | R7DeliverInlineTask
  | R7DeliverFileTask
  | R7ShareLinkTask
  | R7OpenFileTask;

const TASK_TYPE_PATTERN =
  "paste|paste_text|cell_paste|add_comment|search_replace|remove_selection|replace_selection|deliver_inline|deliver_file|share_link|open_file";

const TASK_BLOCK_RE = /```r7\.task\s*([\s\S]*?)```/gi;
/** Unclosed ```r7.task fence — agent sometimes truncates before closing backticks. */
const ORPHAN_R7_TASK_FENCE_RE = /```r7\.task[\s\S]*/gi;
const ORPHAN_R7_TASK_LABEL_RE = /^\*r7\.task\*:\s*$/gm;
const INLINE_TASK_ARRAY_RE = new RegExp(
  `\\[\\s*\\{[\\s\\S]*?"type"\\s*:\\s*"(${TASK_TYPE_PATTERN})"[\\s\\S]*?\\}\\s*\\]`,
  "g",
);

export const EXPORT_CARD_TASK_TYPES: R7TaskType[] = [
  "deliver_inline",
  "deliver_file",
  "share_link",
];

/** Tasks that produce deliverable UI cards (not open_file). */
export function isExportCardTask(type: R7TaskType): boolean {
  return EXPORT_CARD_TASK_TYPES.includes(type);
}

/** Parse all r7.task fenced blocks and inline JSON task arrays from text. */
export function parseR7Tasks(text: string): R7Task[] {
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

  for (const match of text.matchAll(TASK_BLOCK_RE)) {
    addAll(parseTaskPayload(match[1].trim()));
  }

  for (const match of text.matchAll(INLINE_TASK_ARRAY_RE)) {
    addAll(parseTaskPayload(match[0]));
  }

  return tasks;
}

/** Replace r7.task blocks and raw task JSON with empty string. */
export function stripTaskMarkup(text: string): string {
  let out = text.replace(TASK_BLOCK_RE, "").trim();
  out = out.replace(ORPHAN_R7_TASK_FENCE_RE, "").trim();
  out = out.replace(INLINE_TASK_ARRAY_RE, "").trim();
  out = out.replace(ORPHAN_R7_TASK_LABEL_RE, "").trim();
  out = out.replace(/```\s*$/g, "").trim();
  return out.replace(/\n{3,}/g, "\n\n");
}

function parseTaskPayload(raw: string): R7Task[] {
  try {
    const parsed = JSON.parse(raw) as R7Task | R7Task[];
    const list = Array.isArray(parsed) ? parsed : [parsed];
    return list.filter(isValidTask);
  } catch {
    return [];
  }
}

function isValidTask(task: R7Task): boolean {
  switch (task.type) {
    case "paste":
    case "paste_text":
      return typeof task.data === "string";
    case "cell_paste":
      return Boolean(task.data && typeof task.data === "object");
    case "add_comment":
      return typeof task.data?.text === "string";
    case "search_replace":
      return (
        typeof task.data?.search === "string" && typeof task.data?.replace === "string"
      );
    case "remove_selection":
      return true;
    case "replace_selection":
      return typeof task.data === "string" || Boolean(task.data && typeof task.data === "object");
    case "deliver_inline":
      return (
        typeof task.data?.fileName === "string" &&
        typeof task.data?.content === "string" &&
        task.data.content.length <= 32_768
      );
    case "deliver_file":
      return typeof task.data?.fileId === "string" && typeof task.data?.fileName === "string";
    case "share_link":
      return typeof task.data?.fileId === "string";
    case "open_file":
      return typeof task.data?.fileId === "string" && typeof task.data?.fileName === "string";
    default:
      return false;
  }
}
