import { EventEmitter } from 'node:events';
import type { AgentEvent } from './adapters/base.js';

/** Payload emitted on the wildcard `"job:*"` channel. */
export interface JobEvent {
  jobId: string;
  event: AgentEvent;
}

/**
 * Process-wide pub/sub bus for MCP job events.
 *
 * Each MCP job emits on two channels:
 * - `"job:<jobId>"` — per-job channel; used by SSE-style subscribers that track one job.
 * - `"job:*"` — wildcard channel; used by observers that aggregate across all jobs.
 *
 * Subscribe via {@link onJobEvent} or {@link onAllJobEvents} — both return an unsubscribe
 * function to avoid listener leaks.
 */
class EventBus extends EventEmitter {
  /**
   * Emits `event` on both the per-job and wildcard channels.
   *
   * @param jobId - The MCP job UUID.
   * @param event - The {@link AgentEvent} to broadcast.
   */
  emitJobEvent(jobId: string, event: AgentEvent): void {
    this.emit(`job:${jobId}`, event);
    this.emit('job:*', { jobId, event });
  }

  /**
   * Subscribes to all events for a single job.
   *
   * @param jobId - The MCP job UUID to watch.
   * @param handler - Called for each {@link AgentEvent} on that job.
   * @returns An unsubscribe function. Call it when the subscriber is no longer needed.
   */
  onJobEvent(jobId: string, handler: (event: AgentEvent) => void): () => void {
    this.on(`job:${jobId}`, handler);
    return () => this.off(`job:${jobId}`, handler);
  }

  /**
   * Subscribes to events across all jobs.
   *
   * @param handler - Called with a `{ jobId, event }` pair for every event on any job.
   * @returns An unsubscribe function.
   */
  onAllJobEvents(handler: (e: JobEvent) => void): () => void {
    this.on('job:*', handler);
    return () => this.off('job:*', handler);
  }
}

/** Singleton event bus used by {@link McpTaskManager} and any external observers. */
export const eventBus = new EventBus();
