/** Export active Cell sheet to .xlsx bytes (used range on active sheet). */

import { readDocumentSnapshot } from "./reader";
import { hashContent } from "../context/registry";

export async function exportCellWorkbookBytes(): Promise<Uint8Array> {
  const snapshot = await readDocumentSnapshot("cell");
  if (snapshot.type !== "cell") {
    throw new Error("Экспорт книги доступен только в Cell");
  }

  const rows: unknown[][] = [];
  for (const block of snapshot.blocks) {
    for (const line of block.lines) {
      rows.push(line as unknown[]);
    }
  }

  const XLSX = await import("xlsx");
  const ws = XLSX.utils.aoa_to_sheet(rows.length ? rows : [[""]]);
  const wb = XLSX.utils.book_new();
  const sheetName = "Sheet";
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  const out = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
  return new Uint8Array(out);
}

/** Content hash for workbook dedup (sha256:hex). */
export async function computeWorkbookContentHash(): Promise<string> {
  const bytes = await exportCellWorkbookBytes();
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  const digest = await hashContent(binary);
  return `sha256:${digest}`;
}
