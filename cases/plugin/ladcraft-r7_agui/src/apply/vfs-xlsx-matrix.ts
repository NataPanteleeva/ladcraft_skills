/** Load agent deliverable .xlsx from session VFS as a 2D matrix. */
import type { EaiClient } from "../eai/client";
import { downloadVfsFile, resolveSessionXlsxFile } from "../eai/vfs";

export const MATRIX_CELL_LIMIT = 100_000;

export type MatrixCell = string | number | boolean | null;

export interface XlsxMatrixResult {
  aoa: MatrixCell[][];
  sheetName: string;
  cellCount: number;
  fileName: string;
  vfsPath: string;
}

/** sessionId|vfsPath → parsed matrix (repeat clicks without re-download). */
const matrixCache = new Map<string, XlsxMatrixResult>();

function cacheKey(sessionId: string, vfsPath: string): string {
  return `${sessionId}::${vfsPath}`;
}

const SUMMARY_SHEET_RE =
  /^(итог|итого|kpi|топ|сводн|pivot|summary|агрегат)/i;
const DETAIL_SHEET_RE =
  /фильтр|продаж|данн|result|все_|выгруз|строк|дета/i;

type SheetBook = {
  SheetNames?: string[];
  Sheets: Record<string, { "!ref"?: string } | undefined>;
};

function sheetRowCount(wb: SheetBook, name: string): number {
  const ws = wb.Sheets[name];
  if (!ws || !ws["!ref"]) return 0;
  const m = String(ws["!ref"]).match(/:([A-Z]+)(\d+)$/i);
  return m ? Math.max(0, Number(m[2])) : 0;
}

/** Prefer full detail tables over tiny summary/KPI sheets. */
function pickSheetName(wb: SheetBook, decodeRange?: (ref: string) => { e: { r: number; c: number }; s: { r: number; c: number } }): string {
  const names = wb.SheetNames || [];
  if (!names.length) return "Sheet1";

  let best = names[0];
  let bestScore = -1e9;
  for (const name of names) {
    const lower = String(name || "").trim().toLowerCase();
    const ws = wb.Sheets[name];
    let rows = 0;
    let cols = 0;
    if (ws && ws["!ref"] && decodeRange) {
      try {
        const range = decodeRange(ws["!ref"]);
        rows = Math.max(0, range.e.r - range.s.r + 1);
        cols = Math.max(0, range.e.c - range.s.c + 1);
      } catch {
        rows = sheetRowCount(wb, name);
      }
    } else {
      rows = sheetRowCount(wb, name);
    }
    let score = rows * 10 + cols;
    if (DETAIL_SHEET_RE.test(lower)) score += 250;
    if (SUMMARY_SHEET_RE.test(lower)) score -= 400;
    if (/^(sheet|sheet\d+|лист|лист\d+)$/i.test(lower)) score -= 50;
    if (score > bestScore) {
      bestScore = score;
      best = name;
    }
  }
  return best;
}

function countCells(aoa: MatrixCell[][]): number {
  let n = 0;
  for (const row of aoa) {
    if (!row) continue;
    n += row.length;
  }
  return n;
}

/** Parse workbook bytes → preferred sheet as array-of-arrays. */
export async function matrixFromXlsxBytes(
  bytes: ArrayBuffer,
  fileName = "workbook.xlsx",
  vfsPath = "",
  preferredSheet?: string,
): Promise<XlsxMatrixResult> {
  const XLSX = await import("xlsx");
  const wb = XLSX.read(bytes, { type: "array", cellDates: true });
  const names = wb.SheetNames || [];
  let sheetName = pickSheetName(wb, (ref) => XLSX.utils.decode_range(ref));
  if (preferredSheet && names.includes(preferredSheet)) {
    sheetName = preferredSheet;
  } else if (preferredSheet) {
    const lower = preferredSheet.toLowerCase();
    const hit = names.find((n) => String(n).toLowerCase() === lower);
    if (hit) sheetName = hit;
  }
  const ws = wb.Sheets[sheetName];
  if (!ws) {
    throw new Error(`Лист «${sheetName}» не найден в ${fileName}`);
  }
  const aoa = XLSX.utils.sheet_to_json(ws, {
    header: 1,
    defval: "",
    raw: true,
    blankrows: false,
  }) as MatrixCell[][];
  const cellCount = countCells(aoa);
  if (cellCount > MATRIX_CELL_LIMIT) {
    throw new Error(
      `Слишком много ячеек (${cellCount} > ${MATRIX_CELL_LIMIT}) для вставки в редактор`,
    );
  }
  if (!aoa.length) {
    throw new Error("Лист итога пуст");
  }
  return { aoa, sheetName, cellCount, fileName, vfsPath };
}

/** Download session VFS .xlsx and return matrix (cached per path). */
export async function loadAgentXlsxMatrix(
  client: EaiClient,
  sessionId: string,
  vfsPath: string,
  options: { excludePath?: string | null; sheet?: string; fileId?: string } = {},
): Promise<XlsxMatrixResult> {
  const sheetKey = options.sheet ? `::${options.sheet}` : "";
  const key = cacheKey(sessionId, vfsPath) + sheetKey + (options.fileId ? `::${options.fileId}` : "");
  const hit = matrixCache.get(key);
  if (hit) return hit;

  let fileId = options.fileId?.trim() || "";
  let fileName = vfsPath.split("/").pop() || "workbook.xlsx";
  let resolvedPath = vfsPath;
  if (!fileId) {
    const resolved = await resolveSessionXlsxFile(client, sessionId, vfsPath, options);
    if (!resolved) {
      throw new Error("Файл не найден в session VFS");
    }
    fileId = resolved.fileId;
    fileName = resolved.fileName;
    resolvedPath = resolved.vfsPath;
  }
  const blob = await downloadVfsFile(client, fileId, "original");
  const bytes = await blob.arrayBuffer();
  const matrix = await matrixFromXlsxBytes(
    bytes,
    fileName,
    resolvedPath,
    options.sheet,
  );
  matrixCache.set(key, matrix);
  matrixCache.set(cacheKey(sessionId, resolvedPath) + sheetKey, matrix);
  return matrix;
}

/** Drop cache when session ends or path set changes. */
export function clearAgentXlsxMatrixCache(sessionId?: string): void {
  if (!sessionId) {
    matrixCache.clear();
    return;
  }
  const prefix = `${sessionId}::`;
  for (const k of [...matrixCache.keys()]) {
    if (k.startsWith(prefix)) matrixCache.delete(k);
  }
}

/** Escape and join aoa as CSV (BOM UTF-8). */
export function matrixToCsv(aoa: MatrixCell[][]): string {
  const lines = aoa.map((row) =>
    (row || [])
      .map((cell) => {
        const s = cell == null ? "" : String(cell);
        return `"${s.replace(/"/g, '""')}"`;
      })
      .join(","),
  );
  return "\ufeff" + lines.join("\n");
}

/** Sheet name from file stem, R7-safe (≤31 chars). */
export function preferredSheetNameFromFile(fileName: string): string {
  const stem = (fileName || "итог").replace(/\.xlsx$/i, "").trim() || "итог";
  const cleaned = stem.replace(/[\\/*?:\[\]]/g, "_").slice(0, 31);
  return cleaned || "итог";
}
