import {
  getStreamingVisibleText,
  STREAMING_WORKING_PLACEHOLDER,
} from "../apply/content-extract";
import type { ChatTransport, ChatTransportCallbacks } from "./transport";
import type { ChatMessage } from "../ui/chat";

export interface StreamOrchestratorHooks {
  getMessages: () => ChatMessage[];
  setMessageText: (messageId: string, text: string) => void;
  upsertAssistantBubble: (messageId: string) => void;
  patchStreamingDom: (messageId: string, text: string, finalize?: boolean) => boolean;
  renderChat: () => void;
  isChatScreen: () => boolean;
}

const DELTA_DEBOUNCE_MS = 160;

/**
 * Manages live assistant bubble during SSE content_delta.
 * Transport sync flags live in ChatTransport; UI state lives here.
 */
export class StreamOrchestrator {
  private messageId: string | null = null;
  private buffer = "";
  private deltaFlushTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly transport: ChatTransport,
    private readonly hooks: StreamOrchestratorHooks,
  ) {}

  beginTurn(): void {
    this.teardownUiState();
    this.transport.beginTurn();
  }

  teardown(): void {
    this.teardownUiState();
    this.transport.unsubscribe();
  }

  subscribe(sessionId: string): void {
    const callbacks: ChatTransportCallbacks = {
      onMessageStart: (messageId) => this.handleMessageStart(messageId),
      onDelta: (messageId, _delta, accumulated) => this.handleDelta(messageId, accumulated),
      onMessageDone: (messageId) => this.handleMessageDone(messageId),
      onReplayReset: () => undefined,
      onError: () => undefined,
    };
    this.transport.subscribe(sessionId, callbacks);
  }

  shouldDeferHistorySync(): boolean {
    return this.transport.shouldDeferHistorySync();
  }

  getWaitPollMs(): number {
    return this.transport.getWaitPollMs();
  }

  async runOnPollSync(syncFn: () => Promise<void>): Promise<void> {
    if (this.transport.shouldDeferHistorySync()) return;
    if (this.transport.mode === "sse-hybrid") {
      if (!this.transport.needsPostStreamHistorySync()) return;
      this.transport.markHistorySynced();
    }
    await syncFn();
  }

  private handleMessageStart(messageId: string): void {
    if (!this.hooks.isChatScreen()) return;
    this.messageId = messageId;
    this.buffer = "";
    this.hooks.upsertAssistantBubble(messageId);
  }

  private handleDelta(messageId: string, accumulated: string): void {
    if (!this.hooks.isChatScreen()) return;
    if (!this.messageId) {
      this.messageId = messageId;
      this.hooks.upsertAssistantBubble(messageId);
    }
    if (this.messageId !== messageId) return;
    this.buffer = accumulated;
    this.queueDeltaPaint(messageId);
  }

  private handleMessageDone(messageId: string): void {
    if (!this.messageId) this.messageId = messageId;
    // Keep streamed markdown; drop streaming chrome. History later only appends questions/actions.
    this.flushDeltaPaint(messageId, true);
  }

  private queueDeltaPaint(messageId: string): void {
    if (this.messageId !== messageId) return;
    if (this.deltaFlushTimer != null) return;
    this.deltaFlushTimer = setTimeout(() => {
      this.deltaFlushTimer = null;
      this.flushDeltaPaint(messageId, false);
    }, DELTA_DEBOUNCE_MS);
  }

  private flushDeltaPaint(messageId: string, finalize: boolean): void {
    if (!this.hooks.isChatScreen()) return;
    if (this.messageId && this.messageId !== messageId) return;
    if (this.deltaFlushTimer != null) {
      clearTimeout(this.deltaFlushTimer);
      this.deltaFlushTimer = null;
    }
    const displayText = getStreamingVisibleText(this.buffer);
    if (!displayText && !finalize) return;
    const text = displayText || STREAMING_WORKING_PLACEHOLDER;
    this.hooks.setMessageText(messageId, text);
    const patched = this.hooks.patchStreamingDom(messageId, text, finalize);
    if (!patched && !finalize) this.hooks.renderChat();
  }

  private teardownUiState(): void {
    if (this.deltaFlushTimer != null) {
      clearTimeout(this.deltaFlushTimer);
      this.deltaFlushTimer = null;
    }
    this.messageId = null;
    this.buffer = "";
  }

  /** Seed streaming placeholder before first SSE event. */
  ensureStreamingPlaceholder(messageId: string): void {
    const messages = this.hooks.getMessages();
    const existing = messages.find((m) => m.id === messageId);
    if (existing) return;
    messages.push({
      id: messageId,
      role: "assistant",
      text: STREAMING_WORKING_PLACEHOLDER,
    });
    this.hooks.renderChat();
  }
}
