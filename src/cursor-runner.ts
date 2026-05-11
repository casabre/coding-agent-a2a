import { EventEmitter } from 'node:events';
import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import type { CodingAgentAdapter, AgentEvent } from './adapters/base.js';
import type { Config } from './types.js';

/** Construction options for {@link CursorRunner}. */
export interface RunnerOptions {
  /** The task prompt passed as the final CLI argument. */
  task: string;
  /** Adapter that knows how to invoke the specific CLI tool. */
  adapter: CodingAgentAdapter;
  /** Resolved server configuration (timeout, force flag, cwd, etc.). */
  config: Config;
}

/**
 * Typed event declarations for {@link CursorRunner}.
 *
 * - `"agent-event"` — emitted for each parsed {@link AgentEvent} from the CLI's stdout.
 * - `"done"` — emitted once when the process exits (exit code and accumulated stderr).
 * - `"error"` — emitted if the process cannot be spawned.
 */
// eslint-disable-next-line @typescript-eslint/no-unsafe-declaration-merging
export declare interface CursorRunner {
  on(event: 'agent-event', listener: (e: AgentEvent) => void): this;
  on(event: 'done', listener: (exitCode: number, stderr: string) => void): this;
  on(event: 'error', listener: (err: Error) => void): this;
  emit(event: 'agent-event', e: AgentEvent): boolean;
  emit(event: 'done', exitCode: number, stderr: string): boolean;
  emit(event: 'error', err: Error): boolean;
}

/**
 * Spawns a coding-agent CLI process, streams its NDJSON stdout line-by-line,
 * and re-emits typed {@link AgentEvent}s.
 *
 * Lifecycle: construct → {@link start} → (events) → `"done"` or `"error"`.
 * To cancel early: call {@link cancel} (SIGTERM → SIGKILL after 2 s).
 * To resume after `approval_required`: call {@link resume}.
 */
// eslint-disable-next-line @typescript-eslint/no-unsafe-declaration-merging
export class CursorRunner extends EventEmitter {
  private _child: ChildProcess | null = null;
  private _cancelled = false;
  private _exited = false;
  private _timeoutHandle: ReturnType<typeof setTimeout> | null = null;
  private _idleHandle: ReturnType<typeof setTimeout> | null = null;
  private _stderrBuffer = '';
  private readonly _options: RunnerOptions;

  constructor(options: RunnerOptions) {
    super();
    this._options = options;
  }

  /** Spawns the CLI process and begins streaming. Idempotent — calling twice is a no-op once started. */
  start(): void {
    const { task, adapter, config } = this._options;
    const binary = adapter.resolveBinary();
    const args = adapter.buildArgv({
      task,
      repoPath: config.agentRepoPath,
      model: config.agentModel,
      force: config.agentForce,
      timeoutMs: config.agentTimeoutMs,
    });

    let child: ChildProcess;
    try {
      child = spawn(binary, args, {
        shell: false,
        cwd: config.agentRepoPath,
        env: process.env,
      });
    } catch (err) {
      this.emit(
        'error',
        new Error(`Failed to spawn "${binary}": ${String(err)}`),
      );
      return;
    }

    this._child = child;

    if (child.stdout === null || child.stderr === null) {
      this.emit('error', new Error(`"${binary}" process has no stdout/stderr`));
      return;
    }

    try {
      child.stdin?.end();
    } catch {
      // ignore
    }

    let stdoutBuf = '';

    child.stdout.on('data', (chunk: Buffer) => {
      if (this._cancelled) return;
      stdoutBuf += chunk.toString();
      this._resetIdleTimer();

      let nl: number;
      while ((nl = stdoutBuf.indexOf('\n')) !== -1) {
        const line = stdoutBuf.slice(0, nl).trim();
        stdoutBuf = stdoutBuf.slice(nl + 1);
        if (line.length === 0) continue;
        this._processLine(line);
      }
    });

    child.stderr.on('data', (chunk: Buffer) => {
      this._stderrBuffer += chunk.toString();
    });

    child.on('error', (err: Error) => {
      this._clearTimers();
      if (!this._cancelled && !this._exited) {
        this._exited = true;
        this.emit('error', new Error(`Failed to spawn "${binary}": ${err.message}`));
      }
    });

    child.on('close', (code: number | null) => {
      this._clearTimers();
      if (this._cancelled || this._exited) return;
      this._exited = true;
      this.emit('done', code ?? -1, this._stderrBuffer);
    });

    if (config.agentTimeoutMs > 0) {
      this._timeoutHandle = setTimeout(() => {
        if (!this._exited) {
          this.cancel();
          if (!this._exited) {
            this._exited = true;
            this.emit('done', -1, this._stderrBuffer);
          }
        }
      }, config.agentTimeoutMs);
    }

    this._resetIdleTimer();
  }

  /** Sends SIGTERM to the child process; escalates to SIGKILL after 2 s if still alive. Safe to call after exit. */
  cancel(): void {
    if (this._exited) return;
    this._cancelled = true;
    this._clearTimers();
    const child = this._child;
    if (child === null) return;
    child.kill('SIGTERM');
    const kill = setTimeout(() => {
      if (!this._exited) child.kill('SIGKILL');
    }, 2000);
    kill.unref?.();
  }

  /** Writes `answer` to the child's stdin (followed by a newline) to respond to an `approval_required` prompt. */
  resume(answer: string): void {
    this._child?.stdin?.write(answer + '\n');
  }

  private _processLine(line: string): void {
    const { adapter, config } = this._options;
    if (adapter.isApprovalPrompt(line)) {
      this.emit('agent-event', { kind: 'approval_required', prompt: line });
      return;
    }
    const event = adapter.parseEvent(line);
    if (event !== null) {
      this.emit('agent-event', event);
    } else if (config.logLevel === 'debug') {
      console.warn(`[runner] Unparsed line (skipped): ${line.slice(0, 80)}`);
    }
  }

  private _resetIdleTimer(): void {
    const idleMs = this._options.config.agentIdleExitMs;
    if (idleMs <= 0) return;
    if (this._idleHandle !== null) clearTimeout(this._idleHandle);
    this._idleHandle = setTimeout(() => {
      if (!this._exited) {
        this.cancel();
        if (!this._exited) {
          this._exited = true;
          this.emit('done', 0, this._stderrBuffer);
        }
      }
    }, idleMs);
  }

  private _clearTimers(): void {
    if (this._timeoutHandle !== null) {
      clearTimeout(this._timeoutHandle);
      this._timeoutHandle = null;
    }
    if (this._idleHandle !== null) {
      clearTimeout(this._idleHandle);
      this._idleHandle = null;
    }
  }
}
