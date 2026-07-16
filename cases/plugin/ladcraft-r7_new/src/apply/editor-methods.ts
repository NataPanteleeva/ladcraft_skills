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

type AscScope = typeof window.Asc & { scope?: Record<string, unknown> };

function setAscScope(values: Record<string, unknown>): void {
  const asc = window.Asc as AscScope;
  asc.scope = { ...(asc.scope ?? {}), ...values };
}

export { setAscScope };

/** Global search/replace in the open Word document. */
export async function applyDocumentSearchReplace(
  search: string,
  replace: string,
  matchCase: boolean,
): Promise<void> {
  setAscScope({ search, replace, matchCase });
  await new Promise<void>((resolve, reject) => {
    try {
      window.Asc.plugin.callCommand(
        () => {
          const scope = (Asc as AscScope).scope ?? {};
          const count = Api.GetDocument().SearchAndReplace({
            searchString: String(scope.search ?? ""),
            replaceString: String(scope.replace ?? ""),
            matchCase: Boolean(scope.matchCase),
          });
          return String(count ?? 0);
        },
        false,
        false,
        () => resolve(),
        (err) => reject(err instanceof Error ? err : new Error(String(err))),
      );
    } catch (err) {
      reject(err instanceof Error ? err : new Error(String(err)));
    }
  });
}

/** Add a review comment at the start of the Word document. */
export async function applyDocumentComment(text: string): Promise<void> {
  setAscScope({ commentText: text });
  await new Promise<void>((resolve, reject) => {
    try {
      window.Asc.plugin.callCommand(
        () => {
          const scope = (Asc as AscScope).scope ?? {};
          const comment = String(scope.commentText ?? "").trim();
          if (!comment) return "0";
          const doc = Api.GetDocument();
          const content = doc.GetContent();
          if (!content.length) return "0";
          const first = content[0];
          if (first && typeof first.GetRange === "function") {
            const range = first.GetRange();
            if (range && typeof range.AddComment === "function") {
              range.AddComment(comment, "Ladcraft", "0");
              return "1";
            }
          }
          if (typeof doc.AddComment === "function") {
            doc.AddComment(comment, "Ladcraft", "0");
            return "1";
          }
          return "0";
        },
        false,
        false,
        () => resolve(),
        (err) => reject(err instanceof Error ? err : new Error(String(err))),
      );
    } catch (err) {
      reject(err instanceof Error ? err : new Error(String(err)));
    }
  });
}

/** Fill spreadsheet cells from A1-style map. */
export async function applyCellPaste(cells: Record<string, string | number>): Promise<void> {
  setAscScope({ cells });
  await new Promise<void>((resolve, reject) => {
    try {
      window.Asc.plugin.callCommand(
        () => {
          const scope = (Asc as AscScope).scope ?? {};
          const map = (scope.cells ?? {}) as Record<string, string | number>;
          const sheet = Api.GetActiveSheet();
          for (const [addr, value] of Object.entries(map)) {
            sheet.GetRange(addr).SetValue(value);
          }
          return String(Object.keys(map).length);
        },
        false,
        false,
        () => resolve(),
        (err) => reject(err instanceof Error ? err : new Error(String(err))),
      );
    } catch (err) {
      reject(err instanceof Error ? err : new Error(String(err)));
    }
  });
}
