import type { Config } from './types.js';

function parseBool(val: string | undefined, defaultVal: boolean): boolean {
  if (val === undefined) return defaultVal;
  return ['true', '1', 'yes', 'on'].includes(val.toLowerCase());
}

function parseNum(val: string | undefined, defaultVal: number): number {
  if (val === undefined) return defaultVal;
  const n = Number(val);
  if (!Number.isFinite(n) || n < 0) {
    throw new Error(`Invalid numeric env var value: "${val}"`);
  }
  return n;
}

function parseMcpTransport(val: string | undefined): 'stdio' | 'http' {
  if (val === 'http') return 'http';
  return 'stdio';
}

/**
 * Parses all configuration from environment variables and returns a validated {@link Config}.
 *
 * @throws {Error} If a numeric env var cannot be parsed or is negative.
 *   The caller (`src/index.ts`) catches this and exits with code 1.
 */
export function loadConfig(): Config {
  return {
    port: parseNum(process.env['PORT'], 41242),
    agentAdapter: process.env['AGENT_ADAPTER'] ?? 'cursor',
    agentModel: process.env['AGENT_MODEL'] || undefined,
    agentTimeoutMs: parseNum(process.env['AGENT_TIMEOUT_MS'], 120_000),
    agentIdleExitMs: parseNum(process.env['AGENT_IDLE_EXIT_MS'], 0),
    agentForce: parseBool(process.env['AGENT_FORCE'], true),
    agentRepoPath: process.env['AGENT_REPO_PATH'] ?? '.',
    mcpTransport: parseMcpTransport(process.env['MCP_TRANSPORT']),
    logLevel: (process.env['LOG_LEVEL'] as Config['logLevel']) ?? 'info',
  };
}
