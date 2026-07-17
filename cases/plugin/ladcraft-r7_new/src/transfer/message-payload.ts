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
  if (profile === "disk-ref") return false;
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

/**
 * Short stable segment from Ladcraft session id for VFS path isolation.
 * Keeps paths unique across chats without embedding the full id.
 */
export function sessionPathSegment(sessionId: string): string {
  const cleaned = sessionId.trim().replace(/[^a-zA-Z0-9_-]+/g, "");
  if (!cleaned) return "nosession";
  return cleaned.slice(0, 12);
}

/**
 * Physical upload path inside session scope: `/r7/{segment}/{fileName}`.
 * Avoids path collisions when the same document is re-uploaded in a new chat.
 */
export function documentUploadVfsPath(fileName: string, sessionId: string): string {
  const base = fileName.trim().replace(/^\/+/, "").replace(/^r7\//, "");
  const seg = sessionPathSegment(sessionId);
  return `/r7/${seg}/${base}`;
}

/**
 * Canonical bash path for session-scoped R7 snapshot.
 * Prefer passing sessionId so the path matches the upload location.
 */
export function documentBashPath(fileName: string, sessionId?: string): string {
  const base = fileName.trim().replace(/^\/+/, "").replace(/^r7\//, "");
  if (sessionId?.trim()) {
    return `/session/r7/${sessionPathSegment(sessionId)}/${base}`;
  }
  // Legacy: fileName may already include segment (`seg/r7-word_….json`) or be bare.
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

/**
 * On compare-turn, append canonical snapshot bash path to API content (not document body).
 * Reduces hex-path typos when the agent copies B from chat instead of mentioned.files.
 */
export function appendSnapshotPathSupplement(userText: string, bashPath: string): string {
  const path = bashPath.trim();
  if (!path) return userText;
  return `${userText}\n\n---\n[Контекст R7: snapshot path]\nsession_file: ${path}\n---`;
}
