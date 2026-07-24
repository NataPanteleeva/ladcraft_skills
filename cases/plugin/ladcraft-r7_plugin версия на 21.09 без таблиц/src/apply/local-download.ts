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
