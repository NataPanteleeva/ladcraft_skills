import type { EditorType } from "../config";

export interface DocumentContextEntry {
  docKey: string;
  vfsFileId: string;
  vfsFilePath?: string;
  /** user | session — legacy user entries re-upload on next sync. */
  vfsStorage?: "user" | "session";
  /** Ladcraft agent session that owns session-scope VFS mount. */
  vfsSessionId?: string;
  contentHash: string;
  updatedAt: string;
  editorType: EditorType;
  fileName: string;
}

export interface SessionBinding {
  docKey: string;
  sessionId: string;
  updatedAt: string;
}

const CONTEXT_PREFIX = "ladcraft_r7_doc_context:";
const SESSION_PREFIX = "ladcraft_r7_session:";

/** Load persisted document context for user and docKey. */
export function getDocumentContext(
  userId: string,
  docKey: string,
): DocumentContextEntry | null {
  try {
    const raw = localStorage.getItem(`${CONTEXT_PREFIX}${userId}:${docKey}`);
    return raw ? (JSON.parse(raw) as DocumentContextEntry) : null;
  } catch {
    return null;
  }
}

/** Save document context mapping. */
export function saveDocumentContext(userId: string, entry: DocumentContextEntry): void {
  localStorage.setItem(
    `${CONTEXT_PREFIX}${userId}:${entry.docKey}`,
    JSON.stringify(entry),
  );
}

/** Drop cached VFS binding so the next sync re-uploads the document. */
export function clearDocumentContext(userId: string, docKey: string): void {
  localStorage.removeItem(`${CONTEXT_PREFIX}${userId}:${docKey}`);
}

/** Load session bound to document. */
export function getSessionForDoc(userId: string, docKey: string): string | null {
  try {
    const raw = localStorage.getItem(`${SESSION_PREFIX}${userId}:${docKey}`);
    if (!raw) return null;
    return (JSON.parse(raw) as SessionBinding).sessionId;
  } catch {
    return null;
  }
}

/** Bind session to document. */
export function saveSessionForDoc(
  userId: string,
  docKey: string,
  sessionId: string,
): void {
  const binding: SessionBinding = {
    docKey,
    sessionId,
    updatedAt: new Date().toISOString(),
  };
  localStorage.setItem(
    `${SESSION_PREFIX}${userId}:${docKey}`,
    JSON.stringify(binding),
  );
}

/** Drop cached chat session binding so the next open creates a new session. */
export function clearSessionForDoc(userId: string, docKey: string): void {
  localStorage.removeItem(`${SESSION_PREFIX}${userId}:${docKey}`);
}

/** Drop all chat session bindings for a user (e.g. full logout). */
export function clearAllSessionsForUser(userId: string): void {
  const prefix = `${SESSION_PREFIX}${userId}:`;
  const keys: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key?.startsWith(prefix)) keys.push(key);
  }
  for (const key of keys) {
    localStorage.removeItem(key);
  }
}

/** SHA-256 hex digest of string content. */
export async function hashContent(content: string): Promise<string> {
  const data = new TextEncoder().encode(content);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
