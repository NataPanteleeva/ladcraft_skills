/** @see plugins/ladcraft-r7/docs/01-transfer-rules.md */

import type { EditorType } from "../config";
import type { HistoryMessage } from "../eai/session";
import { appendSelectionContext, getSelectedText } from "./selection";
import type { EditorAttachState, FileRef, OutboundTransfer, PrepareOutboundOptions } from "./types";
import { normalizeTemplateSelection } from "./template-selection";

const DOCX_MIME =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const MD_MIME = "text/markdown";

interface PluginInfo {
  title?: string;
  documentTitle?: string;
  url?: string;
  key?: string;
  documentId?: string;
}

export interface DiskRefOutboundOptions extends PrepareOutboundOptions {}

/** Parse numeric document id from R7 editor URL or plugin info. */
export function parseDiskDocumentId(info: PluginInfo): number | null {
  const fromField = parsePositiveInt(info.documentId);
  if (fromField != null) return fromField;

  const candidates = [
    pickString(info.url),
    pickString(info.key),
    typeof window !== "undefined" ? pickString(window.location?.href) : "",
  ].filter(Boolean);

  for (let i = 0; i < candidates.length; i += 1) {
    const url = candidates[i];
    const fromQuery = url.match(/[?&]id=(\d+)/i);
    if (fromQuery) {
      const id = parsePositiveInt(fromQuery[1]);
      if (id != null) return id;
    }
    const fromPath =
      url.match(/\/docs\/(\d+)/i) ||
      url.match(/doc\.html\?id=(\d+)/i) ||
      url.match(/\/doc\.html\?[^#]*\bid=(\d+)/i);
    if (fromPath) {
      const id = parsePositiveInt(fromPath[1]);
      if (id != null) return id;
    }
  }

  return null;
}

/** Human-readable file name for disk-ref payload. */
export function parseDiskFileName(info: PluginInfo): string {
  const title = pickString(info.title) || pickString(info.documentTitle) || "document";
  if (/\.(docx|md)$/i.test(title)) return title;
  return `${title}.docx`;
}

function mimeForFileName(fileName: string): string {
  return fileName.toLowerCase().endsWith(".md") ? MD_MIME : DOCX_MIME;
}

/** Build mentioned.files entry for r7-disk-ref/v1. */
export function buildDiskFileRef(documentId: number, fileName: string): FileRef {
  return {
    file_id: `r7-disk:${documentId}`,
    file_name: fileName,
    mime_type: mimeForFileName(fileName),
  };
}

function pickString(value: unknown): string {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function parsePositiveInt(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return Math.floor(value);
  }
  if (typeof value === "string" && value.trim()) {
    const n = Number(value.trim());
    if (Number.isFinite(n) && n > 0) return Math.floor(n);
  }
  return null;
}

/**
 * disk-ref profile: no VFS upload; mentioned.files carries r7-disk:{document_id}.
 */
export async function prepareDiskRefOutbound(
  editorType: EditorType,
  userText: string,
  attachState: EditorAttachState,
  options: DiskRefOutboundOptions = {},
): Promise<OutboundTransfer> {
  void editorType;
  void attachState;

  const info = window.Asc?.plugin?.info ?? {};
  const documentId = parseDiskDocumentId(info);
  if (documentId == null) {
    throw new Error("Откройте документ с Р7-Диска (в URL должен быть id документа).");
  }

  const fileName = parseDiskFileName(info);
  const selectionText = await getSelectedText();
  const history = options.historyMessages as HistoryMessage[] | undefined;
  const outboundText = history?.length
    ? normalizeTemplateSelection(userText, history)
    : userText;
  let content = appendSelectionContext(outboundText, selectionText);

  content += "\n\n[Контекст R7: диск]\n";
  content += `document_id: ${documentId}\n`;
  content += `file_name: ${fileName}\n`;

  const fileRef = buildDiskFileRef(documentId, fileName);

  return {
    content,
    fileRefs: [fileRef],
    attachEditor: false,
    contextState: "synced",
    primaryFileId: fileRef.file_id,
    primaryFileName: fileRef.file_name,
  };
}
