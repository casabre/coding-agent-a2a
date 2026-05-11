/**
 * Server configuration resolved from environment variables at startup.
 * See `src/config.ts` for the parsing logic and `.env.example` for all defaults.
 */
export interface Config {
  /** HTTP port for the A2A JSON-RPC endpoint and (when `mcpTransport === 'http'`) the MCP endpoint. */
  port: number;
  /** Adapter identifier. Must be a key in the adapter registry (`"cursor"` | `"claude-code"`). */
  agentAdapter: string;
  /** Optional model override forwarded to the CLI. `undefined` uses the CLI's default. */
  agentModel: string | undefined;
  /** Hard timeout in ms. The process is killed after this duration. `0` disables the timeout. */
  agentTimeoutMs: number;
  /**
   * Idle-kill threshold in ms. The process is killed if no stdout arrives for this long.
   * `0` disables idle detection. Useful to recover from hung processes.
   */
  agentIdleExitMs: number;
  /** When `true`, the adapter emits the flag that bypasses shell-command approval prompts. */
  agentForce: boolean;
  /** Absolute path (or `.`) passed as `cwd` to the spawned CLI process. */
  agentRepoPath: string;
  /**
   * How the MCP protocol surface is exposed.
   * - `"stdio"` — Claude Desktop spawns this process; a second McpServer instance handles stdio.
   * - `"http"` — MCP is mounted at `/mcp` on the same HTTP server as A2A.
   */
  mcpTransport: 'stdio' | 'http';
  /** Logging verbosity. `"debug"` logs unparsed CLI lines; `"warn"` and above are production-suitable. */
  logLevel: 'debug' | 'info' | 'warn' | 'error';
}
