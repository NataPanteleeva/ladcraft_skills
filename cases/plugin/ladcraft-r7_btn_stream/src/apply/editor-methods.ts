import { contentToPasteHtml } from "../markdown/html";
import type { InsertPosition } from "./types";

/** Wrapper for Asc.plugin.executeMethod returning a Promise. */
export function executeMethod(method: string, args: unknown[] = []): Promise<unknown> {
  return new Promise((resolve, reject) => {
    try {
      window.Asc.plugin.executeMethod(method, args, (result: unknown) => resolve(result));
    } catch (err) {
      reject(err);
    }
  });
}

/** Block editor UI during long operations. */
export async function withAction<T>(fn: () => Promise<T>): Promise<T> {
  await executeMethod("StartAction", ["Ladcraft", "Обработка..."]);
  try {
    return await fn();
  } finally {
    await executeMethod("EndAction", []);
  }
}

/** Move caret to document end (Word). */
export async function moveCursorToEnd(): Promise<void> {
  await executeMethod("MoveCursorToEnd", []);
}

/** Move caret to document start (Word). */
export async function moveCursorToStart(): Promise<void> {
  return new Promise((resolve, reject) => {
    try {
      window.Asc.plugin.callCommand(
        () => {
          const doc = Api.GetDocument();
          if (typeof doc.MoveCursorToStart === "function") {
            doc.MoveCursorToStart(false);
            return;
          }
          const content = doc.GetContent();
          if (content.GetLength() > 0) {
            const first = content.GetElement(0);
            if (first && typeof first.Select === "function") {
              first.Select();
            }
          }
        },
        false,
        false,
        () => resolve(),
      );
    } catch (err) {
      reject(err);
    }
  });
}

/** Insert HTML at cursor, document end, or document start. */
export async function insertHtml(html: string, position: InsertPosition = "cursor"): Promise<void> {
  if (position === "end") {
    await moveCursorToEnd();
  } else if (position === "start") {
    await moveCursorToStart();
  }
  await executeMethod("PasteHtml", [html]);
}

/** Convert text/markdown to HTML and insert at the given position. */
export async function insertText(
  content: string,
  position: InsertPosition,
  mimeType?: string,
): Promise<void> {
  const html = contentToPasteHtml(content, mimeType);
  await insertHtml(html, position);
}
