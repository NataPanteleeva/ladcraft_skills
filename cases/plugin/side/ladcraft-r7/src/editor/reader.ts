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

/** Read current document snapshot from R7 editor. */
export function readDocumentSnapshot(editorType: EditorType): Promise<DocumentSnapshot> {
  if (editorType === "cell") {
    return readCellSnapshot();
  }
  return readWordSnapshot();
}

function readWordSnapshot(): Promise<WordSnapshot> {
  return new Promise((resolve, reject) => {
    window.Asc.plugin.callCommand(
      () => {
        const doc = Api.GetDocument();
        const parts = doc.GetContent().map((el: AscContentElement) => {
          if (typeof el.GetText === "function") return el.GetText();
          if (el.Table) return Api.GetDocument().ToMarkdown();
          return "";
        });
        return JSON.stringify({ content: parts });
      },
      false,
      false,
      (result: string) => {
        try {
          const parsed = JSON.parse(result) as { content: string[] };
          resolve({ type: "word", content: parsed.content });
        } catch (err) {
          reject(err);
        }
      },
    );
  });
}

function readCellSnapshot(): Promise<CellSnapshot> {
  return new Promise((resolve, reject) => {
    window.Asc.plugin.callCommand(
      () => {
        const values = Api.GetActiveSheet().GetUsedRange().GetValue() as unknown[][];
        let count = 0;
        let isTooLarge = false;
        for (let r = 0; r < values.length; r++) {
          for (let c = 0; c < values[r].length; c++) {
            if (values[r][c] !== "") count++;
            if (count >= CELL_LIMIT) {
              isTooLarge = true;
              break;
            }
          }
          if (isTooLarge) break;
        }
        const blocks = aggregateBlocks(values);
        return JSON.stringify({ blocks, isTooLarge });
      },
      false,
      false,
      (result: string) => {
        try {
          const parsed = JSON.parse(result) as {
            blocks: CellBlock[];
            isTooLarge: boolean;
          };
          resolve({ type: "cell", blocks: parsed.blocks, isTooLarge: parsed.isTooLarge });
        } catch (err) {
          reject(err);
        }
      },
    );
  });
}

function aggregateBlocks(matrix: unknown[][]): CellBlock[] {
  const isEmptyRow = (row: unknown[]) => row.every((v) => v === "");
  const blocks: CellBlock[] = [];
  let block: CellBlock | undefined;
  let rowNum = 0;

  for (const row of matrix) {
    rowNum += 1;
    if (isEmptyRow(row)) {
      if (block) {
        block.stop = rowNum;
        blocks.push(block);
        block = undefined;
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
  return blocks;
}

/** Read selected text in Word. */
export function getSelectedText(): Promise<string> {
  return new Promise((resolve) => {
    window.Asc.plugin.executeMethod("GetSelectedText", [], (result: unknown) => {
      resolve(typeof result === "string" ? result : "");
    });
  });
}

declare global {
  interface AscContentElement {
    GetText?: () => string;
    Table?: boolean;
  }
}
