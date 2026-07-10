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
}

/** Upload document snapshot as JSON (user VFS by default — stable across sessions). */
export async function uploadDocumentContext(
  client: EaiClient,
  fileName: string,
  content: string,
  options: VfsUploadOptions = {},
): Promise<VfsUploadResult> {
  const scope = options.scope ?? "user";
  const form = new FormData();
  const blob = new Blob([content], { type: "application/json" });
  form.append("file", blob, fileName);
  form.append("path", `/r7/${fileName}`);
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

/** File is readable in VFS and ready to attach to a message. */
export async function isVfsFileReady(
  client: EaiClient,
  fileId: string,
): Promise<boolean> {
  const meta = await getVfsFileIfExists(client, fileId);
  if (!meta) return false;
  return meta.parsing_status !== "processing" && meta.parsing_status !== "error";
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export type VfsDownloadFormat = "original" | "md";

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
  if (!bodyText.trim() || bodyText.trim().length < minBodyChars) {
    throw new Error(
      `VFS download: body.text пуст или короче ${minBodyChars} символов (snapshot не готов для навыков)`,
    );
  }
}
