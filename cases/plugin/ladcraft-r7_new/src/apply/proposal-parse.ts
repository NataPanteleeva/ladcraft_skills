/**
 * r7.proposal/v1 — machine payload for WHAT/WHERE (alongside human markdown in chat).
 */

export type ProposalKind = "blob" | "findings" | "cell_map" | "comment";

export type ProposalBlobOp = "paste_text" | "paste" | "replace_selection";

export interface ProposalFindingItem {
  id: number;
  op: "search_replace";
  search: string;
  replace: string;
  matchCase?: boolean;
}

export interface R7ProposalV1 {
  schema: "r7.proposal/v1";
  kind: ProposalKind;
  revision?: number;
  /** blob */
  op?: ProposalBlobOp;
  text?: string;
  defaultPosition?: "cursor" | "start" | "end";
  preferReplaceSelection?: boolean;
  /** findings */
  items?: ProposalFindingItem[];
  /** cell_map */
  data?: Record<string, string | number>;
}

const PROPOSAL_FENCE_RE = /```r7\.proposal\s*([\s\S]*?)```/i;
const ORPHAN_PROPOSAL_FENCE_RE = /```r7\.proposal[\s\S]*/gi;

/** Parse first valid r7.proposal fence from assistant text. */
export function parseR7Proposal(text: string): R7ProposalV1 | null {
  if (!text || typeof text !== "string") return null;
  const m = text.match(PROPOSAL_FENCE_RE);
  if (!m) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(m[1].trim());
  } catch {
    return null;
  }
  return normalizeProposal(raw);
}

export function stripR7ProposalMarkup(text: string): string {
  let out = text.replace(/```r7\.proposal\s*[\s\S]*?```/gi, "").trim();
  out = out.replace(ORPHAN_PROPOSAL_FENCE_RE, "").trim();
  return out.replace(/\n{3,}/g, "\n\n");
}

function normalizeProposal(raw: unknown): R7ProposalV1 | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (o.schema !== "r7.proposal/v1") return null;
  const kind = o.kind;
  if (kind !== "blob" && kind !== "findings" && kind !== "cell_map" && kind !== "comment") {
    return null;
  }

  if (kind === "blob") {
    const text = typeof o.text === "string" ? o.text : "";
    if (!text.trim()) return null;
    const op =
      o.op === "paste" || o.op === "replace_selection" || o.op === "paste_text"
        ? o.op
        : "paste_text";
    const defaultPosition =
      o.defaultPosition === "start" || o.defaultPosition === "end" || o.defaultPosition === "cursor"
        ? o.defaultPosition
        : "cursor";
    return {
      schema: "r7.proposal/v1",
      kind: "blob",
      op,
      text,
      defaultPosition,
      preferReplaceSelection: o.preferReplaceSelection === true || op === "replace_selection",
      revision: typeof o.revision === "number" ? o.revision : undefined,
    };
  }

  if (kind === "findings") {
    const itemsRaw = Array.isArray(o.items) ? o.items : [];
    const items: ProposalFindingItem[] = [];
    for (const it of itemsRaw) {
      if (!it || typeof it !== "object") continue;
      const row = it as Record<string, unknown>;
      const id = Number(row.id);
      const search = typeof row.search === "string" ? row.search : "";
      const replace = typeof row.replace === "string" ? row.replace : "";
      if (!Number.isFinite(id) || id < 1 || !search) continue;
      items.push({
        id: Math.floor(id),
        op: "search_replace",
        search,
        replace,
        matchCase: row.matchCase === true,
      });
    }
    if (!items.length) return null;
    return {
      schema: "r7.proposal/v1",
      kind: "findings",
      revision: typeof o.revision === "number" ? o.revision : 1,
      items,
    };
  }

  if (kind === "cell_map") {
    const data =
      o.data && typeof o.data === "object" && !Array.isArray(o.data)
        ? (o.data as Record<string, string | number>)
        : null;
    if (!data || !Object.keys(data).length) return null;
    return {
      schema: "r7.proposal/v1",
      kind: "cell_map",
      data,
      revision: typeof o.revision === "number" ? o.revision : undefined,
    };
  }

  const text = typeof o.text === "string" ? o.text : "";
  if (!text.trim()) return null;
  return {
    schema: "r7.proposal/v1",
    kind: "comment",
    text,
    revision: typeof o.revision === "number" ? o.revision : undefined,
  };
}
