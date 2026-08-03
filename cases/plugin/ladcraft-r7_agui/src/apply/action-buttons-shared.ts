import type { ChatMessage } from "../ui/chat";
import {
  assistantApplySource,
  extractChernovikBody,
  extractInsertableSummaryBody,
  isGenericInsertableDraft,
  isStructuredSummaryBlob,
  sanitizeProposalText,
  parseFixIntent,
} from "./intent-apply";
import { parseR7Proposal } from "./proposal-parse";

export type ActionId =
  | "replace_selection"
  | "paste_cursor"
  | "paste_start"
  | "paste_end"
  | "fix_all"
  | "fix_orthography"
  | "fix_punctuation"
  | "fix_grammar"
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
  /** After successful apply — show «Изменено» / gray look; may stay clickable for undo. */
  disabled?: boolean;
  /** Visual «applied» (gray) state without necessarily disabling. */
  applied?: boolean;
  /** Compact chip look for category strip. */
  chip?: boolean;
}

/** Findings fix actions (правописание / category chips). */
export function isFindingsFixActionId(actionId: ActionId): boolean {
  return (
    actionId === "fix_all" ||
    actionId === "fix_orthography" ||
    actionId === "fix_punctuation" ||
    actionId === "fix_grammar"
  );
}

export interface ActionTarget {
  message: ChatMessage;
  raw: string;
  fingerprint: string;
}

/**
 * Stable key for applied action state.
 * Must NOT rely on message.id alone — history/projection sync often replaces
 * the stream id, which used to reset «Все» back to purple.
 */
export function actionTargetKey(target: ActionTarget, actionId: string): string {
  const proposal = parseR7Proposal(target.raw);
  if (proposal?.kind === "findings" && proposal.items?.length) {
    const sig = proposal.items
      .map((it) => `${it.id}:${it.search}=>${it.replace}`)
      .join("|");
    return `findings:${hashText(sig)}:${actionId}`;
  }
  if (proposal?.kind === "comment") {
    const sig = `${proposal.search || proposal.anchor || ""}|${proposal.text || ""}`;
    return `comment:${hashText(sig)}:${actionId}`;
  }
  return `raw:${hashText(String(target.raw || "").slice(0, 4000))}:${actionId}`;
}

export function hashText(text: string): string {
  let h = 0;
  for (let i = 0; i < text.length; i++) {
    h = (h * 31 + text.charCodeAt(i)) | 0;
  }
  return String(h);
}

/**
 * Text body for download / paste from last draft.
 * 1) r7.proposal.text
 * 2) body under Черновик:
 * 3) substantive summary (genre/CTA stripped) when model forgot markers
 */
export function resolveInsertableText(raw: string): string {
  const proposal = parseR7Proposal(raw);
  if (proposal?.kind === "blob" && (proposal.text || "").trim()) {
    return sanitizeProposalText(proposal.text!);
  }
  if (proposal?.kind === "comment" && (proposal.text || "").trim()) {
    return sanitizeProposalText(proposal.text!);
  }
  if (proposal?.kind === "cell_map" && proposal.data) {
    return cellMapToText(proposal.data);
  }
  const chernovik = extractChernovikBody(raw);
  if (chernovik.trim()) return chernovik;

  if (isStructuredSummaryBlob(raw) || isGenericInsertableDraft(raw)) {
    return extractInsertableSummaryBody(raw);
  }
  const fallback = extractInsertableSummaryBody(raw);
  return fallback.trim().length >= 80 ? fallback : "";
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
    const mid = String(m.id || "");
    // Skip offline/plugin bubbles so buttons stay on the last model draft.
    // local-help- FAQ, local-apply-* status acks (legacy), other local-* chrome.
    if (mid.startsWith("local-")) continue;
    const raw = assistantApplySource(m);
    if (!raw || /агент (?:выполняет|формирует)/i.test(raw)) continue;
    if (m.widget || m.waitingForInput) continue;
    return { message: m, raw, fingerprint: `${m.id}:${raw.length}:${hashText(raw)}` };
  }
  return null;
}

/**
 * Document action bars should not fall back to stale findings after the user has
 * started another request. Keep spreadsheet deliverables on resolveActionTarget.
 */
export function resolveDocumentActionTarget(messages: ChatMessage[]): ActionTarget | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role === "user") {
      if (isLocalFindingsApproval(m.text)) continue;
      return null;
    }
    if (m.role !== "assistant") continue;
    const mid = String(m.id || "");
    if (mid.startsWith("local-")) continue;
    const raw = assistantApplySource(m);
    if (!raw || /агент (?:выполняет|формирует)/i.test(raw)) continue;
    if (m.widget || m.waitingForInput) continue;
    return { message: m, raw, fingerprint: `${m.id}:${raw.length}:${hashText(raw)}` };
  }
  return null;
}

function isLocalFindingsApproval(text: string | undefined): boolean {
  return Boolean(parseFixIntent(String(text || "")));
}
