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

function sleepMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** executeMethod that cannot hang the UI forever (Asc sometimes never callbacks). */
async function executeMethodBounded(
  method: string,
  args: unknown[] = [],
  timeoutMs = 2_000,
): Promise<unknown> {
  try {
    return await Promise.race([
      executeMethod(method, args),
      sleepMs(timeoutMs).then(() => {
        throw new Error(`${method}: timeout ${timeoutMs}ms`);
      }),
    ]);
  } catch (err) {
    console.warn("[ladcraft-r7_new]", method, err);
    return undefined;
  }
}

/** Block editor UI during long operations. */
export async function withAction<T>(fn: () => Promise<T>): Promise<T> {
  await executeMethodBounded("StartAction", ["Ladcraft", "Обработка..."], 2_000);
  try {
    return await fn();
  } finally {
    await executeMethodBounded("EndAction", [], 2_000);
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

export type MatrixAoa = Array<Array<string | number | boolean | null>>;

/** Dense rectangle of strings/numbers for one Range.SetValue call. */
function normalizeAoaForBulk(aoa: MatrixAoa): (string | number)[][] {
  let cols = 0;
  for (const row of aoa) {
    if (row && row.length > cols) cols = row.length;
  }
  if (!cols) cols = 1;
  const out: (string | number)[][] = [];
  for (let r = 0; r < aoa.length; r++) {
    const src = aoa[r] || [];
    const row: (string | number)[] = [];
    for (let c = 0; c < cols; c++) {
      const value = src[c];
      if (value === null || value === undefined) row.push("");
      else if (typeof value === "boolean") row.push(value ? "TRUE" : "FALSE");
      else row.push(value);
    }
    out.push(row);
  }
  return out.length ? out : [[""]];
}

/** Second callCommand after write: freeze-unfreeze + Select far/home (inline — no outer closures).
 * Canon (2026-07-21): docs/TABLE-AGENTS-PLUGIN.md § Viewport; knowledge-base/r7-api-handoff/03-tables-cell.md.
 * Must not block UI unlock — Asc often never fires the callback after a successful write.
 */
async function nudgeCellViewportAfterWrite(
  homeAddr: string,
  sheetName?: string,
): Promise<void> {
  setAscScope({
    homeAddr: homeAddr || "A1",
    sheetName: sheetName || "",
  });
  const nudge = new Promise<void>((resolve, reject) => {
    try {
      window.Asc.plugin.callCommand(
        () => {
          const scope = (Asc as AscScope).scope ?? {};
          const home = String(scope.homeAddr || "A1");
          const wantSheet = String(scope.sheetName || "").trim();
          const far = "A100";

          if (wantSheet && typeof Api.GetSheet === "function") {
            try {
              const named = Api.GetSheet(wantSheet);
              if (named && typeof named.Activate === "function") named.Activate();
            } catch (_e) {
              /* ignore */
            }
          }

          const sheet = Api.GetActiveSheet();

          function trySelect(addr: string): void {
            try {
              const range = sheet.GetRange(addr);
              if (range && typeof range.Select === "function") {
                range.Select();
                return;
              }
              if (range && typeof range.Activate === "function") {
                range.Activate();
                return;
              }
            } catch (_e) {
              /* ignore */
            }
            try {
              if (typeof sheet.GetCells !== "function") return;
              const m = addr.replace(/\$/g, "").match(/^([A-Za-z]+)(\d+)$/);
              if (!m) return;
              let col1 = 0;
              const letters = m[1].toUpperCase();
              for (let i = 0; i < letters.length; i++) {
                col1 = col1 * 26 + (letters.charCodeAt(i) - 64);
              }
              const row1 = parseInt(m[2], 10) || 1;
              const cell = sheet.GetCells(Math.max(0, row1 - 1), Math.max(0, col1 - 1));
              if (cell && typeof (cell as { Select?: () => void }).Select === "function") {
                (cell as { Select: () => void }).Select();
              } else if (cell && typeof (cell as { Activate?: () => void }).Activate === "function") {
                (cell as { Activate: () => void }).Activate();
              }
            } catch (_e2) {
              /* ignore */
            }
          }

          try {
            const homeRange = sheet.GetRange(home);
            if (homeRange && typeof homeRange.AutoFit === "function") {
              homeRange.AutoFit(true, true);
            }
          } catch (_e) {
            /* ignore */
          }

          try {
            const fp = (
              sheet as AscSheet & { GetFreezePanes?: () => { Unfreeze?: () => void } }
            ).GetFreezePanes?.();
            if (fp && typeof fp.Unfreeze === "function") fp.Unfreeze();
          } catch (_e) {
            /* ignore */
          }

          trySelect(far);
          trySelect(home);

          try {
            const api = Api as { RecalculateAllFormulas?: () => void };
            if (typeof api.RecalculateAllFormulas === "function") api.RecalculateAllFormulas();
          } catch (_e) {
            /* ignore */
          }

          return "1";
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
  await Promise.race([nudge, sleepMs(2_500)]);
}

/** Fire-and-forget viewport nudge so sheet-write UI unlocks immediately. */
function scheduleViewportNudge(homeAddr: string, sheetName?: string): void {
  void nudgeCellViewportAfterWrite(homeAddr, sheetName).catch((err) => {
    console.warn("[ladcraft-r7_new] viewport nudge failed", err);
  });
}

/** Write matrix starting at the active cell + viewport nudge (Cell only). */
export async function applyMatrixAtActiveCell(aoa: MatrixAoa): Promise<number> {
  const bulk = normalizeAoaForBulk(aoa);
  setAscScope({ aoa: bulk });
  const written = await new Promise<number>((resolve, reject) => {
    try {
      window.Asc.plugin.callCommand(
        () => {
          const scope = (Asc as AscScope).scope ?? {};
          const matrix = (scope.aoa ?? [[""]]) as (string | number)[][];
          const sheet = Api.GetActiveSheet();
          /** R7 Cell: GetRow/GetCol are 1-based (A1 → 1,1). */
          let startRow1 = 1;
          let startCol1 = 1;
          try {
            const active =
              (sheet.GetActiveCell && sheet.GetActiveCell()) ||
              (Api.GetActiveCell && Api.GetActiveCell()) ||
              null;
            if (active) {
              let fromAddr = false;
              if (typeof active.GetAddress === "function") {
                try {
                  const raw = String(active.GetAddress(true, true) || "");
                  const m = raw.replace(/\$/g, "").match(/([A-Za-z]+)(\d+)/);
                  if (m) {
                    let col = 0;
                    const letters = m[1].toUpperCase();
                    for (let i = 0; i < letters.length; i++) {
                      col = col * 26 + (letters.charCodeAt(i) - 64);
                    }
                    startCol1 = Math.max(1, col);
                    startRow1 = Math.max(1, parseInt(m[2], 10) || 1);
                    fromAddr = true;
                  }
                } catch (_addrErr) {
                  fromAddr = false;
                }
              }
              if (!fromAddr) {
                const r = Number(active.GetRow());
                const c = Number(active.GetCol());
                if (Number.isFinite(r) && r >= 1) startRow1 = r;
                if (Number.isFinite(c) && c >= 1) startCol1 = c;
              }
            }
          } catch (_e) {
            /* A1 */
          }
          const rows = matrix.length;
          const cols = matrix[0]?.length || 1;
          function colRow1ToA1(row1: number, col1: number): string {
            let n = Math.max(1, col1);
            let s = "";
            while (n > 0) {
              const m = (n - 1) % 26;
              s = String.fromCharCode(65 + m) + s;
              n = Math.floor((n - 1) / 26);
            }
            return `${s}${Math.max(1, row1)}`;
          }
          const start = colRow1ToA1(startRow1, startCol1);
          const end = colRow1ToA1(startRow1 + rows - 1, startCol1 + cols - 1);
          const rangeAddr = start === end ? start : `${start}:${end}`;
          let count = rows * cols;
          try {
            sheet.GetRange(rangeAddr).SetValue(matrix as unknown as string | number);
          } catch (_e) {
            count = 0;
            for (let r = 0; r < rows; r++) {
              const rStart = colRow1ToA1(startRow1 + r, startCol1);
              const rEnd = colRow1ToA1(startRow1 + r, startCol1 + cols - 1);
              const addr = rStart === rEnd ? rStart : `${rStart}:${rEnd}`;
              try {
                sheet.GetRange(addr).SetValue(matrix[r] as unknown as string | number);
                count += cols;
              } catch (_rowErr) {
                for (let c = 0; c < cols; c++) {
                  sheet
                    .GetRange(colRow1ToA1(startRow1 + r, startCol1 + c))
                    .SetValue(matrix[r][c] ?? "");
                  count += 1;
                }
              }
            }
          }
          return JSON.stringify({ written: count, home: start });
        },
        false,
        false,
        (result: string) => {
          try {
            const parsed = JSON.parse(String(result || "{}")) as {
              written?: number;
              home?: string;
            };
            (Asc as AscScope).scope = {
              ...((Asc as AscScope).scope ?? {}),
              homeAddr: parsed.home || "A1",
            };
            resolve(Number(parsed.written) || 0);
          } catch {
            resolve(Number(result) || 0);
          }
        },
        (err) => reject(err instanceof Error ? err : new Error(String(err))),
      );
    } catch (err) {
      reject(err instanceof Error ? err : new Error(String(err)));
    }
  });

  const home =
    String(((window.Asc as AscScope).scope ?? {}).homeAddr || "A1") || "A1";
  scheduleViewportNudge(home);
  return written;
}

/**
 * AddSheet (stays on new tab) → write from A1 → separate viewport nudge.
 * No return to the previous sheet tab.
 */
export async function applyMatrixOnNewSheet(
  aoa: MatrixAoa,
  preferredName: string,
): Promise<{ sheetName: string; written: number }> {
  const bulk = normalizeAoaForBulk(aoa);
  setAscScope({ aoa: bulk, preferredName });
  const out = await new Promise<{ sheetName: string; written: number }>((resolve, reject) => {
    try {
      window.Asc.plugin.callCommand(
        () => {
          const scope = (Asc as AscScope).scope ?? {};
          const matrix = (scope.aoa ?? [[""]]) as (string | number)[][];

          function listSheetNames(): string[] {
            const names: string[] = [];
            try {
              const all = Api.GetAllSheets && Api.GetAllSheets();
              if (all && all.length) {
                for (let i = 0; i < all.length; i++) {
                  const s = all[i];
                  const n =
                    s && typeof s.GetName === "function" ? String(s.GetName() || "") : "";
                  if (n) names.push(n);
                }
              }
            } catch (_e) {
              /* ignore */
            }
            return names;
          }

          function uniqueName(baseIn: string): string {
            let base = String(baseIn || "итог")
              .replace(/[\\/*?:\[\]]/g, "_")
              .slice(0, 31);
            if (!base) base = "итог";
            let name = base;
            let n = 2;
            while (Api.GetSheet && Api.GetSheet(name)) {
              const suffix = `_${n}`;
              name = (base.slice(0, Math.max(1, 31 - suffix.length)) + suffix).slice(0, 31);
              n += 1;
              if (n > 99) break;
            }
            return name;
          }

          const before = listSheetNames();
          const name = uniqueName(String(scope.preferredName || "итог"));

          let created = false;
          if (typeof Api.AddSheet === "function") {
            try {
              Api.AddSheet(name);
              created = true;
            } catch (_e1) {
              try {
                Api.AddSheet();
                created = true;
              } catch (_e2) {
                created = false;
              }
            }
          }

          let sheet =
            (Api.GetSheet && Api.GetSheet(name)) || null;
          if (!sheet) {
            const after = listSheetNames();
            let fresh = "";
            for (let i = 0; i < after.length; i++) {
              if (before.indexOf(after[i]) < 0) fresh = after[i];
            }
            if (fresh && Api.GetSheet) sheet = Api.GetSheet(fresh);
          }
          if (!sheet) sheet = Api.GetActiveSheet();

          const finalName =
            sheet && typeof sheet.GetName === "function"
              ? String(sheet.GetName() || name)
              : name;
          if (finalName !== name && sheet && typeof sheet.SetName === "function") {
            try {
              sheet.SetName(name);
            } catch (_e) {
              /* keep finalName */
            }
          } else if (sheet && typeof sheet.SetName === "function") {
            try {
              if (!(Api.GetSheet && Api.GetSheet(name))) sheet.SetName(name);
            } catch (_e) {
              /* ignore */
            }
          }

          const sheetName =
            (sheet && typeof sheet.GetName === "function" && String(sheet.GetName() || "")) ||
            name;

          if (sheet && typeof sheet.Activate === "function") {
            try {
              sheet.Activate();
            } catch (_e) {
              /* ignore */
            }
          }

          const rows = matrix.length;
          const cols = matrix[0]?.length || 1;
          function colRow0ToA1(row0: number, col0: number): string {
            let nn = col0 + 1;
            let s = "";
            while (nn > 0) {
              const m = (nn - 1) % 26;
              s = String.fromCharCode(65 + m) + s;
              nn = Math.floor((nn - 1) / 26);
            }
            return `${s}${row0 + 1}`;
          }

          // Large tables: write in row chunks (bulk SetValue of 12k+ cells is flaky).
          const CHUNK = 200;
          let written = 0;
          for (let r0 = 0; r0 < rows; r0 += CHUNK) {
            const r1 = Math.min(rows, r0 + CHUNK);
            const slice = matrix.slice(r0, r1);
            const start = colRow0ToA1(r0, 0);
            const end = colRow0ToA1(r1 - 1, cols - 1);
            const rangeAddr = start === end ? start : `${start}:${end}`;
            try {
              sheet.GetRange(rangeAddr).SetValue(slice as unknown as string | number);
              written += (r1 - r0) * cols;
            } catch (_chunkErr) {
              for (let r = r0; r < r1; r++) {
                const rStart = colRow0ToA1(r, 0);
                const rEnd = colRow0ToA1(r, cols - 1);
                const addr = rStart === rEnd ? rStart : `${rStart}:${rEnd}`;
                try {
                  sheet.GetRange(addr).SetValue(matrix[r] as unknown as string | number);
                  written += cols;
                } catch (_rowErr) {
                  for (let c = 0; c < cols; c++) {
                    sheet.GetRange(colRow0ToA1(r, c)).SetValue(matrix[r][c] ?? "");
                    written += 1;
                  }
                }
              }
            }
          }

          return JSON.stringify({
            sheetName,
            written,
            created: created || before.indexOf(sheetName) < 0,
          });
        },
        false,
        false,
        (result: string) => {
          try {
            const parsed = JSON.parse(String(result || "{}")) as {
              sheetName?: string;
              written?: number;
              created?: boolean;
            };
            resolve({
              sheetName: parsed.sheetName || preferredName,
              written: Number(parsed.written) || 0,
            });
          } catch {
            resolve({ sheetName: preferredName, written: 0 });
          }
        },
        (err) => reject(err instanceof Error ? err : new Error(String(err))),
      );
    } catch (err) {
      reject(err instanceof Error ? err : new Error(String(err)));
    }
  });

  scheduleViewportNudge("A1", out.sheetName);
  return out;
}

/**
 * Replace the active sheet used-range with a matrix from A1 (clear old, write new).
 * Visibility: write callCommand then nudgeCellViewportAfterWrite (canon).
 */
export async function applyMatrixReplaceActiveSheet(aoa: MatrixAoa): Promise<number> {
  const bulk = normalizeAoaForBulk(aoa);
  setAscScope({ aoa: bulk });
  const written = await new Promise<number>((resolve, reject) => {
    try {
      window.Asc.plugin.callCommand(
        () => {
          const scope = (Asc as AscScope).scope ?? {};
          const matrix = (scope.aoa ?? [[""]]) as (string | number)[][];
          const sheet = Api.GetActiveSheet();
          const rows = matrix.length;
          const cols = matrix[0]?.length || 1;

          function colRow1ToA1(row1: number, col1: number): string {
            let n = Math.max(1, col1);
            let s = "";
            while (n > 0) {
              const m = (n - 1) % 26;
              s = String.fromCharCode(65 + m) + s;
              n = Math.floor((n - 1) / 26);
            }
            return `${s}${Math.max(1, row1)}`;
          }

          try {
            const used = sheet.GetUsedRange && sheet.GetUsedRange();
            if (used) {
              if (typeof (used as { Clear?: () => void }).Clear === "function") {
                (used as { Clear: () => void }).Clear();
              } else if (typeof (used as { ClearContents?: () => void }).ClearContents === "function") {
                (used as { ClearContents: () => void }).ClearContents();
              } else {
                try {
                  used.SetValue([[""]] as unknown as string | number);
                } catch (_e) {
                  /* ignore */
                }
              }
            }
          } catch (_clearErr) {
            /* proceed to overwrite */
          }

          const end = colRow1ToA1(rows, cols);
          const rangeAddr = rows === 1 && cols === 1 ? "A1" : `A1:${end}`;
          let count = rows * cols;
          try {
            sheet.GetRange(rangeAddr).SetValue(matrix as unknown as string | number);
          } catch (_e) {
            count = 0;
            for (let r = 0; r < rows; r++) {
              for (let c = 0; c < cols; c++) {
                sheet.GetRange(colRow1ToA1(r + 1, c + 1)).SetValue(matrix[r][c] ?? "");
                count += 1;
              }
            }
          }
          return JSON.stringify({ written: count, home: "A1" });
        },
        false,
        false,
        (result: string) => {
          try {
            const parsed = JSON.parse(String(result || "{}")) as { written?: number };
            resolve(Number(parsed.written) || 0);
          } catch {
            resolve(Number(result) || 0);
          }
        },
        (err) => reject(err instanceof Error ? err : new Error(String(err))),
      );
    } catch (err) {
      reject(err instanceof Error ? err : new Error(String(err)));
    }
  });

  scheduleViewportNudge("A1");
  return written;
}

/**
 * Replace used range / selection / named range with matrix.
 * mode used → clear used + write from A1; selection/range → write at anchor (+ optional clear).
 */
export async function applyMatrixReplaceAtTarget(
  aoa: MatrixAoa,
  options: {
    mode?: string;
    range?: string | null;
    clearTarget?: boolean;
  } = {},
): Promise<number> {
  const mode = String(options.mode || "used").toLowerCase();
  if (mode === "used" || !mode) {
    return applyMatrixReplaceActiveSheet(aoa);
  }

  const bulk = normalizeAoaForBulk(aoa);
  const rangeAddr = typeof options.range === "string" ? options.range.trim() : "";
  if (mode === "range" && !rangeAddr) {
    throw new Error("mode=range требует адрес range");
  }
  setAscScope({
    aoa: bulk,
    replaceMode: mode,
    replaceRange: rangeAddr,
    clearTarget: options.clearTarget !== false,
  });

  const written = await new Promise<number>((resolve, reject) => {
    try {
      window.Asc.plugin.callCommand(
        () => {
          const scope = (Asc as AscScope).scope ?? {};
          const matrix = (scope.aoa ?? [[""]]) as (string | number)[][];
          const replaceMode = String(scope.replaceMode || "selection");
          const explicitRange = String(scope.replaceRange || "").trim();
          const doClear = scope.clearTarget !== false;
          const sheet = Api.GetActiveSheet();
          const rows = matrix.length;
          const cols = matrix[0]?.length || 1;

          function colRow1ToA1(row1: number, col1: number): string {
            let n = Math.max(1, col1);
            let s = "";
            while (n > 0) {
              const m = (n - 1) % 26;
              s = String.fromCharCode(65 + m) + s;
              n = Math.floor((n - 1) / 26);
            }
            return `${s}${Math.max(1, row1)}`;
          }

          function parseA1(addr: string): { row1: number; col1: number } | null {
            const m = String(addr || "")
              .replace(/\$/g, "")
              .match(/([A-Za-z]+)(\d+)/);
            if (!m) return null;
            let col = 0;
            const letters = m[1].toUpperCase();
            for (let i = 0; i < letters.length; i++) {
              col = col * 26 + (letters.charCodeAt(i) - 64);
            }
            return { row1: Math.max(1, parseInt(m[2], 10) || 1), col1: Math.max(1, col) };
          }

          let startRow1 = 1;
          let startCol1 = 1;
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          let clearRange: any = null;

          if (replaceMode === "range" && explicitRange) {
            try {
              clearRange = sheet.GetRange(explicitRange);
            } catch (_e) {
              clearRange = null;
            }
            const startPart = explicitRange.split(":")[0] || explicitRange;
            const parsed = parseA1(startPart);
            if (parsed) {
              startRow1 = parsed.row1;
              startCol1 = parsed.col1;
            }
          } else {
            try {
              const apiAny = Api as unknown as {
                GetSelection?: () => unknown;
              };
              const sheetAny = sheet as unknown as {
                GetSelection?: () => unknown;
              };
              const sel =
                (apiAny.GetSelection && apiAny.GetSelection()) ||
                (sheetAny.GetSelection && sheetAny.GetSelection()) ||
                null;
              if (sel) {
                clearRange = sel;
                const selAny = sel as {
                  GetAddress?: (a?: boolean, b?: boolean) => string;
                };
                if (typeof selAny.GetAddress === "function") {
                  try {
                    const raw = String(selAny.GetAddress(true, true) || "");
                    const startPart = raw.split(":")[0] || raw;
                    const parsed = parseA1(startPart);
                    if (parsed) {
                      startRow1 = parsed.row1;
                      startCol1 = parsed.col1;
                    }
                  } catch (_addr) {
                    /* keep A1 */
                  }
                }
              }
            } catch (_selErr) {
              /* A1 */
            }
          }

          if (doClear && clearRange) {
            try {
              if (typeof clearRange.Clear === "function") clearRange.Clear();
              else if (typeof clearRange.ClearContents === "function") clearRange.ClearContents();
              else if (typeof clearRange.SetValue === "function") {
                clearRange.SetValue([[""]]);
              }
            } catch (_clearErr) {
              /* overwrite */
            }
          }

          const start = colRow1ToA1(startRow1, startCol1);
          const end = colRow1ToA1(startRow1 + rows - 1, startCol1 + cols - 1);
          const writeAddr = start === end ? start : `${start}:${end}`;
          let count = rows * cols;
          try {
            sheet.GetRange(writeAddr).SetValue(matrix as unknown as string | number);
          } catch (_e) {
            count = 0;
            for (let r = 0; r < rows; r++) {
              for (let c = 0; c < cols; c++) {
                sheet
                  .GetRange(colRow1ToA1(startRow1 + r, startCol1 + c))
                  .SetValue(matrix[r][c] ?? "");
                count += 1;
              }
            }
          }
          return JSON.stringify({ written: count, home: start });
        },
        false,
        false,
        (result: string) => {
          try {
            const parsed = JSON.parse(String(result || "{}")) as {
              written?: number;
              home?: string;
            };
            (Asc as AscScope).scope = {
              ...((Asc as AscScope).scope ?? {}),
              homeAddr: parsed.home || "A1",
            };
            resolve(Number(parsed.written) || 0);
          } catch {
            resolve(Number(result) || 0);
          }
        },
        (err) => reject(err instanceof Error ? err : new Error(String(err))),
      );
    } catch (err) {
      reject(err instanceof Error ? err : new Error(String(err)));
    }
  });

  const home =
    ((Asc as AscScope).scope ?? {}).homeAddr ||
    (typeof options.range === "string" ? options.range.split(":")[0] : "A1") ||
    "A1";
  scheduleViewportNudge(String(home).split(":")[0] || "A1");
  return written;
}

/** Apply Cell format to used range / selection / address / cells; then viewport nudge. */
export async function applyCellFormatSpec(spec: {
  target?: string;
  range?: string | null;
  cells?: string[] | null;
  format: Record<string, unknown>;
}): Promise<string> {
  setAscScope({
    cellFormatTarget: String(spec.target || "used"),
    cellFormatRange: typeof spec.range === "string" ? spec.range : "",
    cellFormatCells: Array.isArray(spec.cells) ? spec.cells : [],
    cellFormat: spec.format || {},
  });
  const summary = await new Promise<string>((resolve, reject) => {
    try {
      window.Asc.plugin.callCommand(
        () => {
          const scope = (Asc as AscScope).scope ?? {};
          const target = String(scope.cellFormatTarget || "used");
          const explicitRange = String(scope.cellFormatRange || "").trim();
          const cells = Array.isArray(scope.cellFormatCells)
            ? (scope.cellFormatCells as string[])
            : [];
          const fmt = (scope.cellFormat || {}) as Record<string, unknown>;
          const sheet = Api.GetActiveSheet();

          function resolveRange(): any {
            if (target === "cells" && cells.length) {
              return null;
            }
            if (target === "selection") {
              try {
                const apiAny = Api as unknown as { GetSelection?: () => unknown };
                const sheetAny = sheet as unknown as { GetSelection?: () => unknown };
                const sel =
                  (apiAny.GetSelection && apiAny.GetSelection()) ||
                  (sheetAny.GetSelection && sheetAny.GetSelection()) ||
                  null;
                if (sel) return sel;
              } catch (_e) {
                /* fall through */
              }
            }
            if (target === "range" && explicitRange) {
              try {
                return sheet.GetRange(explicitRange);
              } catch (_e) {
                /* fall through */
              }
            }
            if (target === "used" || !target || target === "range") {
              try {
                return sheet.GetUsedRange();
              } catch (_e) {
                return sheet.GetRange("A1");
              }
            }
            try {
              return sheet.GetRange(target);
            } catch (_e2) {
              return sheet.GetUsedRange();
            }
          }

          function asRgb(v: unknown): [number, number, number] | null {
            if (!Array.isArray(v) || v.length < 3) return null;
            return [Number(v[0]) || 0, Number(v[1]) || 0, Number(v[2]) || 0];
          }

          function applyFill(range: any, rgb: [number, number, number]) {
            if (!range || typeof range.SetFillColor !== "function") return;
            try {
              const apiAny = Api as unknown as {
                CreateColorFromRGB?: (r: number, g: number, b: number) => unknown;
              };
              if (typeof apiAny.CreateColorFromRGB === "function") {
                range.SetFillColor(apiAny.CreateColorFromRGB(rgb[0], rgb[1], rgb[2]));
              } else {
                range.SetFillColor(rgb[0], rgb[1], rgb[2]);
              }
            } catch (_e) {
              try {
                range.SetFillColor(rgb[0], rgb[1], rgb[2]);
              } catch (_e2) {
                /* ignore */
              }
            }
          }

          function applyFormatToRange(range: any, formatObj?: Record<string, unknown>) {
            if (!range) return;
            const f = formatObj || fmt;
            if (f.bold === true && typeof range.SetBold === "function") range.SetBold(true);
            if (f.bold === false && typeof range.SetBold === "function") range.SetBold(false);
            if (f.italic === true && typeof range.SetItalic === "function") range.SetItalic(true);
            if (typeof f.fontName === "string" && typeof range.SetFontName === "function") {
              range.SetFontName(f.fontName);
            }
            if (typeof f.fontSize === "number" && typeof range.SetFontSize === "function") {
              range.SetFontSize(f.fontSize);
            }
            if (typeof f.underline === "string" && typeof range.SetUnderline === "function") {
              range.SetUnderline(f.underline);
            }
            const fill = asRgb(f.fillRgb);
            if (fill) applyFill(range, fill);
            const fontRgb = asRgb(f.fontColorRgb);
            if (fontRgb && typeof range.SetFontColor === "function") {
              try {
                const apiAny = Api as unknown as {
                  CreateColorFromRGB?: (r: number, g: number, b: number) => unknown;
                };
                if (typeof apiAny.CreateColorFromRGB === "function") {
                  range.SetFontColor(
                    apiAny.CreateColorFromRGB(fontRgb[0], fontRgb[1], fontRgb[2]),
                  );
                }
              } catch (_e) {
                /* ignore */
              }
            }
            if (f.bordersOutline === true && typeof range.SetBorders === "function") {
              try {
                const apiAny = Api as unknown as {
                  CreateColorFromRGB?: (r: number, g: number, b: number) => unknown;
                };
                const c =
                  typeof apiAny.CreateColorFromRGB === "function"
                    ? apiAny.CreateColorFromRGB(0, 0, 0)
                    : null;
                if (c) range.SetBorders("Outline", "Thin", c);
                else range.SetBorders();
              } catch (_e) {
                /* ignore */
              }
            }
          }

          if (target === "cells" && cells.length) {
            let n = 0;
            for (const addr of cells) {
              const a = String(addr || "").trim();
              if (!a) continue;
              try {
                applyFormatToRange(sheet.GetRange(a));
                n += 1;
              } catch (_cellErr) {
                /* skip */
              }
            }
            return n ? `cells:${n}` : "no-range";
          }

          function colToLetters(col1: number): string {
            let n = Math.max(1, col1);
            let s = "";
            while (n > 0) {
              const m = (n - 1) % 26;
              s = String.fromCharCode(65 + m) + s;
              n = Math.floor((n - 1) / 26);
            }
            return s;
          }

          function lettersToCol(letters: string): number {
            let col = 0;
            const up = String(letters || "").toUpperCase();
            for (let i = 0; i < up.length; i++) col = col * 26 + (up.charCodeAt(i) - 64);
            return Math.max(1, col);
          }

          /** Width of header row (= used cols). Never trust sheetName!A1 without stripping. */
          function headerColCount(): number {
            let best = 1;
            try {
              const used = sheet.GetUsedRange();
              if (!used) return 1;

              // 1) GetValue first row (row-major).
              try {
                const vals =
                  typeof (used as any).GetValue === "function" ? (used as any).GetValue() : null;
                if (Array.isArray(vals) && vals.length) {
                  const row0 = vals[0];
                  if (Array.isArray(row0) && row0.length > best) best = row0.length;
                  // Column-major quirk: each vals[i] is a column — then header is vals.map(c => c[0]).
                  else if (!Array.isArray(row0) && vals.length > best) {
                    best = vals.length;
                  }
                }
              } catch (_v) {
                /* ignore */
              }

              // 2) Address — strip SheetName! prefix first.
              try {
                if (typeof (used as any).GetAddress === "function") {
                  let addr = String((used as any).GetAddress(true, true) || "")
                    .replace(/\$/g, "")
                    .replace(/^[^!]*!/, "");
                  const m = addr.match(/([A-Za-z]+)(\d+):([A-Za-z]+)(\d+)/);
                  if (m) {
                    const cols = lettersToCol(m[3]) - lettersToCol(m[1]) + 1;
                    if (cols > best) best = cols;
                  }
                }
              } catch (_a) {
                /* ignore */
              }

              // 3) GetCols / Count if present.
              try {
                if (typeof (used as any).GetCols === "function") {
                  const c = Number((used as any).GetCols());
                  if (Number.isFinite(c) && c > best) best = c;
                } else if (typeof (used as any).GetColCount === "function") {
                  const c = Number((used as any).GetColCount());
                  if (Number.isFinite(c) && c > best) best = c;
                }
              } catch (_c) {
                /* ignore */
              }
            } catch (_e) {
              /* ignore */
            }

            // 4) Scan row 1 until empty streak (cap 64).
            try {
              let lastNonEmpty = best;
              let emptyStreak = 0;
              for (let c = 1; c <= 64; c++) {
                let raw: unknown = "";
                try {
                  const cell =
                    typeof (sheet as any).GetCells === "function"
                      ? (sheet as any).GetCells(1, c)
                      : sheet.GetRange(`${colToLetters(c)}1`);
                  raw =
                    cell && typeof cell.GetValue === "function" ? cell.GetValue() : "";
                } catch (_cell) {
                  raw = "";
                }
                const empty =
                  raw == null ||
                  raw === "" ||
                  (Array.isArray(raw) && !(raw as unknown[]).length);
                if (empty) {
                  emptyStreak += 1;
                  if (emptyStreak >= 2 && c > best) break;
                } else {
                  emptyStreak = 0;
                  lastNonEmpty = c;
                }
              }
              if (lastNonEmpty > best) best = lastNonEmpty;
            } catch (_scan) {
              /* ignore */
            }

            return Math.max(1, best);
          }

          /**
           * Header = entire first ROW (A1:…1), never a single cell and never column A.
           * Prefer range SetBold; also per-cell for Cell builds that skip multi-cell.
           */
          function applyHeaderFormat(): string {
            const cols = headerColCount();
            const headerAddr = cols <= 1 ? "A1" : `A1:${colToLetters(cols)}1`;
            let n = 0;
            try {
              const header = sheet.GetRange(headerAddr) as any;
              if (fmt.headerBold === true && typeof header.SetBold === "function") {
                header.SetBold(true);
              }
              const hFill = asRgb(fmt.headerFillRgb);
              if (hFill) applyFill(header, hFill);
              n = cols;
            } catch (_rangeErr) {
              /* fall through to per-cell */
            }
            for (let c = 1; c <= cols; c++) {
              try {
                const cell = sheet.GetRange(`${colToLetters(c)}1`) as any;
                if (fmt.headerBold === true && typeof cell.SetBold === "function") {
                  cell.SetBold(true);
                }
                const hFill = asRgb(fmt.headerFillRgb);
                if (hFill) applyFill(cell, hFill);
                n = Math.max(n, c);
              } catch (_cellErr) {
                /* skip */
              }
            }
            return `header-row1:${n}:${headerAddr}`;
          }

          const formatKeys = Object.keys(fmt);
          const onlyHeaderKeys =
            formatKeys.length > 0 &&
            formatKeys.every((k) => k === "headerBold" || k === "headerFillRgb");

          if (onlyHeaderKeys) {
            return applyHeaderFormat();
          }

          const range = resolveRange();
          if (!range) return "no-range";

          // When headerBold is set, do not also SetBold the whole used range
          // (some Cell builds mis-apply range bold to column A).
          const fmtForRange: Record<string, unknown> = { ...fmt };
          if (fmt.headerBold === true) {
            delete fmtForRange.bold;
          }
          applyFormatToRange(range, fmtForRange);

          if (fmt.headerBold === true || asRgb(fmt.headerFillRgb)) {
            applyHeaderFormat();
          }

          return "ok";
        },
        false,
        false,
        (result: string) => resolve(String(result || "ok")),
        (err) => reject(err instanceof Error ? err : new Error(String(err))),
      );
    } catch (err) {
      reject(err instanceof Error ? err : new Error(String(err)));
    }
  });

  scheduleViewportNudge("A1");
  return summary;
}
