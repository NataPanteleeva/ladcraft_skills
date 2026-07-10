import type { EaiClient } from "./client";

type ConnectionState = "connecting" | "open" | "reconnecting" | "closed";

interface SseEnvelope {
  session_id?: string;
  type?: string;
  data?: unknown;
  timestamp?: string;
}

interface EventPayload {
  type: string;
  eventId: string | null;
  envelope: SseEnvelope | null;
  data: Record<string, unknown>;
}

export interface SessionSseCallbacks {
  onConnectionState?: (state: ConnectionState) => void;
  onMessageStart?: (messageId: string) => void;
  onDelta?: (messageId: string, delta: string, accumulated: string) => void;
  onMessageDone?: (messageId: string, status: string) => void;
  onReplayReset?: () => void;
  onError?: (error: unknown) => void;
}

export interface SessionSseOptions {
  fallbackToAgentPath?: boolean;
  reconnectDelayMs?: number;
}

const PRIMARY_EVENTS_PATH = "/v1/agent-api/sessions/{sessionId}/events";
const FALLBACK_EVENTS_PATH = "/v1/agent/sse/{sessionId}";
const DEFAULT_RECONNECT_DELAY_MS = 1200;

/** Session SSE reader for token-by-token assistant text streaming. */
export class SessionSseClient {
  private abortController: AbortController | null = null;
  private callbacks: SessionSseCallbacks = {};
  private sessionId: string | null = null;
  private reconnectDelayMs = DEFAULT_RECONNECT_DELAY_MS;
  private running = false;
  private lastEventId: string | null = null;
  private preferredPathTemplate = PRIMARY_EVENTS_PATH;
  private activeMessageId: string | null = null;
  private accumulated = "";

  constructor(
    private readonly client: EaiClient,
    private readonly options: SessionSseOptions = {},
  ) {}

  getLastEventId(): string | null {
    return this.lastEventId;
  }

  getResolvedPathTemplate(): string {
    return this.preferredPathTemplate;
  }

  isRunning(): boolean {
    return this.running;
  }

  subscribe(sessionId: string, callbacks: SessionSseCallbacks): void {
    this.unsubscribe();
    this.running = true;
    this.callbacks = callbacks;
    this.sessionId = sessionId;
    this.lastEventId = null;
    this.activeMessageId = null;
    this.accumulated = "";
    this.reconnectDelayMs = Math.max(
      300,
      this.options.reconnectDelayMs ?? DEFAULT_RECONNECT_DELAY_MS,
    );
    void this.runLoop();
  }

  unsubscribe(): void {
    this.running = false;
    this.sessionId = null;
    this.activeMessageId = null;
    this.accumulated = "";
    this.abortController?.abort();
    this.abortController = null;
    this.emitState("closed");
  }

  private emitState(state: ConnectionState): void {
    this.callbacks.onConnectionState?.(state);
  }

  private async runLoop(): Promise<void> {
    let firstConnect = true;
    let currentPath = this.preferredPathTemplate;
    while (this.running && this.sessionId) {
      this.emitState(firstConnect ? "connecting" : "reconnecting");
      const response = await this.openStream(currentPath);
      if (!this.running || !this.sessionId) break;
      if (!response) {
        await this.sleep(this.reconnectDelayMs);
        firstConnect = false;
        continue;
      }
      if (!response.ok) {
        const switched = this.trySwitchPathOnError(response.status, currentPath);
        if (switched) {
          currentPath = switched;
          continue;
        }
        this.callbacks.onError?.(
          new Error(`SSE stream failed with HTTP ${response.status}`),
        );
        await this.sleep(this.reconnectDelayMs);
        firstConnect = false;
        continue;
      }

      currentPath = this.preferredPathTemplate;
      this.emitState("open");
      try {
        await this.consumeStream(response);
      } catch (error) {
        if (!this.running) break;
        this.callbacks.onError?.(error);
      }
      firstConnect = false;
      if (this.running) {
        await this.sleep(this.reconnectDelayMs);
      }
    }
  }

  private trySwitchPathOnError(
    status: number,
    currentPath: string,
  ): string | null {
    if (currentPath !== PRIMARY_EVENTS_PATH) return null;
    if (!this.options.fallbackToAgentPath) return null;
    if (status !== 403 && status !== 404) return null;
    this.preferredPathTemplate = FALLBACK_EVENTS_PATH;
    return FALLBACK_EVENTS_PATH;
  }

  private async openStream(pathTemplate: string): Promise<Response | null> {
    const token = this.client.getTokens()?.accessToken;
    if (!token) {
      this.callbacks.onError?.(new Error("Нет access token для SSE"));
      return null;
    }
    const sessionId = this.sessionId;
    if (!sessionId) return null;

    this.abortController?.abort();
    this.abortController = new AbortController();
    const path = pathTemplate.replace("{sessionId}", encodeURIComponent(sessionId));
    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      Accept: "text/event-stream",
    };
    if (this.lastEventId) {
      headers["Last-Event-ID"] = this.lastEventId;
    }
    return fetch(`${this.client.getApiBaseUrl()}${path}`, {
      method: "GET",
      headers,
      signal: this.abortController.signal,
    });
  }

  private async consumeStream(response: Response): Promise<void> {
    if (!response.body) return;
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    while (this.running) {
      const { value, done } = await reader.read();
      if (done) return;
      buffer += decoder.decode(value, { stream: true });

      let chunkEnd = buffer.indexOf("\n\n");
      while (chunkEnd >= 0) {
        const chunk = buffer.slice(0, chunkEnd);
        buffer = buffer.slice(chunkEnd + 2);
        this.handleChunk(chunk);
        chunkEnd = buffer.indexOf("\n\n");
      }
    }
  }

  private handleChunk(chunk: string): void {
    if (!chunk.trim()) return;
    const lines = chunk.split(/\r?\n/);
    let eventName = "";
    let eventId: string | null = null;
    const dataLines: string[] = [];
    for (const line of lines) {
      if (line.startsWith(":")) continue;
      if (line.startsWith("id:")) {
        eventId = line.slice(3).trim();
        continue;
      }
      if (line.startsWith("event:")) {
        eventName = line.slice(6).trim();
        continue;
      }
      if (line.startsWith("data:")) {
        dataLines.push(line.slice(5).trimStart());
      }
    }
    if (eventId) this.lastEventId = eventId;
    const dataRaw = dataLines.join("\n");
    if (!dataRaw) return;

    let envelope: SseEnvelope | null = null;
    try {
      envelope = JSON.parse(dataRaw) as SseEnvelope;
    } catch {
      return;
    }
    const payload = normalizePayload(eventName, eventId, envelope);
    this.handlePayload(payload);
  }

  private handlePayload(payload: EventPayload): void {
    if (payload.type === "replay_reset") {
      this.callbacks.onReplayReset?.();
      return;
    }
    if (payload.type === "message_start") {
      const messageId = readMessageId(payload.data);
      if (!messageId) return;
      this.activeMessageId = messageId;
      this.accumulated = "";
      this.callbacks.onMessageStart?.(messageId);
      return;
    }
    if (payload.type === "content_delta") {
      const messageId = readMessageId(payload.data) ?? this.activeMessageId;
      if (!messageId) return;
      const delta = readDelta(payload.data);
      if (!delta) return;
      this.activeMessageId = messageId;
      this.accumulated += delta;
      this.callbacks.onDelta?.(messageId, delta, this.accumulated);
      return;
    }
    if (payload.type === "message_done") {
      const messageId = readMessageId(payload.data) ?? this.activeMessageId;
      const status = String(payload.data.status ?? "completed");
      if (!messageId) return;
      this.callbacks.onMessageDone?.(messageId, status);
      this.activeMessageId = null;
      this.accumulated = "";
    }
  }

  private async sleep(ms: number): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, ms));
  }
}

function normalizePayload(
  eventName: string,
  eventId: string | null,
  envelope: SseEnvelope | null,
): EventPayload {
  const type = String(envelope?.type ?? eventName ?? "").trim();
  const data = normalizeData(envelope?.data);
  return {
    type,
    eventId,
    envelope,
    data,
  };
}

function normalizeData(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== "object") return {};
  const obj = raw as Record<string, unknown>;
  const nested = obj.data;
  if (nested && typeof nested === "object" && !Array.isArray(nested)) {
    return nested as Record<string, unknown>;
  }
  return obj;
}

function readMessageId(data: Record<string, unknown>): string | null {
  const id = data.message_id ?? data.messageId ?? data.id ?? null;
  if (!id) return null;
  return String(id);
}

function readDelta(data: Record<string, unknown>): string {
  const delta = data.delta ?? data.text_delta ?? data.content_delta ?? "";
  return String(delta);
}
