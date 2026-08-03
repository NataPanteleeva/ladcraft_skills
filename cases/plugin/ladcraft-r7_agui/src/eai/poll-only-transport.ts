import type { ChatTransport, ChatTransportCallbacks } from "./transport";

/** Poll-only transport — no live token stream (ladcraft-r7 / ladcraft-r7_btn). */
export class PollOnlyTransport implements ChatTransport {
  readonly mode = "poll-only" as const;

  beginTurn(): void {
    /* no-op */
  }

  subscribe(_sessionId: string, _callbacks: ChatTransportCallbacks): void {
    /* no-op */
  }

  unsubscribe(): void {
    /* no-op */
  }

  isStreamingActive(): boolean {
    return false;
  }

  getWaitPollMs(): number {
    return 1200;
  }

  shouldDeferHistorySync(): boolean {
    return false;
  }

  markHistorySynced(): void {
    /* no-op */
  }

  needsPostStreamHistorySync(): boolean {
    return false;
  }

  disableStreamingForTurn(): void {
    /* no-op */
  }
}
