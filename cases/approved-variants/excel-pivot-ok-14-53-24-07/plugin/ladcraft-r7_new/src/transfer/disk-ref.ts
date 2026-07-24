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
  api?: unknown;
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

function parseDiskIdFromEditorKey(value: unknown): number | null {
  const s = pickString(value);
  if (!s) return null;
  const suffix = s.match(/_(\d{1,12})$/);
  if (suffix) {
    return parsePositiveInt(suffix[1]);
  }
  return null;
}

function parseIdFromEditorDocumentKey(info: PluginInfo): { id: number | null; source: string } {
  const candidates: Array<[string, unknown]> = [
    ["info.documentId", info.documentId],
    ["info.key", info.key],
  ];
  for (let i = 0; i < candidates.length; i += 1) {
    const id = parseDiskIdFromEditorKey(candidates[i][1]);
    if (id != null) {
      return { id, source: candidates[i][0] + ".diskSuffix" };
    }
  }
  return { id: null, source: "" };
}

function isLikelyDiskDocumentId(value: unknown): number | null {
  const s = pickString(value);
  if (!s) return null;
  if (/^[0-9a-f]{12,}$/i.test(s.replace(/-/g, ""))) return null;
  const n = parsePositiveInt(value);
  if (n == null || n > 999999999) return null;
  return n;
}

function parseIdFromPluginInfoUrls(info: PluginInfo): { id: number | null; source: string } {
  const callbackUrl = pickString(info.documentCallbackUrl);
  if (callbackUrl) {
    const fromCallback = parseIdFromUrl(callbackUrl);
    if (fromCallback != null) {
      return { id: fromCallback, source: "info.documentCallbackUrl" };
    }
  }

  const referrer = typeof document !== "undefined" ? pickString(document.referrer) : "";
  if (referrer) {
    const fromReferrer = parseIdFromUrl(referrer);
    if (fromReferrer != null) {
      return { id: fromReferrer, source: "document.referrer" };
    }
  }

  const infoUrl = pickString(info.url);
  if (infoUrl) {
    const fromInfoUrl = parseIdFromUrl(infoUrl);
    if (fromInfoUrl != null) {
      return { id: fromInfoUrl, source: "info.url" };
    }
  }

  return { id: null, source: "" };
}

function parseIdFromDocumentIdField(info: PluginInfo): { id: number | null; source: string } {
  const raw = info.documentId;
  if (raw == null || raw === "") return { id: null, source: "" };

  if (typeof raw === "string") {
    const fromUrl = parseIdFromUrl(raw);
    if (fromUrl != null) return { id: fromUrl, source: "info.documentId.url" };
  }

  const fromNum = isLikelyDiskDocumentId(raw);
  if (fromNum != null) return { id: fromNum, source: "info.documentId" };

  return { id: null, source: "" };
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
    const id = isLikelyDiskDocumentId(candidate);
    if (id != null && !found.includes(id)) found.push(id);
  };

  const isDocIdKey = (key: string): boolean =>
    /^(documentId|document_id|docId|doc_id|fileId|file_id)$/i.test(key);

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

export const DISK_DOC_ID_STORAGE_KEY = "ladcraft_r7_disk_doc_id";
export const DISK_DOC_ID_CONTEXT_KEY = "ladcraft_r7_disk_doc_context";
export const DISK_DOC_ID_OVERRIDE_KEY = "ladcraft_r7_disk_document_id_override";

type DiskIdTier = 1 | 2 | 3 | 4 | 5 | 6;

interface DiskIdCandidate {
  id: number;
  source: string;
  tier: DiskIdTier;
}

interface DiskIdResolution {
  id: number | null;
  source: string;
  urlId: number | null;
  diskSuffixId: number | null;
}

function isHighPriorityDiskUrl(url: string): boolean {
  return /doc\.html/i.test(url) || /Documents\/Download/i.test(url);
}

function editorContextFingerprint(info: PluginInfo): string {
  return [pickString(info.documentId), pickString(info.key)].join("|");
}

function readCachedDiskDocumentId(info?: PluginInfo): number | null {
  if (typeof sessionStorage === "undefined") return null;
  try {
    if (info) {
      const context = sessionStorage.getItem(DISK_DOC_ID_CONTEXT_KEY);
      if (context !== editorContextFingerprint(info)) return null;
    }
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

function storeDiskDocumentId(id: number, contextKey: string): void {
  if (typeof sessionStorage === "undefined") return;
  try {
    sessionStorage.setItem(DISK_DOC_ID_STORAGE_KEY, String(id));
    sessionStorage.setItem(DISK_DOC_ID_CONTEXT_KEY, contextKey);
  } catch {
    /* ignore */
  }
}

function collectDiskDocumentIdCandidates(info: PluginInfo): DiskIdCandidate[] {
  const list: DiskIdCandidate[] = [];
  const bestTierById = new Map<number, DiskIdTier>();

  const add = (id: number | null, source: string, tier: DiskIdTier): void => {
    if (id == null) return;
    const prev = bestTierById.get(id);
    if (prev != null && prev <= tier) return;
    bestTierById.set(id, tier);
    const idx = list.findIndex((c) => c.id === id);
    if (idx >= 0) list.splice(idx, 1);
    list.push({ id, source, tier });
  };

  for (const url of collectBrowserLocationHints()) {
    const id = parseIdFromUrl(url);
    if (id == null) continue;
    const tier: DiskIdTier = isHighPriorityDiskUrl(url) ? 1 : 2;
    add(id, "url:" + truncateHint(url), tier);
  }

  const fromPluginUrls = parseIdFromPluginInfoUrls(info);
  if (fromPluginUrls.id != null) {
    add(fromPluginUrls.id, fromPluginUrls.source, 2);
  }

  const fromDocIdField = parseIdFromDocumentIdField(info);
  if (fromDocIdField.id != null) {
    add(fromDocIdField.id, fromDocIdField.source, 3);
  }

  for (const id of collectDeepIdCandidates(info.externalData)) {
    add(id, "info.externalData", 4);
  }
  for (const id of collectDeepIdCandidates(info.referenceData)) {
    add(id, "info.referenceData", 4);
  }

  const jwtPayload = info.jwt ? decodeJwtPayload(info.jwt) : null;
  if (jwtPayload != null) {
    for (const id of collectDeepIdCandidates(jwtPayload)) {
      add(id, "info.jwt", 4);
    }
  }

  const pluginUrlHints = collectPluginInfoHints(info);
  for (let i = 0; i < pluginUrlHints.length; i += 1) {
    const id = parseIdFromUrl(pluginUrlHints[i]);
    if (id != null) add(id, "url:" + truncateHint(pluginUrlHints[i]), 2);
  }

  const fromEditorKey = parseIdFromEditorDocumentKey(info);
  if (fromEditorKey.id != null) {
    add(fromEditorKey.id, fromEditorKey.source, 5);
  }

  const keyStr = pickString(info.key);
  if (/^\d{1,12}$/.test(keyStr)) {
    const fromKey = parsePositiveInt(keyStr);
    if (fromKey != null) add(fromKey, "info.key", 5);
  }

  return list;
}

function pickBestDiskIdCandidate(candidates: DiskIdCandidate[]): DiskIdResolution {
  if (!candidates.length) {
    return { id: null, source: "none", urlId: null, diskSuffixId: null };
  }

  const sorted = candidates.slice().sort((a, b) => a.tier - b.tier);
  const best = sorted[0];
  const urlId =
    candidates.find((c) => c.tier <= 2 && c.source.startsWith("url:"))?.id ??
    candidates.find((c) => c.tier <= 2)?.id ??
    null;
  const diskSuffixId =
    candidates.find((c) => c.source.includes("diskSuffix"))?.id ?? null;

  return {
    id: best.id,
    source: best.source,
    urlId,
    diskSuffixId,
  };
}

function readPluginInfo(): PluginInfo {
  if (typeof window === "undefined") return {};
  const raw = (window.Asc?.plugin?.info ?? {}) as PluginInfo & Record<string, unknown>;
  const info: PluginInfo = { ...raw };

  const api = raw.api;
  if (api && typeof api === "object") {
    const apiObj = api as Record<string, unknown>;
    if (info.documentId == null && apiObj.documentId != null) {
      info.documentId = apiObj.documentId as string | number;
    }
    if (!info.documentCallbackUrl && pickString(apiObj.documentCallbackUrl)) {
      info.documentCallbackUrl = pickString(apiObj.documentCallbackUrl);
    }
    if (!info.jwt && pickString(apiObj.jwt)) {
      info.jwt = pickString(apiObj.jwt);
    }
    if (info.externalData == null && apiObj.externalData != null) {
      info.externalData = apiObj.externalData;
    }
  }

  return info;
}

/** Try to read doc id from plugin.info, parent URLs and JWT; cache for later parse. */
export function captureDiskDocumentIdFromEnvironment(): number | null {
  const info = readPluginInfo();
  const contextKey = editorContextFingerprint(info);
  const resolved = parseDiskDocumentIdWithSource(info);
  if (resolved.id != null) {
    storeDiskDocumentId(resolved.id, contextKey);
    return resolved.id;
  }
  return readCachedDiskDocumentId(info);
}

function parseDiskDocumentIdWithSource(info: PluginInfo): DiskIdResolution {
  const picked = pickBestDiskIdCandidate(collectDiskDocumentIdCandidates(info));
  if (picked.id != null) return picked;

  const override = readOverrideDiskDocumentId();
  if (override != null) {
    return {
      id: override,
      source: "localStorage.override",
      urlId: null,
      diskSuffixId: null,
    };
  }

  const cached = readCachedDiskDocumentId(info);
  if (cached != null) {
    return {
      id: cached,
      source: "sessionStorage.cache",
      urlId: null,
      diskSuffixId: null,
    };
  }

  return { id: null, source: "none", urlId: null, diskSuffixId: null };
}

function truncateHint(value: string): string {
  const s = pickString(value);
  if (s.length <= 48) return s;
  return s.slice(0, 24) + "…" + s.slice(-16);
}

function parseDiskDocumentIdFromSources(info: PluginInfo): number | null {
  return parseDiskDocumentIdWithSource(info).id;
}

export interface DiskRefDebugInfo {
  documentId: number | null;
  source: string;
  fileName: string;
  infoKeys: string[];
  overrideActive: boolean;
  cachedId: number | null;
  referrerHint: string;
  callbackHint: string;
  rawDocumentIdHint: string;
  suffixHint: string;
  urlIdHint: string;
  conflictHint: string;
}

/** Diagnostic line for chat UI — no secrets (jwt/password omitted). */
export function getDiskRefDebugInfo(): DiskRefDebugInfo {
  const info = readPluginInfo();
  const resolved = parseDiskDocumentIdWithSource(info);
  const suffixId = parseDiskIdFromEditorKey(pickString(info.documentId));
  const urlId = resolved.urlId;
  const conflictHint =
    urlId != null &&
    suffixId != null &&
    urlId !== suffixId &&
    resolved.id === urlId
      ? `chosen url over diskSuffix`
      : "";
  return {
    documentId: resolved.id,
    source: resolved.source,
    fileName: parseDiskFileName(info),
    infoKeys: Object.keys(info).filter((key) => {
      if (key === "jwt") return Boolean(pickString(info.jwt));
      const value = (info as Record<string, unknown>)[key];
      return value != null && value !== "";
    }),
    overrideActive: readOverrideDiskDocumentId() != null,
    cachedId: readCachedDiskDocumentId(info),
    referrerHint: truncateHint(
      typeof document !== "undefined" ? pickString(document.referrer) : ""
    ),
    callbackHint: truncateHint(pickString(info.documentCallbackUrl)),
    rawDocumentIdHint: truncateHint(pickString(info.documentId)),
    suffixHint: suffixId != null ? `diskSuffix=${suffixId}` : "diskSuffix=—",
    urlIdHint: urlId != null ? `urlId=${urlId}` : "urlId=—",
    conflictHint,
  };
}

export function formatDiskRefDebugLine(debug: DiskRefDebugInfo): string {
  const idPart =
    debug.documentId != null
      ? `id=${debug.documentId} (${debug.source})`
      : "id не найден";
  const keys = debug.infoKeys.length ? debug.infoKeys.join(", ") : "—";
  const override = debug.overrideActive ? " · override" : "";
  const hints = [
    debug.urlIdHint,
    debug.suffixHint,
    debug.conflictHint,
    debug.referrerHint ? `referrer=${debug.referrerHint}` : "",
    debug.callbackHint ? `callback=${debug.callbackHint}` : "",
    debug.rawDocumentIdHint ? `info.documentId=${debug.rawDocumentIdHint}` : "",
  ]
    .filter(Boolean)
    .join(" · ");
  return `Диск: ${idPart} · ${hints || "нет URL-подсказок"} · поля: ${keys}${override}`;
}

/** Parse numeric document id from R7 editor URL or plugin info. */
export function parseDiskDocumentId(info: PluginInfo): number | null {
  const contextKey = editorContextFingerprint(info);
  const id = parseDiskDocumentIdFromSources(info);
  if (id != null) storeDiskDocumentId(id, contextKey);
  return id;
}

const DISK_REF_PRESERVE_EXTENSION_RE =
  /\.(docx|md|csv|xlsx|xls|ods|txt|json|xml|pdf|pptx)$/i;

function hasKnownDiskFileExtension(fileName: string): boolean {
  return DISK_REF_PRESERVE_EXTENSION_RE.test(fileName.trim());
}

/** Human-readable file name for disk-ref payload. */
export function parseDiskFileName(info: PluginInfo): string {
  const title = pickString(info.title) || pickString(info.documentTitle) || "document";
  if (hasKnownDiskFileExtension(title)) return title;
  return `${title}.docx`;
}

const CSV_MIME = "text/csv";
const XLSX_MIME =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const XLS_MIME = "application/vnd.ms-excel";

function mimeForFileName(fileName: string): string {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".md")) return MD_MIME;
  if (lower.endsWith(".csv")) return CSV_MIME;
  if (lower.endsWith(".xlsx")) return XLSX_MIME;
  if (lower.endsWith(".xls") || lower.endsWith(".ods")) return XLS_MIME;
  return DOCX_MIME;
}

/** Build mentioned.files entry for r7-disk-ref/v1. */
export function buildDiskFileRef(documentId: number, fileName: string): FileRef {
  return {
    file_id: `r7-disk:${documentId}`,
    file_name: fileName,
    mime_type: mimeForFileName(fileName),
  };
}

const MISSING_DOC_ID_ERROR =
  "Не удалось определить id документа на Р7-Диске. Откройте файл с диска и нажмите «Обновить контекст».";

/** Resolve disk-ref context; throws if document id is missing. */
export function resolveDiskRefContext(info: PluginInfo): {
  documentId: number;
  fileName: string;
  fileId: string;
  status: string;
} {
  captureDiskDocumentIdFromEnvironment();
  const documentId = parseDiskDocumentId(info);
  if (documentId == null) {
    throw new Error(MISSING_DOC_ID_ERROR);
  }
  const fileName = parseDiskFileName(info);
  return {
    documentId,
    fileName,
    fileId: `r7-disk:${documentId}`,
    status: `Документ на диске (id=${documentId}, «${fileName}»)`,
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

  const ctx = resolveDiskRefContext(readPluginInfo());
  const { documentId, fileName } = ctx;

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
