/** @see plugins/ladcraft-r7/docs/01-transfer-rules.md */

import type { EditorType } from "../config";
import type { CellSnapshot, DocumentSnapshot } from "../editor/reader";
import { hashContent } from "../context/registry";

export const SNAPSHOT_SCHEMA = "r7-snapshot/v1" as const;

export interface R7SnapshotV1 {
  schema: typeof SNAPSHOT_SCHEMA;
  editor: EditorType;
  docKey: string;
  exportedAt: string;
  contentHash: string;
  body: {
    text: string;
    paragraphs?: string[];
    blocks?: CellSnapshot["blocks"];
  };
  type: "word" | "cell";
  content?: string[];
  blocks?: CellSnapshot["blocks"];
  isTooLarge?: boolean;
}

/** Build plain text extractable by Ladcraft skills from a raw editor snapshot. */
export function extractBodyText(snapshot: DocumentSnapshot): string {
  if (snapshot.type === "word") {
    return snapshot.content
      .map((p) => p.trim())
      .filter(Boolean)
      .join("\n\n");
  }
  const lines: string[] = [];
  for (const block of snapshot.blocks) {
    for (const row of block.lines) {
      lines.push(row.map((c) => String(c ?? "")).join("\t"));
    }
    lines.push("");
  }
  return lines.join("\n").trim();
}

/**
 * Stable JSON for contentHash — excludes exportedAt, contentHash, and other upload metadata.
 * Same document → same hash between reads.
 */
export function buildStableHashInput(
  editorType: EditorType,
  docKey: string,
  snapshot: DocumentSnapshot,
): string {
  if (snapshot.type === "word") {
    return JSON.stringify({
      editor: editorType,
      docKey,
      type: "word",
      content: snapshot.content,
    });
  }
  return JSON.stringify({
    editor: editorType,
    docKey,
    type: "cell",
    blocks: snapshot.blocks,
    isTooLarge: snapshot.isTooLarge,
  });
}

/** Content hash for dedup (stable across reads of the same document). */
export async function computeSnapshotContentHash(
  editorType: EditorType,
  docKey: string,
  snapshot: DocumentSnapshot,
): Promise<string> {
  const digest = await hashContent(buildStableHashInput(editorType, docKey, snapshot));
  return `sha256:${digest}`;
}

/** Normalize legacy registry hashes (plain hex without sha256: prefix). */
export function normalizeContentHash(hash: string): string {
  if (hash.startsWith("sha256:")) return hash;
  return `sha256:${hash}`;
}

/** Wrap raw R7 snapshot in r7-snapshot/v1 for VFS upload. */
export function buildSnapshotPayload(
  editorType: EditorType,
  docKey: string,
  snapshot: DocumentSnapshot,
  contentHash: string,
): R7SnapshotV1 {
  const bodyText = extractBodyText(snapshot);

  const base: R7SnapshotV1 = {
    schema: SNAPSHOT_SCHEMA,
    editor: editorType,
    docKey,
    exportedAt: new Date().toISOString(),
    contentHash,
    body: { text: bodyText },
    type: snapshot.type,
  };

  if (snapshot.type === "word") {
    base.body.paragraphs = snapshot.content;
    base.content = snapshot.content;
  } else {
    base.body.blocks = snapshot.blocks;
    base.blocks = snapshot.blocks;
    base.isTooLarge = snapshot.isTooLarge;
  }

  return base;
}

/** Serialize snapshot and compute content hash (async SHA-256). */
export async function serializeSnapshot(
  editorType: EditorType,
  docKey: string,
  snapshot: DocumentSnapshot,
): Promise<{ serialized: string; contentHash: string }> {
  const contentHash = await computeSnapshotContentHash(editorType, docKey, snapshot);
  const payload = buildSnapshotPayload(editorType, docKey, snapshot, contentHash);
  return { serialized: JSON.stringify(payload), contentHash };
}

/** Extract body text from a downloaded VFS JSON (r7-snapshot/v1 or legacy). */
export function extractTextFromVfsJson(text: string): string {
  try {
    const parsed = JSON.parse(text) as {
      body?: { text?: string };
      content?: string[];
      type?: string;
    };
    if (typeof parsed.body?.text === "string" && parsed.body.text.trim()) {
      return parsed.body.text;
    }
    if (Array.isArray(parsed.content)) {
      return parsed.content
        .map((p) => String(p).trim())
        .filter(Boolean)
        .join("\n\n");
    }
  } catch {
    /* not JSON */
  }
  return "";
}
