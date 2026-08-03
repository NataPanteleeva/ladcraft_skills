import type { EditorType } from "../config";

export interface WordSnapshot {
  type: "word";
  content: string[];
}

export interface CellBlock {
  start: number;
  stop: number;
  lines: unknown[][];
}

export interface CellSnapshot {
  type: "cell";
  blocks: CellBlock[];
  isTooLarge: boolean;
}

export type DocumentSnapshot = WordSnapshot | CellSnapshot;

const CELL_LIMIT = 1000;

/** Serialize Asc callCommand queue — parallel callCommand returns undefined to callback. */
let ascReadChain: Promise<unknown> = Promise.resolve();

function enqueueAscRead<T>(fn: () => Promise<T>): Promise<T> {
  const run = ascReadChain.then(fn, fn);
  ascReadChain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

/** Read current document snapshot from R7 editor. */
export function readDocumentSnapshot(editorType: EditorType): Promise<DocumentSnapshot> {
  return enqueueAscRead(() =>
    editorType === "cell" ? readCellSnapshot() : readWordSnapshot(),
  );
}

function parseCommandResult<T>(result: unknown, label: string): T {
  if (result == null || result === "") {
    throw new Error(`${label}: пустой ответ редактора`);
  }
  if (typeof result !== "string") {
    throw new Error(`${label}: неожиданный тип ответа (${typeof result})`);
  }
  if (result === "undefined" || result === "null") {
    throw new Error(`${label}: пустой ответ редактора`);
  }
  return JSON.parse(result) as T;
}

/**
 * Desktop-safe Word read: GetContent() is often NOT a JS Array (no .map).
 * Using .map throws inside callCommand → callback gets undefined → JSON.parse crash.
 */
function readWordSnapshot(): Promise<WordSnapshot> {
  return new Promise((resolve, reject) => {
    try {
      window.Asc.plugin.callCommand(
        () => {
          const doc = Api.GetDocument();
          const parts = [];

          if (typeof doc.GetElementsCount === "function" && typeof doc.GetElement === "function") {
            const n = doc.GetElementsCount();
            for (let i = 0; i < n; i++) {
              const el = doc.GetElement(i);
              if (el && typeof el.GetText === "function") {
                parts.push(String(el.GetText() || ""));
              } else {
                parts.push("");
              }
            }
          } else {
            const content = doc.GetContent();
            if (content && typeof content.GetText === "function") {
              const full = String(content.GetText() || "");
              const split = full.split(/\n+/);
              for (let i = 0; i < split.length; i++) parts.push(split[i]);
            } else if (typeof doc.ToMarkdown === "function") {
              parts.push(String(doc.ToMarkdown() || ""));
            } else if (content && typeof content.map === "function") {
              const mapped = content.map(function (el) {
                if (el && typeof el.GetText === "function") return String(el.GetText() || "");
                return "";
              });
              for (let i = 0; i < mapped.length; i++) parts.push(mapped[i]);
            }
          }

          return JSON.stringify({ content: parts });
        },
        false,
        false,
        (result: string) => {
          try {
            const parsed = parseCommandResult<{ content: string[] }>(result, "Чтение Word");
            resolve({
              type: "word",
              content: Array.isArray(parsed.content) ? parsed.content : [],
            });
          } catch (err) {
            reject(err);
          }
        },
      );
    } catch (err) {
      reject(err instanceof Error ? err : new Error(String(err)));
    }
  });
}

function readCellSnapshot(): Promise<CellSnapshot> {
  return new Promise((resolve, reject) => {
    try {
      window.Asc.plugin.callCommand(
        () => {
          const values = Api.GetActiveSheet().GetUsedRange().GetValue();
          const matrix = values || [];
          let count = 0;
          let isTooLarge = false;
          for (let r = 0; r < matrix.length; r++) {
            const row = matrix[r] || [];
            for (let c = 0; c < row.length; c++) {
              if (row[c] !== "") count++;
              if (count >= 1000) {
                isTooLarge = true;
                break;
              }
            }
            if (isTooLarge) break;
          }
          const blocks = [];
          let block = null;
          let rowNum = 0;
          for (let r = 0; r < matrix.length; r++) {
            const row = matrix[r] || [];
            rowNum += 1;
            let empty = true;
            for (let c = 0; c < row.length; c++) {
              if (row[c] !== "") {
                empty = false;
                break;
              }
            }
            if (empty) {
              if (block) {
                block.stop = rowNum;
                blocks.push(block);
                block = null;
              }
              continue;
            }
            if (block) {
              block.lines.push(row);
            } else {
              block = { start: rowNum, stop: 0, lines: [row] };
            }
          }
          if (block) {
            block.stop = rowNum;
            blocks.push(block);
          }
          return JSON.stringify({ blocks: blocks, isTooLarge: isTooLarge });
        },
        false,
        false,
        (result: string) => {
          try {
            const parsed = parseCommandResult<{
              blocks: CellBlock[];
              isTooLarge: boolean;
            }>(result, "Чтение Cell");
            resolve({
              type: "cell",
              blocks: Array.isArray(parsed.blocks) ? parsed.blocks : [],
              isTooLarge: Boolean(parsed.isTooLarge),
            });
          } catch (err) {
            reject(err);
          }
        },
      );
    } catch (err) {
      reject(err instanceof Error ? err : new Error(String(err)));
    }
  });
}

/** Read selected text in Word. */
export function getSelectedText(): Promise<string> {
  return new Promise((resolve) => {
    try {
      window.Asc.plugin.executeMethod("GetSelectedText", [], (result: unknown) => {
        resolve(typeof result === "string" ? result : "");
      });
    } catch {
      resolve("");
    }
  });
}

declare global {
  interface AscContentElement {
    GetText?: () => string;
    Table?: boolean;
    GetElement?: (i: number) => AscContentElement;
  }
}
