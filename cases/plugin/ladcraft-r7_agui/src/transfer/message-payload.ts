/** @see plugins/ladcraft-r7/docs/01-transfer-rules.md */

import type { EditorAttachState, TransferProfile } from "./types";

const JSON_MIME = "application/json";
const XLSX_MIME =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/**
 * Whether files.editor mount is required for this outbound message.
 * vfs: never — avoids Ladcraft parsing the full snapshot into agent context.
 */
export function shouldAttachEditor(
  state: EditorAttachState,
  currentFileId: string,
  profile: TransferProfile = "vfs",
): boolean {
  if (profile === "vfs") return false;
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

/** Whether to include the primary file in mentioned.files on this send. */
export function shouldMentionDocumentFiles(
  _state: EditorAttachState,
  _profile: TransferProfile = "vfs",
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
  return `/session/r7/${base}`;
}

/** Session path for workbook binary (Cell). */
export function workbookBashPath(fileName: string, sessionId?: string): string {
  return documentBashPath(fileName, sessionId);
}

/** Build mentioned.files entry for the primary document snapshot. */
export function documentFileRef(fileId: string, bashPath: string) {
  return {
    file_id: fileId,
    file_name: bashPath,
    mime_type: JSON_MIME,
  };
}

/** Build mentioned.files entry for workbook upload. */
export function workbookFileRef(fileId: string, bashPath: string) {
  return {
    file_id: fileId,
    file_name: bashPath,
    mime_type: XLSX_MIME,
  };
}

/**
 * Append canonical snapshot bash path to API content (not document body).
 */
export function appendSnapshotPathSupplement(userText: string, bashPath: string): string {
  const path = bashPath.trim();
  if (!path) return userText;
  return `${userText}\n\n---\n[Контекст R7: snapshot path]\nsession_file: ${path}\n---`;
}

/** Append workbook path for table agents (openpyxl / list_workbooks). */
export function appendWorkbookPathSupplement(
  userText: string,
  bashPath: string,
  options: { lastResultPath?: string } = {},
): string {
  const path = bashPath.trim();
  if (!path) return userText;
  const last = (options.lastResultPath || "").trim();
  const lastLine = last ? `\nlast_result_path: ${last}` : "";
  return `${userText}\n\n---\n[Контекст R7: workbook]\nworkbook_path: ${path}${lastLine}\n---`;
}

/**
 * True when the user clearly asks to refine a previous agent deliverable
 * (KPI / сводная / «этот файл»), not a fresh question on the open workbook.
 */
export function userAsksToRefineLastResult(userText: string): boolean {
  const t = String(userText || "").toLowerCase();
  if (!t.trim()) return false;
  if (/\blast_result_path\b/.test(t)) return true;
  if (/\b(?:kpi|premium_kpi|premium_by_department)\b/i.test(t)) return true;
  if (/(?:доработ|продолж\w*\s+(?:эту|этот|предыдущ)|из\s+сводн|по\s+сводн|по\s+kpi)/i.test(t)) {
    return true;
  }
  if (/(?:этот|эту|предыдущ\w*)\s+(?:результат|файл|таблиц|сводн)/i.test(t)) return true;
  return false;
}
