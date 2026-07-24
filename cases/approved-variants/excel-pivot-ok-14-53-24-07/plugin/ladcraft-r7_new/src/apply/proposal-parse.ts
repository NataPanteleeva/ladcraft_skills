/**
 * r7.proposal/v1 — machine payload for WHAT/WHERE (alongside human markdown in chat).
 */

export type ProposalKind = "blob" | "findings" | "cell_map" | "comment" | "cell_format";

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
  /** cell_format — open sheet styling (applied by plugin via Asc). */
  target?: "used" | "selection" | string;
  format?: Record<string, unknown>;
}

const PROPOSAL_FENCE_RE = /```r7\.proposal\s*([\s\S]*?)```/i;
const ORPHAN_PROPOSAL_FENCE_RE = /```r7\.proposal\s*([\s\S]*)$/i;

/** Parse first valid r7.proposal from assistant text (named fence, json fence, orphan, or bare JSON). */
export function parseR7Proposal(text: string): R7ProposalV1 | null {
  if (!text || typeof text !== "string") return null;

  const fromNamed = tryParseJsonBlob(matchGroup(text, PROPOSAL_FENCE_RE));
  if (fromNamed) return fromNamed;

  const fromJsonFence = tryParseJsonBlob(extractJsonFenceProposal(text));
  if (fromJsonFence) return fromJsonFence;

  const fromOrphan = tryParseJsonBlob(matchGroup(text, ORPHAN_PROPOSAL_FENCE_RE));
  if (fromOrphan) return fromOrphan;

  const fromBare = tryParseJsonBlob(extractTrailingProposalJson(text));
  if (fromBare) return fromBare;

  return null;
}

export function stripR7ProposalMarkup(text: string): string {
  let out = text.replace(/```r7\.proposal\s*[\s\S]*?```/gi, "").trim();
  out = out.replace(/```r7\.proposal[\s\S]*/gi, "").trim();
  // Strip ```json / unlabeled fences that wrap r7.proposal/v1.
  out = out.replace(/```(?:json|JSON)?\s*\{[\s\S]*?"schema"\s*:\s*"r7\.proposal\/v1"[\s\S]*?\}\s*```/g, "").trim();
  const bare = extractTrailingProposalJson(out);
  if (bare && out.endsWith(bare)) {
    out = out.slice(0, out.length - bare.length).trim();
  }
  return out.replace(/\n{3,}/g, "\n\n");
}

function matchGroup(text: string, re: RegExp): string | null {
  const m = text.match(re);
  return m?.[1]?.trim() || null;
}

/** ```json { ... "schema":"r7.proposal/v1" ... } ``` or unlabeled fence. */
function extractJsonFenceProposal(text: string): string | null {
  const openRe = /```(?:json|JSON)?\s*(?=\{)/g;
  let m: RegExpExecArray | null;
  while ((m = openRe.exec(text)) !== null) {
    const start = m.index + m[0].length;
    if (text[start] !== "{") continue;
    const obj = sliceBalancedJsonObject(text, start);
    if (obj && /"schema"\s*:\s*"r7\.proposal\/v1"/.test(obj)) return obj;
  }
  return null;
}

function tryParseJsonBlob(raw: string | null): R7ProposalV1 | null {
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.trim());
  } catch {
    // Truncated orphan: trim to last closing brace.
    const trimmed = raw.trim().replace(/,?\s*$/, "");
    const lastBrace = trimmed.lastIndexOf("}");
    if (lastBrace < 0) return null;
    try {
      parsed = JSON.parse(trimmed.slice(0, lastBrace + 1));
    } catch {
      return null;
    }
  }
  return normalizeProposal(parsed);
}

/** Last JSON object in text that declares schema r7.proposal/v1. */
function extractTrailingProposalJson(text: string): string | null {
  let searchFrom = 0;
  let lastObj: string | null = null;
  const schemaRe = /"schema"\s*:\s*"r7\.proposal\/v1"/;
  while (searchFrom < text.length) {
    const slice = text.slice(searchFrom);
    const m = schemaRe.exec(slice);
    if (!m || m.index == null) break;
    const abs = searchFrom + m.index;
    const start = text.lastIndexOf("{", abs);
    if (start >= 0) {
      const obj = sliceBalancedJsonObject(text, start);
      if (obj) lastObj = obj;
    }
    searchFrom = abs + m[0].length;
  }
  return lastObj;
}

function sliceBalancedJsonObject(text: string, start: number): string | null {
  if (text[start] !== "{") return null;
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escape) {
        escape = false;
      } else if (ch === "\\") {
        escape = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

function normalizeProposal(raw: unknown): R7ProposalV1 | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (o.schema !== "r7.proposal/v1") return null;
  const kind = o.kind;
  if (kind !== "blob" && kind !== "findings" && kind !== "cell_map" && kind !== "comment" && kind !== "cell_format") {
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

  if (kind === "cell_format") {
    const format =
      o.format && typeof o.format === "object" && !Array.isArray(o.format)
        ? (o.format as Record<string, unknown>)
        : null;
    if (!format || !Object.keys(format).length) return null;
    const target =
      typeof o.target === "string" && o.target.trim() ? o.target.trim() : "used";
    return {
      schema: "r7.proposal/v1",
      kind: "cell_format",
      target,
      format,
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
