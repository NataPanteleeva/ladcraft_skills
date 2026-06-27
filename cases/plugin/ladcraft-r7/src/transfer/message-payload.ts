/** @see plugins/ladcraft-r7/docs/01-transfer-rules.md */

import type { EditorAttachState, TransferProfile } from "./types";

const JSON_MIME = "application/json";

/**
 * Whether files.editor mount is required for this outbound message.
 * doc-compare: never — avoids Ladcraft parsing the full snapshot into agent context.
 */
export function shouldAttachEditor(
  state: EditorAttachState,
  currentFileId: string,
  profile: TransferProfile = "doc-compare",
): boolean {
  if (profile === "doc-compare") return false;
  if (state.firstMessageInSession) return true;
  if (state.needsEditorRemount) return true;
  if (
    state.lastEditorAttachFileId != null &&
    state.lastEditorAttachFileId !== currentFileId
  ) {
    return true;
  }
  return false;
}

/**
 * Whether to include the document in mentioned.files on this send.
 * doc-compare: include from the first message so the agent has bash path (skill reads B after template pick).
 */
export function shouldMentionDocumentFiles(
  _state: EditorAttachState,
  _profile: TransferProfile = "doc-compare",
): boolean {
  return true;
}

/** Canonical bash path for session-scoped R7 snapshot (always from fileName, not API file_path). */
export function documentBashPath(fileName: string): string {
  const base = fileName.trim().replace(/^\/+/, "").replace(/^r7\//, "");
  return `/session/r7/${base}`;
}

/** Build mentioned.files entry for the primary document snapshot. */
export function documentFileRef(fileId: string, bashPath: string) {
  return {
    file_id: fileId,
    file_name: bashPath,
    mime_type: JSON_MIME,
  };
}
