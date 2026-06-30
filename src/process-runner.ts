import { EventEmitter } from 'node:events';
import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import type { Span } from '@opentelemetry/api';
import { SpanStatusCode } from '@opentelemetry/api';
import type { ProcessAdapter, AgentEvent, AgentStats } from './adapters/base.js';
import type { Runner } from './runner.js';
import type { Config } from './types.js';
import { tracer, inputTokenCounter, outputTokenCounter, taskDurationHist, taskErrorCounter, context } from './telemetry.js';

/** Construction options for {@link ProcessRunner}. */
export interface RunnerOptions {
  /** The task prompt passed as the final CLI argument. */
  task: string;
  /** Adapter that knows how to invoke the specific CLI tool. */
  adapter: ProcessAdapter;
  /** Resolved server configuration (timeout, force flag, cwd, etc.). */
  config: Config;
}

/**
 * Typed event declarations for {@link ProcessRunner}.
 *
 * - `"agent-event"` — emitted for each parsed {@link AgentEvent} from the CLI's stdout.
 * - `"done"` — emitted once when the process exits (exit code and accumulated stderr).
 * - `"error"` — emitted if the process cannot be spawned.
 */
// eslint-disable-next-line @typescript-eslint/no-unsafe-declaration-merging
export declare interface ProcessRunner {
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
export class ProcessRunner extends EventEmitter implements Runner {
  private _child: ChildProcess | null = null;
  private _cancelled = false;
  private _exited = false;
  private _timeoutHandle: ReturnType<typeof setTimeout> | null = null;
  private _idleHandle: ReturnType<typeof setTimeout> | null = null;
  private _stderrBuffer = '';
  private _lastThinkingText = '';
  private _span: Span | null = null;
  private _pendingStats: AgentStats | null = null;
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

    this._span = tracer.startSpan('cli.execute', {
      attributes: { 'agent.adapter': adapter.name, 'agent.repo_path': config.agentRepoPath },
    }, context.active());

    let child: ChildProcess;
    try {
      child = spawn(binary, args, {
        shell: false,
        cwd: config.agentRepoPath,
        env: process.env,
      });
    } catch (err) {
      this._span.setStatus({ code: SpanStatusCode.ERROR, message: String(err) });
      this._span.end();
      this._span = null;
      this.emit(
        'error',
        new Error(`Failed to spawn "${binary}": ${String(err)}`),
      );
      return;
    }

    this._child = child;

    if (child.stdout === null || child.stderr === null) {
      this._finalizeOtel(-1);
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
        if (this._span) {
          this._span.recordException(err);
          this._span.setStatus({ code: SpanStatusCode.ERROR, message: err.message });
          this._span.end();
          this._span = null;
        }
        taskErrorCounter.add(1, { adapter: adapter.name, error_kind: 'spawn_error' });
        this.emit('error', new Error(`Failed to spawn "${binary}": ${err.message}`));
      }
    });

    child.on('close', (code: number | null) => {
      this._clearTimers();
      const exitCode = code ?? -1;
      // Always finalize telemetry regardless of whether this is a normal exit,
      // a cancellation, or a timeout — _finalizeOtel is idempotent.
      this._finalizeOtel(exitCode);
      if (this._cancelled || this._exited) return;
      this._exited = true;
      this.emit('done', exitCode, this._stderrBuffer);
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
      if (event.kind === 'thinking') {
        this._lastThinkingText = event.text;
      }
      if (event.kind === 'done' && event.stats) {
        this._pendingStats = event.stats;
      }
      const emitted = event.kind === 'done' ? { ...event, summary: this._lastThinkingText } : event;
      this.emit('agent-event', emitted);
    } else if (config.logLevel === 'debug') {
      console.warn(`[runner] Unparsed line (skipped): ${line.slice(0, 80)}`);
    }
  }

  private _finalizeOtel(exitCode: number): void {
    if (this._span) {
      const stats = this._pendingStats;
      this._span.setAttributes({
        'agent.exit_code': exitCode,
        'agent.input_tokens': stats?.inputTokens ?? 0,
        'agent.output_tokens': stats?.outputTokens ?? 0,
        'agent.duration_ms': stats?.durationMs ?? 0,
      });
      if (exitCode !== 0) {
        this._span.setStatus({ code: SpanStatusCode.ERROR, message: `exit code ${exitCode}` });
        taskErrorCounter.add(1, { adapter: this._options.adapter.name, error_kind: 'nonzero_exit' });
      }
      this._span.end();
      this._span = null;
    }
    if (this._pendingStats) {
      const s = this._pendingStats;
      const adapterName = this._options.adapter.name;
      inputTokenCounter.add(s.inputTokens ?? 0, { adapter: adapterName });
      outputTokenCounter.add(s.outputTokens ?? 0, { adapter: adapterName });
      taskDurationHist.record(s.durationMs ?? 0, { adapter: adapterName });
      this._pendingStats = null;
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
