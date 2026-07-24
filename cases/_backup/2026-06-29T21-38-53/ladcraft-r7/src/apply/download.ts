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

/** True when source is a VFS deliver_file card or inline base64 DOCX. */
export function isDocxDownloadSource(source: ActionContentSource): boolean {
  if (source.kind === "base64") return true;
  if (source.kind !== "card") return false;
  const card = source.card;
  if (card.kind === "inline") return false;
  return Boolean(card.fileId) && (isDocxName(card.fileName) || Boolean(card.mimeType?.includes("wordprocessingml")));
}

function defaultBaseName(source: ActionContentSource): string {
  if (source.kind === "base64") {
    return source.fileName.replace(/\.[^.]+$/, "") || "отчёт";
  }
  if (source.kind === "card") {
    const name = source.card.fileName.replace(/\.[^.]+$/, "") || "отчёт";
    return name;
  }
  return source.fileName?.replace(/\.[^.]+$/, "") || "отчёт";
}

/** Download native .docx from VFS deliver_file (scenario A) or inline base64 (scenario B). */
export async function downloadDocx(
  client: EaiClient,
  source: ActionContentSource,
  baseName = "отчёт",
): Promise<void> {
  if (source.kind === "base64") {
    const binary = atob(source.base64.replace(/\s/g, ""));
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    const blob = new Blob([bytes], {
      type:
        source.mimeType ??
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    });
    triggerBrowserDownload(blob, source.fileName);
    return;
  }

  if (source.kind !== "card" || !isDocxDownloadSource(source)) {
    throw new Error("Нет DOCX для скачивания — дождитесь ответа агента с deliver_file");
  }
  const card = source.card;
  const blob = await downloadVfsFile(client, card.fileId!, "original");
  const fromCard = card.fileName?.trim();
  const name =
    fromCard && isDocxName(fromCard)
      ? fromCard
      : `${baseName.replace(/\.[^.]+$/, "") || "отчёт"}.docx`;
  triggerBrowserDownload(blob, name.endsWith(".docx") ? name : `${name}.docx`);
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
  if (isDocxDownloadSource(source)) {
    await downloadDocx(client, source, baseName);
    return;
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
  if (source.kind === "base64") {
    throw new Error("Для DOCX используйте кнопку «Скачать .docx»");
  }
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
