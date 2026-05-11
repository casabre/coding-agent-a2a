import { v4 as uuidv4 } from 'uuid';
import type { AgentEvent, CodingAgentAdapter } from '../adapters/base.js';
import type { Config } from '../types.js';
import { CursorRunner } from '../cursor-runner.js';
import { eventBus } from '../event-bus.js';

/** Snapshot of a running or completed MCP job. */
export interface McpJob {
  /** All {@link AgentEvent}s received so far, in arrival order. */
  events: AgentEvent[];
  /** `true` once the underlying CLI process has exited (success or failure). */
  done: boolean;
  /** Exit code of the CLI process. `0` = success. Only meaningful when `done === true`. */
  exitCode: number;
}

/**
 * Tracks in-flight and recently completed MCP coding jobs.
 *
 * Each job maps to one {@link CursorRunner} that spawns the CLI process.
 * Jobs are identified by a UUID returned from {@link startJob}.
 *
 * Lifecycle:
 * 1. {@link startJob} — creates a UUID, spawns the runner, buffers events.
 * 2. {@link pollJob} / {@link getJob} — read accumulated events without side effects.
 * 3. {@link getResult} — returns the final summary; removes the job from memory if done.
 * 4. {@link cancelJob} — terminates the runner immediately and removes the job.
 *
 * All events are also forwarded to the process-wide {@link eventBus} for external subscribers.
 */
export class McpTaskManager {
  private readonly _adapter: CodingAgentAdapter;
  private readonly _config: Config;
  private readonly _jobs = new Map<string, McpJob & { runner: CursorRunner }>();

  constructor(adapter: CodingAgentAdapter, config: Config) {
    this._adapter = adapter;
    this._config = config;
  }

  /**
   * Starts a new coding job and returns its UUID immediately (non-blocking).
   *
   * @param task - The natural-language task prompt sent to the CLI.
   * @param overrides - Optional per-job overrides for model, working directory, or force flag.
   * @returns A UUID string that identifies this job in subsequent calls.
   */
  startJob(task: string, overrides?: { model?: string; repoPath?: string; force?: boolean }): string {
    const jobId = uuidv4();
    const config: Config = {
      ...this._config,
      agentModel: overrides?.model ?? this._config.agentModel,
      agentRepoPath: overrides?.repoPath ?? this._config.agentRepoPath,
      agentForce: overrides?.force ?? this._config.agentForce,
    };
    const runner = new CursorRunner({ task, adapter: this._adapter, config });
    const job: McpJob & { runner: CursorRunner } = {
      runner,
      events: [],
      done: false,
      exitCode: 0,
    };
    this._jobs.set(jobId, job);

    runner.on('agent-event', (event) => {
      job.events.push(event);
      eventBus.emitJobEvent(jobId, event);
    });
    runner.on('done', (code) => {
      job.done = true;
      job.exitCode = code;
    });
    runner.on('error', (err) => {
      job.done = true;
      const errEvent: AgentEvent = { kind: 'error', message: err.message };
      job.events.push(errEvent);
      eventBus.emitJobEvent(jobId, errEvent);
    });
    runner.start();
    return jobId;
  }

  /**
   * Returns a point-in-time snapshot of the job (all events, done flag, exit code).
   * Does not remove the job from memory.
   *
   * @returns `undefined` if `jobId` is unknown or has already been cleaned up.
   */
  getJob(jobId: string): McpJob | undefined {
    const job = this._jobs.get(jobId);
    if (!job) return undefined;
    return { events: job.events, done: job.done, exitCode: job.exitCode };
  }

  /**
   * Returns events that arrived after `sinceLine`, suitable for incremental polling.
   *
   * @param jobId - UUID returned by {@link startJob}.
   * @param sinceLine - Index of the first event to return. Pass `0` for all events,
   *   or the length of the previously received events array to get only new ones.
   * @returns `null` if the job is unknown; otherwise `{ events, done }`.
   */
  pollJob(jobId: string, sinceLine: number): { events: AgentEvent[]; done: boolean } | null {
    const job = this._jobs.get(jobId);
    if (!job) return null;
    return { events: job.events.slice(sinceLine), done: job.done };
  }

  /**
   * Terminates the job's CLI process immediately and removes the job from memory.
   *
   * @returns `false` if the job is unknown (already removed or never started).
   */
  cancelJob(jobId: string): boolean {
    const job = this._jobs.get(jobId);
    if (!job) return false;
    job.runner.cancel();
    this._jobs.delete(jobId);
    return true;
  }

  /**
   * Returns the final result of a job.
   *
   * If the job is done, it is removed from memory after this call (clean-up on read).
   * If the job is still running, the result is returned with `done: false` and the job is kept.
   *
   * @returns `null` if the job is unknown; otherwise `{ summary, stats?, done }`.
   */
  getResult(jobId: string): { summary: string; stats?: unknown; done: boolean } | null {
    const job = this._jobs.get(jobId);
    if (!job) return null;
    const doneEvent = job.events.find(
      (e): e is Extract<AgentEvent, { kind: 'done' }> => e.kind === 'done',
    );
    const result = {
      summary: doneEvent?.summary ?? '',
      stats: doneEvent?.stats,
      done: job.done,
    };
    if (job.done) this._jobs.delete(jobId);
    return result;
  }
}
