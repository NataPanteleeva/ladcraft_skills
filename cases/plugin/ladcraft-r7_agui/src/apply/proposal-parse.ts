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
  /** Optional LCA error category; ignored by agents that omit it. */
  category?: string;
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
  /** comment — optional document phrase to select before AddComment */
  search?: string;
  anchor?: string;
  /** cell_map */
  data?: Record<string, string | number>;
  /** cell_format — open sheet styling (applied by plugin via Asc). */
  target?: "used" | "selection" | string;
  format?: Record<string, unknown>;
  rules?: Array<{
    match?: Record<string, unknown>;
    format?: Record<string, unknown>;
  }>;
  applyScope?: string;
  autoFitColumns?: boolean;
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

  return parseFindingsTableFallback(text);
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

/**
 * Last-resort proofread fallback: when the agent forgets r7.proposal but emits
 * category section tables, synthesize findings (with category) so chips work.
 * Accepts:
 * - `№ | Ошибка | Правильно` under ### Орфографические / …
 * - `Опечатка | Исправление | …` (auto ids 1..n)
 */
function categoryFromSectionHeading(heading: string): string | undefined {
  const h = String(heading || "").toLowerCase();
  if (/орфограф/.test(h)) return "orthography";
  if (/пунктуац/.test(h)) return "punctuation";
  if (/грамматич/.test(h)) return "grammar";
  if (/речев|стилист/.test(h)) return "speech";
  if (/логик/.test(h)) return "logic";
  return undefined;
}

function parseFindingsTableFallback(text: string): R7ProposalV1 | null {
  const lines = String(text || "").split(/\r?\n/);
  const items: ProposalFindingItem[] = [];
  let sectionCategory: string | undefined;
  const maxItems = 40;
  let i = 0;

  while (i < lines.length && items.length < maxItems) {
    const heading = lines[i].match(/^#{1,6}\s+(.+)\s*$/);
    if (heading) {
      sectionCategory = categoryFromSectionHeading(heading[1]);
      i += 1;
      continue;
    }

    const cells = parseMarkdownTableCells(lines[i]);
    if (cells.length < 2) {
      i += 1;
      continue;
    }
    const errIdx = cells.findIndex((c) =>
      /^(?:№\s*)?(?:ошибк\w*|опечатк\w*|было|search|error)$/i.test(c) ||
      /ошибк|опечатк|было/i.test(c),
    );
    const fixIdx = cells.findIndex((c) =>
      /^(?:исправлен\w*|правильн\w*|стало|replace|fix)$/i.test(c) ||
      /исправлен|правильн|стало/i.test(c),
    );
    if (errIdx < 0 || fixIdx < 0 || errIdx === fixIdx) {
      i += 1;
      continue;
    }

    const idIdx = cells.findIndex((c) => /^(?:№|no\.?|#|id)$/i.test(c.trim()));
    i += 1;
    while (i < lines.length && items.length < maxItems) {
      const rowLine = lines[i];
      if (/^#{1,6}\s+/.test(rowLine)) break;

      const row = parseMarkdownTableCells(rowLine);
      if (!row.length) {
        if (!String(rowLine || "").trim()) {
          i += 1;
          continue;
        }
        if (!rowLine.includes("|")) break;
        i += 1;
        continue;
      }
      if (row.every((c) => /^:?-{3,}:?$/.test(c))) {
        i += 1;
        continue;
      }
      // Another findings header → let outer loop handle it.
      if (
        row.some((c) => /^(?:№\s*)?(?:ошибк\w*|опечатк\w*|было)$/i.test(c)) &&
        row.some((c) => /^(?:исправлен\w*|правильн\w*|стало)$/i.test(c))
      ) {
        break;
      }
      if (row.length <= Math.max(errIdx, fixIdx)) {
        i += 1;
        continue;
      }

      const search = cleanupTableCell(row[errIdx] || "");
      const replace = cleanupTableCell(row[fixIdx] || "");
      if (!search || !replace || normalizeCellText(search) === normalizeCellText(replace)) {
        i += 1;
        continue;
      }

      let id = items.length + 1;
      if (idIdx >= 0) {
        const fromCol = Number(row[idIdx]);
        if (Number.isFinite(fromCol) && fromCol >= 1) id = Math.floor(fromCol);
      } else {
        const fromFirst = Number(row[0]);
        if (
          errIdx > 0 &&
          Number.isFinite(fromFirst) &&
          fromFirst >= 1 &&
          String(row[0]).trim() === String(Math.floor(fromFirst))
        ) {
          id = Math.floor(fromFirst);
        }
      }

      items.push({
        id,
        op: "search_replace",
        search,
        replace,
        matchCase: false,
        category: sectionCategory,
      });
      i += 1;
    }
  }

  if (!items.length) return null;

  const seen = new Set<number>();
  for (let k = 0; k < items.length; k++) {
    let id = items[k].id;
    if (!Number.isFinite(id) || id < 1 || seen.has(id)) id = k + 1;
    while (seen.has(id)) id += 1;
    seen.add(id);
    items[k].id = id;
  }
  return { schema: "r7.proposal/v1", kind: "findings", revision: 1, items };
}

function parseMarkdownTableCells(line: string): string[] {
  const t = String(line || "").trim();
  if (!t.includes("|")) return [];
  return t
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((c) => cleanupTableCell(c));
}

function cleanupTableCell(cell: string): string {
  return String(cell || "")
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeCellText(s: string): string {
  return cleanupTableCell(s).toLowerCase().replace(/\s+/g, " ").trim();
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
        category:
          typeof row.category === "string" && row.category.trim()
            ? String(row.category).trim().toLowerCase()
            : undefined,
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
        : {};
    const rules = Array.isArray(o.rules)
      ? (o.rules as Array<{ match?: Record<string, unknown>; format?: Record<string, unknown> }>)
      : undefined;
    const autoFitColumns = o.autoFitColumns === true;
    if (!Object.keys(format).length && !(rules && rules.length) && !autoFitColumns) return null;
    const target =
      typeof o.target === "string" && o.target.trim() ? o.target.trim() : "used";
    return {
      schema: "r7.proposal/v1",
      kind: "cell_format",
      target,
      format,
      rules,
      applyScope: typeof o.applyScope === "string" ? o.applyScope : "row",
      autoFitColumns,
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
