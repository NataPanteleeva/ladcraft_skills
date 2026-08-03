/** Chat transport abstraction — AG-UI primary in this fork; SSE/poll fallback. */

import type { EaiClient } from "./client";
import type { PluginFeatures } from "../features";
import { AgUiTransport } from "./ag-ui-transport";
import { PollOnlyTransport } from "./poll-only-transport";
import { SseHybridTransport } from "./sse-hybrid-transport";

export type ChatTransportMode = "sse-hybrid" | "poll-only" | "ag-ui";

export interface ChatTransportFileRef {
  file_id: string;
  path?: string;
  display_name?: string;
  mime_type?: string;
  file_type?: string;
}

export interface ChatTransportCallbacks {
  onMessageStart?: (messageId: string) => void;
  onDelta?: (messageId: string, delta: string, accumulated: string) => void;
  onMessageDone?: (messageId: string, status: string) => void;
  /** AG-UI CUSTOM eai.message.file_references — early excel buttons. */
  onFileReferences?: (messageId: string, files: ChatTransportFileRef[]) => void;
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
  /** Optional server-side cancellation for transports with an active run id. */
  cancelActiveRun?(): Promise<void>;
}

export interface ChatTransportFactoryOptions {
  client: EaiClient;
  features: PluginFeatures;
  fallbackToAgentPath?: boolean;
}

/** Create transport from feature flags. Default for this fork: AG-UI. */
export function createChatTransport(options: ChatTransportFactoryOptions): ChatTransport {
  const { client, features, fallbackToAgentPath = true } = options;
  if (features.agUiStreaming) {
    return new AgUiTransport(client);
  }
  if (features.sseStreaming) {
    return new SseHybridTransport(client, { fallbackToAgentPath });
  }
  return new PollOnlyTransport();
}
