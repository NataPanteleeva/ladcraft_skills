/** Physical editor mode: document (Word) vs spreadsheet (Cell). */

import type { EditorType } from "./types";
import type { TransferProfile } from "./types";

export type ContextFamily = "document" | "spreadsheet";
export type InboundPayloadKind = "text_snapshot" | "workbook_binary";

const CONTEXT_FAMILY_KEY_PREFIX = "ladcraft_r7_context_family:";

/** Debug override per agent: document | spreadsheet */
export function getContextFamilyOverride(agentId: string): ContextFamily | null {
  if (!agentId) return null;
  try {
    const raw = localStorage.getItem(CONTEXT_FAMILY_KEY_PREFIX + agentId);
    if (raw === "document" || raw === "spreadsheet") return raw;
  } catch {
    /* ignore */
  }
  return null;
}

/**
 * What we opened in R7 drives UI + default inbound payload.
 * Word → document; Cell → spreadsheet.
 */
export function resolveContextFamily(
  editorType: EditorType,
  agentId?: string,
): ContextFamily {
  const override = agentId ? getContextFamilyOverride(agentId) : null;
  if (override) return override;
  if (editorType === "cell") return "spreadsheet";
  return "document";
}

/** VFS default payload for a context family (disk-ref uses its own outbound). */
export function resolveInboundPayloadKind(
  family: ContextFamily,
  profile: TransferProfile,
): InboundPayloadKind {
  if (profile === "disk-ref") return "text_snapshot";
  if (family === "spreadsheet") return "workbook_binary";
  return "text_snapshot";
}
