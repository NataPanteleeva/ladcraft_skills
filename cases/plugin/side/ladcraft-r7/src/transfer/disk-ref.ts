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
  documentId?: string | number;
  documentCallbackUrl?: string;
  jwt?: string;
  externalData?: unknown;
  referenceData?: unknown;
}

export interface DiskRefOutboundOptions extends PrepareOutboundOptions {}

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

function safeWindowHref(win: Window | null | undefined): string {
  if (!win) return "";
  try {
    return pickString(win.location?.href);
  } catch {
    return "";
  }
}

/** Browser locations where R7 keeps doc.html?id= (plugin iframe often differs). */
function collectBrowserLocationHints(): string[] {
  if (typeof window === "undefined") return [];
  const hints: string[] = [];
  const push = (value: string) => {
    if (value && !hints.includes(value)) hints.push(value);
  };

  push(safeWindowHref(window));
  push(pickString(document.referrer));

  try {
    push(safeWindowHref(window.top));
  } catch {
    /* cross-origin */
  }
  try {
    push(safeWindowHref(window.opener));
  } catch {
    /* cross-origin */
  }

  const seen = new Set<Window>();
  let frame: Window | null = window;
  for (let depth = 0; frame && depth < 12; depth += 1) {
    if (seen.has(frame)) break;
    seen.add(frame);
    push(safeWindowHref(frame));
    try {
      const parent: Window = frame.parent;
      if (!parent || parent === frame) break;
      frame = parent;
    } catch {
      break;
    }
  }

  return hints;
}

function parseIdFromUrl(url: string): number | null {
  if (!url) return null;

  let decoded = url;
  try {
    decoded = decodeURIComponent(url);
  } catch {
    decoded = url;
  }

  const patterns = [
    /[?&#](?:id|fileid|file_id|docid|doc_id|documentid|document_id)=(\d+)/i,
    /doc\.html[^#?]*[?&#][^#]*\bid=(\d+)/i,
    /\/docs\/(\d+)(?:[/?#]|$)/i,
    /\/documents\/(\d+)(?:[/?#]|$)/i,
    /\/document\/(\d+)(?:[/?#]|$)/i,
    /\/file\/(\d+)(?:[/?#]|$)/i,
    /\/files\/(\d+)(?:[/?#]|$)/i,
    /\/edit\/(\d+)(?:[/?#]|$)/i,
    /\/editor\/(\d+)(?:[/?#]|$)/i,
    /#\/(?:doc|document|file)[/?](\d+)/i,
    /Products\/Files\/[^?#]*[?&][^=]*=(\d+)/i,
    /Documents\/Download[^?#]*[?&]id=(\d+)/i,
  ];

  for (const haystack of [url, decoded]) {
    for (let i = 0; i < patterns.length; i += 1) {
      const match = haystack.match(patterns[i]);
      if (match) {
        const id = parsePositiveInt(match[1]);
        if (id != null) return id;
      }
    }
  }

  return null;
}

function decodeJwtPayload(token: string): unknown | null {
  const parts = pickString(token).split(".");
  if (parts.length < 2) return null;
  try {
    const base64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
    return JSON.parse(atob(padded));
  } catch {
    return null;
  }
}

function collectDeepIdCandidates(value: unknown, depth = 0): number[] {
  if (depth > 5 || value == null) return [];
  const found: number[] = [];
  const pushId = (candidate: unknown) => {
    const id = parsePositiveInt(candidate);
    if (id != null && !found.includes(id)) found.push(id);
  };

  const isDocIdKey = (key: string): boolean =>
    /^(documentId|document_id|docId|doc_id|fileId|file_id|directoryId|directory_id)$/i.test(key);

  if (typeof value === "string" || typeof value === "number") {
    pushId(value);
    const fromUrl = parseIdFromUrl(String(value));
    if (fromUrl != null && !found.includes(fromUrl)) found.push(fromUrl);
    return found;
  }

  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i += 1) {
      found.push(...collectDeepIdCandidates(value[i], depth + 1));
    }
    return found;
  }

  if (typeof value === "object") {
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if (isDocIdKey(key)) {
        pushId(child);
      }
      if (typeof child === "string" && (child.includes("://") || child.includes("id="))) {
        const fromUrl = parseIdFromUrl(child);
        if (fromUrl != null && !found.includes(fromUrl)) found.push(fromUrl);
      }
      found.push(...collectDeepIdCandidates(child, depth + 1));
    }
  }

  return found;
}

function collectPluginInfoHints(info: PluginInfo): string[] {
  const hints: string[] = [];
  const push = (value: unknown) => {
    const s = pickString(value);
    if (s && !hints.includes(s)) hints.push(s);
  };

  push(info.url);
  push(info.key);
  push(info.documentCallbackUrl);
  push(info.documentId);
  push(info.documentTitle);
  push(info.title);

  const jwtPayload = info.jwt ? decodeJwtPayload(info.jwt) : null;
  if (jwtPayload != null) {
    push(JSON.stringify(jwtPayload));
    for (const id of collectDeepIdCandidates(jwtPayload)) {
      push(String(id));
    }
  }

  for (const id of collectDeepIdCandidates(info.externalData)) {
    push(String(id));
  }
  for (const id of collectDeepIdCandidates(info.referenceData)) {
    push(String(id));
  }

  return hints;
}

function collectUrlCandidates(info: PluginInfo): string[] {
  const hints: string[] = [];
  const push = (value: unknown) => {
    const s = pickString(value);
    if (s && !hints.includes(s)) hints.push(s);
  };

  const pluginHints = collectPluginInfoHints(info);
  for (let i = 0; i < pluginHints.length; i += 1) {
    push(pluginHints[i]);
  }

  const locations = collectBrowserLocationHints();
  for (let i = 0; i < locations.length; i += 1) {
    push(locations[i]);
  }

  return hints;
}

export const DISK_DOC_ID_STORAGE_KEY = "ladcraft_r7_disk_doc_id";
export const DISK_DOC_ID_OVERRIDE_KEY = "ladcraft_r7_disk_document_id_override";

function readCachedDiskDocumentId(): number | null {
  if (typeof sessionStorage === "undefined") return null;
  try {
    return parsePositiveInt(sessionStorage.getItem(DISK_DOC_ID_STORAGE_KEY));
  } catch {
    return null;
  }
}

function readOverrideDiskDocumentId(): number | null {
  if (typeof localStorage === "undefined") return null;
  try {
    return parsePositiveInt(localStorage.getItem(DISK_DOC_ID_OVERRIDE_KEY));
  } catch {
    return null;
  }
}

function storeDiskDocumentId(id: number): void {
  if (typeof sessionStorage === "undefined") return;
  try {
    sessionStorage.setItem(DISK_DOC_ID_STORAGE_KEY, String(id));
  } catch {
    /* ignore */
  }
}

function readPluginInfo(): PluginInfo {
  if (typeof window === "undefined") return {};
  return (window.Asc?.plugin?.info ?? {}) as PluginInfo;
}

/** Try to read doc id from plugin.info, parent URLs and JWT; cache for later parse. */
export function captureDiskDocumentIdFromEnvironment(): number | null {
  const id = parseDiskDocumentIdFromSources(readPluginInfo());
  if (id != null) {
    storeDiskDocumentId(id);
    return id;
  }
  return readCachedDiskDocumentId();
}

function parseDiskDocumentIdFromSources(info: PluginInfo): number | null {
  const fromField = parsePositiveInt(info.documentId);
  if (fromField != null) return fromField;

  for (const id of collectDeepIdCandidates(info.externalData)) {
    if (id != null) return id;
  }
  for (const id of collectDeepIdCandidates(info.referenceData)) {
    if (id != null) return id;
  }

  const jwtPayload = info.jwt ? decodeJwtPayload(info.jwt) : null;
  if (jwtPayload != null) {
    for (const id of collectDeepIdCandidates(jwtPayload)) {
      if (id != null) return id;
    }
  }

  const candidates = collectUrlCandidates(info);
  for (let i = 0; i < candidates.length; i += 1) {
    const id = parseIdFromUrl(candidates[i]);
    if (id != null) return id;
  }

  const keyStr = pickString(info.key);
  if (/^\d{1,12}$/.test(keyStr)) {
    const fromKey = parsePositiveInt(keyStr);
    if (fromKey != null) return fromKey;
  }

  const override = readOverrideDiskDocumentId();
  if (override != null) return override;

  return readCachedDiskDocumentId();
}

/** Parse numeric document id from R7 editor URL or plugin info. */
export function parseDiskDocumentId(info: PluginInfo): number | null {
  const id = parseDiskDocumentIdFromSources(info);
  if (id != null) storeDiskDocumentId(id);
  return id;
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

  captureDiskDocumentIdFromEnvironment();
  const info = readPluginInfo();
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
