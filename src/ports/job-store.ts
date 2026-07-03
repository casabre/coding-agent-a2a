import type { AgentEvent } from '../adapters/base.js';
import type { TerminalReason } from '../runner.js';

/**
 * Identity of a client-facing caller. `sub` is the JWT subject; `scopes` are its granted
 * scopes. Used to partition jobs by tenant once multi-tenant AuthZ lands (R&S trigger).
 */
export interface Caller {
  sub: string;
  scopes: string[];
}

/** Pending input-required state for a job awaiting a resume answer. */
export interface InputRequired {
  prompt: string;
}

/** Durable record of one coding job. */
export interface JobRecord {
  jobId: string;
  /** Owner/tenant captured at create — the authZ anchor for client-facing mutations. */
  owner?: Caller;
  /** Dedupe key: a repeat create with the same key is a no-op. */
  idempotencyKey?: string;
  events: AgentEvent[];
  done: boolean;
  terminalReason?: TerminalReason;
  waitState?: InputRequired | null;
}

/**
 * Durable job-state port. The current in-memory `Map<jobId, …>` inside `McpTaskManager`
 * is the de-facto implementation today; this interface is defined now (not yet wired) so the
 * durable backend (Redis/Postgres) gated behind the "second replica needed" trigger is a
 * drop-in, and reads/writes get a single contract with the tenant-partitioning seams already
 * in the signatures.
 *
 * Write-side methods (`appendEvent`/`setTerminal`/`setWaitState`/`claimOwner`) are trusted
 * intra-replica writes from the owning runner; client-facing reads/mutations take a
 * {@link Caller} and are authZ-checked against `owner`.
 */
export interface JobStore {
  create(caller: Caller, job: JobRecord): Promise<{ created: boolean }>;
  get(caller: Caller, jobId: string): Promise<JobRecord | null>;
  appendEvent(jobId: string, event: AgentEvent): Promise<number>;
  getEvents(caller: Caller, jobId: string, since: number): Promise<AgentEvent[]>;
  setWaitState(jobId: string, wait: InputRequired | null): Promise<void>;
  setTerminal(jobId: string, reason: TerminalReason): Promise<void>;
  claimOwner(jobId: string, replicaId: string): Promise<boolean>;
  reapOrphans(opts: { before: number; deadReplicas: string[] }): Promise<string[]>;
}
