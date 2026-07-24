/** @see plugins/ladcraft-r7/docs/01-transfer-rules.md */

import { buildDocKey, type EditorType } from "../config";
import {
  clearDocumentContext,
  getDocumentContext,
  saveDocumentContext,
  type DocumentContextEntry,
} from "../context/registry";
import type { EaiClient } from "../eai/client";
import { getStoredUserId } from "../eai/client";
import {
  getVfsFile,
  getVfsFileIfExists,
  isVfsFileReady,
  isVfsNotFoundError,
  updateDocumentContext,
  uploadDocumentContext,
  verifyFileReadable,
  waitForParsing,
} from "../eai/vfs";
import { readDocumentSnapshot, type DocumentSnapshot } from "../editor/reader";
import { serializeSnapshot, normalizeContentHash } from "./snapshot";

const CURRENT_VFS_STORAGE = "session" as const;
const syncLocks = new Map<string, Promise<unknown>>();

export type DocumentContextState = "no_vfs" | "synced" | "dirty" | "syncing" | "error";

export interface EnsureContextResult {
  fileId: string;
  fileName: string;
  filePath?: string;
  contentHash: string;
  skippedUpload: boolean;
  snapshot?: DocumentSnapshot;
}

export interface EnsureContextOptions {
  /** Ladcraft agent session — required for session-scope VFS upload. */
  sessionId?: string;
  forceReupload?: boolean;
  docKey?: string;
}

function sanitizeFileName(key: string): string {
  return key.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 80);
}

function sanitizeStoredPath(
  filePath: string | undefined,
  fallback: string,
): string | undefined {
  if (!filePath || filePath.includes("/session/")) return fallback;
  return filePath;
}

function docFileName(docKey: string): string {
  return `r7-${sanitizeFileName(docKey)}.json`;
}

/** Hash of current editor snapshot (r7-snapshot/v1) without uploading. */
export async function computeDocumentHash(
  editorType: EditorType,
  docKey?: string,
): Promise<string> {
  const key =
    docKey ??
    buildDocKey({ ...(window.Asc?.plugin?.info ?? {}), editorType });
  const snapshot = await readDocumentSnapshot(editorType);
  const { contentHash } = await serializeSnapshot(editorType, key, snapshot);
  return contentHash;
}

/** True when live document or bound file_id does not match persisted VFS. */
export async function isDocumentDirty(
  editorType: EditorType,
  bound?: { docKey?: string | null; fileId?: string | null },
): Promise<boolean> {
  const info = window.Asc?.plugin?.info ?? {};
  const docKey = buildDocKey({ ...info, editorType });
  if (bound?.docKey && bound.docKey !== docKey) return true;

  const userId = getStoredUserId();
  const existing = getDocumentContext(userId, docKey);
  if (!existing?.vfsFileId) return true;
  if (bound?.fileId && bound.fileId !== existing.vfsFileId) return true;

  const contentHash = await computeDocumentHash(editorType, docKey);
  return normalizeContentHash(existing.contentHash) !== contentHash;
}

/** Whether in-memory VFS binding targets the document currently open in the editor. */
export function isContextBoundToDocument(
  editorType: EditorType,
  boundDocKey: string | null,
  boundFileId: string | null,
): boolean {
  const docKey = buildDocKey({
    ...(window.Asc?.plugin?.info ?? {}),
    editorType,
  });
  if (!boundDocKey || boundDocKey !== docKey) return false;
  if (!boundFileId) return false;
  const userId = getStoredUserId();
  const existing = getDocumentContext(userId, docKey);
  return existing?.vfsFileId === boundFileId;
}

function requireSessionId(sessionId: string | undefined): string {
  if (!sessionId?.trim()) {
    throw new Error("Нет session_id: откройте чат перед синхронизацией документа");
  }
  return sessionId;
}

/**
 * Ensures document snapshot exists in session VFS with a readable file_id.
 */
export async function ensureDocumentContext(
  client: EaiClient,
  editorType: EditorType,
  options: EnsureContextOptions = {},
): Promise<EnsureContextResult> {
  const info = window.Asc?.plugin?.info ?? {};
  const docKey =
    options.docKey ?? buildDocKey({ ...info, editorType });
  return withSyncLock(docKey, () =>
    ensureDocumentContextInner(client, editorType, docKey, options),
  );
}

async function ensureDocumentContextInner(
  client: EaiClient,
  editorType: EditorType,
  docKey: string,
  options: EnsureContextOptions,
): Promise<EnsureContextResult> {
  const userId = getStoredUserId();
  const existing = getDocumentContext(userId, docKey);
  const storageStale =
    !existing?.vfsStorage || existing.vfsStorage !== CURRENT_VFS_STORAGE;
  const sessionId = requireSessionId(options.sessionId);
  const sessionStale =
    Boolean(existing?.vfsSessionId) && existing!.vfsSessionId !== sessionId;

  const snapshot = await readDocumentSnapshot(editorType);
  const { serialized, contentHash } = await serializeSnapshot(
    editorType,
    docKey,
    snapshot,
  );
  const fileName = docFileName(docKey);
  const vfsPath = `/r7/${fileName}`;

  let cachedFileId =
    options.forceReupload || storageStale || sessionStale
      ? undefined
      : existing?.vfsFileId;
  let cachedFilePath =
    options.forceReupload || storageStale || sessionStale
      ? undefined
      : existing?.vfsFilePath;

  if (
    existing &&
    cachedFileId &&
    !options.forceReupload &&
    !storageStale &&
    !sessionStale &&
    (existing.contentHash === contentHash ||
      normalizeContentHash(existing.contentHash) === contentHash)
  ) {
    const verified = await getVfsFileIfExists(client, cachedFileId);
    if (verified && (await isVfsFileReady(client, cachedFileId))) {
      await verifyFileReadable(client, cachedFileId);
      const filePath = sanitizeStoredPath(
        verified.file_path ?? cachedFilePath,
        vfsPath,
      );
      if (filePath !== existing.vfsFilePath || existing.vfsSessionId !== sessionId) {
        saveDocumentContext(userId, {
          ...existing,
          vfsFilePath: filePath,
          vfsSessionId: sessionId,
          contentHash,
          updatedAt: new Date().toISOString(),
        });
      }
      return {
        fileId: cachedFileId,
        fileName: existing.fileName,
        filePath,
        contentHash,
        skippedUpload: true,
        snapshot,
      };
    }
    clearDocumentContext(userId, docKey);
    cachedFileId = undefined;
    cachedFilePath = undefined;
  }

  let fileId = cachedFileId;
  let filePath = cachedFilePath;

  if (fileId) {
    const verified = await getVfsFileIfExists(client, fileId);
    if (!verified || !(await isVfsFileReady(client, fileId))) {
      fileId = undefined;
      filePath = undefined;
    }
  }

  if (!fileId) {
    const uploaded = await uploadDocumentContext(client, fileName, serialized, {
      scope: "session",
      sessionId,
      sync: true,
    });
    fileId = uploaded.file_id;
    filePath = uploaded.file_path;
    if (uploaded.parsing_status !== "complete") {
      const meta = await waitForParsing(client, fileId);
      filePath = meta.file_path ?? filePath;
    }
  } else if (!existing || existing.contentHash !== contentHash) {
    try {
      await updateDocumentContext(client, fileId, serialized, vfsPath);
    } catch (err) {
      if (!isVfsNotFoundError(err)) throw err;
      const uploaded = await uploadDocumentContext(client, fileName, serialized, {
        scope: "session",
        sessionId,
        sync: true,
      });
      fileId = uploaded.file_id;
      filePath = uploaded.file_path;
      if (uploaded.parsing_status !== "complete") {
        const meta = await waitForParsing(client, fileId);
        filePath = meta.file_path ?? filePath;
      }
    }

    const meta = await getVfsFile(client, fileId);
    filePath = meta.file_path ?? filePath;
    if (meta.parsing_status === "processing") {
      const ready = await waitForParsing(client, fileId);
      filePath = ready.file_path ?? filePath;
    }
  }

  await verifyFileReadable(client, fileId);

  const entry: DocumentContextEntry = {
    docKey,
    vfsFileId: fileId,
    vfsFilePath: sanitizeStoredPath(filePath, vfsPath),
    vfsStorage: CURRENT_VFS_STORAGE,
    vfsSessionId: sessionId,
    contentHash,
    updatedAt: new Date().toISOString(),
    editorType,
    fileName,
  };
  saveDocumentContext(userId, entry);

  return {
    fileId,
    fileName,
    filePath,
    contentHash,
    skippedUpload: false,
    snapshot,
  };
}

let syncTimer: ReturnType<typeof setTimeout> | null = null;

/** Debounced background sync after document edits. */
export function scheduleContextSync(
  client: EaiClient,
  editorType: EditorType,
  sessionId: string,
  delayMs = 2000,
): void {
  if (syncTimer) clearTimeout(syncTimer);
  syncTimer = setTimeout(() => {
    void ensureDocumentContext(client, editorType, { sessionId }).catch((err) => {
      console.error("Context sync failed:", err);
    });
  }, delayMs);
}

async function withSyncLock<T>(docKey: string, fn: () => Promise<T>): Promise<T> {
  const prev = syncLocks.get(docKey) ?? Promise.resolve();
  const run = prev.then(fn, fn);
  syncLocks.set(
    docKey,
    run.catch(() => undefined),
  );
  return run;
}
