/** @see plugins/ladcraft-r7/docs/01-transfer-rules.md */

import type { EaiClient } from "./client";
import { SNAPSHOT_SCHEMA, extractTextFromVfsJson } from "../transfer/snapshot";

const MIN_R7_BODY_CHARS = 100;

const VFS_UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Ladcraft opaque file ids e.g. IOxx_BMNiLVL8PtFqtoZx */
const VFS_OPAQUE_ID_RE = /^[A-Za-z0-9_-]{12,64}$/;

/** True when value looks like a Ladcraft VFS file id (UUID or opaque token). */
export function isValidVfsFileId(fileId: string | undefined | null): fileId is string {
  if (!fileId?.trim()) return false;
  const id = fileId.trim();
  if (id.includes("<") || id.includes(">")) return false;
  return VFS_UUID_RE.test(id) || VFS_OPAQUE_ID_RE.test(id);
}

export interface VfsUploadResult {
  file_id: string;
  file_path?: string;
  parsing_status?: "processing" | "complete" | "error";
  parsing_error?: string | null;
}

export interface VfsFileMeta {
  file_id: string;
  parsing_status?: "processing" | "complete" | "error";
  content?: string;
  file_name?: string;
  mime_type?: string;
  size_bytes?: number;
  file_path?: string;
}

export type VfsScope = "space" | "user" | "workspace" | "session";

export interface VfsUploadOptions {
  scope?: VfsScope;
  sessionId?: string;
  workspaceId?: string;
  /** Wait until file is mounted in VFS before returning (session uploads). */
  sync?: boolean;
  /**
   * Full destination path within the scope (e.g. `/r7/{sessionSeg}/{fileName}`).
   * Defaults to `/r7/${fileName}` for legacy callers.
   */
  path?: string;
}

export interface VfsDeleteOptions {
  scope: VfsScope;
  path: string;
  sessionId?: string;
  workspaceId?: string;
}

/** True when upload/update failed because the VFS path is already taken. */
export function isVfsPathConflictError(err: unknown): boolean {
  const message = (err instanceof Error ? err.message : String(err)).toLowerCase();
  if (message.includes("занят")) return true;
  if (message.includes("occupied")) return true;
  if (message.includes("already exists")) return true;
  if (message.includes("path already")) return true;
  if (message.includes("целевой путь")) return true;
  return false;
}

/**
 * Delete a file or folder at path (DELETE /v1/agent/vfs/folders — no body).
 * Best-effort: returns false on not-found / soft failures without throwing.
 */
export async function deleteVfsPath(
  client: EaiClient,
  options: VfsDeleteOptions,
): Promise<boolean> {
  const path = options.path.trim();
  if (!path) return false;
  const params = new URLSearchParams({ scope: options.scope, path });
  if (options.scope === "session" && options.sessionId) {
    params.set("session_id", options.sessionId);
  }
  if (options.workspaceId) {
    params.set("workspace_id", options.workspaceId);
  }
  try {
    await client.request(`/v1/agent/vfs/folders?${params.toString()}`, {
      method: "DELETE",
    });
    return true;
  } catch (err) {
    if (isVfsNotFoundError(err)) return false;
    console.warn("[ladcraft-r7_new] deleteVfsPath failed", err);
    return false;
  }
}

/** Upload document snapshot as JSON (user VFS by default — stable across sessions). */
export async function uploadDocumentContext(
  client: EaiClient,
  fileName: string,
  content: string,
  options: VfsUploadOptions = {},
): Promise<VfsUploadResult> {
  const scope = options.scope ?? "user";
  const destPath = (options.path?.trim() || `/r7/${fileName}`).replace(/\/{2,}/g, "/");
  const form = new FormData();
  const blob = new Blob([content], { type: "application/json" });
  form.append("file", blob, fileName);
  form.append("path", destPath);
  form.append("scope", scope);
  if (options.workspaceId) form.append("workspace_id", options.workspaceId);
  if (scope === "session" && options.sessionId) {
    form.append("session_id", options.sessionId);
  }
  if (options.sync) {
    form.append("sync", "true");
  }
  return client.request<VfsUploadResult>("/v1/agent/vfs/upload", {
    method: "POST",
    formData: form,
  });
}

const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/** Upload workbook binary (.xlsx) to session VFS. */
export async function uploadWorkbookContext(
  client: EaiClient,
  fileName: string,
  bytes: Uint8Array,
  options: VfsUploadOptions = {},
): Promise<VfsUploadResult> {
  const scope = options.scope ?? "user";
  const destPath = (options.path?.trim() || `/r7/${fileName}`).replace(/\/{2,}/g, "/");
  const form = new FormData();
  const blob = new Blob([Uint8Array.from(bytes)], { type: XLSX_MIME });
  form.append("file", blob, fileName);
  form.append("path", destPath);
  form.append("scope", scope);
  if (options.workspaceId) form.append("workspace_id", options.workspaceId);
  if (scope === "session" && options.sessionId) {
    form.append("session_id", options.sessionId);
  }
  if (options.sync) {
    form.append("sync", "true");
  }
  return client.request<VfsUploadResult>("/v1/agent/vfs/upload", {
    method: "POST",
    formData: form,
  });
}

/**
 * Upload workbook with best-effort delete of target path, then one retry on path conflict.
 */
export async function uploadWorkbookContextWithRecovery(
  client: EaiClient,
  fileName: string,
  bytes: Uint8Array,
  options: VfsUploadOptions = {},
): Promise<VfsUploadResult> {
  const scope = options.scope ?? "user";
  const destPath = (options.path?.trim() || `/r7/${fileName}`).replace(/\/{2,}/g, "/");
  await deleteVfsPath(client, {
    scope,
    path: destPath,
    sessionId: options.sessionId,
    workspaceId: options.workspaceId,
  });
  try {
    return await uploadWorkbookContext(client, fileName, bytes, {
      ...options,
      path: destPath,
    });
  } catch (err) {
    if (!isVfsPathConflictError(err)) throw err;
    await deleteVfsPath(client, {
      scope,
      path: destPath,
      sessionId: options.sessionId,
      workspaceId: options.workspaceId,
    });
    return uploadWorkbookContext(client, fileName, bytes, {
      ...options,
      path: destPath,
    });
  }
}

/**
 * Upload with best-effort delete of target path, then one retry on path conflict.
 */
export async function uploadDocumentContextWithRecovery(
  client: EaiClient,
  fileName: string,
  content: string,
  options: VfsUploadOptions = {},
): Promise<VfsUploadResult> {
  const scope = options.scope ?? "user";
  const destPath = (options.path?.trim() || `/r7/${fileName}`).replace(/\/{2,}/g, "/");
  await deleteVfsPath(client, {
    scope,
    path: destPath,
    sessionId: options.sessionId,
    workspaceId: options.workspaceId,
  });
  try {
    return await uploadDocumentContext(client, fileName, content, {
      ...options,
      path: destPath,
    });
  } catch (err) {
    if (!isVfsPathConflictError(err)) throw err;
    await deleteVfsPath(client, {
      scope,
      path: destPath,
      sessionId: options.sessionId,
      workspaceId: options.workspaceId,
    });
    return uploadDocumentContext(client, fileName, content, {
      ...options,
      path: destPath,
    });
  }
}

/** Update existing VFS file content. */
export async function updateDocumentContext(
  client: EaiClient,
  fileId: string,
  content: string,
  path?: string,
): Promise<{ file_id: string; updated_at?: string }> {
  const body: Record<string, unknown> = { content };
  if (path) body.path = path;
  return client.request(`/v1/agent/vfs/files/${fileId}`, {
    method: "PUT",
    body,
  });
}

/** Fetch VFS file metadata and optional content. */
export async function getVfsFile(client: EaiClient, fileId: string): Promise<VfsFileMeta> {
  return client.request<VfsFileMeta>(`/v1/agent/vfs/files/${fileId}`);
}

/** Returns null when the file id is missing on the server (stale local cache). */
export async function getVfsFileIfExists(
  client: EaiClient,
  fileId: string,
): Promise<VfsFileMeta | null> {
  try {
    return await getVfsFile(client, fileId);
  } catch (err) {
    if (isVfsNotFoundError(err)) return null;
    throw err;
  }
}

/** True when API reports that a VFS file id no longer exists or cannot be attached. */
export function isVfsNotFoundError(err: unknown): boolean {
  const message = (err instanceof Error ? err.message : String(err)).toLowerCase();
  if (message.includes("файл не найден")) return true;
  if (message.includes("file not found")) return true;
  if (message.includes("загрузить файл")) return true;
  if (message.includes("vfs") && message.includes("not found")) return true;
  if (message.includes("404") && (message.includes("vfs") || message.includes("файл"))) {
    return true;
  }
  return false;
}

/**
 * File exists and is attachable. "processing" is OK for r7-snapshot JSON —
 * skills read body.text via download original; waiting for platform parse
 * can hang for minutes and then surface as Failed to fetch.
 */
export async function isVfsFileReady(
  client: EaiClient,
  fileId: string,
): Promise<boolean> {
  const meta = await getVfsFileIfExists(client, fileId);
  if (!meta) return false;
  return meta.parsing_status !== "error";
}

/** Poll until parsing completes or errors. */
export async function waitForParsing(
  client: EaiClient,
  fileId: string,
  timeoutMs = 60_000,
): Promise<VfsFileMeta> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const meta = await getVfsFile(client, fileId);
    if (meta.parsing_status === "complete") return meta;
    if (meta.parsing_status === "error") {
      throw new Error("Ошибка парсинга документа на платформе");
    }
    await sleep(1500);
  }
  throw new Error("Таймаут ожидания парсинга документа");
}

/**
 * Prefer a readable download over a full platform parse wait.
 * Word text snapshots are usable as soon as original JSON downloads;
 * long "processing" used to block openChat for up to 60s+.
 */
export async function waitForParsingOrReadable(
  client: EaiClient,
  fileId: string,
  options: {
    timeoutMs?: number;
    softTimeoutMs?: number;
    verify?: (client: EaiClient, fileId: string) => Promise<void>;
  } = {},
): Promise<VfsFileMeta> {
  const timeoutMs = options.timeoutMs ?? 45_000;
  const softTimeoutMs = options.softTimeoutMs ?? 2_000;
  const verify = options.verify ?? verifyFileReadable;
  const started = Date.now();
  let lastMeta: VfsFileMeta | null = null;

  while (Date.now() - started < timeoutMs) {
    lastMeta = await getVfsFile(client, fileId);
    if (lastMeta.parsing_status === "complete") return lastMeta;
    if (lastMeta.parsing_status === "error") {
      throw new Error("Ошибка парсинга документа на платформе");
    }

    const elapsed = Date.now() - started;
    if (elapsed >= softTimeoutMs) {
      try {
        await verify(client, fileId);
        return lastMeta;
      } catch {
        /* keep polling until hard timeout */
      }
    }
    await sleep(1200);
  }

  if (lastMeta) {
    try {
      await verify(client, fileId);
      return lastMeta;
    } catch {
      /* fall through */
    }
  }
  throw new Error("Таймаут ожидания парсинга документа");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export type VfsDownloadFormat = "original" | "md";

export interface VfsFileListItem {
  file_id: string;
  file_name?: string;
  file_path?: string;
  path?: string;
  mime_type?: string;
  size_bytes?: number;
  is_directory?: boolean;
  updated_at?: string;
  created_at?: string;
}

/** List files in agent session VFS. */
export async function listSessionVfsFiles(
  client: EaiClient,
  sessionId: string,
  page = 1,
  size = 100,
  options: { hierarchical?: boolean; path?: string } = {},
): Promise<VfsFileListItem[]> {
  const params = new URLSearchParams({
    scope: "session",
    session_id: sessionId,
    page: String(page),
    size: String(size),
    hierarchical: options.hierarchical === false ? "false" : "true",
  });
  if (options.path) params.set("path", options.path);
  const res = await client.request<Record<string, unknown>>(
    `/v1/agent/vfs/files?${params.toString()}`,
  );
  const root = (res.result as Record<string, unknown> | undefined) ?? res;
  const nested = (root.data as Record<string, unknown> | undefined)?.data;
  const data = Array.isArray(nested)
    ? nested
    : Array.isArray(root.data)
      ? root.data
      : Array.isArray(res.data)
        ? res.data
        : [];
  return data as VfsFileListItem[];
}

/** Normalize session paths from chat / file_created (`~/session/...`, encoding, NFC). */
export function normalizeSessionVfsPath(vfsPath: string): string {
  let s = String(vfsPath || "").trim().replace(/\\/g, "/");
  if (s.startsWith("~/")) s = s.slice(1);
  else if (s.startsWith("~")) s = s.slice(1);
  if (!s.startsWith("/") && s.startsWith("session/")) s = `/${s}`;
  try {
    s = decodeURIComponent(s);
  } catch {
    /* keep raw */
  }
  if (typeof s.normalize === "function") s = s.normalize("NFC");
  return s;
}

function normalizeVfsFileName(name: string): string {
  let s = String(name || "").trim().replace(/\\/g, "/");
  try {
    s = decodeURIComponent(s);
  } catch {
    /* keep raw */
  }
  if (typeof s.normalize === "function") s = s.normalize("NFC");
  return s;
}

function itemPaths(f: VfsFileListItem): string[] {
  const out: string[] = [];
  for (const raw of [f.file_path, f.path, f.file_name]) {
    if (!raw) continue;
    out.push(normalizeSessionVfsPath(String(raw)));
    out.push(normalizeVfsFileName(String(raw)));
  }
  return out;
}

function isXlsxFile(f: VfsFileListItem): boolean {
  if (f.is_directory) return false;
  const name = String(f.file_name || f.file_path || "");
  return /\.xlsx$/i.test(name);
}

/** Find session file id by bash path suffix or full name match. */
export async function findSessionFileIdByPath(
  client: EaiClient,
  sessionId: string,
  vfsPath: string,
): Promise<string | null> {
  const normalized = normalizeSessionVfsPath(vfsPath);
  const base = normalized.split("/").pop() || normalized;
  const baseLower = base.toLowerCase();
  const tildePath = normalized.startsWith("/") ? `~${normalized}` : `~/${normalized}`;
  // ASCII stem helps when Cyrillic in basename differs between chat text and VFS list.
  const asciiStem = base.replace(/[^\x00-\x7F]+/g, "").replace(/_+\.xlsx$/i, ".xlsx");
  const files = await listSessionVfsFiles(client, sessionId, 1, 9999, {
    hierarchical: true,
  });
  for (const f of files) {
    if (f.is_directory) continue;
    const candidates = itemPaths(f);
    const leaf = normalizeVfsFileName(String(f.file_name || "")).split("/").pop() || "";
    const leafLower = leaf.toLowerCase();
    if (
      candidates.includes(normalized) ||
      candidates.includes(tildePath) ||
      leaf === base ||
      leafLower === baseLower ||
      candidates.some((c) => c.endsWith("/" + base) || c.endsWith("/" + baseLower))
    ) {
      return f.file_id;
    }
  }
  if (asciiStem && asciiStem.toLowerCase().endsWith(".xlsx") && asciiStem.length >= 12) {
    const asciiLower = asciiStem.toLowerCase();
    for (const f of files) {
      if (f.is_directory) continue;
      const leaf = (
        normalizeVfsFileName(String(f.file_name || "")).split("/").pop() || ""
      ).toLowerCase();
      const leafAscii = leaf.replace(/[^\x00-\x7F]+/g, "").replace(/_+\.xlsx$/i, ".xlsx");
      if (leafAscii === asciiLower || leaf.endsWith(asciiLower) || leafAscii.endsWith(asciiLower)) {
        return f.file_id;
      }
    }
  }
  return null;
}

/**
 * Newest session .xlsx that is not the open workbook snapshot.
 * Used when chat mentions a missing / hallucinated path.
 */
export async function findLatestSessionXlsxFileId(
  client: EaiClient,
  sessionId: string,
  options: { excludePath?: string | null } = {},
): Promise<{ fileId: string; fileName: string; vfsPath: string } | null> {
  const exclude = options.excludePath
    ? normalizeSessionVfsPath(options.excludePath)
    : "";
  const excludeBase = exclude ? exclude.split("/").pop() || "" : "";
  const files = await listSessionVfsFiles(client, sessionId, 1, 9999, {
    hierarchical: true,
  });
  const xlsx = files
    .filter(isXlsxFile)
    .filter((f) => {
      const paths = itemPaths(f);
      if (exclude && paths.some((p) => p === exclude || p.endsWith("/" + excludeBase))) {
        return false;
      }
      // Skip empty placeholders.
      if (typeof f.size_bytes === "number" && f.size_bytes <= 0) return false;
      return true;
    })
    .sort((a, b) => {
      const ta = Date.parse(String(a.updated_at || a.created_at || "")) || 0;
      const tb = Date.parse(String(b.updated_at || b.created_at || "")) || 0;
      return tb - ta;
    });
  const hit = xlsx[0];
  if (!hit) return null;
  const fileName = String(hit.file_name || "workbook.xlsx");
  const vfsPath = normalizeSessionVfsPath(
    String(hit.file_path || hit.path || `/session/${fileName}`),
  );
  return { fileId: hit.file_id, fileName, vfsPath };
}

/** Resolve chat/tool path, then fall back to newest session .xlsx. */
export async function resolveSessionXlsxFile(
  client: EaiClient,
  sessionId: string,
  vfsPath: string,
  options: { excludePath?: string | null } = {},
): Promise<{ fileId: string; fileName: string; vfsPath: string } | null> {
  const normalized = normalizeSessionVfsPath(vfsPath);
  const exclude = options.excludePath
    ? normalizeSessionVfsPath(options.excludePath)
    : "";
  const excluded =
    Boolean(exclude) &&
    (normalized === exclude ||
      normalized.endsWith("/" + (exclude.split("/").pop() || "")));

  // Never treat the open workbook snapshot as the agent «result» when excluded.
  if (!excluded) {
    const fileId = await findSessionFileIdByPath(client, sessionId, normalized);
    if (fileId) {
      return {
        fileId,
        fileName: normalized.split("/").pop() || "workbook.xlsx",
        vfsPath: normalized,
      };
    }
  }
  return findLatestSessionXlsxFileId(client, sessionId, options);
}

/** Download file bytes from VFS. */
export async function downloadVfsFile(
  client: EaiClient,
  fileId: string,
  format: VfsDownloadFormat = "original",
): Promise<Blob> {
  const params = new URLSearchParams({ format });
  return client.fetchBlob(`/v1/agent/vfs/files/${fileId}/download?${params}`);
}

export interface ShareLinkResult {
  file_id: string;
  share_token: string;
}

/** Create public share token for a VFS file. */
export async function createShareLink(
  client: EaiClient,
  fileId: string,
): Promise<ShareLinkResult> {
  return client.request<ShareLinkResult>(`/v1/agent/vfs/files/${fileId}/share-link`, {
    method: "POST",
  });
}

/** Build public download URL from share token. */
export function buildPublicDownloadUrl(
  apiBaseUrl: string,
  shareToken: string,
  format?: VfsDownloadFormat,
): string {
  const base = apiBaseUrl.replace(/\/$/, "");
  const params = format ? `?format=${format}` : "";
  return `${base}/v1/agent/public/file/${shareToken}/download${params}`;
}

/** Download VFS file as text (original or markdown). */
export async function downloadVfsText(
  client: EaiClient,
  fileId: string,
  format: VfsDownloadFormat = "original",
): Promise<string> {
  const blob = await downloadVfsFile(client, fileId, format);
  return blob.text();
}

/**
 * Smoke-test that file_id is readable via VFS download API and contains r7-snapshot body.text.
 */
export async function verifyFileReadable(
  client: EaiClient,
  fileId: string,
  minBodyChars = MIN_R7_BODY_CHARS,
): Promise<void> {
  if (!isValidVfsFileId(fileId)) {
    throw new Error(`Некорректный file_id: ${fileId}`);
  }
  const text = await downloadVfsText(client, fileId);
  if (!text.trim().length) {
    throw new Error("VFS download вернул пустой файл");
  }
  let parsed: { schema?: string };
  try {
    parsed = JSON.parse(text) as { schema?: string };
  } catch {
    throw new Error("VFS download: ответ не является JSON");
  }
  if (parsed.schema !== SNAPSHOT_SCHEMA) {
    throw new Error(`VFS download: ожидался schema ${SNAPSHOT_SCHEMA}, получен ${String(parsed.schema ?? "")}`);
  }
  const bodyText = extractTextFromVfsJson(text);
  if (bodyText.trim().length < minBodyChars) {
    throw new Error(
      `VFS download: body.text пуст или короче ${minBodyChars} символов (snapshot не готов для навыков)`,
    );
  }
}

/** Smoke-test that VFS file is a readable .xlsx (ZIP PK header). */
export async function verifyWorkbookReadable(
  client: EaiClient,
  fileId: string,
  minBytes = 100,
): Promise<void> {
  if (!isValidVfsFileId(fileId)) {
    throw new Error(`Некорректный file_id: ${fileId}`);
  }
  const blob = await downloadVfsFile(client, fileId, "original");
  if (blob.size < minBytes) {
    throw new Error(`VFS download: workbook меньше ${minBytes} байт`);
  }
  const head = new Uint8Array(await blob.slice(0, 2).arrayBuffer());
  if (head[0] !== 0x50 || head[1] !== 0x4b) {
    throw new Error("VFS download: файл не похож на .xlsx (нет PK)");
  }
}
