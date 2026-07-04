import { describe, it, expect } from 'vitest';
import { createWorkspace } from '../../../src/context/index.js';
import { InProcessWorkspace } from '../../../src/context/in-process-workspace.js';
import type { Config } from '../../../src/types.js';

const base = { agentRepoPath: '/repo', workspaceEnabled: false } as unknown as Config;

describe('createWorkspace', () => {
  it('returns undefined when workspaceEnabled is false', () => {
    expect(createWorkspace(base)).toBeUndefined();
  });

  it('returns an InProcessWorkspace over agentRepoPath when enabled', () => {
    const ws = createWorkspace({ ...base, workspaceEnabled: true });
    expect(ws).toBeInstanceOf(InProcessWorkspace);
    expect(ws?.repoId).toBe('/repo');
  });
});
