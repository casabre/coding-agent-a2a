import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ROUTING_ENV_KEYS = [
  'CONFIG_FILE',
  'ROUTING__COMPLEX__ADAPTER', 'ROUTING__COMPLEX__MODEL',
  'ROUTING__MID__ADAPTER', 'ROUTING__ROUTINE__ADAPTER',
];

function saveEnv() {
  return Object.fromEntries(ROUTING_ENV_KEYS.map((k) => [k, process.env[k]]));
}
function restoreEnv(saved: Record<string, string | undefined>) {
  for (const key of ROUTING_ENV_KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
}
async function loadFreshConfig() {
  const mod = await import('../../../src/config.js?t=' + Date.now());
  return mod.loadConfig();
}

let savedEnv: Record<string, string | undefined>;

beforeEach(() => {
  savedEnv = saveEnv();
  for (const key of ROUTING_ENV_KEYS) delete process.env[key];
});
afterEach(() => restoreEnv(savedEnv));

describe('routing config', () => {
  it('is undefined when neither file nor env provide routing', async () => {
    const config = await loadFreshConfig();
    expect(config.routing).toBeUndefined();
  });

  it('parses nested ROUTING__<PROFILE>__<FIELD> env vars', async () => {
    process.env['ROUTING__COMPLEX__ADAPTER'] = 'cursor';
    process.env['ROUTING__COMPLEX__MODEL'] = 'big-model';
    process.env['ROUTING__MID__ADAPTER'] = 'claude-code';
    process.env['ROUTING__ROUTINE__ADAPTER'] = 'codex';

    const config = await loadFreshConfig();
    expect(config.routing).toEqual({
      COMPLEX: { adapter: 'cursor', model: 'big-model' },
      MID: { adapter: 'claude-code' },
      ROUTINE: { adapter: 'codex' },
    });
  });

  it('lets an env leaf override the file value (env > file per leaf)', async () => {
    const file = join(tmpdir(), `routing-${Date.now()}.json`);
    writeFileSync(file, JSON.stringify({
      routing: {
        COMPLEX: { adapter: 'cursor' },
        MID: { adapter: 'cursor' },
        ROUTINE: { adapter: 'cursor' },
      },
    }));
    process.env['CONFIG_FILE'] = file;
    process.env['ROUTING__ROUTINE__ADAPTER'] = 'codex'; // override just this leaf

    try {
      const config = await loadFreshConfig();
      expect(config.routing?.COMPLEX.adapter).toBe('cursor'); // from file
      expect(config.routing?.ROUTINE.adapter).toBe('codex');  // env override
    } finally {
      unlinkSync(file);
    }
  });

  it('rejects a routing block missing a profile', async () => {
    const file = join(tmpdir(), `routing-bad-${Date.now()}.json`);
    writeFileSync(file, JSON.stringify({ routing: { COMPLEX: { adapter: 'cursor' } } }));
    process.env['CONFIG_FILE'] = file;
    try {
      await expect(loadFreshConfig()).rejects.toThrow(/Invalid configuration/);
    } finally {
      unlinkSync(file);
    }
  });
});
