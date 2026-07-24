/** Chat transport abstraction — SSE hybrid today; AG-UI / WebSocket later. */

import type { EaiClient } from "./client";
import type { PluginFeatures } from "../features";
import { PollOnlyTransport } from "./poll-only-transport";
import { SseHybridTransport } from "./sse-hybrid-transport";

export type ChatTransportMode = "sse-hybrid" | "poll-only" | "ag-ui";

export interface ChatTransportCallbacks {
  onMessageStart?: (messageId: string) => void;
  onDelta?: (messageId: string, delta: string, accumulated: string) => void;
  onMessageDone?: (messageId: string, status: string) => void;
  onReplayReset?: () => void;
  onError?: (error: unknown) => void;
}

/** Transport contract used by stream orchestrator and send flow. */
export interface ChatTransport {
  readonly mode: ChatTransportMode;
  /** Prepare transport for a new outbound user turn. */
  beginTurn(): void;
  subscribe(sessionId: string, callbacks: ChatTransportCallbacks): void;
  unsubscribe(): void;
  /** True while a streaming turn is active (suppresses competing history sync). */
  isStreamingActive(): boolean;
  /** Poll interval for waitForAssistantTurn onPoll callback. */
  getWaitPollMs(): number;
  /** Skip intermediate history sync during active stream. */
  shouldDeferHistorySync(): boolean;
  /** Mark stream turn complete after message_done + history sync. */
  markHistorySynced(): void;
  /** Whether post-message_done history sync still pending. */
  needsPostStreamHistorySync(): boolean;
  /** Disable streaming for current turn (replay_reset / SSE error). */
  disableStreamingForTurn(): void;
}

export interface ChatTransportFactoryOptions {
  client: EaiClient;
  features: PluginFeatures;
  fallbackToAgentPath?: boolean;
}

/** Create transport from feature flags. AG-UI falls back to SSE until implemented. */
export function createChatTransport(options: ChatTransportFactoryOptions): ChatTransport {
  const { client, features, fallbackToAgentPath = true } = options;
  if (features.sseStreaming) {
    return new SseHybridTransport(client, { fallbackToAgentPath });
  }
  return new PollOnlyTransport();
}
