import type { AgentEvent } from './adapters/base.js';

/**
 * Transport-agnostic execution port.
 *
 * A runner drives a single coding task to completion and re-emits its progress
 * as typed {@link AgentEvent}s. {@link ProcessRunner} is the only implementation
 * today (it spawns a CLI subprocess); an HTTP-backed runner can be added later
 * without changing consumers, which depend on this interface rather than on any
 * concrete runner.
 *
 * Lifecycle: construct → {@link start} → (`"agent-event"`…) → `"done"` or `"error"`.
 * To cancel early: {@link cancel}. To answer an `approval_required` event: {@link resume}.
 */
export interface Runner {
  /** Begins execution. Idempotent — calling twice once started is a no-op. */
  start(): void;
  /** Terminates execution as soon as possible. Safe to call after completion. */
  cancel(): void;
  /** Provides an answer to a pending `approval_required` event. */
  resume(answer: string): void;

  /** Emitted for each parsed {@link AgentEvent}. */
  on(event: 'agent-event', listener: (e: AgentEvent) => void): this;
  /** Emitted once when execution finishes (exit code and accumulated stderr). */
  on(event: 'done', listener: (exitCode: number, stderr: string) => void): this;
  /** Emitted if execution cannot start or fails unexpectedly. */
  on(event: 'error', listener: (err: Error) => void): this;
}
