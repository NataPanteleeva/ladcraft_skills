/** @see plugins/ladcraft-r7/docs/01-transfer-rules.md */

import type { DocumentContextState } from "./context-sync";

/** VFS file reference for mentioned.files / files.editor. */
export interface FileRef {
  file_id: string;
  file_name: string;
  mime_type: string;
}

/** Result of block 1 — passed to chat layer (block 2) for POST /message. */
export interface OutboundTransfer {
  content: string;
  fileRefs: FileRef[];
  attachEditor: boolean;
  contextState: DocumentContextState;
  primaryFileId: string;
  primaryFileName: string;
}

/** Chat session flags for files.editor remount policy. */
export interface EditorAttachState {
  firstMessageInSession: boolean;
  needsEditorRemount: boolean;
  lastEditorAttachFileId: string | null;
}

/** Transfer policy: doc-compare uses VFS + bash only (no editor mount). */
export type TransferProfile = "doc-compare" | "editor-mount";

export interface PrepareOutboundOptions {
  sessionId?: string;
  forceReupload?: boolean;
  docKey?: string;
  /** Default doc-compare: no files.editor, deferred mentioned.files on first send. */
  transferProfile?: TransferProfile;
}
