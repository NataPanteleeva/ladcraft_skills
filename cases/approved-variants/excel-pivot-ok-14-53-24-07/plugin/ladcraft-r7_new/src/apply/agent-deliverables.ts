/** Detect agent-produced session files from chat + tool results. */

const SESSION_XLSX_RE = /(?:~)?\/session\/[^\s`"']+\.xlsx/gi;

/** Tools that write a result workbook (prefer these over source/inspect). */
const RESULT_TOOL_NAMES = new Set([
  "filter_export",
  "sort_rows",
  "select_columns",
  "dedupe_rows",
  "add_calculated_column",
  "time_bucket",
  "top_n_summary",
  "build_pivot_table",
  "compare_sheets",
  "profile_sheet",
]);

const SOURCE_TOOL_NAMES = new Set([
  "list_workbooks",
  "pick_working_source",
  "inspect_workbook",
  "vfs_file_capabilities",
  "bash",
  "skills",
]);

export interface AgentDeliverable {
  vfsPath: string;
  fileName: string;
  mime: string;
}

export interface ToolCallLike {
  name?: string;
  tool_name?: string;
  result?: unknown;
  status?: string;
  success?: boolean;
}

export interface HistoryMessageLike {
  role?: string;
  text?: string;
  applyText?: string;
  content?: string | null;
  tool_calls?: ToolCallLike[] | null;
  /** API camelCase before normalize. */
  toolCalls?: ToolCallLike[] | null;
}

function messageToolCalls(m: HistoryMessageLike): ToolCallLike[] {
  const calls = m.tool_calls || m.toolCalls;
  return Array.isArray(calls) ? calls : [];
}

function normalizeDeliverablePath(path: string): string {
  let s = path.trim().replace(/\\/g, "/");
  if (s.startsWith("~/")) s = s.slice(1);
  if (typeof s.normalize === "function") s = s.normalize("NFC");
  return s;
}

export function isOpenWorkbookSessionPath(path: string): boolean {
  const p = normalizeDeliverablePath(path).toLowerCase();
  return /\/session\/r7\//i.test(p);
}

/**
 * True only for the live open-book snapshot itself (not result files under /session/r7/).
 * Result files often land next to the upload (…_sorted.xlsx) and must stay actionable.
 */
export function isExactOpenWorkbookPath(
  path: string,
  openWorkbookPath?: string | null,
): boolean {
  const p = normalizeDeliverablePath(path);
  if (!p) return false;
  if (openWorkbookPath) {
    return p === normalizeDeliverablePath(openWorkbookPath);
  }
  // Heuristic: live upload is r7-cell_<hex>.xlsx without a result suffix.
  const name = (p.split("/").pop() || "").toLowerCase();
  if (/^r7-cell_[a-f0-9]+\.xlsx$/.test(name)) return true;
  return false;
}

function deliverableFromPath(vfsPath: string): AgentDeliverable {
  const path = normalizeDeliverablePath(vfsPath);
  return {
    vfsPath: path,
    fileName: path.split("/").pop() || "workbook.xlsx",
    mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  };
}

export function extractSessionXlsxPaths(text: string): string[] {
  if (!text) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  const re = new RegExp(SESSION_XLSX_RE.source, SESSION_XLSX_RE.flags);
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const path = normalizeDeliverablePath(m[0]);
    if (!path || seen.has(path)) continue;
    seen.add(path);
    out.push(path);
  }
  return out;
}

function parseToolResultObject(result: unknown): Record<string, unknown> | null {
  if (result == null) return null;
  if (typeof result === "object" && !Array.isArray(result)) {
    return result as Record<string, unknown>;
  }
  if (typeof result === "string") {
    const t = result.trim();
    if (!t) return null;
    try {
      const parsed = JSON.parse(t);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      /* plain text tool result */
    }
    const paths = extractSessionXlsxPaths(t);
    if (paths.length) return { targetPath: paths[paths.length - 1], ok: true };
  }
  return null;
}

function toolName(tc: ToolCallLike): string {
  return String(tc.name || tc.tool_name || "").trim().toLowerCase();
}

function targetPathFromToolResult(obj: Record<string, unknown> | null): string | null {
  if (!obj || obj.ok === false) return null;
  const target = obj.targetPath ?? obj.target_path;
  if (typeof target === "string" && /\.xlsx$/i.test(target) && /\/session\//i.test(target)) {
    return normalizeDeliverablePath(target);
  }
  return null;
}

/**
 * Prefer real tool side-effect paths over chat text (agents may invent «Файл:»).
 * Prefer result tools (sort/filter/…) and non-/session/r7/ paths over the open book.
 */
export function extractLatestTargetPathFromToolCalls(
  history: HistoryMessageLike[],
): string | null {
  const resultPaths: string[] = [];
  const otherPaths: string[] = [];

  for (let i = history.length - 1; i >= 0; i--) {
    const m = history[i];
    if (!m || (m.role && m.role !== "assistant" && m.role !== "tool")) continue;
    const calls = messageToolCalls(m);
    if (!calls.length) continue;
    for (let j = calls.length - 1; j >= 0; j--) {
      const tc = calls[j];
      if (!tc) continue;
      const status = String(tc.status || "").toLowerCase();
      if (status && status !== "completed" && tc.success === false) continue;
      const name = toolName(tc);
      if (SOURCE_TOOL_NAMES.has(name)) continue;
      const obj = parseToolResultObject(tc.result);
      const target = targetPathFromToolResult(obj);
      if (!target) continue;
      if (RESULT_TOOL_NAMES.has(name)) {
        resultPaths.push(target);
      } else {
        otherPaths.push(target);
      }
    }
  }

  const pickPreferred = (paths: string[]): string | null => {
    if (!paths.length) return null;
    const nonR7 = paths.find((p) => !isOpenWorkbookSessionPath(p));
    return nonR7 || paths[0];
  };

  return pickPreferred(resultPaths) || pickPreferred(otherPaths);
}

/** Latest deliverable from assistant messages (newest first). */
export function resolveAgentDeliverables(
  messages: { role: string; text?: string; applyText?: string }[],
): AgentDeliverable[] {
  const found: AgentDeliverable[] = [];
  const seen = new Set<string>();
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role !== "assistant") continue;
    const raw = (m.applyText || m.text || "").trim();
    if (!raw) continue;
    for (const vfsPath of extractSessionXlsxPaths(raw)) {
      if (seen.has(vfsPath)) continue;
      seen.add(vfsPath);
      found.push(deliverableFromPath(vfsPath));
    }
  }
  return found;
}

function pickPathFromChatText(raw: string): string | null {
  const paths = extractSessionXlsxPaths(raw);
  if (!paths.length) return null;
  // Prefer explicit result files over the open Cell snapshot under /session/r7/.
  for (let i = paths.length - 1; i >= 0; i--) {
    if (!isOpenWorkbookSessionPath(paths[i])) return paths[i];
  }
  return paths[paths.length - 1];
}

/**
 * Deliverable for action bar: tool targetPath first, then chat «Файл: /session/…xlsx».
 */
export function resolveLatestAgentDeliverable(
  messages: { role: string; text?: string; applyText?: string }[],
  history?: HistoryMessageLike[],
  options: { excludePath?: string | null } = {},
): AgentDeliverable | null {
  const listed = listLatestAssistantDeliverables(messages, history, options);
  if (listed.length) return listed[listed.length - 1];
  return null;
}

/**
 * All result .xlsx from the latest assistant turn (chat order, then tools).
 * Used when the agent produced several tables in one reply.
 */
export function listLatestAssistantDeliverables(
  messages: { role: string; text?: string; applyText?: string }[],
  history?: HistoryMessageLike[],
  options: { excludePath?: string | null } = {},
): AgentDeliverable[] {
  const ordered: string[] = [];
  const seen = new Set<string>();
  const exclude = options.excludePath
    ? normalizeDeliverablePath(options.excludePath)
    : null;

  const push = (path: string | null | undefined) => {
    if (!path) return;
    const p = normalizeDeliverablePath(path);
    if (!p || seen.has(p)) return;
    // Skip only the open workbook snapshot — keep /session/r7/…_sorted.xlsx etc.
    if (isExactOpenWorkbookPath(p, exclude)) return;
    seen.add(p);
    ordered.push(p);
  };

  if (history?.length) {
    for (let i = history.length - 1; i >= 0; i--) {
      const m = history[i];
      if (!m || m.role !== "assistant") continue;
      const content =
        (typeof m.content === "string" && m.content) ||
        (typeof (m as { text?: string }).text === "string" && (m as { text?: string }).text) ||
        "";
      for (const p of extractSessionXlsxPaths(content)) push(p);

      const calls = messageToolCalls(m);
      for (const tc of calls) {
        if (!tc) continue;
        const name = toolName(tc);
        if (SOURCE_TOOL_NAMES.has(name)) continue;
        if (!RESULT_TOOL_NAMES.has(name) && name) continue;
        const status = String(tc.status || "").toLowerCase();
        if (status && status !== "completed" && tc.success === false) continue;
        push(targetPathFromToolResult(parseToolResultObject(tc.result)));
      }
      break;
    }
  }

  if (!ordered.length) {
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i];
      if (m.role !== "assistant") continue;
      const raw = (m.applyText || m.text || "").trim();
      if (!raw) continue;
      for (const p of extractSessionXlsxPaths(raw)) push(p);
      break;
    }
  }

  // Prefer non-/session/r7/ results first (open-folder clutter), keep r7 results.
  ordered.sort((a, b) => {
    const ar = isOpenWorkbookSessionPath(a) ? 1 : 0;
    const br = isOpenWorkbookSessionPath(b) ? 1 : 0;
    return ar - br;
  });

  return ordered.map(deliverableFromPath);
}

/** Resolve path chosen in action bar, or fall back to latest. */
export function resolveSelectedAgentDeliverable(
  messages: { role: string; text?: string; applyText?: string }[],
  history: HistoryMessageLike[] | undefined,
  selectedPath: string | null | undefined,
  options: { excludePath?: string | null } = {},
): AgentDeliverable | null {
  const listed = listLatestAssistantDeliverables(messages, history, options);
  if (!listed.length) {
    return resolveLatestAgentDeliverable(messages, history, options);
  }
  if (selectedPath) {
    const want = normalizeDeliverablePath(selectedPath);
    const hit = listed.find((d) => d.vfsPath === want);
    if (hit) return hit;
  }
  return listed[0];
}

/** Short label for picker chips. */
export function deliverableChipLabel(item: AgentDeliverable): string {
  const base = (item.fileName || "").replace(/\.xlsx$/i, "").trim() || "таблица";
  if (base.length <= 22) return base;
  return base.slice(0, 20) + "…";
}

/**
 * True when chat text already names a session result workbook (not the live open book).
 * Short Excel replies («Фильтр… / Файл: /session/….xlsx») are ready for the action bar.
 */
export function hasSessionResultFileLine(text: string): boolean {
  const body = String(text || "").trim();
  if (!body) return false;
  for (const path of extractSessionXlsxPaths(body)) {
    if (!isExactOpenWorkbookPath(path)) return true;
  }
  return false;
}

/**
 * Analytics turn is actionable: successful result tool wrote a workbook, and/or
 * user-visible `Файл: /session/….xlsx` is present. Used to end plugin wait without
 * waiting for Ladcraft message.status=completed (often lags behind tool + userReply).
 */
export function hasReadyAnalyticsDeliverable(
  historyMessage: HistoryMessageLike | null | undefined,
): boolean {
  if (!historyMessage) return false;
  if (extractAnalyticsUserReply(historyMessage)) return true;
  const content =
    (typeof historyMessage.content === "string" && historyMessage.content) ||
    (typeof historyMessage.text === "string" && historyMessage.text) ||
    "";
  if (hasSessionResultFileLine(content)) return true;
  return false;
}

/**
 * If the agent wrote a result file but forgot `Файл:` (or ended with a platform error),
 * append the tool targetPath so the action bar and the user still see the deliverable.
 */
export function extractAnalyticsUserReply(
  historyMessage: HistoryMessageLike | null | undefined,
): string | null {
  if (!historyMessage) return null;
  for (const tc of messageToolCalls(historyMessage).slice().reverse()) {
    if (!tc) continue;
    const name = toolName(tc);
    if (!RESULT_TOOL_NAMES.has(name)) continue;
    const obj = parseToolResultObject(tc.result);
    if (!obj || obj.ok === false) continue;
    const reply = obj.userReply;
    if (typeof reply === "string" && reply.trim()) return reply.trim();
    const path = targetPathFromToolResult(obj);
    if (path && !isExactOpenWorkbookPath(path)) {
      return `Готово.\nФайл: ${path}`;
    }
  }
  return null;
}

/**
 * Prefer skill userReply over model narration / platform abort.
 * Analytics file is already saved; chat should show only the short deliverable text.
 */
export function resolveAssistantDeliverableText(
  text: string,
  historyMessage: HistoryMessageLike | null | undefined,
): string {
  const reply = extractAnalyticsUserReply(historyMessage);
  if (reply) return reply;
  const body = String(text || "").trim();
  // Drop platform unsafe-abort tail when a Файл: line already exists in the body.
  if (
    hasSessionResultFileLine(body) &&
    /не удалось продолжить задачу/i.test(body)
  ) {
    const cut = body.search(/не удалось продолжить задачу/i);
    if (cut > 0) {
      const kept = body.slice(0, cut).trim();
      if (hasSessionResultFileLine(kept)) return kept;
    }
  }
  return appendMissingFileLineFromTools(body, historyMessage);
}

export function appendMissingFileLineFromTools(
  text: string,
  historyMessage: HistoryMessageLike | null | undefined,
): string {
  const body = String(text || "").trim();
  if (/^\s*Файл:\s*\/session\//im.test(body)) return body;
  if (!historyMessage) return body;
  const path = extractLatestTargetPathFromToolCalls([historyMessage]);
  if (!path || isExactOpenWorkbookPath(path)) return body;
  if (body.includes(path)) return body;
  return body ? `${body}\n\nФайл: ${path}` : `Файл: ${path}`;
}
