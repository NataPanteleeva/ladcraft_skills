import { contentToPasteHtml } from "../markdown/html";
import { wrapHtmlWithWordFont } from "../ui/word-font-prefs";
import { normalizeCellFormatSpec } from "./cell-format";
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

async function executeMethodStrictTimeout(
  method: string,
  args: unknown[] = [],
  timeoutMs = 4_000,
): Promise<void> {
  await Promise.race([
    executeMethod(method, args).then(() => undefined),
    sleepMs(timeoutMs).then(() => {
      throw new Error(`${method}: timeout ${timeoutMs}ms`);
    }),
  ]);
}

function callCommandStrictTimeout(
  command: () => void,
  timeoutMs = 4_000,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    let settled = false;
    const done = (fn: () => void): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn();
    };
    const timer = setTimeout(() => {
      done(() => reject(new Error(`callCommand: timeout ${timeoutMs}ms`)));
    }, timeoutMs);
    try {
      window.Asc.plugin.callCommand(
        command,
        false,
        false,
        () => done(resolve),
        (err) =>
          done(() => reject(err instanceof Error ? err : new Error(String(err)))),
      );
    } catch (err) {
      done(() => reject(err instanceof Error ? err : new Error(String(err))));
    }
  });
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
  const html = wrapHtmlWithWordFont(contentToPasteHtml(content, mimeType));
  await insertHtml(html, position);
}

type AscScope = typeof window.Asc & { scope?: Record<string, unknown> };

function setAscScope(values: Record<string, unknown>): void {
  const asc = window.Asc as AscScope;
  asc.scope = { ...(asc.scope ?? {}), ...values };
}

export { setAscScope };

/**
 * Candidates for Asc SearchAndReplace from agent findings.
 * Prefer the shortest differing token first (the typo word from the table) —
 * long context phrases often miss due to line breaks; no need to «poll» them first.
 *
 * Exception: punctuation-only token edits (`однако`→`однако,`, `файл`→`файл,`) must NOT
 * be shortened to a single token — Asc replaces substrings, so `файл`→`файл,` turns
 * `файлы` into `файл,ы` and a second pass into `файл,,ы`.
 */
export function searchReplaceFallbackPairs(
  search: string,
  replace: string,
): Array<{ search: string; replace: string }> {
  const out: Array<{ search: string; replace: string }> = [];
  const seen = new Set<string>();
  const add = (sRaw: string, rRaw: string) => {
    const s = String(sRaw || "")
      .replace(/\u00a0/g, " ")
      .replace(/[…]+$/g, "")
      .replace(/\s+/g, " ")
      .trim();
    const r = String(rRaw || "")
      .replace(/\u00a0/g, " ")
      .replace(/[…]+$/g, "")
      .replace(/\s+/g, " ")
      .trim();
    if (!s || s === r || s.length < 2) return;
    // Bare punct-only single token is unsafe under substring SAR.
    if (!/\s/.test(s) && isPunctuationOnlyDiff(s, r)) return;
    const key = `${s}\0${r}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ search: s, replace: r });
  };

  const s0 = String(search ?? "");
  const r0 = String(replace ?? "");
  const sw = s0.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim().split(/\s+/).filter(Boolean);
  const rw = r0.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim().split(/\s+/).filter(Boolean);
  if (sw.length && rw.length) {
    let i = 0;
    while (i < sw.length && i < rw.length && sw[i] === rw[i]) i++;
    let j = 0;
    while (
      j < sw.length - i &&
      j < rw.length - i &&
      sw[sw.length - 1 - j] === rw[rw.length - 1 - j]
    ) {
      j++;
    }
    // Shortest first — unless punctuation-only on one token (see add()).
    if (i < sw.length && i < rw.length && sw[i] !== rw[i]) {
      if (!(sw.length >= 2 && isPunctuationOnlyDiff(sw[i], rw[i]))) {
        add(sw[i], rw[i]);
      }
    }
    const sMid = sw.slice(i, sw.length - j).join(" ");
    const rMid = rw.slice(i, rw.length - j).join(" ");
    if (sMid && rMid) add(sMid, rMid);
  }
  add(s0, r0);
  return out;
}

/** True when a/b differ only by spaces/punctuation (same letters). */
export function isPunctuationOnlyDiff(a: string, b: string): boolean {
  const strip = (t: string) =>
    String(t || "")
      .replace(/[\s.,:;!?…«»„“"'()[\]{}<>\-—–/\\]+/gu, "")
      .toLowerCase();
  const sa = strip(a);
  const sb = strip(b);
  return Boolean(sa) && sa === sb && String(a) !== String(b);
}

/** Global search/replace in the open Word document. Throws if count is 0. */
export async function applyDocumentSearchReplace(
  search: string,
  replace: string,
  matchCase: boolean,
): Promise<number> {
  const batch = await applyDocumentSearchReplaceBatch([
    { search, replace, matchCase },
  ]);
  if (batch.appliedIndexes.includes(0)) return 1;
  const err = batch.errors[0] || "Ничего не найдено для замены";
  throw new Error(err);
}

/** Strip agent meta like «(после „что“)» — not present in the document. */
export function sanitizeSearchReplaceNeedle(raw: string): string {
  return String(raw || "")
    .replace(/\u00a0/g, " ")
    .replace(/\s*\([^)]{0,80}\)\s*/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function executeMethodSearchReplace(
  search: string,
  replace: string,
  matchCase: boolean,
  timeoutMs = 3_000,
): Promise<number> {
  const needle = sanitizeSearchReplaceNeedle(search);
  const repl = sanitizeSearchReplaceNeedle(replace);
  if (!needle || needle === repl) return 0;
  try {
    const result = await Promise.race([
      executeMethod("SearchAndReplace", [
        {
          searchString: needle,
          replaceString: repl,
          matchCase: Boolean(matchCase),
        },
      ]),
      sleepMs(timeoutMs).then(() => {
        throw new Error(`SearchAndReplace: timeout ${timeoutMs}ms`);
      }),
    ]);
    // Desktop Asc often returns void/undefined even when replacements ran.
    // Explicit 0 → miss. Positive count → hits. void/null/"" → unknown success.
    if (result === undefined || result === null || result === "") return -1;
    const num = Number(result);
    if (Number.isFinite(num) && num > 0) return num;
    if (num === 0) return 0;
    return -1;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/timeout/i.test(msg)) {
      console.warn("[ladcraft-r7_agui] SearchAndReplace timeout", needle.slice(0, 40));
      return 0;
    }
    throw err;
  }
}

/**
 * Apply many Word search/replace pairs via executeMethod (bounded per item).
 * Avoids callCommand freezes + StartAction lock that left «Вношу N замен…» hanging.
 */
export async function applyDocumentSearchReplaceBatch(
  items: Array<{ search: string; replace: string; matchCase?: boolean }>,
): Promise<{ appliedIndexes: number[]; errors: string[] }> {
  if (!items.length) return { appliedIndexes: [], errors: [] };

  const appliedIndexes: number[] = [];
  const errors: string[] = [];
  const started = Date.now();
  const budgetMs = Math.min(45_000, Math.max(12_000, items.length * 3_500));

  for (let i = 0; i < items.length; i++) {
    if (Date.now() - started > budgetMs) {
      for (let j = i; j < items.length; j++) {
        errors.push(`search_replace: прервано по таймауту (осталось ${items.length - j})`);
      }
      break;
    }
    const it = items[i];
    const attempts = searchReplaceFallbackPairs(
      sanitizeSearchReplaceNeedle(it.search) || it.search,
      sanitizeSearchReplaceNeedle(it.replace) || it.replace,
    ).slice(0, 2);
    let ok = 0;
    let lastErr = "";
    for (const att of attempts) {
      try {
        const n = await executeMethodSearchReplace(
          att.search,
          att.replace,
          Boolean(it.matchCase),
          2_500,
        );
        // n>0 real hits; n<0 Desktop void (treat as applied).
        if (n !== 0) {
          ok = n > 0 ? n : 1;
          break;
        }
      } catch (err) {
        lastErr = err instanceof Error ? err.message : String(err);
      }
    }
    if (ok > 0) appliedIndexes.push(i);
    else {
      const shown = String(attempts[0]?.search || it.search || "").slice(0, 40);
      errors.push(
        lastErr
          ? `search_replace: ${lastErr}`
          : `search_replace: Ничего не найдено для замены «${shown}${String(attempts[0]?.search || it.search || "").length > 40 ? "…" : ""}»`,
      );
    }
  }
  return { appliedIndexes, errors };
}

/**
 * Add a review comment to Word.
 * Prefer: Search(anchor) → range.AddComment; else current selection; never first paragraph alone.
 */
export async function applyDocumentComment(
  text: string,
  search?: string,
): Promise<void> {
  const comment = String(text || "").trim();
  if (!comment) throw new Error("add_comment: empty text");
  const anchor = String(search || "").trim();

  setAscScope({ commentText: comment, commentSearch: anchor, commentResult: "" });
  await callCommandStrictTimeout(() => {
    const AscAny = Asc as AscScope;
    if (!AscAny.scope) AscAny.scope = {};
    const scope = AscAny.scope;
    const c = String(scope.commentText ?? "").trim();
    const q = String(scope.commentSearch ?? "").trim();
    scope.commentResult = "0";
    if (!c) return;

    const apiAny = Api as {
      GetRangeBySelect?: () => {
        GetText?: () => string;
        AddComment?: (t: string, u: string, id: string) => void;
      } | null;
    };
    if (typeof apiAny.GetRangeBySelect === "function") {
      const sel = apiAny.GetRangeBySelect();
      if (sel && typeof sel.GetText === "function") {
        const t = String(sel.GetText() || "").trim();
        if (t && typeof sel.AddComment === "function") {
          sel.AddComment(c, "Ladcraft", "0");
          scope.commentResult = "1";
          return;
        }
      } else if (sel && typeof sel.AddComment === "function" && !q) {
        sel.AddComment(c, "Ladcraft", "0");
        scope.commentResult = "1";
        return;
      }
    }

    const doc = Api.GetDocument() as unknown as { Search?: (s: string) => unknown[] };
    if (q && typeof doc.Search === "function") {
      const found = doc.Search(q) as Array<{
        AddComment?: (t: string, u: string, id: string) => void;
        Select?: () => void;
      }> | null;
      const first = found && found.length ? found[0] : null;
      if (first && typeof first.AddComment === "function") {
        first.AddComment(c, "Ladcraft", "0");
        scope.commentResult = "1";
        return;
      }
      if (first && typeof first.Select === "function") {
        first.Select();
        scope.commentResult = "selected";
      }
    }
  });

  const viaSearch = String(
    ((window.Asc as AscScope).scope ?? {}).commentResult ?? "0",
  );

  if (viaSearch === "1") return;

  // After Search→Select, or when selection already present: executeMethod AddComment.
  if (viaSearch === "selected" || !anchor) {
    try {
      await executeMethodStrictTimeout("AddComment", [
        { Text: comment, UserName: "Ladcraft", UserId: "0" },
      ], 4_000);
      return;
    } catch (err) {
      console.warn("[ladcraft-r7_agui] AddComment executeMethod failed", err);
    }
  }

  throw new Error(
    anchor
      ? `Не найден якорь «${anchor}» для комментария — проверьте текст в документе`
      : "Выделите фразу в документе или укажите search в proposal",
  );
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
export async function applyMatrixAtActiveCell(
  aoa: MatrixAoa,
  options: { headerBold?: boolean } = {},
): Promise<number> {
  const bulk = normalizeAoaForBulk(aoa);
  setAscScope({ aoa: bulk, headerBold: options.headerBold !== false });
  const written = await new Promise<number>((resolve, reject) => {
    try {
      window.Asc.plugin.callCommand(
        () => {
          const scope = (Asc as AscScope).scope ?? {};
          const matrix = (scope.aoa ?? [[""]]) as (string | number)[][];
          const sheet = Api.GetActiveSheet();
          const doHeaderBold = scope.headerBold !== false;
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
          if (doHeaderBold && cols >= 1) {
            try {
              const h0 = colRow1ToA1(startRow1, startCol1);
              const h1 = colRow1ToA1(startRow1, startCol1 + cols - 1);
              const hAddr = cols === 1 ? h0 : `${h0}:${h1}`;
              const header = sheet.GetRange(hAddr) as { SetBold?: (v: boolean) => void };
              if (header && typeof header.SetBold === "function") header.SetBold(true);
              for (let c = 0; c < cols; c++) {
                try {
                  const cell = sheet.GetRange(colRow1ToA1(startRow1, startCol1 + c)) as {
                    SetBold?: (v: boolean) => void;
                  };
                  if (cell && typeof cell.SetBold === "function") cell.SetBold(true);
                } catch (_cellBold) {
                  /* skip */
                }
              }
            } catch (_hdr) {
              /* ignore */
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
  options: { headerBold?: boolean } = {},
): Promise<{ sheetName: string; written: number }> {
  const bulk = normalizeAoaForBulk(aoa);
  setAscScope({ aoa: bulk, preferredName, headerBold: options.headerBold !== false });
  const out = await new Promise<{ sheetName: string; written: number }>((resolve, reject) => {
    try {
      window.Asc.plugin.callCommand(
        () => {
          const scope = (Asc as AscScope).scope ?? {};
          const matrix = (scope.aoa ?? [[""]]) as (string | number)[][];
          const doHeaderBold = scope.headerBold !== false;

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

          if (doHeaderBold && cols >= 1) {
            try {
              const hAddr = cols === 1 ? "A1" : `A1:${colRow0ToA1(0, cols - 1)}`;
              const header = sheet.GetRange(hAddr) as { SetBold?: (v: boolean) => void };
              if (header && typeof header.SetBold === "function") header.SetBold(true);
              for (let c = 0; c < cols; c++) {
                try {
                  const cell = sheet.GetRange(colRow0ToA1(0, c)) as {
                    SetBold?: (v: boolean) => void;
                  };
                  if (cell && typeof cell.SetBold === "function") cell.SetBold(true);
                } catch (_cellBold) {
                  /* skip */
                }
              }
            } catch (_hdr) {
              /* ignore */
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
export async function applyMatrixReplaceActiveSheet(
  aoa: MatrixAoa,
  options: { headerBold?: boolean } = {},
): Promise<number> {
  const bulk = normalizeAoaForBulk(aoa);
  setAscScope({ aoa: bulk, headerBold: options.headerBold !== false });
  const written = await new Promise<number>((resolve, reject) => {
    try {
      window.Asc.plugin.callCommand(
        () => {
          const scope = (Asc as AscScope).scope ?? {};
          const matrix = (scope.aoa ?? [[""]]) as (string | number)[][];
          const doHeaderBold = scope.headerBold !== false;
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
          if (doHeaderBold && cols >= 1) {
            try {
              const hAddr = cols === 1 ? "A1" : `A1:${colRow1ToA1(1, cols)}`;
              const header = sheet.GetRange(hAddr) as { SetBold?: (v: boolean) => void };
              if (header && typeof header.SetBold === "function") header.SetBold(true);
              for (let c = 1; c <= cols; c++) {
                try {
                  const cell = sheet.GetRange(colRow1ToA1(1, c)) as {
                    SetBold?: (v: boolean) => void;
                  };
                  if (cell && typeof cell.SetBold === "function") cell.SetBold(true);
                } catch (_cellBold) {
                  /* skip */
                }
              }
            } catch (_hdr) {
              /* ignore */
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
    headerBold?: boolean;
  } = {},
): Promise<number> {
  const mode = String(options.mode || "used").toLowerCase();
  if (mode === "used" || !mode) {
    return applyMatrixReplaceActiveSheet(aoa, { headerBold: options.headerBold });
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
    headerBold: options.headerBold !== false,
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
          const doHeaderBold = scope.headerBold !== false;
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
          if (doHeaderBold && cols >= 1) {
            try {
              const h0 = colRow1ToA1(startRow1, startCol1);
              const h1 = colRow1ToA1(startRow1, startCol1 + cols - 1);
              const hAddr = cols === 1 ? h0 : `${h0}:${h1}`;
              const header = sheet.GetRange(hAddr) as { SetBold?: (v: boolean) => void };
              if (header && typeof header.SetBold === "function") header.SetBold(true);
              for (let c = 0; c < cols; c++) {
                try {
                  const cell = sheet.GetRange(colRow1ToA1(startRow1, startCol1 + c)) as {
                    SetBold?: (v: boolean) => void;
                  };
                  if (cell && typeof cell.SetBold === "function") cell.SetBold(true);
                } catch (_cellBold) {
                  /* skip */
                }
              }
            } catch (_hdr) {
              /* ignore */
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
  format?: Record<string, unknown>;
  rules?: Array<{
    match?: Record<string, unknown>;
    format?: Record<string, unknown>;
    applyScope?: string;
  }> | null;
  applyScope?: string;
  autoFitColumns?: boolean;
}): Promise<string> {
  const normalized = normalizeCellFormatSpec(spec);
  setAscScope({
    cellFormatTarget: String(normalized.target || "used"),
    cellFormatRange: typeof normalized.range === "string" ? normalized.range : "",
    cellFormatCells: Array.isArray(normalized.cells) ? normalized.cells : [],
    cellFormat: normalized.format || {},
    cellFormatRules: Array.isArray(normalized.rules) ? normalized.rules : [],
    cellFormatApplyScope: String(normalized.applyScope || "row"),
    cellFormatAutoFit: normalized.autoFitColumns === true,
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
          const rules = Array.isArray(scope.cellFormatRules)
            ? (scope.cellFormatRules as Array<{
                match?: Record<string, unknown>;
                format?: Record<string, unknown>;
                applyScope?: string;
              }>)
            : [];
          const defaultScope = String(scope.cellFormatApplyScope || "row").toLowerCase();
          const doAutoFit = scope.cellFormatAutoFit === true;
          const sheet = Api.GetActiveSheet();

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

          function cellValue(row1: number, col1: number): string {
            try {
              const cell =
                typeof (sheet as any).GetCells === "function"
                  ? (sheet as any).GetCells(row1, col1)
                  : sheet.GetRange(`${colToLetters(col1)}${row1}`);
              const raw = cell && typeof cell.GetValue === "function" ? cell.GetValue() : "";
              if (raw == null) return "";
              if (Array.isArray(raw)) return String(raw[0] ?? "");
              return String(raw);
            } catch (_e) {
              return "";
            }
          }

          function tableBoundsFromHeader(r1: number, c1: number): {
            r1: number;
            r2: number;
            c1: number;
            c2: number;
          } {
            let c2 = c1;
            for (let cc = c1 + 1; cc <= c1 + 64; cc++) {
              if (!String(cellValue(r1, cc) || "").trim()) break;
              c2 = cc;
            }
            let r2 = r1;
            for (let rr = r1 + 1; rr <= r1 + 2000; rr++) {
              let any = false;
              for (let cx = c1; cx <= c2; cx++) {
                if (String(cellValue(rr, cx) || "").trim()) {
                  any = true;
                  break;
                }
              }
              if (!any) break;
              r2 = rr;
            }
            return { r1, r2, c1, c2 };
          }

          function stemHeaderToken(raw: string): string {
            let s = String(raw || "")
              .trim()
              .toLowerCase()
              .replace(/["«»]/g, "");
            if (!s) return "";
            s = s.replace(
              /(ами|ями|ов|ев|ей|ой|ою|ую|ые|ых|ым|ом|ем|ам|ям|у|е|а|ы|и|ь)$/i,
              "",
            );
            if (s.length < 3) {
              s = String(raw || "")
                .trim()
                .toLowerCase()
                .replace(/["«»']/g, "");
            }
            return s;
          }

          /** Exact → stem includes → alias list against real sheet headers. */
          function findHeaderCol(
            headerName: string,
            r1: number,
            c1: number,
            c2: number,
            aliases?: string[] | null,
          ): { col: number; label: string } {
            const headers: Array<{ c: number; text: string; low: string; stem: string }> = [];
            for (let c = c1; c <= c2; c++) {
              const text = String(cellValue(r1, c) || "").trim();
              if (!text) continue;
              headers.push({
                c,
                text,
                low: text.toLowerCase(),
                stem: stemHeaderToken(text),
              });
            }
            const queries: string[] = [];
            const pushQ = (v: string) => {
              const t = String(v || "").trim();
              if (!t) return;
              if (!queries.some((x) => x.toLowerCase() === t.toLowerCase())) queries.push(t);
            };
            pushQ(headerName);
            if (Array.isArray(aliases)) {
              for (let i = 0; i < aliases.length; i++) pushQ(String(aliases[i] || ""));
            }
            // 1) exact
            for (let qi = 0; qi < queries.length; qi++) {
              const want = queries[qi].toLowerCase();
              for (let hi = 0; hi < headers.length; hi++) {
                if (headers[hi].low === want) {
                  return { col: headers[hi].c, label: headers[hi].text };
                }
              }
            }
            // 2) stem / includes
            for (let qi = 0; qi < queries.length; qi++) {
              const qs = stemHeaderToken(queries[qi]);
              if (!qs || qs.length < 3) continue;
              for (let hi = 0; hi < headers.length; hi++) {
                const h = headers[hi];
                if (
                  h.stem === qs ||
                  h.stem.indexOf(qs) >= 0 ||
                  qs.indexOf(h.stem) >= 0 ||
                  h.low.indexOf(qs) >= 0
                ) {
                  return { col: h.c, label: h.text };
                }
              }
            }
            return { col: -1, label: "" };
          }

          function resolveCol(
            match: Record<string, unknown>,
            bounds: { r1: number; c1: number; c2: number },
          ): number {
            const header = String(match.header || "").trim();
            if (header) {
              const aliases = Array.isArray(match.headerAliases)
                ? (match.headerAliases as string[])
                : null;
              return findHeaderCol(header, bounds.r1, bounds.c1, bounds.c2, aliases).col;
            }
            if (match.col != null) {
              const raw = match.col;
              if (typeof raw === "number") return Math.max(1, raw);
              if (/^[A-Za-z]+$/.test(String(raw))) return lettersToCol(String(raw));
              return Math.max(1, parseInt(String(raw), 10) || -1);
            }
            return -1;
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

          function normalizeAlign(val: unknown): string | null {
            const s = String(val ?? "")
              .trim()
              .toLowerCase();
            if (!s) return null;
            if (s === "center" || s === "centre" || s === "центр" || s.indexOf("центр") >= 0) {
              return "center";
            }
            if (s === "left" || s === "лево" || s.indexOf("лев") >= 0) return "left";
            if (s === "right" || s === "право" || s.indexOf("прав") >= 0) return "right";
            return null;
          }

          function applyAlign(range: any, val: unknown): void {
            const a = normalizeAlign(val);
            if (!a || !range) return;
            try {
              if (typeof range.SetAlignHorizontal === "function") range.SetAlignHorizontal(a);
              else if (typeof range.SetHorizontalAlignment === "function") {
                range.SetHorizontalAlignment(a);
              }
            } catch (_ae) {
              /* ignore */
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
            if (f.align != null) applyAlign(range, f.align);
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
                // Medium only — Thick made outline ~0.5–1pt heavier than needed.
                const sides = ["Outline", "Top", "Bottom", "Left", "Right"];
                for (let si = 0; si < sides.length; si++) {
                  try {
                    if (c) range.SetBorders(sides[si], "Medium", c);
                    else range.SetBorders(sides[si], "Medium");
                  } catch (_be) {
                    /* ignore ret/throw; visual effect is the success criterion */
                  }
                }
              } catch (_e) {
                /* ignore */
              }
            }
          }

          function parseNum(text: string): number {
            const t = String(text || "")
              .trim()
              .replace(/\s/g, "")
              .replace(",", ".");
            const n = parseFloat(t);
            return Number.isFinite(n) ? n : NaN;
          }

          function matchValue(cellText: string, op: string, expect: unknown): boolean {
            const left = String(cellText ?? "").trim();
            const right = String(expect ?? "").trim();
            const lop = String(op || "eq").toLowerCase();
            if (lop === "contains") return left.toLowerCase().indexOf(right.toLowerCase()) >= 0;
            if (lop === "neq") return left.toLowerCase() !== right.toLowerCase();
            if (lop === "eq") return left.toLowerCase() === right.toLowerCase();
            const ln = parseNum(left);
            const rn =
              typeof expect === "number" ? expect : parseNum(right);
            if (!Number.isFinite(ln) || !Number.isFinite(rn)) return false;
            if (lop === "gt") return ln > rn;
            if (lop === "gte") return ln >= rn;
            if (lop === "lt") return ln < rn;
            if (lop === "lte") return ln <= rn;
            return false;
          }

          function resolveRange(): any {
            if (target === "cells" && cells.length) return null;
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
                /* fall */
              }
            }
            if (target === "range" && explicitRange) {
              try {
                return sheet.GetRange(explicitRange);
              } catch (_e) {
                /* fall */
              }
            }
            try {
              return sheet.GetUsedRange();
            } catch (_e2) {
              return sheet.GetRange("A1");
            }
          }

          function paintRowOrCell(
            bounds: { r1: number; r2: number; c1: number; c2: number },
            row1: number,
            focusCol: number,
            scopeMode: string,
            formatObj: Record<string, unknown>,
          ): boolean {
            try {
              let addr = "";
              if (scopeMode === "cell" && focusCol >= 1) {
                addr = `${colToLetters(focusCol)}${row1}`;
              } else {
                const a0 = `${colToLetters(bounds.c1)}${row1}`;
                const a1 = `${colToLetters(bounds.c2)}${row1}`;
                addr = bounds.c1 === bounds.c2 ? a0 : `${a0}:${a1}`;
              }
              applyFormatToRange(sheet.GetRange(addr), formatObj);
              return true;
            } catch (_e) {
              return false;
            }
          }

          function evalSimpleCond(
            cond: Record<string, unknown>,
            bounds: { r1: number; r2: number; c1: number; c2: number },
            row1: number,
          ): { ok: boolean; focusCol: number } {
            const col1 = resolveCol(cond, bounds);
            if (col1 < 1) return { ok: false, focusCol: -1 };
            const op = String(cond.op || "eq").toLowerCase();
            return {
              ok: matchValue(cellValue(row1, col1), op, cond.value),
              focusCol: col1,
            };
          }

          function collectTopNRows(
            bounds: { r1: number; r2: number; c1: number; c2: number },
            header: string,
            n: number,
            order: string,
            aliases?: string[] | null,
            filters?: Array<Record<string, unknown>> | null,
          ): { rows: number[]; label: string; col: number } {
            const found = findHeaderCol(header, bounds.r1, bounds.c1, bounds.c2, aliases);
            if (found.col < 1) return { rows: [], label: "", col: -1 };
            const items: Array<{ row: number; val: number }> = [];
            for (let r = bounds.r1 + 1; r <= bounds.r2; r++) {
              let pass = true;
              if (Array.isArray(filters) && filters.length) {
                for (let fi = 0; fi < filters.length; fi++) {
                  const ev = evalSimpleCond(filters[fi], bounds, r);
                  if (!ev.ok) {
                    pass = false;
                    break;
                  }
                }
              }
              if (!pass) continue;
              const val = parseNum(cellValue(r, found.col));
              if (!Number.isFinite(val)) continue;
              items.push({ row: r, val });
            }
            items.sort((a, b) => (order === "desc" ? b.val - a.val : a.val - b.val));
            const out: number[] = [];
            for (let i = 0; i < items.length && i < n; i++) out.push(items[i].row);
            return { rows: out, label: found.label, col: found.col };
          }

          function collectExtremeRow(
            bounds: { r1: number; r2: number; c1: number; c2: number },
            header: string,
            which: string,
            aliases?: string[] | null,
            filters?: Array<Record<string, unknown>> | null,
          ): { row: number; label: string; col: number } {
            const pack = collectTopNRows(
              bounds,
              header,
              1,
              which === "min" ? "asc" : "desc",
              aliases,
              filters,
            );
            return {
              row: pack.rows.length ? pack.rows[0] : -1,
              label: pack.label,
              col: pack.col,
            };
          }

          function applyRules(bounds: {
            r1: number;
            r2: number;
            c1: number;
            c2: number;
          }): { painted: number; headerLabel: string } {
            let painted = 0;
            let headerLabel = "";
            for (let i = 0; i < rules.length; i++) {
              const rule = rules[i] || {};
              const match = (rule.match || {}) as Record<string, unknown>;
              const rfmt = (rule.format || {}) as Record<string, unknown>;
              const scopeMode = String(rule.applyScope || defaultScope || "row").toLowerCase();

              if (match.topN && typeof match.topN === "object") {
                const tn = match.topN as Record<string, unknown>;
                const header = String(tn.header || "");
                const n = Math.max(1, Number(tn.n) || 1);
                const order = String(tn.order || "asc").toLowerCase();
                const aliases = Array.isArray(tn.headerAliases)
                  ? (tn.headerAliases as string[])
                  : null;
                const filters = Array.isArray(tn.filters)
                  ? (tn.filters as Array<Record<string, unknown>>)
                  : null;
                const pack = collectTopNRows(bounds, header, n, order, aliases, filters);
                if (pack.label) headerLabel = pack.label;
                for (let k = 0; k < pack.rows.length; k++) {
                  if (paintRowOrCell(bounds, pack.rows[k], pack.col, scopeMode, rfmt)) {
                    painted += 1;
                  }
                }
                continue;
              }

              if (match.extreme && typeof match.extreme === "object") {
                const ex = match.extreme as Record<string, unknown>;
                const header = String(ex.header || "");
                const which = String(ex.which || "max").toLowerCase();
                const aliases = Array.isArray(ex.headerAliases)
                  ? (ex.headerAliases as string[])
                  : null;
                const filters = Array.isArray(ex.filters)
                  ? (ex.filters as Array<Record<string, unknown>>)
                  : null;
                const pack = collectExtremeRow(bounds, header, which, aliases, filters);
                if (pack.label) headerLabel = pack.label;
                if (
                  pack.row >= 1 &&
                  paintRowOrCell(bounds, pack.row, pack.col, scopeMode, rfmt)
                ) {
                  painted += 1;
                }
                continue;
              }

              const conds: Record<string, unknown>[] = Array.isArray(match.all)
                ? (match.all as Record<string, unknown>[])
                : [match];

              let focusCol = -1;
              for (let r = bounds.r1 + 1; r <= bounds.r2; r++) {
                let ok = true;
                for (let j = 0; j < conds.length; j++) {
                  const ev = evalSimpleCond(conds[j], bounds, r);
                  if (!ev.ok) {
                    ok = false;
                    break;
                  }
                  if (focusCol < 1) focusCol = ev.focusCol;
                }
                if (!ok) continue;
                if (paintRowOrCell(bounds, r, focusCol, scopeMode, rfmt)) painted += 1;
              }
            }
            return { painted, headerLabel };
          }

          function applyAutoFit(bounds: {
            r1: number;
            r2: number;
            c1: number;
            c2: number;
          }): string {
            const a0 = `${colToLetters(bounds.c1)}${bounds.r1}`;
            const a1 = `${colToLetters(bounds.c2)}${bounds.r2}`;
            const addr = bounds.c1 === bounds.c2 && bounds.r1 === bounds.r2 ? a0 : `${a0}:${a1}`;
            let viaApi = "";
            try {
              const rng = sheet.GetRange(addr) as any;
              if (rng && typeof rng.AutoFit === "function") {
                try {
                  rng.AutoFit();
                  viaApi = `autofit:${addr}`;
                } catch (_e0) {
                  try {
                    rng.AutoFit(true, false);
                    viaApi = `autofit:${addr}:cols`;
                  } catch (_e1) {
                    try {
                      rng.AutoFit(true, true);
                      viaApi = `autofit:${addr}:both`;
                    } catch (_e2) {
                      /* fall to SetColumnWidth */
                    }
                  }
                }
              }
            } catch (_e) {
              /* fall */
            }
            // Always reinforce with content-based widths — AutoFit alone is flaky on some hosts.
            let n = 0;
            for (let c = bounds.c1; c <= bounds.c2; c++) {
              let maxLen = 8;
              for (let r = bounds.r1; r <= bounds.r2; r++) {
                const len = String(cellValue(r, c) || "").trim().length;
                if (len > maxLen) maxLen = len;
              }
              // Cyrillic glyphs are wider than Latin; 1.6 keeps «Екатеринбург» visible.
              const width = Math.max(10, Math.min(48, Math.ceil(maxLen * 1.6) + 2));
              try {
                if (typeof (sheet as any).SetColumnWidth === "function") {
                  (sheet as any).SetColumnWidth(c - 1, width);
                  n += 1;
                }
              } catch (_e2) {
                /* skip */
              }
            }
            if (n) return viaApi ? `${viaApi}|colwidth:${n}` : `colwidth:${n}`;
            return viaApi || "autofit:skip";
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

          const bounds = tableBoundsFromHeader(1, 1);

          function applyHeaderFormat(): string {
            const headerAddr =
              bounds.c1 === bounds.c2
                ? `${colToLetters(bounds.c1)}${bounds.r1}`
                : `${colToLetters(bounds.c1)}${bounds.r1}:${colToLetters(bounds.c2)}${bounds.r1}`;
            const hFill = asRgb(fmt.headerFillRgb);
            const hAlign = normalizeAlign(fmt.headerAlign);
            // 1) Fill first (range + per-cell) — multi-cell SetBold often sticks only on A1.
            try {
              const header = sheet.GetRange(headerAddr) as any;
              if (hFill) applyFill(header, hFill);
            } catch (_e) {
              /* ignore */
            }
            for (let c = bounds.c1; c <= bounds.c2; c++) {
              try {
                const cell = sheet.GetRange(`${colToLetters(c)}${bounds.r1}`) as any;
                if (hFill) applyFill(cell, hFill);
              } catch (_cellErr) {
                /* skip */
              }
            }
            // 2) Bold + align last, per-cell only.
            if (fmt.headerBold === true || hAlign) {
              for (let c = bounds.c1; c <= bounds.c2; c++) {
                try {
                  const cell = sheet.GetRange(`${colToLetters(c)}${bounds.r1}`) as any;
                  if (fmt.headerBold === true && cell && typeof cell.SetBold === "function") {
                    cell.SetBold(true);
                  }
                  if (hAlign) applyAlign(cell, hAlign);
                } catch (_cellErr2) {
                  /* skip */
                }
              }
            }
            return `header:${headerAddr}`;
          }

          let rulesPainted = 0;
          let rulesHeader = "";
          if (rules.length) {
            const rr = applyRules(bounds);
            rulesPainted = rr.painted;
            rulesHeader = rr.headerLabel || "";
          }

          const formatKeys = Object.keys(fmt);
          const onlyHeaderKeys =
            formatKeys.length > 0 &&
            formatKeys.every(
              (k) => k === "headerBold" || k === "headerFillRgb" || k === "headerAlign",
            );

          // Order: borders → header fill/bold/align → autofit last.
          if (onlyHeaderKeys && !rules.length && !doAutoFit) {
            return applyHeaderFormat();
          }

          if (formatKeys.length) {
            const fmtForRange: Record<string, unknown> = { ...fmt };
            if (fmt.headerBold === true) delete fmtForRange.bold;
            // Strip header-only keys from body range format.
            delete fmtForRange.headerBold;
            delete fmtForRange.headerFillRgb;
            delete fmtForRange.headerAlign;

            if (fmt.bordersOutline || fmt.fillRgb || fmt.align != null) {
              const a0 = `${colToLetters(bounds.c1)}${bounds.r1}`;
              const a1 = `${colToLetters(bounds.c2)}${bounds.r2}`;
              const addr = `${a0}:${a1}`;
              try {
                applyFormatToRange(sheet.GetRange(addr), fmtForRange);
              } catch (_e) {
                const range = resolveRange();
                if (range) applyFormatToRange(range, fmtForRange);
              }
            } else if (!onlyHeaderKeys) {
              const range = resolveRange();
              if (range) applyFormatToRange(range, fmtForRange);
            }
          }

          if (
            fmt.headerBold === true ||
            asRgb(fmt.headerFillRgb) ||
            normalizeAlign(fmt.headerAlign)
          ) {
            applyHeaderFormat();
          }

          let autoMsg = "";
          if (doAutoFit) autoMsg = applyAutoFit(bounds);

          const parts: string[] = [];
          if (rulesPainted) parts.push(`rules:${rulesPainted}`);
          if (rulesHeader) parts.push(`hdr:${rulesHeader}`);
          if (formatKeys.length) parts.push("fmt");
          if (autoMsg) parts.push(autoMsg);
          return parts.length ? parts.join("|") : "ok";
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
