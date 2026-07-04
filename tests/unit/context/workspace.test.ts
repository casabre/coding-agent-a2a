import { describe, it, expect, vi } from 'vitest';
import { NullWorkspace, emptyContextPack } from '../../../src/context/workspace.js';
import { InProcessWorkspace, type GitRunner } from '../../../src/context/in-process-workspace.js';

vi.mock('node:child_process', () => ({ execFileSync: vi.fn(() => 'sha\n') }));

describe('NullWorkspace', () => {
  it('returns an empty context pack and a no-op refresh', async () => {
    const ws = new NullWorkspace();
    expect(ws.repoId).toBe('');
    expect(await ws.getContextPack()).toEqual(emptyContextPack());
    await expect(ws.refresh()).resolves.toBeUndefined();
  });
});

/** Builds a fake GitRunner from canned command outputs keyed by the first arg. */
function fakeGit(map: {
  sha?: string;
  files?: string[];
  show?: Record<string, string>;
}): { git: GitRunner; calls: string[][] } {
  const calls: string[][] = [];
  const git: GitRunner = (args) => {
    calls.push(args);
    if (args[0] === 'rev-parse') return (map.sha ?? 'sha1') + '\n';
    if (args[0] === 'ls-tree') return (map.files ?? []).join('\n') + '\n';
    if (args[0] === 'show') return map.show?.[args[1].replace('HEAD:', '')] ?? '';
    return '';
  };
  return { git, calls };
}

describe('InProcessWorkspace', () => {
  it('returns the file tree from ls-tree', async () => {
    const { git } = fakeGit({ files: ['src/a.ts', 'README.md'] });
    const pack = await new InProcessWorkspace('/repo', git).getContextPack();
    expect(pack.files).toEqual(['src/a.ts', 'README.md']);
    expect(pack.symbols).toEqual([]); // tree-sitter deferred
    expect(pack.truncated).toBe(false);
  });

  it('surfaces AGENTS.md / CLAUDE.md conventions when present', async () => {
    const { git } = fakeGit({
      files: ['AGENTS.md', 'CLAUDE.md'],
      show: { 'AGENTS.md': 'be nice', 'CLAUDE.md': 'use tabs' },
    });
    const pack = await new InProcessWorkspace('/repo', git).getContextPack();
    expect(pack.conventions.agentsMd).toBe('be nice');
    expect(pack.conventions.claudeMd).toBe('use tabs');
  });

  it('extracts the test command from package.json', async () => {
    const { git } = fakeGit({
      files: ['package.json'],
      show: { 'package.json': JSON.stringify({ scripts: { test: 'vitest run' } }) },
    });
    const pack = await new InProcessWorkspace('/repo', git).getContextPack();
    expect(pack.conventions.testCommand).toBe('vitest run');
  });

  it('omits the test command when package.json has no test script', async () => {
    const { git } = fakeGit({ files: ['package.json'], show: { 'package.json': JSON.stringify({ scripts: {} }) } });
    const pack = await new InProcessWorkspace('/repo', git).getContextPack();
    expect(pack.conventions.testCommand).toBeUndefined();
  });

  it('tolerates malformed package.json', async () => {
    const { git } = fakeGit({ files: ['package.json'], show: { 'package.json': 'not json' } });
    const pack = await new InProcessWorkspace('/repo', git).getContextPack();
    expect(pack.conventions.testCommand).toBeUndefined();
  });

  it('leaves conventions empty when no convention files exist', async () => {
    const { git } = fakeGit({ files: ['src/a.ts'] });
    const pack = await new InProcessWorkspace('/repo', git).getContextPack();
    expect(pack.conventions).toEqual({});
  });

  it('serves a cache hit without re-scanning when HEAD is unchanged', async () => {
    const { git, calls } = fakeGit({ sha: 'same', files: ['a.ts'] });
    const ws = new InProcessWorkspace('/repo', git);
    await ws.getContextPack();
    const lsTreeCalls = () => calls.filter((c) => c[0] === 'ls-tree').length;
    expect(lsTreeCalls()).toBe(1);
    await ws.getContextPack(); // second call, same SHA
    expect(lsTreeCalls()).toBe(1); // not re-scanned
  });

  it('rebuilds after refresh()', async () => {
    const { git, calls } = fakeGit({ sha: 'same', files: ['a.ts'] });
    const ws = new InProcessWorkspace('/repo', git);
    await ws.getContextPack();
    await ws.refresh();
    await ws.getContextPack();
    expect(calls.filter((c) => c[0] === 'ls-tree').length).toBe(2);
  });

  it('extracts symbols from supported source files', async () => {
    const { git } = fakeGit({
      files: ['src/a.ts', 'README.md'],
      show: { 'src/a.ts': 'export function hello() {}\nexport const x = 1;' },
    });
    const pack = await new InProcessWorkspace('/repo', git).getContextPack();
    expect(pack.symbols).toEqual([
      { name: 'hello', kind: 'function', file: 'src/a.ts' },
      { name: 'x', kind: 'variable', file: 'src/a.ts' },
    ]);
  });

  it('caps symbol extraction at 200 source files', async () => {
    const files = Array.from({ length: 201 }, (_, i) => `f${i}.ts`);
    const show: Record<string, string> = {};
    for (const f of files) show[f] = `export const s = 1;`;
    const { git } = fakeGit({ files, show });
    const pack = await new InProcessWorkspace('/repo', git).getContextPack();
    expect(pack.symbols).toHaveLength(200); // one symbol per parsed file, capped
  });

  it('uses the default git runner (execFileSync) when none is injected', async () => {
    // execFileSync is mocked to return 'sha\n' for every call → empty tree, empty conventions.
    const pack = await new InProcessWorkspace('/repo').getContextPack();
    expect(pack.files).toEqual(['sha']); // the mocked stdout, split into one line
    expect(pack.conventions).toEqual({});
  });
});
