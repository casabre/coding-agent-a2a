/**
 * Options passed to {@link CodingAgentAdapter.buildArgv} for every run.
 * The runner fills these from the resolved {@link Config} and any per-job overrides.
 */
export interface RunOptions {
  /** The user's task prompt; passed as the final positional CLI argument. */
  task: string;
  /** Absolute path used as the agent's working directory (`cwd`). */
  repoPath: string;
  /** Model override forwarded to the CLI (e.g. `claude-opus-4-5`). `undefined` means use the CLI's default. */
  model?: string;
  /**
   * When `true`, the adapter must emit the flag that bypasses shell-command approval prompts
   * (e.g. `-f` for Cursor, `--dangerously-skip-permissions` for Claude Code).
   * Defaults to `true`; set to `false` to enable interactive `approval_required` events.
   */
  force?: boolean;
  /** Hard timeout in ms. `0` or `undefined` means no timeout. Adapters may ignore this. */
  timeoutMs?: number;
}

/**
 * Capabilities advertised by an adapter — surfaced in the A2A agent card
 * and in the `coding_agent_info` MCP tool response.
 */
export interface AdapterCapabilities {
  /** Whether the CLI produces streaming NDJSON output (required for real-time events). */
  streaming: boolean;
  /** Whether the CLI supports resuming a previous session by session ID. */
  sessionResume: boolean;
  /** Whether the CLI pauses execution to ask for shell-command approval. */
  shellApproval: boolean;
}

/**
 * Token and timing statistics produced at the end of a successful run.
 * All fields are optional because not every adapter reports all values.
 */
export interface AgentStats {
  /** Prompt tokens consumed. */
  inputTokens?: number;
  /** Completion tokens produced. */
  outputTokens?: number;
  /** Wall-clock duration of the run in milliseconds. */
  durationMs?: number;
}

/**
 * Normalised event emitted by {@link ProcessRunner} for every parsed NDJSON line
 * from the CLI's stdout stream. Discriminated by `kind`.
 *
 * Sequence for a successful run: `init` → one or more (`thinking` | `tool_use` | `tool_result`) → `done`
 * Sequence for a failed run:     `init` → ... → `error`
 * Paused for approval:           ... → `approval_required` (call `runner.resume()` to continue)
 */
export type AgentEvent =
  | { kind: 'init'; sessionId?: string; model?: string }
  | { kind: 'thinking'; text: string }
  | { kind: 'tool_use'; tool: string; input: unknown }
  | { kind: 'tool_result'; tool: string; output: string; isError: boolean }
  | { kind: 'approval_required'; prompt: string }
  | { kind: 'done'; summary: string; stats?: AgentStats }
  | { kind: 'error'; message: string };

/**
 * Transport-agnostic port that every coding-agent adapter must implement,
 * regardless of how the backend is reached (CLI subprocess, HTTP API, …).
 *
 * It owns only what every backend can honor: an identity ({@link name}),
 * advertised {@link capabilities}, and the ability to turn one line of the
 * backend's streamed output into a typed {@link AgentEvent} ({@link parseEvent}).
 *
 * CLI-specific concerns (binary resolution, argv, interactive approval) live in
 * {@link ProcessAdapter}, so an HTTP-backed adapter need not implement them.
 *
 * Adapters are stateless singleton objects — all per-run state lives in the runner.
 *
 * @example Registering a custom adapter
 * ```typescript
 * import { registry } from './adapters/index.js';
 * registry['my-agent'] = new MyAgentAdapter();
 * ```
 */
export interface CodingAgentAdapter {
  /** Unique lower-kebab-case name (e.g. `"cursor"`, `"claude-code"`). Used in logging and the agent card. */
  readonly name: string;

  /** Static capabilities of this adapter. Used in `coding_agent_info` and the A2A agent card. */
  readonly capabilities: AdapterCapabilities;

  /**
   * Parses a single line of the backend's streamed output into a typed {@link AgentEvent}.
   * Returns `null` for lines that should be silently skipped (malformed JSON, unknown type).
   *
   * @param line - A single non-empty, trimmed line from the backend's output stream.
   */
  parseEvent(line: string): AgentEvent | null;
}

/**
 * Adapter for a backend driven as a local CLI subprocess.
 *
 * Extends {@link CodingAgentAdapter} with the process-only concerns:
 * 1. Locating the CLI binary on disk ({@link resolveBinary}).
 * 2. Building the CLI argument vector ({@link buildArgv}).
 * 3. Detecting interactive approval prompts and providing the canned auto-response
 *    ({@link isApprovalPrompt} / {@link approvalResponse}).
 *
 * These methods operate on stdin/stdout/argv and have no meaning for a non-process
 * backend, so they are deliberately kept off the base {@link CodingAgentAdapter}.
 */
export interface ProcessAdapter extends CodingAgentAdapter {
  /**
   * Returns the full path to the CLI binary, or the bare executable name if it is on `PATH`.
   * Reads from an env var first (e.g. `CURSOR_AGENT_PATH`) so users can override without recompiling.
   */
  resolveBinary(): string;

  /**
   * Builds the complete argument vector for `child_process.spawn`.
   * Must include the streaming-NDJSON flag, the task prompt as the last argument,
   * and any optional flags for model, force, etc.
   *
   * @param options - Run-time options resolved from config and per-job overrides.
   * @returns A flat string array passed directly to `spawn` (no shell expansion).
   */
  buildArgv(options: RunOptions): string[];

  /**
   * Returns `true` if the raw stdout line is an interactive approval prompt.
   * Used to emit `approval_required` events before the line is passed to {@link parseEvent}.
   *
   * @param line - A single non-empty, trimmed line from the CLI's stdout.
   */
  isApprovalPrompt(line: string): boolean;

  /**
   * Returns the string to write to the CLI's stdin when auto-approving a prompt.
   * Typically `"y"`. Only called when `AGENT_FORCE=false`.
   */
  approvalResponse(): string;
}
