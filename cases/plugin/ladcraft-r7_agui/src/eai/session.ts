import {
  isComparisonReport,
  isSubstantiveResult,
  isTemplateBodyDump,
  isTemplatePickerMessage,
} from "../apply/content-extract";
import { hasReadyAnalyticsDeliverable } from "../apply/agent-deliverables";
import { stripAgentServiceMarkup } from "../apply/display-sanitize";
import type { EaiClient } from "./client";
import type { FileRef } from "../transfer/types";
import { resolveTemplateSelection } from "../transfer/template-selection";
import {
  extractWidgetPayload,
  findLatestWidgetAfter,
  isWaitingForUserInput,
  isWidgetMessage,
} from "./widget";

export interface AgentSession {
  session_id: string;
}

export interface HistoryMessage {
  id: string;
  role: "user" | "assistant" | "system" | "tool";
  kind?: string;
  content?: string | null;
  status?: string;
  error?: { code?: string; message?: string } | null;
  response_timeline?: Array<{ kind: string; content?: string; status?: string }>;
  tool_calls?: ToolCallRecord[] | null;
  metadata?: Record<string, unknown> | null;
  widget_id?: string;
  widget_html?: string;
  widget_name?: string;
  widget_app_id?: string;
}

export interface ToolCallRecord {
  id?: string;
  name?: string;
  tool_name?: string;
  arguments?: unknown;
  args?: unknown;
  result?: unknown;
  success?: boolean;
  status?: string;
}

function toolCallName(tc: ToolCallRecord): string {
  return (tc.name ?? tc.tool_name ?? "").trim();
}

/** True when message has completed tool-call by exact name. */
export function hasCompletedToolCall(
  message: HistoryMessage,
  toolName: string,
): boolean {
  const expected = toolName.trim();
  if (!expected) return false;
  return (message.tool_calls ?? []).some((tc) => {
    if (!tc) return false;
    if (toolCallName(tc) !== expected) return false;
    return (tc.status ?? "").toLowerCase() === "completed";
  });
}

export interface SendMessageOptions {
  content: string;
  appId?: string;
  appName?: string;
  /** Primary channel: structured file attachments for mentioned.files */
  fileRefs?: FileRef[];
  /** @deprecated Prefer fileRefs */
  fileId?: string;
  fileName?: string;
  filePath?: string;
  mimeType?: string;
  /** Mount primary editor file in agent workspace (first message or remount). */
  attachEditorFile?: boolean;
}

interface VfsFileRef {
  file_id: string;
  file_name?: string;
  file_path?: string;
  mime_type?: string;
}

function buildFileRef(options: SendMessageOptions): VfsFileRef | null {
  if (!options.fileId) return null;
  const ref: VfsFileRef = { file_id: options.fileId };
  if (options.fileName) ref.file_name = options.fileName;
  if (options.mimeType) ref.mime_type = options.mimeType;
  return ref;
}

function buildFileRefs(options: SendMessageOptions): VfsFileRef[] {
  if (options.fileRefs?.length) {
    return options.fileRefs.map((f) => ({
      file_id: f.file_id,
      file_name: f.file_name,
      mime_type: f.mime_type,
    }));
  }
  const single = buildFileRef(options);
  return single ? [single] : [];
}

/** Create agent session. */
export async function createSession(
  client: EaiClient,
  agentId: string,
  title = "R7 документ",
): Promise<AgentSession> {
  const res = await client.request<Record<string, unknown>>("/v1/agent/session", {
    method: "POST",
    body: { agent_id: agentId, title, kind: "user_agent" },
  });
  return { session_id: unwrapSessionId(res) };
}

/**
 * Finish an in-flight run without deleting the session (history stays in Ladcraft).
 * Verified: waiting_approval / queued → leaves activity list; session remains readable.
 */
export async function abortSession(
  client: EaiClient,
  sessionId: string,
): Promise<boolean> {
  const id = String(sessionId || "").trim();
  if (!id) return false;
  try {
    await client.request(`/v1/agent/session/${id}/abort`, {
      method: "POST",
      body: {},
    });
    return true;
  } catch (err) {
    console.warn("[ladcraft-r7_new] abortSession failed", id, err);
    return false;
  }
}

export interface ActiveAgentActivityItem {
  session_id: string;
  task_id?: string;
  run_id?: string;
  task_status?: string;
  run_status?: string;
  activity_state?: string;
  waiting_reason?: string;
}

/** Active runs for an agent (blocks the agent queue while present). */
export async function listActiveAgentActivity(
  client: EaiClient,
  agentId: string,
): Promise<ActiveAgentActivityItem[]> {
  const id = String(agentId || "").trim();
  if (!id) return [];
  try {
    const res = await client.request<Record<string, unknown>>(
      `/v1/agent/activity?agent_id=${encodeURIComponent(id)}&only_active=true`,
    );
    const root = (res.result as Record<string, unknown> | undefined) || res;
    const raw = (root.items || root.data || res.items) as unknown;
    if (!Array.isArray(raw)) return [];
    return raw
      .map((row) => {
        const r = row as Record<string, unknown>;
        const sid = String(r.session_id || r.sessionId || "").trim();
        if (!sid) return null;
        return {
          session_id: sid,
          task_id: r.task_id ? String(r.task_id) : undefined,
          run_id: r.run_id ? String(r.run_id) : undefined,
          task_status: r.task_status ? String(r.task_status) : undefined,
          run_status: r.run_status ? String(r.run_status) : undefined,
          activity_state: r.activity_state ? String(r.activity_state) : undefined,
          waiting_reason: r.waiting_reason ? String(r.waiting_reason) : undefined,
        } as ActiveAgentActivityItem;
      })
      .filter(Boolean) as ActiveAgentActivityItem[];
  } catch (err) {
    console.warn("[ladcraft-r7_new] listActiveAgentActivity failed", err);
    return [];
  }
}

/**
 * Abort active runs for this agent (and known previous session ids) so a new chat
 * is not stuck behind waiting_approval / queued. Does **not** DELETE sessions.
 */
export async function finishPreviousAgentSessions(
  client: EaiClient,
  agentId: string,
  knownSessionIds: string[] = [],
): Promise<void> {
  const ids = new Set<string>();
  for (const sid of knownSessionIds) {
    const t = String(sid || "").trim();
    if (t) ids.add(t);
  }
  const active = await listActiveAgentActivity(client, agentId);
  for (const item of active) {
    if (item.session_id) ids.add(item.session_id);
  }
  for (const sid of ids) {
    await abortSession(client, sid);
  }
}

/** True when activity looks stuck behind approval / queue (blocks the agent). */
function isBlockingQueueActivity(item: ActiveAgentActivityItem): boolean {
  const blob = [
    item.activity_state,
    item.task_status,
    item.run_status,
    item.waiting_reason,
  ]
    .map((s) => String(s || "").toLowerCase())
    .join(" ");
  return (
    blob.includes("waiting_approval") ||
    blob.includes("waiting_for_approval") ||
    blob.includes("needs_approval") ||
    blob.includes("requires_user_action") ||
    blob.includes("requires_action") ||
    blob.includes("queued") ||
    /\bqueue\b/.test(blob)
  );
}

/**
 * Free the agent queue before a follow-up POST /message.
 * Aborts waiting_approval/queued runs (any session) and the current session when it
 * still has activity or a leftover analytics run. Does **not** DELETE history.
 * After analytics deliverable: clear **all** active runs for this agent (Excel follow-up
 * otherwise orphans — POST accepted, no assistant).
 */
export async function ensureAgentQueueIdleBeforeSend(
  client: EaiClient,
  agentId: string,
  currentSessionId: string,
  options: { analyticsReady?: boolean } = {},
): Promise<void> {
  const current = String(currentSessionId || "").trim();
  let hadAnalyticsDeliverable = Boolean(options.analyticsReady);

  if (current && !hadAnalyticsDeliverable) {
    try {
      const history = await getHistoryMessages(client, current, 1, 40);
      let latest: HistoryMessage | null = null;
      for (let i = history.length - 1; i >= 0; i--) {
        if (history[i].role === "assistant") {
          latest = history[i];
          break;
        }
      }
      hadAnalyticsDeliverable = Boolean(latest && hasReadyAnalyticsDeliverable(latest));
    } catch (err) {
      console.warn("[ladcraft-r7_agui] ensureAgentQueueIdleBeforeSend history", err);
    }
  }

  if (hadAnalyticsDeliverable) {
    // Excel: previous turn wrote Файл: — wipe agent queue so the next POST actually runs.
    await finishPreviousAgentSessions(client, agentId, current ? [current] : []);
    await sleep(700);
    return;
  }

  const toAbort = new Set<string>();
  const active = await listActiveAgentActivity(client, agentId);

  for (const item of active) {
    const sid = String(item.session_id || "").trim();
    if (!sid) continue;
    if (isBlockingQueueActivity(item)) {
      toAbort.add(sid);
      continue;
    }
    if (sid === current) toAbort.add(sid);
  }

  for (const sid of toAbort) {
    await abortSession(client, sid);
  }
  if (toAbort.size) await sleep(400);
}

/**
 * After analytics userReply/Файл: force-finish the run so the next user message
 * is not orphaned (Ladcraft may accept POST but never spawn assistant).
 */
export async function finishAnalyticsTurnIfReady(
  client: EaiClient,
  sessionId: string,
  message: HistoryMessage | null | undefined,
): Promise<void> {
  if (!message || !hasReadyAnalyticsDeliverable(message)) return;
  await abortSession(client, sessionId);
}

/**
 * Delete agent session on the server.
 * Prefer abortSession when leaving a chat — keep history visible in Ladcraft.
 * DELETE only for explicit wipe.
 */
export async function deleteSession(
  client: EaiClient,
  sessionId: string,
): Promise<void> {
  await client.request(`/v1/agent/session/${sessionId}`, { method: "DELETE" });
}

/** Fetch session message history. */
export async function getHistoryMessages(
  client: EaiClient,
  sessionId: string,
  page = 1,
  size = 50,
): Promise<HistoryMessage[]> {
  const params = new URLSearchParams({ page: String(page), size: String(size) });
  const res = await client.request<Record<string, unknown>>(
    `/v1/agent/session/${sessionId}/history?${params}`,
  );
  return unwrapHistoryMessages(res);
}

/** True when API reports that a Ladcraft session id no longer exists. */
export function isSessionNotFoundError(err: unknown): boolean {
  const message = (err instanceof Error ? err.message : String(err)).toLowerCase();
  if (message.includes("сессия не найдена")) return true;
  if (message.includes("session not found")) return true;
  if (message.includes("session") && message.includes("not found")) return true;
  if (message.includes("404") && message.includes("session")) return true;
  return false;
}

/** Lightweight check that a stored session_id is still valid on the server. */
export async function verifySession(
  client: EaiClient,
  sessionId: string,
): Promise<boolean> {
  try {
    await getHistoryMessages(client, sessionId, 1, 1);
    return true;
  } catch (err) {
    if (isSessionNotFoundError(err)) return false;
    throw err;
  }
}

/** @deprecated Use getHistoryMessages */
export async function getHistory(
  client: EaiClient,
  sessionId: string,
  page = 1,
  size = 50,
): Promise<{ data: HistoryMessage[] }> {
  const data = await getHistoryMessages(client, sessionId, page, size);
  return { data };
}

/** Send user message; server routes skill when appId omitted. */
export async function sendMessage(
  client: EaiClient,
  sessionId: string,
  options: SendMessageOptions,
): Promise<{ message_id: string }> {
  const body: Record<string, unknown> = { content: options.content };

  if (options.appId) {
    body.mentioned = {
      apps: [{ app_id: options.appId, app_name: options.appName ?? null }],
    };
  }

  const fileRefs = buildFileRefs(options);
  if (fileRefs.length) {
    body.mentioned = {
      ...(body.mentioned as Record<string, unknown> | undefined),
      files: fileRefs,
    };
    if (options.attachEditorFile) {
      body.files = { editor: [fileRefs[0]] };
    }
  }

  const res = await client.request<Record<string, unknown>>(
    `/v1/agent/session/${sessionId}/message`,
    { method: "POST", body },
  );
  const messageId = res.message_id ?? (res.result as Record<string, unknown> | undefined)?.message_id;
  return { message_id: String(messageId ?? "") };
}

export interface AssistantTurnResult {
  reply: HistoryMessage;
  widget: HistoryMessage | null;
  waitingForUser: boolean;
}

/** Poll history until assistant final reply (not reasoning-only). */
export async function waitForAssistantReply(
  client: EaiClient,
  sessionId: string,
  afterMessageCount: number,
  timeoutMs = 300_000,
  onProgress?: (status: string) => void,
): Promise<HistoryMessage | null> {
  const turn = await waitForAssistantTurn(
    client,
    sessionId,
    afterMessageCount,
    timeoutMs,
    onProgress,
  );
  return turn?.reply ?? null;
}

/** Default active wait after POST message (non-compare turns). */
export const DEFAULT_ASSISTANT_WAIT_MS = 300_000;

/** Extended wait when user picked a template / compare is in progress. */
export const COMPARE_ASSISTANT_WAIT_MS = 600_000;

/** Grace period after tools finish when API never sends a terminal status (fallback only). */
const STALL_FALLBACK_MS = 120_000;

/** True when user picked a template from the last assistant picker (compare turn). */
export function isCompareTurnRequest(
  userText: string,
  messages: HistoryMessage[] = [],
): boolean {
  return resolveTemplateSelection(userText, messages).matched;
}

/** Active wait timeout for waitForAssistantTurn. */
export function resolveAssistantWaitTimeoutMs(
  userText: string,
  messages: HistoryMessage[],
): number {
  if (isCompareTurnRequest(userText, messages)) return COMPARE_ASSISTANT_WAIT_MS;
  if (isAwaitingCompareReport(messages)) return COMPARE_ASSISTANT_WAIT_MS;
  return DEFAULT_ASSISTANT_WAIT_MS;
}

function toolCallCommand(tc: ToolCallRecord): string {
  const args = tc.arguments ?? tc.args;
  if (typeof args === "object" && args && "command" in args) {
    return String((args as { command?: string }).command ?? "");
  }
  return "";
}

function hasCompareRelatedToolCalls(message: HistoryMessage): boolean {
  const calls = message.tool_calls;
  if (!calls?.length) return false;
  return calls.some((tc) => {
    const name = (tc.name ?? tc.tool_name ?? "").toLowerCase();
    const cmd = toolCallCommand(tc).toLowerCase();
    if (/compare_with_template|compare|doc_compare|r7-compare|startup_session/.test(name)) {
      return true;
    }
    if (/head\s+-c\s+\d+/.test(cmd)) return true;
    if (/compare|r7-word_|templates\//i.test(cmd)) return true;
    return false;
  });
}

/** Skip STALL_FALLBACK while compare tools or interim compare ack are active. */
export function shouldSuppressStallFallback(
  messages: HistoryMessage[],
  latest: HistoryMessage | null,
): boolean {
  if (isAwaitingCompareReport(messages)) return true;
  if (!latest) return false;
  if (hasPendingToolCalls(latest) && hasCompareRelatedToolCalls(latest)) return true;
  if (
    allToolCallsTerminal(latest) &&
    hasCompareRelatedToolCalls(latest) &&
    !hasFinalAssistantText(latest)
  ) {
    return true;
  }
  return false;
}

export interface WaitForAssistantTurnOptions {
  timeoutMs?: number;
  pollMs?: number;
  /** Agent id — enables orphan detection (POST accepted, no assistant, activity empty). */
  agentId?: string;
  /** After this long with no assistant for the turn, run onOrphanRetry once. */
  orphanDetectMs?: number;
  /**
   * Re-post the user message after queue clear. Return new afterMessageCount
   * (history length before the re-posted user row).
   */
  onOrphanRetry?: () => Promise<number>;
}

/** Poll until assistant turn completes; may include a widget clarification. */
export async function waitForAssistantTurn(
  client: EaiClient,
  sessionId: string,
  afterMessageCount: number,
  timeoutMs = DEFAULT_ASSISTANT_WAIT_MS,
  onProgress?: (status: string) => void,
  onPoll?: (messages: HistoryMessage[]) => void | Promise<void>,
  options: WaitForAssistantTurnOptions = {},
): Promise<AssistantTurnResult | null> {
  const started = Date.now();
  const pollMs = options.pollMs ?? 1200;
  const orphanDetectMs = options.orphanDetectMs ?? 16_000;
  let toolsTerminalSince: number | null = null;
  let searchAfter = afterMessageCount;
  let orphanRetried = false;

  while (Date.now() - started < timeoutMs) {
    const messages = await getHistoryMessages(client, sessionId);
    const latest = findLatestAssistantForTurn(messages, searchAfter);
    if (latest) {
      if (allToolCallsTerminal(latest) && !hasFinalAssistantText(latest)) {
        toolsTerminalSince ??= Date.now();
      } else {
        toolsTerminalSince = null;
      }

      const treatStalledAsReady =
        isAssistantTurnStalled(latest) ||
        (!shouldSuppressStallFallback(messages, latest) &&
          toolsTerminalSince != null &&
          Date.now() - toolsTerminalSince >= STALL_FALLBACK_MS &&
          !isMessageStreaming(latest));

      if (isAssistantReplyReady(latest, { treatStalledAsReady })) {
        const waitingForUser = isWaitingForUserInput(latest);
        let widget = findLatestWidgetAfter(messages, searchAfter);
        if (!widget && waitingForUser) {
          onProgress?.("Загрузка формы выбора...");
          widget = await waitForWidgetMessage(
            client,
            sessionId,
            searchAfter,
            Math.min(15_000, timeoutMs - (Date.now() - started)),
          );
        }
        await invokePoll(onPoll, messages);
        // Analytics deliverable: close the run so the next user message is not orphaned.
        if (hasReadyAnalyticsDeliverable(latest) && !waitingForUser) {
          await abortSession(client, sessionId);
        }
        return { reply: latest, widget, waitingForUser };
      }
      onProgress?.(getProgressLabel(latest));
    } else if (messages.length > searchAfter) {
      onProgress?.("Ожидание ответа...");

      // Orphan: user row in history, no assistant — empty activity OR stuck requires_user_action.
      if (
        !orphanRetried &&
        options.agentId &&
        options.onOrphanRetry &&
        Date.now() - started >= orphanDetectMs
      ) {
        const last = messages[messages.length - 1];
        const lastIsUser = last?.role === "user";
        let shouldRetry = false;
        try {
          const active = await listActiveAgentActivity(client, options.agentId);
          const here = active.filter((a) => a.session_id === sessionId);
          if (!here.length) {
            shouldRetry = true;
          } else if (here.every((a) => isBlockingQueueActivity(a))) {
            shouldRetry = true;
          }
        } catch {
          shouldRetry = false;
        }
        if (lastIsUser && shouldRetry) {
          orphanRetried = true;
          onProgress?.("Повтор запуска хода…");
          try {
            await finishPreviousAgentSessions(client, options.agentId, [sessionId]);
            await sleep(700);
            searchAfter = await options.onOrphanRetry();
            toolsTerminalSince = null;
          } catch (err) {
            console.warn("[ladcraft-r7_new] orphan retry failed", err);
          }
        }
      }
    }
    await invokePoll(onPoll, messages);
    await sleep(pollMs);
  }
  return null;
}

/** Short poll for kind=widget message after clarification text. */
export async function waitForWidgetMessage(
  client: EaiClient,
  sessionId: string,
  afterMessageCount: number,
  timeoutMs = 15_000,
): Promise<HistoryMessage | null> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const messages = await getHistoryMessages(client, sessionId);
    const widget = findLatestWidgetAfter(messages, afterMessageCount);
    if (widget && (widget.widget_html?.trim() || extractWidgetPayload(widget))) {
      return widget;
    }
    await sleep(1500);
  }
  return null;
}

/** Extract user-visible text (excludes internal reasoning and tool payloads). */
export function extractText(message: HistoryMessage): string {
  return extractVisibleText(message);
}

/** Prefer timeline text chunks; ignore reasoning/tool_call when timeline is present. */
export function extractVisibleText(message: HistoryMessage): string {
  const timeline = message.response_timeline ?? [];
  const fromTimeline = joinTimelineVisibleText(timeline);
  const fromContent = collapseDuplicatedAssistantBody(
    stripAgentServiceMarkup(stripLeakedToolPayload(message.content?.trim() ?? "")),
  );

  if (
    fromContent.length > fromTimeline.length &&
    !isTemplateBodyDump(fromContent) &&
    (isComparisonReport(fromContent) || isSubstantiveResult(fromContent))
  ) {
    return fromContent;
  }
  // Prefer shorter non-duplicated body when timeline join inflated the answer.
  if (
    fromContent &&
    fromTimeline &&
    fromTimeline.length > fromContent.length * 1.4 &&
    fromTimeline.replace(/\s+/g, " ").includes(fromContent.replace(/\s+/g, " ").slice(0, 80))
  ) {
    return fromContent;
  }
  // Prefer longer body.text when timeline only kept a short post-tool status
  // («Формулирую…») while content already has the full clarification / answer.
  if (
    fromContent.length >= 80 &&
    fromContent.length > fromTimeline.length &&
    (fromTimeline.length < 80 || looksLikeInProgressReply(fromTimeline))
  ) {
    return fromContent;
  }
  return fromTimeline || fromContent;
}

/**
 * Full assistant text for intent-apply (keeps r7.proposal wherever the server put it).
 * Prefers any chunk that already contains a proposal fence/JSON.
 */
export function extractApplySourceText(message: HistoryMessage): string {
  const chunks: string[] = [];
  const content = stripAgentServiceMarkup(stripLeakedToolPayload(message.content?.trim() ?? ""));
  if (content) chunks.push(content);

  for (const entry of message.response_timeline ?? []) {
    if (entry.kind !== "text" || !entry.content?.trim()) continue;
    const part = stripAgentServiceMarkup(entry.content.trim());
    if (part) chunks.push(part);
  }

  const withProposal = chunks.filter((c) => /r7\.proposal\/v1|```r7\.proposal/i.test(c));
  if (withProposal.length) {
    // Longest chunk that still carries the proposal (usually full reply).
    withProposal.sort((a, b) => b.length - a.length);
    return withProposal[0];
  }

  const joined = chunks.join("\n\n").trim();
  return joined || extractVisibleText(message);
}

function joinTimelineVisibleText(
  timeline: NonNullable<HistoryMessage["response_timeline"]>,
): string {
  const textEntries = timeline
    .map((entry, index) => ({
      kind: entry.kind,
      content: entry.content?.trim() ?? "",
      index,
    }))
    .filter((entry) => entry.kind === "text" && entry.content);

  if (!textEntries.length) return "";

  const strippedParts = textEntries
    .map((entry) => ({
      ...entry,
      content: stripAgentServiceMarkup(entry.content),
    }))
    .filter((entry) => entry.content.trim());

  if (!strippedParts.length) return "";

  const hasToolGroup = timeline.some((entry) => entry.kind === "tool_group");
  const lastPart = strippedParts[strippedParts.length - 1];

  if (hasToolGroup && strippedParts.length > 1 && isTemplatePickerMessage(lastPart.content)) {
    const preamble = strippedParts
      .slice(0, -1)
      .map((entry) => entry.content)
      .filter((content) => content && !isTemplatePickerMessage(content))
      .join("\n\n")
      .trim();
    if (preamble) return `${preamble}\n\n${lastPart.content}`;
    return lastPart.content;
  }

  // With tools: keep only the final text chunk. Intermediate "thinking aloud"
  // between tool_groups must not appear in the client chat.
  if (hasToolGroup && strippedParts.length > 1) {
    return lastPart.content;
  }

  // Cumulative SSE snapshots: later text entries often contain earlier ones.
  // Joining them duplicates the answer in chat.
  if (strippedParts.length > 1) {
    const lastNorm = lastPart.content.replace(/\s+/g, " ").trim();
    const earlierContained =
      lastNorm.length >= 40 &&
      strippedParts.slice(0, -1).every((p) => {
        const n = p.content.replace(/\s+/g, " ").trim();
        return !n || lastNorm.includes(n) || n.includes(lastNorm);
      });
    if (earlierContained) {
      return lastPart.content;
    }
    const priorJoined = strippedParts
      .slice(0, -1)
      .map((p) => p.content)
      .join("\n\n");
    // Two model drafts in one turn (pre/post tool) — keep the later answer.
    if (assistantBodiesNearDuplicate(priorJoined, lastPart.content)) {
      return lastPart.content;
    }
  }

  return collapseDuplicatedAssistantBody(
    strippedParts.map((entry) => entry.content).join("\n\n"),
  );
}

function significantAssistantTokens(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[`*_#>\[\]()«»""]/g, " ")
      .split(/[^\p{L}\p{N}/._-]+/u)
      .filter((w) => w.length > 3),
  );
}

function tokenJaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const t of a) {
    if (b.has(t)) inter += 1;
  }
  return inter / (a.size + b.size - inter);
}

function sharedSessionPath(a: string, b: string): boolean {
  const re = /\/session\/[^\s`"'<>]+/g;
  const pa = a.match(re) || [];
  const pb = b.match(re) || [];
  return pa.some((p) => pb.includes(p));
}

/** True when two assistant bodies restate the same answer (wording may drift). */
export function assistantBodiesNearDuplicate(a: string, b: string): boolean {
  const na = a.replace(/\s+/g, " ").trim();
  const nb = b.replace(/\s+/g, " ").trim();
  if (!na || !nb) return false;
  if (na === nb) return true;
  if (na.includes(nb) || nb.includes(na)) {
    const ratio = Math.min(na.length, nb.length) / Math.max(na.length, nb.length);
    if (ratio >= 0.55) return true;
  }
  const ja = tokenJaccard(significantAssistantTokens(na), significantAssistantTokens(nb));
  if (ja >= 0.55 && Math.min(na.length, nb.length) >= 60) return true;
  if (sharedSessionPath(na, nb) && ja >= 0.4 && Math.min(na.length, nb.length) >= 80) {
    return true;
  }
  return false;
}

/** Drop accidental double-paste of the same answer body. */
export function collapseDuplicatedAssistantBody(text: string): string {
  const raw = String(text || "").trim();
  if (raw.length < 80) return raw;

  const byBlank = raw.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  if (byBlank.length >= 2) {
    // Repeated half of the message (same capability list pasted twice).
    if (byBlank.length >= 4) {
      for (let i = 1; i < byBlank.length; i++) {
        const left = byBlank.slice(0, i).join("\n\n");
        const right = byBlank.slice(i).join("\n\n");
        if (right.length >= 60 && assistantBodiesNearDuplicate(left, right)) {
          return left.trim();
        }
      }
    }

    const deduped: string[] = [];
    for (const part of byBlank) {
      const dup = deduped.some((prev) => assistantBodiesNearDuplicate(prev, part));
      if (!dup) deduped.push(part);
    }
    if (deduped.length < byBlank.length) {
      return deduped.join("\n\n").trim();
    }
  }

  const flat = raw.replace(/\s+/g, " ").trim();
  const half = Math.floor(flat.length / 2);
  if (half >= 60) {
    const left = flat.slice(0, half).trim();
    const right = flat.slice(half).trim();
    if (assistantBodiesNearDuplicate(left, right)) {
      return byBlank.length
        ? byBlank.slice(0, Math.ceil(byBlank.length / 2)).join("\n\n").trim()
        : left;
    }
  }

  // Near-duplicate trailing block (capabilities list repeated with small drift).
  const marker = /(?:что ещё я могу|не поддерживаю)/i;
  const marks: number[] = [];
  for (let i = 0; i < byBlank.length; i++) {
    if (marker.test(byBlank[i])) marks.push(i);
  }
  if (marks.length >= 2) {
    const cut = marks[Math.floor(marks.length / 2)];
    if (cut > 0 && cut < byBlank.length) {
      const left = byBlank.slice(0, cut).join("\n\n");
      const right = byBlank.slice(cut).join("\n\n");
      if (assistantBodiesNearDuplicate(left, right) || right.length > 40) {
        // If the second half restarts the same sections, keep the first.
        if (/шапк|выделен|жирн/i.test(left) && marker.test(right)) {
          return left.trim();
        }
      }
    }
  }

  return raw;
}

function stripLeakedToolPayload(text: string): string {
  return text
    .replace(/\{"command"\s*:\s*"[^"]*"\}/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function findLatestAssistantAfter(
  messages: HistoryMessage[],
  afterCount: number,
): HistoryMessage | null {
  let latest: HistoryMessage | null = null;
  for (let i = afterCount; i < messages.length; i++) {
    if (messages[i].role === "assistant") latest = messages[i];
  }
  return latest;
}

/** Assistant reply for the latest user message in the current turn. */
function findLatestAssistantForTurn(
  messages: HistoryMessage[],
  afterCount: number,
): HistoryMessage | null {
  let lastUserIdx = -1;
  for (let i = afterCount; i < messages.length; i++) {
    if (messages[i].role === "user") lastUserIdx = i;
  }
  const searchFrom = lastUserIdx >= 0 ? lastUserIdx + 1 : afterCount;
  return findLatestAssistantAfter(messages, searchFrom);
}

function hasFinalAssistantText(message: HistoryMessage): boolean {
  return Boolean(extractText(message).trim());
}

const COMPARISON_COMPLETE_MARKERS =
  /(?:сравнен[иеё]*\s+завершен|расхождени[йя]\s*[:：]\s*\d+)/i;

const IN_PROGRESS_TEXT_END =
  /(?:запускаю|сравниваю|читаю|анализирую|выполняю|ожидайте|подождите|проведу сравнен|начинаю сравнен|сейчас проведу)[\s.…]*$/i;

const INTERIM_COMPARE_ACK =
  /(?:сейчас проведу|проведу сравнен|запускаю сравнен|начинаю сравнен|выполняю сравнен|сравниваю документ)/i;

function getTimeline(message: HistoryMessage): NonNullable<HistoryMessage["response_timeline"]> {
  return message.response_timeline ?? [];
}

function hasPendingToolCalls(message: HistoryMessage): boolean {
  const calls = message.tool_calls;
  if (!calls?.length) return false;
  return calls.some((tc) => {
    const status = tc.status?.toLowerCase();
    if (status === "completed" || status === "failed" || status === "error") {
      return false;
    }
    return tc.result === undefined && tc.success !== true;
  });
}

/** True when every recorded tool call has a terminal status or result. */
function allToolCallsTerminal(message: HistoryMessage): boolean {
  const calls = message.tool_calls;
  if (!calls?.length) return false;
  return !hasPendingToolCalls(message);
}

function hasInFlightToolGroups(message: HistoryMessage): boolean {
  const timeline = getTimeline(message);
  const hasUncompletedGroup = timeline.some(
    (t) =>
      t.kind === "tool_group" &&
      t.status != null &&
      t.status !== "completed" &&
      t.status !== "failed",
  );
  if (!hasUncompletedGroup) return false;
  // Ladcraft may leave tool_group as "started" after all tool_calls finished.
  if (allToolCallsTerminal(message)) return false;
  return true;
}

/** True when Ladcraft reports the assistant message turn is still streaming tokens. */
function isMessageStreaming(message: HistoryMessage): boolean {
  const status = message.status?.toLowerCase();
  if (!status) return false;
  // Clarification / widget wait — not streaming; must show the question in the plugin.
  if (isWaitingForUserInput(message)) return false;
  if (
    status === "waiting_user_response" ||
    status === "waiting_for_user" ||
    status === "requires_action" ||
    status === "needs_input" ||
    status === "awaiting_user"
  ) {
    return false;
  }
  return status !== "completed" && status !== "done" && status !== "failed" && status !== "error";
}

/** True when Ladcraft reports the assistant message turn is finished. */
function isMessageTerminal(message: HistoryMessage): boolean {
  const status = message.status?.toLowerCase();
  if (!status) return false;
  return status === "completed" || status === "done" || status === "failed" || status === "error";
}

/** True when tools finished but the assistant never produced user-visible text. */
export function isAssistantTurnStalled(message: HistoryMessage): boolean {
  if (message.role !== "assistant") return false;
  if (extractVisibleText(message).trim()) return false;
  if (isWidgetMessage(message)) return false;
  if (!isMessageTerminal(message)) return false;
  if (hasPendingToolCalls(message)) return false;
  if (hasInFlightToolGroups(message)) return false;
  return true;
}

/** True when history has an assistant turn without user-visible text yet. */
export function isAssistantInProgress(message: HistoryMessage): boolean {
  if (message.role !== "assistant") return false;
  if (extractVisibleText(message).trim()) return false;
  if (isWidgetMessage(message)) return false;
  if (isAssistantTurnStalled(message)) return false;
  if (isAssistantStillThinking(message)) return true;
  if (hasPendingToolCalls(message)) return true;
  if (isMessageStreaming(message)) return true;
  return false;
}

function looksLikeInProgressReply(text: string): boolean {
  const body = text.trim();
  if (!body) return false;
  if (COMPARISON_COMPLETE_MARKERS.test(body)) return false;
  if (INTERIM_COMPARE_ACK.test(body) && !COMPARISON_COMPLETE_MARKERS.test(body)) {
    return true;
  }
  if (IN_PROGRESS_TEXT_END.test(body)) return true;
  if (/^(?:выбран шаблон|навык активирован)/i.test(body) && body.length < 400) {
    return true;
  }
  return false;
}

/** True when user picked a template but compare report is not in history yet. */
export function isAwaitingCompareReport(messages: HistoryMessage[]): boolean {
  let lastUser = -1;
  let lastUserText = "";
  for (let i = 0; i < messages.length; i++) {
    if (messages[i].role === "user") {
      lastUser = i;
      lastUserText = messages[i].content?.trim() ?? "";
    }
  }
  if (lastUser < 0) return false;
  if (!isCompareTurnRequest(lastUserText, messages)) return false;

  for (let i = lastUser + 1; i < messages.length; i++) {
    const item = messages[i];
    if (item.role !== "assistant") continue;
    if (isComparisonReport(extractVisibleText(item))) return false;
  }
  return true;
}

function isAssistantStillThinking(message: HistoryMessage): boolean {
  const timeline = getTimeline(message);
  const hasText = hasFinalAssistantText(message);

  if (hasInFlightToolGroups(message)) return true;
  if (hasPendingToolCalls(message)) return true;

  const visible = extractText(message);
  if (looksLikeInProgressReply(visible)) return true;

  let lastStartedToolIdx = -1;
  let lastTextIdx = -1;
  for (let i = 0; i < timeline.length; i++) {
    const item = timeline[i];
    if (item.kind === "tool_group" && item.status === "started") {
      lastStartedToolIdx = i;
    }
    if (item.kind === "text" && item.content?.trim()) {
      lastTextIdx = i;
    }
  }

  // Text after the last in-flight tool group → turn is presentable (matches Ladcraft web UI).
  if (hasText && lastTextIdx > lastStartedToolIdx) {
    return false;
  }
  if (lastStartedToolIdx >= 0 && lastTextIdx < lastStartedToolIdx) {
    if (!isMessageTerminal(message)) return true;
    return false;
  }

  if (hasText) return false;
  // Tools done — agent may still be writing the user-visible reply.
  if (allToolCallsTerminal(message) && !isMessageTerminal(message)) return true;
  if (timeline.some((t) => t.kind === "tool_call")) return true;
  if (timeline.some((t) => t.kind === "reasoning")) return true;
  return false;
}

/** User-facing text sufficient to end active wait (picker or substantive reply). */
export function isRenderableAssistantText(text: string): boolean {
  const body = text.trim();
  if (!body) return false;
  return isTemplatePickerMessage(body) || isSubstantiveResult(body);
}

/** True when assistant turn can be shown and active wait may end. */
export function isAssistantReplyReady(
  message: HistoryMessage,
  options: { treatStalledAsReady?: boolean } = {},
): boolean {
  if (message.role !== "assistant") return false;
  // Must run before isMessageStreaming — Ladcraft often keeps a non-completed
  // status while waiting_user_response, which previously blocked the whole UI.
  if (isWaitingForUserInput(message) && hasFinalAssistantText(message)) return true;
  // Excel: tool userReply / «Файл:» is enough. Do not wait for status=completed —
  // history poll already shows the bubble while isSending stayed true.
  if (
    hasReadyAnalyticsDeliverable(message) &&
    !hasPendingToolCalls(message) &&
    !hasInFlightToolGroups(message)
  ) {
    return true;
  }
  if (isMessageStreaming(message)) return false;
  if (isWidgetMessage(message)) return true;
  if (isAssistantStillThinking(message)) return false;
  if (options.treatStalledAsReady && isAssistantTurnStalled(message)) return true;
  if (!hasFinalAssistantText(message)) return false;

  const visible = extractText(message);
  // Short terminal acks («Готово.» after r7_replace_selection) must end the wait.
  // Otherwise isSubstantiveResult rejects them (<120 chars) and the UI stays locked
  // for the full DEFAULT_ASSISTANT_WAIT_MS (~5 min).
  if (
    isMessageTerminal(message) &&
    (!message.tool_calls?.length || allToolCallsTerminal(message)) &&
    !looksLikeInProgressReply(visible)
  ) {
    return true;
  }

  return isRenderableAssistantText(visible);
}

function getProgressLabel(message: HistoryMessage): string {
  const timeline = getTimeline(message);
  const hasActiveTools =
    hasInFlightToolGroups(message) ||
    timeline.some((t) => t.kind === "tool_group" && t.status === "started");
  if (hasActiveTools && !hasFinalAssistantText(message)) {
    return "Агент выполняет действия...";
  }
  if (hasActiveTools) {
    return "Агент формирует ответ...";
  }
  if (
    allToolCallsTerminal(message) &&
    !hasFinalAssistantText(message) &&
    !isMessageTerminal(message)
  ) {
    return "Агент формирует ответ...";
  }
  if (timeline.some((t) => t.kind === "reasoning" || t.kind === "tool_call")) {
    return "Агент размышляет...";
  }
  return "Ожидание ответа...";
}

function unwrapSessionId(res: Record<string, unknown>): string {
  if (typeof res.session_id === "string") return res.session_id;
  const result = res.result;
  if (result && typeof result === "object" && !Array.isArray(result)) {
    const id = (result as Record<string, unknown>).session_id;
    if (typeof id === "string") return id;
  }
  throw new Error("Ответ API не содержит session_id");
}

function normalizeHistoryMessage(raw: Record<string, unknown>): HistoryMessage {
  const msg = raw as unknown as HistoryMessage;
  if (!msg.response_timeline && Array.isArray(raw.responseTimeline)) {
    msg.response_timeline = raw.responseTimeline as HistoryMessage["response_timeline"];
  }
  if (!msg.tool_calls && Array.isArray(raw.toolCalls)) {
    msg.tool_calls = raw.toolCalls as HistoryMessage["tool_calls"];
  }
  if (!msg.widget_html && typeof raw.widgetHtml === "string") {
    msg.widget_html = raw.widgetHtml;
  }
  if (!msg.widget_id && typeof raw.widgetId === "string") {
    msg.widget_id = raw.widgetId;
  }
  if (!msg.widget_name && typeof raw.widgetName === "string") {
    msg.widget_name = raw.widgetName;
  }
  if (!msg.widget_app_id && typeof raw.widgetAppId === "string") {
    msg.widget_app_id = raw.widgetAppId;
  }
  return msg;
}

function unwrapHistoryMessages(res: Record<string, unknown>): HistoryMessage[] {
  let raw: unknown[] = [];
  if (Array.isArray(res.data)) {
    raw = res.data;
  } else {
    const result = res.result;
    if (result && typeof result === "object" && !Array.isArray(result)) {
      const obj = result as Record<string, unknown>;
      if (Array.isArray(obj.data)) raw = obj.data;
      else if (Array.isArray(obj.messages)) raw = obj.messages;
    } else if (Array.isArray(res.messages)) {
      raw = res.messages;
    }
  }
  return raw
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
    .map(normalizeHistoryMessage);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function invokePoll(
  onPoll: ((messages: HistoryMessage[]) => void | Promise<void>) | undefined,
  messages: HistoryMessage[],
): Promise<void> {
  if (!onPoll) return;
  await onPoll(messages);
}
