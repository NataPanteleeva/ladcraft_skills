import type { EaiClient } from "./client";
import { SessionSseClient } from "./sse";
import type { ChatTransport, ChatTransportCallbacks } from "./transport";

interface TurnState {
  enabled: boolean;
  sawMessageDone: boolean;
  syncedAfterDone: boolean;
}

/** SSE hybrid transport with poll fallback semantics (ladcraft-r7_btn_stream). */
export class SseHybridTransport implements ChatTransport {
  readonly mode = "sse-hybrid" as const;

  private sse: SessionSseClient;
  private turn: TurnState | null = null;

  constructor(
    client: EaiClient,
    options: { fallbackToAgentPath?: boolean } = {},
  ) {
    this.sse = new SessionSseClient(client, {
      fallbackToAgentPath: options.fallbackToAgentPath ?? true,
    });
  }

  beginTurn(): void {
    this.turn = {
      enabled: true,
      sawMessageDone: false,
      syncedAfterDone: false,
    };
  }

  subscribe(sessionId: string, callbacks: ChatTransportCallbacks): void {
    if (!this.turn) this.beginTurn();
    if (!this.turn?.enabled) return;
    this.sse.subscribe(sessionId, {
      onConnectionState: () => undefined,
      onMessageStart: callbacks.onMessageStart,
      onDelta: callbacks.onDelta,
      onMessageDone: (messageId, status) => {
        if (this.turn) this.turn.sawMessageDone = true;
        callbacks.onMessageDone?.(messageId, status);
      },
      onReplayReset: () => {
        this.disableStreamingForTurn();
        callbacks.onReplayReset?.();
      },
      onError: (error) => {
        this.disableStreamingForTurn();
        callbacks.onError?.(error);
      },
    });
  }

  unsubscribe(): void {
    this.sse.unsubscribe();
    this.turn = null;
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
    return Boolean(this.turn?.enabled && this.turn.sawMessageDone && !this.turn.syncedAfterDone);
  }

  disableStreamingForTurn(): void {
    if (this.turn) {
      this.turn.enabled = false;
      this.turn.sawMessageDone = true;
    }
  }
}
