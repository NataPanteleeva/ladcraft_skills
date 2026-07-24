import {
  isComparisonReport,
  isSubstantiveResult,
  isTemplateBodyDump,
  isTemplatePickerMessage,
} from "../apply/content-extract";
import type { EaiClient } from "./client";
import type { FileRef } from "../transfer/types";
import { resolveTemplateSelection } from "../transfer/template-selection";
import {
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
 * Delete agent session on the server.
 * Do not call on panel close, Back, or agent switch — use localStorage detach only.
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
}

/** Poll until assistant turn completes; may include a widget clarification. */
export async function waitForAssistantTurn(
  client: EaiClient,
  sessionId: string,
  afterMessageCount: number,
  timeoutMs = DEFAULT_ASSISTANT_WAIT_MS,
  onProgress?: (status: string) => void,
  onPoll?: (messages: HistoryMessage[]) => void | Promise<void>,
  _options: WaitForAssistantTurnOptions = {},
): Promise<AssistantTurnResult | null> {
  const started = Date.now();
  const pollMs = 1200;
  let toolsTerminalSince: number | null = null;
  while (Date.now() - started < timeoutMs) {
    const messages = await getHistoryMessages(client, sessionId);
    const latest = findLatestAssistantForTurn(messages, afterMessageCount);
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
        let widget = findLatestWidgetAfter(messages, afterMessageCount);
        if (!widget && waitingForUser) {
          onProgress?.("Загрузка формы выбора...");
          widget = await waitForWidgetMessage(
            client,
            sessionId,
            afterMessageCount,
            Math.min(15_000, timeoutMs - (Date.now() - started)),
          );
        }
        await invokePoll(onPoll, messages);
        return { reply: latest, widget, waitingForUser };
      }
      onProgress?.(getProgressLabel(latest));
    } else if (messages.length > afterMessageCount) {
      onProgress?.("Ожидание ответа...");
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
    if (widget?.widget_html?.trim()) return widget;
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
  const textParts = timeline
    .filter((t) => t.kind === "text" && t.content?.trim())
    .map((t) => t.content!.trim());
  const fromTimeline = textParts.join("\n\n");
  const fromContent = stripLeakedToolPayload(message.content?.trim() ?? "");

  if (
    fromContent.length > fromTimeline.length &&
    !isTemplateBodyDump(fromContent) &&
    (isComparisonReport(fromContent) || isSubstantiveResult(fromContent))
  ) {
    return fromContent;
  }
  return fromTimeline || fromContent;
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

function isMessageStreaming(message: HistoryMessage): boolean {
  const status = message.status?.toLowerCase();
  if (!status) return false;
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
  if (isMessageStreaming(message)) return false;
  if (isWidgetMessage(message)) return true;
  if (isAssistantStillThinking(message)) return false;
  if (isWaitingForUserInput(message) && hasFinalAssistantText(message)) return true;
  if (options.treatStalledAsReady && isAssistantTurnStalled(message)) return true;
  if (!hasFinalAssistantText(message)) return false;
  return isRenderableAssistantText(extractText(message));
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
