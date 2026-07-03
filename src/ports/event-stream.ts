/**
 * Transport-agnostic pub/sub port for job events and control messages.
 *
 * This is the seam that lets the process-local {@link import('../event-bus.js').EventBus}
 * (the current in-memory implementation) be swapped for a distributed backend
 * (Redis Pub/Sub, NATS, …) without touching producers or consumers — the work gated behind
 * the "second replica needed" trigger. Defined now so that later swap is a swap, not a rewrite.
 */
export interface EventStream {
  /** Publishes `message` on `channel` to all current subscribers. */
  publish(channel: string, message: unknown): void;

  /**
   * Subscribes `handler` to `channel`.
   * @returns An unsubscribe function that removes the handler.
   */
  subscribe(channel: string, handler: (message: unknown) => void): () => void;
}
