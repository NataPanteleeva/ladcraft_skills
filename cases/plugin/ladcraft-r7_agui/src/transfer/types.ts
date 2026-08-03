/** @see plugins/ladcraft-r7/docs/01-transfer-rules.md */

import type { HistoryMessage } from "../eai/session";
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

/** Transfer policy: vfs = session VFS upload (default); disk-ref = r7-disk id (opt-in); editor-mount = files.editor. */
export type EditorType = "word" | "cell";
export type TransferProfile = "vfs" | "disk-ref" | "editor-mount";

export interface PrepareOutboundOptions {
  sessionId?: string;
  forceReupload?: boolean;
  docKey?: string;
  /** Default VFS: no files.editor; mentioned.files from first send. */
  transferProfile?: TransferProfile;
  /** Selected agent — context family override only. */
  agentId?: string;
  /** @deprecated disk-ref auto-finds templates folder; no longer used. */
  templatesDirectoryId?: number;
  /** Chat history before send — used to normalize template selection to `*.md`. */
  historyMessages?: HistoryMessage[];
}
