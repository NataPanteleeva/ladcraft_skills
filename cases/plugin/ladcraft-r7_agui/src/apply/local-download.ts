/** Local file download for LCA action bar (no agent / VFS). */
import { contentToPasteHtml, wrapHtmlDocument } from "../markdown/html";

/** Trigger browser file download from a Blob. */
export function triggerBrowserDownload(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}

/** Download plain/markdown text as .md */
export function downloadTextAsMarkdown(text: string, baseName = "черновик"): void {
  const base = (baseName || "черновик").replace(/\.[^.]+$/, "") || "черновик";
  triggerBrowserDownload(
    new Blob([text], { type: "text/markdown;charset=utf-8" }),
    `${base}.md`,
  );
}

/** Download markdown as Word-openable .html (local, no agent). */
export function downloadTextAsWordHtml(text: string, baseName = "черновик"): void {
  const base = (baseName || "черновик").replace(/\.[^.]+$/, "") || "черновик";
  const html = wrapHtmlDocument(contentToPasteHtml(text), base);
  triggerBrowserDownload(
    new Blob([html], { type: "text/html;charset=utf-8" }),
    `${base}.html`,
  );
}

/** Naive markdown pipe-table → CSV (preview export). */
export function downloadTextAsCsv(text: string, baseName = "таблица"): void {
  const base = (baseName || "таблица").replace(/\.[^.]+$/, "") || "таблица";
  const lines = text.split(/\r?\n/);
  const rows: string[][] = [];
  for (const line of lines) {
    const t = line.trim();
    if (!t.startsWith("|") || !t.includes("|")) continue;
    if (/^\|[\s\-:|]+\|$/.test(t)) continue;
    const cells = t
      .slice(1, t.endsWith("|") ? -1 : undefined)
      .split("|")
      .map((c) => c.trim().replace(/"/g, '""'));
    rows.push(cells);
  }
  const body =
    rows.length > 0
      ? rows.map((r) => r.map((c) => `"${c}"`).join(",")).join("\n")
      : text.replace(/\t/g, ",");
  triggerBrowserDownload(
    new Blob(["\ufeff" + body], { type: "text/csv;charset=utf-8" }),
    `${base}.csv`,
  );
}

export function downloadBlob(blob: Blob, fileName: string): void {
  triggerBrowserDownload(blob, fileName);
}
