import type { EaiClient } from "./client";
import {
  cancelAgUiRun,
  runAgUiAgent,
  type AgUiFileRef,
  type AgUiRunResult,
} from "./ag-ui-run";
import type { ChatTransport, ChatTransportCallbacks } from "./transport";

interface TurnState {
  enabled: boolean;
  sawMessageDone: boolean;
  syncedAfterDone: boolean;
}

export interface AgUiRunMessageOptions {
  threadId: string;
  content: string;
  fileRefs?: AgUiFileRef[];
  attachEditorFile?: boolean;
}

/**
 * AG-UI transport: POST /v2/agent/run SSE drives the same ChatTransportCallbacks
 * as legacy session SSE. subscribe() only stores callbacks (no GET /sse).
 */
export class AgUiTransport implements ChatTransport {
  readonly mode = "ag-ui" as const;

  private callbacks: ChatTransportCallbacks = {};
  private turn: TurnState | null = null;
  private abortController: AbortController | null = null;
  private activeRunId: string | null = null;
  private lastEventId: string | null = null;
  private lastSeq = 0;
  private activeThreadId: string | null = null;

  constructor(private readonly client: EaiClient) {}

  beginTurn(): void {
    this.abortController?.abort();
    this.abortController = null;
    this.activeRunId = null;
    this.turn = {
      enabled: true,
      sawMessageDone: false,
      syncedAfterDone: false,
    };
  }

  subscribe(_sessionId: string, callbacks: ChatTransportCallbacks): void {
    if (!this.turn) this.beginTurn();
    this.callbacks = callbacks;
  }

  unsubscribe(): void {
    this.abortController?.abort();
    this.abortController = null;
    this.callbacks = {};
    this.turn = null;
    this.activeRunId = null;
    this.activeThreadId = null;
  }

  isStreamingActive(): boolean {
    return Boolean(this.turn?.enabled && !this.turn.sawMessageDone);
  }

  getWaitPollMs(): number {
    return this.turn?.enabled ? 5000 : 1200;
  }

  shouldDeferHistorySync(): boolean {
    return this.isStreamingActive();
  }

  markHistorySynced(): void {
    if (this.turn) this.turn.syncedAfterDone = true;
  }

  needsPostStreamHistorySync(): boolean {
    return Boolean(
      this.turn?.enabled && this.turn.sawMessageDone && !this.turn.syncedAfterDone,
    );
  }

  disableStreamingForTurn(): void {
    if (this.turn) {
      this.turn.enabled = false;
      this.turn.sawMessageDone = true;
    }
  }

  getActiveRunId(): string | null {
    return this.activeRunId;
  }

  getLastSeq(): number {
    return this.lastSeq;
  }

  /** Send user turn via AG-UI and stream TEXT_MESSAGE_* into subscribed callbacks. */
  async runMessage(options: AgUiRunMessageOptions): Promise<AgUiRunResult> {
    if (!this.turn) this.beginTurn();
    this.activeThreadId = options.threadId;
    this.abortController = new AbortController();

    const wrapped: ChatTransportCallbacks = {
      onMessageStart: (messageId) => this.callbacks.onMessageStart?.(messageId),
      onDelta: (messageId, delta, accumulated) =>
        this.callbacks.onDelta?.(messageId, delta, accumulated),
      onMessageDone: (messageId, status) => {
        if (this.turn) this.turn.sawMessageDone = true;
        this.callbacks.onMessageDone?.(messageId, status);
      },
      onFileReferences: (messageId, files) =>
        this.callbacks.onFileReferences?.(messageId, files),
      onReplayReset: () => {
        this.disableStreamingForTurn();
        this.callbacks.onReplayReset?.();
      },
      onError: (error) => {
        this.disableStreamingForTurn();
        this.callbacks.onError?.(error);
      },
    };

    let result = await runAgUiAgent(
      this.client,
      {
        threadId: options.threadId,
        content: options.content,
        fileRefs: options.fileRefs,
        attachEditorFile: options.attachEditorFile,
        signal: this.abortController.signal,
      },
      wrapped,
    );
    this.activeRunId = result.runId;
    this.lastEventId = result.lastEventId || null;
    this.lastSeq = result.lastSeq;

    // Connection closed without terminal event — one reconnect attempt.
    if (result.outcome === "closed" && result.runId && this.turn?.enabled) {
      result = await runAgUiAgent(
        this.client,
        {
          threadId: options.threadId,
          content: "",
          runId: result.runId,
          afterSeq: result.lastSeq,
          lastEventId: result.lastEventId || undefined,
          reconnect: true,
          signal: this.abortController.signal,
        },
        wrapped,
      );
      this.lastEventId = result.lastEventId || this.lastEventId;
      this.lastSeq = result.lastSeq || this.lastSeq;
    }

    if (this.turn && !this.turn.sawMessageDone) {
      this.turn.sawMessageDone = true;
    }

    if (result.outcome === "error" && result.errorMessage && result.errorMessage !== "aborted") {
      // Stream often ends with RUN_ERROR "network error" after the model already
      // finished — do not wipe the turn; projection/history still has the reply.
      const painted = String(result.responseText || "").trim();
      if (painted.length >= 40 || this.turn?.sawMessageDone) {
        console.warn(
          "[ladcraft-r7_agui] AG-UI RUN_ERROR after content — soft success:",
          result.errorMessage,
        );
        return result;
      }
      throw new Error(result.errorMessage);
    }

    return result;
  }

  /** Cancel in-flight AG-UI run on the server (aborting fetch alone is not enough). */
  async cancelActiveRun(): Promise<void> {
    const runId = this.activeRunId;
    const threadId = this.activeThreadId;
    this.abortController?.abort();
    this.abortController = null;
    this.disableStreamingForTurn();
    if (!runId || !threadId) return;
    try {
      await cancelAgUiRun(this.client, runId, threadId);
    } catch (err) {
      console.warn("[ladcraft-r7_agui] cancelAgUiRun", err);
    }
  }
}

export function isAgUiTransport(transport: ChatTransport): transport is AgUiTransport {
  return transport.mode === "ag-ui";
}
