/** Session VFS upload for open Cell workbook (.xlsx). */

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
  deleteVfsPath,
  getVfsFile,
  getVfsFileIfExists,
  isVfsFileReady,
  isVfsNotFoundError,
  uploadWorkbookContextWithRecovery,
  verifyWorkbookReadable,
  waitForParsingOrReadable,
} from "../eai/vfs";
import {
  computeWorkbookContentHash,
  exportCellWorkbookBytes,
} from "../editor/workbook-export";
import { documentUploadVfsPath } from "./message-payload";
import type { EnsureContextOptions, EnsureContextResult } from "./context-sync";
import { normalizeContentHash } from "./snapshot";

const CURRENT_VFS_STORAGE = "session" as const;
const syncLocks = new Map<string, Promise<unknown>>();

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

function workbookFileName(docKey: string): string {
  return `r7-${sanitizeFileName(docKey)}.xlsx`;
}

function requireSessionId(sessionId: string | undefined): string {
  if (!sessionId?.trim()) {
    throw new Error("Нет session_id: откройте чат перед синхронизацией документа");
  }
  return sessionId;
}

/**
 * Ensures open Cell workbook exists in session VFS as .xlsx.
 */
export async function ensureWorkbookContext(
  client: EaiClient,
  editorType: EditorType,
  options: EnsureContextOptions = {},
): Promise<EnsureContextResult> {
  if (editorType !== "cell") {
    throw new Error("ensureWorkbookContext только для Cell");
  }
  const info = window.Asc?.plugin?.info ?? {};
  const docKey = options.docKey ?? buildDocKey({ ...info, editorType });
  return withSyncLock(docKey, () =>
    ensureWorkbookContextInner(client, editorType, docKey, options),
  );
}

async function ensureWorkbookContextInner(
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

  const bytes = await exportCellWorkbookBytes();
  const contentHash = await computeWorkbookContentHash();

  const fileName = workbookFileName(docKey);
  const vfsPath = documentUploadVfsPath(fileName, sessionId);

  if (sessionStale && existing?.vfsFilePath && existing.vfsSessionId) {
    await deleteVfsPath(client, {
      scope: "session",
      path: existing.vfsFilePath,
      sessionId: existing.vfsSessionId,
    });
  }

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
    existing.vfsSessionId === sessionId &&
    existing.payloadKind === "workbook_binary" &&
    (existing.contentHash === contentHash ||
      normalizeContentHash(existing.contentHash) === contentHash)
  ) {
    const verified = await getVfsFileIfExists(client, cachedFileId);
    if (verified && (await isVfsFileReady(client, cachedFileId))) {
      await verifyWorkbookReadable(client, cachedFileId);
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
        sessionId,
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

  if (!fileId || existing?.contentHash !== contentHash) {
    const uploaded = await uploadWorkbookContextWithRecovery(client, fileName, bytes, {
      scope: "session",
      sessionId,
      sync: true,
      path: vfsPath,
    });
    fileId = uploaded.file_id;
    filePath = uploaded.file_path ?? vfsPath;
    if (uploaded.parsing_status !== "complete") {
      const meta = await waitForParsingOrReadable(client, fileId, {
        verify: verifyWorkbookReadable,
      });
      filePath = meta.file_path ?? filePath;
    }
  } else {
    const meta = await getVfsFile(client, fileId);
    filePath = meta.file_path ?? filePath;
    if (meta.parsing_status === "processing") {
      const ready = await waitForParsingOrReadable(client, fileId, {
        verify: verifyWorkbookReadable,
      });
      filePath = ready.file_path ?? filePath;
    }
  }

  await verifyWorkbookReadable(client, fileId);

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
    contextFamily: "spreadsheet",
    payloadKind: "workbook_binary",
  };
  saveDocumentContext(userId, entry);

  return {
    fileId,
    fileName,
    filePath: entry.vfsFilePath,
    contentHash,
    skippedUpload: false,
    sessionId,
  };
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
