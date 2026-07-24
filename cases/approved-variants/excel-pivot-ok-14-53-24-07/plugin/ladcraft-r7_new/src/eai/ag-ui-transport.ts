import type { ChatTransport } from "./transport";
import { SseHybridTransport } from "./sse-hybrid-transport";

/**
 * AG-UI transport placeholder.
 * When Ladcraft exposes AG-UI endpoints, implement subscribe() here
 * and switch createChatTransport() to return AgUiTransport.
 * Until then this class is not wired into the factory.
 */
export class AgUiTransport implements ChatTransport {
  readonly mode = "ag-ui" as const;
  private fallback: SseHybridTransport;

  constructor(fallback: SseHybridTransport) {
    this.fallback = fallback;
  }

  beginTurn(): void {
    this.fallback.beginTurn();
  }

  subscribe(sessionId: string, callbacks: Parameters<SseHybridTransport["subscribe"]>[1]): void {
    this.fallback.subscribe(sessionId, callbacks);
  }

  unsubscribe(): void {
    this.fallback.unsubscribe();
  }

  isStreamingActive(): boolean {
    return this.fallback.isStreamingActive();
  }

  getWaitPollMs(): number {
    return this.fallback.getWaitPollMs();
  }

  shouldDeferHistorySync(): boolean {
    return this.fallback.shouldDeferHistorySync();
  }

  markHistorySynced(): void {
    this.fallback.markHistorySynced();
  }

  needsPostStreamHistorySync(): boolean {
    return this.fallback.needsPostStreamHistorySync();
  }

  disableStreamingForTurn(): void {
    this.fallback.disableStreamingForTurn();
  }
}
