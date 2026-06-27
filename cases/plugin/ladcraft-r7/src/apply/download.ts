import type { EaiClient } from "../eai/client";
import { downloadVfsFile, downloadVfsText } from "../eai/vfs";
import {
  contentToPasteHtml,
  looksLikeMarkdown,
  wrapHtmlDocument,
} from "../markdown/html";
import type { DeliverableCard } from "./deliverable";
import { triggerBrowserDownload } from "./deliverable";
import type { ActionContentSource } from "./types";
import { sanitizeExportContent } from "./content-extract";

function isDocxName(fileName: string): boolean {
  return /\.docx?$/i.test(fileName);
}

function isMarkdownName(fileName: string): boolean {
  return /\.md$/i.test(fileName);
}

function defaultBaseName(source: ActionContentSource): string {
  if (source.kind === "card") {
    const name = source.card.fileName.replace(/\.[^.]+$/, "") || "отчёт";
    return name;
  }
  return source.fileName?.replace(/\.[^.]+$/, "") || "отчёт";
}

/** Download payload as markdown file. */
export async function downloadMarkdown(
  client: EaiClient,
  source: ActionContentSource,
  baseName = "отчёт",
): Promise<void> {
  const text = await resolveText(client, source);
  const name = baseName.endsWith(".md") ? baseName : `${baseName}.md`;
  triggerBrowserDownload(
    new Blob([text], { type: "text/markdown;charset=utf-8" }),
    name,
  );
}

/**
 * Download as styled HTML (opens in Word; user can Save as DOCX).
 * Local strategy — no agent call.
 */
export async function downloadAsWordHtml(
  client: EaiClient,
  source: ActionContentSource,
  baseName = "отчёт",
): Promise<void> {
  if (source.kind === "card") {
    const card = source.card;
    if (card.kind !== "inline" && card.fileId && isDocxName(card.fileName)) {
      const blob = await downloadVfsFile(client, card.fileId, "original");
      triggerBrowserDownload(blob, card.fileName.endsWith(".docx") ? card.fileName : `${card.fileName}.docx`);
      return;
    }
  }

  const text = await resolveText(client, source);
  const base = baseName.replace(/\.[^.]+$/, "") || "отчёт";
  const html = wrapHtmlDocument(contentToPasteHtml(text), base);
  triggerBrowserDownload(
    new Blob([html], { type: "text/html;charset=utf-8" }),
    `${base}.html`,
  );
}

async function resolveText(client: EaiClient, source: ActionContentSource): Promise<string> {
  let text: string;
  if (source.kind === "text") {
    text = source.text;
  } else if (source.card.kind === "inline" && source.card.content != null) {
    text = source.card.content;
  } else if (!source.card.fileId) {
    throw new Error("Нет содержимого для скачивания");
  } else if (isDocxName(source.card.fileName)) {
    throw new Error("Для DOCX используйте кнопку «Скачать для Word»");
  } else {
    text = await downloadVfsText(client, source.card.fileId, "md");
  }

  const fileName =
    source.kind === "text" ? source.fileName : source.card.fileName;
  const isCompare =
    /\.md$/i.test(fileName ?? "") || /отчёт|report|compare/i.test(fileName ?? "");
  const sanitized = sanitizeExportContent(text, isCompare);
  return sanitized || text;
}

/** Suggested download base name from payload. */
export function suggestBaseName(source: ActionContentSource): string {
  const base = defaultBaseName(source);
  if (looksLikeMarkdown(base) || isMarkdownName(base)) return base.replace(/\.md$/i, "");
  return base;
}
