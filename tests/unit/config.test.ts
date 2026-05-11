import { describe, it, expect, beforeEach, afterEach } from 'vitest';

const ENV_KEYS = [
  'PORT', 'AGENT_ADAPTER', 'AGENT_MODEL', 'AGENT_TIMEOUT_MS', 'AGENT_IDLE_EXIT_MS',
  'AGENT_FORCE', 'AGENT_REPO_PATH', 'MCP_TRANSPORT', 'LOG_LEVEL',
];

function saveEnv(): Record<string, string | undefined> {
  return Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
}

function restoreEnv(saved: Record<string, string | undefined>) {
  for (const key of ENV_KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
}

let savedEnv: Record<string, string | undefined>;

beforeEach(() => {
  savedEnv = saveEnv();
  for (const key of ENV_KEYS) delete process.env[key];
});

afterEach(() => {
  restoreEnv(savedEnv);
});

async function loadFreshConfig() {
  // Force re-evaluation by busting module cache via a query param trick
  const mod = await import('../../src/config.js?t=' + Date.now());
  return mod.loadConfig();
}

describe('loadConfig', () => {
  it('returns defaults when no env vars are set', async () => {
    const config = await loadFreshConfig();
    expect(config.port).toBe(41242);
    expect(config.agentAdapter).toBe('cursor');
    expect(config.agentModel).toBeUndefined();
    expect(config.agentTimeoutMs).toBe(120_000);
    expect(config.agentIdleExitMs).toBe(0);
    expect(config.agentForce).toBe(true);
    expect(config.agentRepoPath).toBe('.');
    expect(config.mcpTransport).toBe('stdio');
    expect(config.logLevel).toBe('info');
  });

  it('reads PORT from env', async () => {
    process.env['PORT'] = '9000';
    const config = await loadFreshConfig();
    expect(config.port).toBe(9000);
  });

  it('reads AGENT_ADAPTER from env', async () => {
    process.env['AGENT_ADAPTER'] = 'claude-code';
    const config = await loadFreshConfig();
    expect(config.agentAdapter).toBe('claude-code');
  });

  it('reads AGENT_MODEL from env', async () => {
    process.env['AGENT_MODEL'] = 'claude-opus';
    const config = await loadFreshConfig();
    expect(config.agentModel).toBe('claude-opus');
  });

  it('AGENT_MODEL empty string maps to undefined', async () => {
    process.env['AGENT_MODEL'] = '';
    const config = await loadFreshConfig();
    expect(config.agentModel).toBeUndefined();
  });

  it('reads AGENT_TIMEOUT_MS from env', async () => {
    process.env['AGENT_TIMEOUT_MS'] = '30000';
    const config = await loadFreshConfig();
    expect(config.agentTimeoutMs).toBe(30_000);
  });

  it('reads AGENT_IDLE_EXIT_MS from env', async () => {
    process.env['AGENT_IDLE_EXIT_MS'] = '5000';
    const config = await loadFreshConfig();
    expect(config.agentIdleExitMs).toBe(5000);
  });

  it('reads AGENT_FORCE=false from env', async () => {
    process.env['AGENT_FORCE'] = 'false';
    const config = await loadFreshConfig();
    expect(config.agentForce).toBe(false);
  });

  it('reads AGENT_FORCE=true from env', async () => {
    process.env['AGENT_FORCE'] = 'true';
    const config = await loadFreshConfig();
    expect(config.agentForce).toBe(true);
  });

  it('reads AGENT_FORCE=1 from env as true', async () => {
    process.env['AGENT_FORCE'] = '1';
    const config = await loadFreshConfig();
    expect(config.agentForce).toBe(true);
  });

  it('reads AGENT_REPO_PATH from env', async () => {
    process.env['AGENT_REPO_PATH'] = '/my/repo';
    const config = await loadFreshConfig();
    expect(config.agentRepoPath).toBe('/my/repo');
  });

  it('reads MCP_TRANSPORT=http from env', async () => {
    process.env['MCP_TRANSPORT'] = 'http';
    const config = await loadFreshConfig();
    expect(config.mcpTransport).toBe('http');
  });

  it('reads MCP_TRANSPORT=stdio from env', async () => {
    process.env['MCP_TRANSPORT'] = 'stdio';
    const config = await loadFreshConfig();
    expect(config.mcpTransport).toBe('stdio');
  });

  it('reads LOG_LEVEL from env', async () => {
    process.env['LOG_LEVEL'] = 'debug';
    const config = await loadFreshConfig();
    expect(config.logLevel).toBe('debug');
  });

  it('throws for invalid PORT value', async () => {
    process.env['PORT'] = 'not-a-number';
    await expect(loadFreshConfig()).rejects.toThrow(/Invalid numeric/);
  });

  it('throws for negative PORT value', async () => {
    process.env['PORT'] = '-1';
    await expect(loadFreshConfig()).rejects.toThrow(/Invalid numeric/);
  });
});
