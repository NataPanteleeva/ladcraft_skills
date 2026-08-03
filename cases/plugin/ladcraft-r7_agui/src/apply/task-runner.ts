import type { EditorType } from "../config";
import { extractTasksFromReply } from "./executor";
import {
  applyCellFormatSpec,
  applyCellPaste,
  applyDocumentComment,
  applyDocumentSearchReplace,
  applyDocumentSearchReplaceBatch,
  applyMatrixReplaceAtTarget,
  executeMethod,
  insertText,
  setAscScope,
  withAction,
} from "./editor-methods";
import type { HistoryMessage } from "../eai/session";
import { userTextWantsAutoFitColumns } from "./cell-format";
import type { R7Task, R7TaskType } from "./task-parse";
import type { MatrixCell } from "./vfs-xlsx-matrix";
import { parseR7Proposal } from "./proposal-parse";
import { isLexicalSearchReplaceIntent } from "./intent-apply";
import { wrapHtmlWithWordFont } from "../ui/word-font-prefs";
import { contentToPasteHtml } from "../markdown/html";

/** Applied automatically to the open R7 document (not deliverable/export cards). */
export const EDITOR_AUTO_APPLY_TYPES: R7TaskType[] = [
  "search_replace",
  "add_comment",
  "paste",
  "paste_text",
  "cell_paste",
  "remove_selection",
  "replace_selection",
  "sheet_replace_from_xlsx",
  "cell_format",
];

export interface EditorTaskApplyResult {
  applied: number;
  failed: number;
  summary: string;
  errors: string[];
  successfulTasks: R7Task[];
}

/** Optional VFS loader for sheet_replace_from_xlsx (plugin session context). */
export interface EditorTaskApplyDeps {
  loadXlsxMatrix?: (
    path: string,
    sheet?: string,
  ) => Promise<{ aoa: MatrixCell[][]; sheetName?: string }>;
}

export function taskApplyKey(messageId: string, task: R7Task): string {
  return `${messageId}:${task.type}:${JSON.stringify(task.data)}`;
}

export function filterEditorApplyTasks(tasks: R7Task[]): R7Task[] {
  return tasks.filter((task) => EDITOR_AUTO_APPLY_TYPES.includes(task.type));
}

/** Preceding user bubble text for an assistant message (for apply heuristics). */
export function precedingUserTextForMessage(
  messages: HistoryMessage[],
  assistantMessageId: string,
): string {
  let prevUser = "";
  for (const message of messages) {
    if (message.id === assistantMessageId) return prevUser;
    if (message.role === "user") {
      prevUser = String(message.content || "").trim();
    }
  }
  return prevUser;
}

/**
 * If the user asked for width-by-content but the LLM left autoFitColumns false,
 * force it on before Asc apply.
 */
export function hoistCellFormatAutoFitFromUserText(
  task: R7Task,
  userText: string,
): R7Task {
  if (task.type !== "cell_format") return task;
  if (task.data?.autoFitColumns === true) return task;
  if (!userTextWantsAutoFitColumns(userText)) return task;
  return {
    ...task,
    data: {
      ...task.data,
      autoFitColumns: true,
    },
  };
}

export function collectPendingEditorTasks(
  messages: HistoryMessage[],
  appliedKeys: ReadonlySet<string>,
): Array<{ messageId: string; task: R7Task }> {
  const pending: Array<{ messageId: string; task: R7Task }> = [];
  const seen = new Set<string>();

  for (const message of messages) {
    if (message.role !== "assistant") continue;
    const tasks = filterEditorApplyTasks(extractTasksFromReply(message));
    const userText = precedingUserTextForMessage(messages, message.id);
    for (const rawTask of tasks) {
      const task = hoistCellFormatAutoFitFromUserText(rawTask, userText);
      const key = taskApplyKey(message.id, task);
      const contentKey = taskContentKey(task);
      if (appliedKeys.has(key) || appliedKeys.has(contentKey) || seen.has(key)) continue;
      seen.add(key);
      pending.push({ messageId: message.id, task });
    }
  }

  return pending;
}

/**
 * AG-UI: collect search_replace from findings **only** for the latest
 * user→assistant pair when that user asked for lexical replace.
 * Do not re-apply older lexical findings on later analyze turns.
 */
export function collectPendingSearchReplaceFromChat(
  messages: Array<{
    id: string;
    role: string;
    text?: string;
    applyText?: string;
    widget?: unknown;
    waitingForInput?: boolean;
  }>,
  appliedKeys: ReadonlySet<string>,
): Array<{ messageId: string; task: R7Task }> {
  const pending: Array<{ messageId: string; task: R7Task }> = [];
  const seen = new Set<string>();

  let lastUser = "";
  let lastAssistant: (typeof messages)[number] | null = null;
  for (const message of messages) {
    if (message.role === "user") {
      lastUser = String(message.text || "").trim();
      lastAssistant = null;
      continue;
    }
    if (message.role === "assistant") {
      if (message.widget || message.waitingForInput) continue;
      if (String(message.id || "").startsWith("local-")) continue;
      lastAssistant = message;
    }
  }

  if (!lastAssistant || !isLexicalSearchReplaceIntent(lastUser)) return pending;

  const raw = String(lastAssistant.applyText || lastAssistant.text || "").trim();
  if (!raw || !/r7\.proposal/i.test(raw)) return pending;
  const proposal = parseR7Proposal(raw);
  if (proposal?.kind !== "findings" || !proposal.items?.length) return pending;

  for (const it of proposal.items.slice(0, 15)) {
    const task: R7Task = {
      type: "search_replace",
      data: {
        search: it.search,
        replace: it.replace,
        matchCase: it.matchCase === true,
      },
    };
    const key = taskApplyKey(lastAssistant.id, task);
    const contentKey = taskContentKey(task);
    if (appliedKeys.has(key) || appliedKeys.has(contentKey) || seen.has(key)) continue;
    seen.add(key);
    pending.push({ messageId: lastAssistant.id, task });
  }

  return pending;
}

/** Content-only key so intent-apply and later tool_calls dedupe the same payload. */
export function taskContentKey(task: R7Task): string {
  return `content:${task.type}:${JSON.stringify(task.data)}`;
}

export async function applyEditorTasks(
  editorType: EditorType,
  tasks: R7Task[],
  deps: EditorTaskApplyDeps = {},
): Promise<EditorTaskApplyResult> {
  if (!tasks.length) {
    return { applied: 0, failed: 0, summary: "", errors: [], successfulTasks: [] };
  }

  const errors: string[] = [];
  const successfulTasks: R7Task[] = [];

  const run = async (): Promise<void> => {
    // Word: search_replace via bounded executeMethod (no StartAction lock / callCommand freeze).
    if (editorType !== "cell") {
      const sarTasks: R7Task[] = [];
      const other: R7Task[] = [];
      for (const task of tasks) {
        if (task.type === "search_replace") sarTasks.push(task);
        else other.push(task);
      }
      if (sarTasks.length) {
        try {
          const batch = await applyDocumentSearchReplaceBatch(
            sarTasks.map((t) => ({
              search: String(t.data.search || ""),
              replace: String(t.data.replace || ""),
              matchCase: t.data.matchCase === true,
            })),
          );
          const ok = new Set(batch.appliedIndexes);
          for (let i = 0; i < sarTasks.length; i++) {
            if (ok.has(i)) successfulTasks.push(sarTasks[i]);
          }
          for (const e of batch.errors) errors.push(e);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          errors.push(`search_replace: ${msg}`);
        }
      }
      for (const task of other) {
        try {
          await applySingleEditorTask(editorType, task, deps);
          successfulTasks.push(task);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          errors.push(`${task.type}: ${msg}`);
        }
      }
      return;
    }

    for (const task of tasks) {
      try {
        await applySingleEditorTask(editorType, task, deps);
        successfulTasks.push(task);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push(`${task.type}: ${msg}`);
      }
    }
  };

  // StartAction freezes the whole editor; skip when only search_replace (common LCA path).
  const onlySar =
    editorType !== "cell" && tasks.length > 0 && tasks.every((t) => t.type === "search_replace");
  if (onlySar) await run();
  else await withAction(run);

  const applied = successfulTasks.length;
  const failed = tasks.length - applied;
  let summary = "";
  if (applied > 0) {
    summary =
      applied === 1
        ? "Изменение применено в документе"
        : `Применено изменений в документе: ${applied}`;
  } else if (failed > 0) {
    summary = "Не удалось применить изменения в документе";
  }

  return { applied, failed, summary, errors, successfulTasks };
}

async function applySingleEditorTask(
  editorType: EditorType,
  task: R7Task,
  deps: EditorTaskApplyDeps,
): Promise<void> {
  switch (task.type) {
    case "search_replace":
      if (editorType === "cell") {
        await applyCellSearchReplace(task.data.search, task.data.replace, task.data.matchCase);
        return;
      }
      await applyDocumentSearchReplace(
        task.data.search,
        task.data.replace,
        Boolean(task.data.matchCase),
      );
      return;
    case "add_comment":
      if (editorType !== "word") {
        throw new Error("add_comment только для Word");
      }
      await applyDocumentComment(
        task.data.text,
        typeof task.data.search === "string" ? task.data.search : undefined,
      );
      return;
    case "paste": {
      const payload = unwrapPastePayload(task.data);
      await insertText(payload.text, payload.position, "text/html");
      return;
    }
    case "paste_text": {
      const payload = unwrapPastePayload(task.data);
      // Align with replace_selection: markdown → HTML via PasteHtml (bold ** etc.).
      const mime = /<[a-z][\s\S]*>/i.test(payload.text.trim())
        ? "text/html"
        : "text/markdown";
      await insertText(payload.text, payload.position, mime);
      return;
    }
    case "cell_paste":
      if (editorType !== "cell") {
        throw new Error("cell_paste только для Cell");
      }
      await applyCellPaste(task.data);
      return;
    case "remove_selection":
      await applyRemoveSelection(editorType);
      return;
    case "replace_selection":
      await applyReplaceSelection(editorType, task.data);
      return;
    case "sheet_replace_from_xlsx": {
      if (editorType !== "cell") {
        throw new Error("sheet_replace_from_xlsx только для Cell");
      }
      if (!deps.loadXlsxMatrix) {
        throw new Error("sheet_replace_from_xlsx: нет загрузчика VFS");
      }
      const matrix = await deps.loadXlsxMatrix(task.data.path, task.data.sheet);
      const written = await applyMatrixReplaceAtTarget(matrix.aoa, {
        mode: task.data.mode || "used",
        range: task.data.range,
        clearTarget: task.data.clearTarget !== false,
      });
      if (!written) {
        throw new Error("Не удалось заменить данные на листе");
      }
      return;
    }
    case "cell_format": {
      if (editorType !== "cell") {
        throw new Error("cell_format только для Cell");
      }
      await applyCellFormatSpec({
        target: task.data.target || "used",
        range: task.data.range,
        cells: task.data.cells,
        format: task.data.format || {},
        rules: task.data.rules || null,
        applyScope: task.data.applyScope || "row",
        autoFitColumns: task.data.autoFitColumns === true,
      });
      return;
    }
    default:
      throw new Error(`Тип ${(task as R7Task).type} не поддерживается task-runner`);
  }
}

async function applyCellSearchReplace(
  search: string,
  replace: string,
  matchCase?: boolean,
): Promise<void> {
  setAscScope({ search, replace, matchCase });
  await runEditorCommand(() => {
    const scope = Asc.scope ?? {};
    const sheet = Api.GetActiveSheet();
    const values = sheet.GetUsedRange().GetValue() as unknown[][];
    let count = 0;
    const needle = String(scope.search ?? "");
    const repl = String(scope.replace ?? "");
    const caseSensitive = Boolean(scope.matchCase);
    for (let r = 0; r < values.length; r++) {
      for (let c = 0; c < values[r].length; c++) {
        const raw = values[r][c];
        if (raw == null || raw === "") continue;
        const text = String(raw);
        const hit = caseSensitive
          ? text.includes(needle)
          : text.toLowerCase().includes(needle.toLowerCase());
        if (!hit) continue;
        const next = caseSensitive
          ? text.split(needle).join(repl)
          : (() => {
              const lower = text.toLowerCase();
              const nLower = needle.toLowerCase();
              let out = "";
              let i = 0;
              while (i < text.length) {
                if (lower.slice(i, i + needle.length) === nLower) {
                  out += repl;
                  i += needle.length;
                } else {
                  out += text[i];
                  i += 1;
                }
              }
              return out;
            })();
        let colIndex = c + 1;
        let col = "";
        while (colIndex > 0) {
          const rem = (colIndex - 1) % 26;
          col = String.fromCharCode(65 + rem) + col;
          colIndex = Math.floor((colIndex - 1) / 26);
        }
        sheet.GetRange(`${col}${r + 1}`).SetValue(next);
        count += 1;
      }
    }
    return String(count);
  }, "0");
}

async function applyRemoveSelection(editorType: EditorType): Promise<void> {
  if (editorType === "cell") {
    await runEditorCommand(() => {
      const sheet = Api.GetActiveSheet();
      sheet.GetSelection().Clear();
      return "1";
    }, "1");
    return;
  }
  // Desktop: GetRangeBySelect().Delete is unstable; RemoveSelectedContent is the canon.
  await executeMethod("RemoveSelectedContent", []);
}

async function applyReplaceSelection(
  editorType: EditorType,
  data: string | Record<string, string | number>,
): Promise<void> {
  const text = extractReplaceSelectionText(data);
  if (!String(text).trim()) {
    throw new Error(
      "replace_selection: empty text — refusing RemoveSelectedContent (would delete selection with no paste)",
    );
  }
  if (editorType === "cell") {
    setAscScope({ replaceText: text });
    await runEditorCommand(() => {
      const scope = Asc.scope ?? {};
      Api.GetActiveSheet().GetSelection().SetValue(String(scope.replaceText ?? ""));
      return "1";
    }, "1");
    return;
  }
  // Canon: RemoveSelectedContent + PasteHtml (markdown → HTML keeps ** / headings).
  await executeMethod("RemoveSelectedContent", []);
  const mime = /<[a-z][\s\S]*>/i.test(String(text).trim())
    ? "text/html"
    : "text/markdown";
  const html = wrapHtmlWithWordFont(contentToPasteHtml(text, mime));
  await executeMethod("PasteHtml", [html]);
}

/** Unwrap tool payloads like `{ data: "…" }` / `{ text }` / `{ html }` (empty → refuse delete). */
function extractReplaceSelectionText(
  data: string | Record<string, string | number>,
): string {
  if (typeof data === "string") return data;
  if (!data || typeof data !== "object") return "";
  const d = data as Record<string, unknown>;
  const keys = ["text", "html", "data", "content", "replace", "value"];
  for (const key of keys) {
    const v = d[key];
    if (typeof v === "string" && v.length) return v;
    if (v && typeof v === "object" && !Array.isArray(v)) {
      const nested = v as Record<string, unknown>;
      for (const nk of keys) {
        if (typeof nested[nk] === "string" && (nested[nk] as string).length) {
          return nested[nk] as string;
        }
      }
    }
  }
  return "";
}

/** Unwrap paste payload: plain string or { text, position }. */
function unwrapPastePayload(
  data: string | { text: string; position?: "start" | "end" | "cursor" },
): { text: string; position: "start" | "end" | "cursor" } {
  if (typeof data === "string") return { text: data, position: "cursor" };
  if (data && typeof data === "object" && typeof data.text === "string") {
    const position =
      data.position === "start" || data.position === "end" || data.position === "cursor"
        ? data.position
        : "cursor";
    return { text: data.text, position };
  }
  return { text: "", position: "cursor" };
}

function runEditorCommand(fn: () => unknown, fallback = "0"): Promise<string> {
  return new Promise((resolve, reject) => {
    try {
      window.Asc.plugin.callCommand(
        fn,
        false,
        false,
        (result: string) => resolve(String(result ?? fallback)),
        (err: unknown) => reject(err instanceof Error ? err : new Error(String(err))),
      );
    } catch (err) {
      reject(err instanceof Error ? err : new Error(String(err)));
    }
  });
}
