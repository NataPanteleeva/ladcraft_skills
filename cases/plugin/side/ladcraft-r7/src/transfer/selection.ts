/** @see plugins/ladcraft-r7/docs/01-transfer-rules.md */

import type { EditorType } from "../config";
import type { EaiClient } from "../eai/client";
import {
  getVfsFileIfExists,
  isVfsFileReady,
  uploadDocumentContext,
  waitForParsing,
} from "../eai/vfs";
import { getSelectedText } from "../editor/reader";
import type { FileRef } from "./types";

export const SELECTION_SCHEMA = "r7-selection/v1" as const;

export interface R7SelectionV1 {
  schema: typeof SELECTION_SCHEMA;
  docKey: string;
  editor: EditorType;
  selectionType: "text" | "range";
  text: string;
  empty: boolean;
}

/** Append editor selection for the agent API payload (not shown in chat bubble styling). */
export function appendSelectionContext(userText: string, selection: string): string {
  const trimmed = selection.trim();
  if (!trimmed) return userText;
  return `${userText}\n\n---\n[Контекст R7: выделенный фрагмент в редакторе]\n${trimmed}\n---`;
}

function selectionFileName(docKey: string): string {
  return `r7-selection_${sanitizeFileName(docKey)}.json`;
}

function sanitizeFileName(key: string): string {
  return key.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 80);
}

export interface SelectionUploadOptions {
  sessionId?: string;
}

/**
 * Upload selection snapshot to session VFS when editor has a non-empty selection.
 * Returns null when selection is empty.
 */
export async function uploadSelectionContext(
  client: EaiClient,
  editorType: EditorType,
  docKey: string,
  selectionText: string,
  options: SelectionUploadOptions = {},
): Promise<FileRef | null> {
  const text = selectionText.trim();
  if (!text) return null;

  const payload: R7SelectionV1 = {
    schema: SELECTION_SCHEMA,
    docKey,
    editor: editorType,
    selectionType: "text",
    text,
    empty: false,
  };
  const serialized = JSON.stringify(payload);
  const fileName = selectionFileName(docKey);
  const sessionId = options.sessionId?.trim();
  if (!sessionId) {
    throw new Error("Нет session_id для загрузки выделения в VFS");
  }
  const uploaded = await uploadDocumentContext(client, fileName, serialized, {
    scope: "session",
    sessionId,
    sync: true,
  });
  let fileId = uploaded.file_id;
  if (uploaded.parsing_status !== "complete") {
    await waitForParsing(client, fileId);
  }
  const verified = await getVfsFileIfExists(client, fileId);
  if (!verified || !(await isVfsFileReady(client, fileId))) {
    throw new Error("Файл выделения не доступен в VFS после загрузки");
  }

  return {
    file_id: fileId,
    file_name: fileName,
    mime_type: "application/json",
  };
}

/** Read current editor selection text. */
export { getSelectedText };
