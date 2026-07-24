import type { ChatMessage } from "../ui/chat";
import {
  assistantApplySource,
  extractInsertableMarkdown,
  isGenericInsertableDraft,
  isStructuredSummaryBlob,
} from "./intent-apply";
import { parseR7Proposal } from "./proposal-parse";

export type ActionId =
  | "replace_selection"
  | "paste_cursor"
  | "paste_start"
  | "paste_end"
  | "fix_all"
  | "add_comment"
  | "cell_write"
  | "sheet_from_xlsx"
  | "paste_xlsx_matrix"
  | "replace_active_sheet"
  | "download_md"
  | "download_word_html"
  | "download_csv"
  | "download_vfs_xlsx";

export interface ActionButtonSpec {
  id: ActionId;
  label: string;
  glyph: string;
  title: string;
  primary?: boolean;
  kind: "apply" | "download";
}

export interface ActionTarget {
  message: ChatMessage;
  raw: string;
  fingerprint: string;
}

const DRAFT_HEADER_RE =
  /(?:^|\n)#{0,3}\s*\*{0,2}\s*черновик(?:\s*\([^)]*\))?\s*\*{0,2}\s*:?\s*\*{0,2}\s*(?:\n|$)/i;

export function hashText(text: string): string {
  let h = 0;
  for (let i = 0; i < text.length; i++) {
    h = (h * 31 + text.charCodeAt(i)) | 0;
  }
  return String(h);
}

/** Text body for download / paste from last draft. */
export function resolveInsertableText(raw: string): string {
  const proposal = parseR7Proposal(raw);
  if (proposal?.kind === "blob" && (proposal.text || "").trim()) {
    return proposal.text!.trim();
  }
  if (proposal?.kind === "comment" && (proposal.text || "").trim()) {
    return proposal.text!.trim();
  }
  if (proposal?.kind === "cell_map" && proposal.data) {
    return cellMapToText(proposal.data);
  }
  if (
    DRAFT_HEADER_RE.test(raw) ||
    isStructuredSummaryBlob(raw) ||
    isGenericInsertableDraft(raw)
  ) {
    return extractInsertableMarkdown(raw);
  }
  const extracted = extractInsertableMarkdown(raw);
  return extracted.trim().length >= 40 ? extracted : "";
}

function cellMapToText(data: Record<string, string | number | boolean | null>): string {
  return Object.keys(data)
    .sort()
    .map((k) => `${k}\t${data[k] == null ? "" : String(data[k])}`)
    .join("\n");
}

/** Last assistant draft suitable for apply/download (same scan as intent-apply). */
export function resolveActionTarget(messages: ChatMessage[]): {
  message: ChatMessage;
  raw: string;
  fingerprint: string;
} | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role !== "assistant") continue;
    const raw = assistantApplySource(m);
    if (!raw || /агент (?:выполняет|формирует)/i.test(raw)) continue;
    if (m.widget || m.waitingForInput) continue;
    return { message: m, raw, fingerprint: `${m.id}:${raw.length}:${hashText(raw)}` };
  }
  return null;
}
