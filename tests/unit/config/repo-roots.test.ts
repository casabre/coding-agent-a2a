import { describe, it, expect, beforeEach, afterEach } from 'vitest';

const KEY = 'AGENT_ALLOWED_REPO_ROOTS';

async function loadFreshConfig() {
  const mod = await import('../../../src/config.js?t=' + Date.now());
  return mod.loadConfig();
}

let saved: string | undefined;
beforeEach(() => { saved = process.env[KEY]; delete process.env[KEY]; });
afterEach(() => { if (saved === undefined) delete process.env[KEY]; else process.env[KEY] = saved; });

describe('allowedRepoRoots config', () => {
  it('is undefined when the env var is unset', async () => {
    const config = await loadFreshConfig();
    expect(config.allowedRepoRoots).toBeUndefined();
  });

  it('parses a comma-separated allow-list, trimming blanks', async () => {
    process.env[KEY] = '/home/me/projects, /srv/work ,';
    const config = await loadFreshConfig();
    expect(config.allowedRepoRoots).toEqual(['/home/me/projects', '/srv/work']);
  });
});
