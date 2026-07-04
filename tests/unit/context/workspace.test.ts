import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'node:events';
import { NullWorkspace, emptyContextPack } from '../../../src/context/workspace.js';

vi.mock('node:child_process', () => ({ spawn: vi.fn() }));
import { spawn } from 'node:child_process';
import {
  InProcessWorkspace,
  defaultGitRunner,
  parseBatch,
  type GitRunner,
} from '../../../src/context/in-process-workspace.js';

// ── helpers ─────────────────────────────────────────────────────────────────

/** Builds `git cat-file --batch` output for the requested refs from a path→content map. */
function batchOutput(input: string, show: Record<string, string>): Buffer {
  const parts: Buffer[] = [];
  for (const ref of input.trim().split('\n').filter(Boolean)) {
    const path = ref.replace('HEAD:', '');
    if (path in show) {
      const content = Buffer.from(show[path], 'utf8');
      parts.push(Buffer.from(`abc123 blob ${content.length}\n`), content, Buffer.from('\n'));
    } else {
      parts.push(Buffer.from(`${ref} missing\n`));
    }
  }
  return Buffer.concat(parts);
}

/** Async fake {@link GitRunner} driven by canned rev-parse / ls-tree / cat-file output. */
function fakeGit(map: { sha?: string; files?: string[]; show?: Record<string, string> }): {
  git: GitRunner;
  calls: string[][];
} {
  const calls: string[][] = [];
  const git: GitRunner = (args, input) => {
    calls.push(args);
    if (args[0] === 'rev-parse') return Promise.resolve(Buffer.from(`${map.sha ?? 'sha1'}\n`));
    if (args[0] === 'ls-tree') return Promise.resolve(Buffer.from(`${(map.files ?? []).join('\n')}\n`));
    if (args[0] === 'cat-file') return Promise.resolve(batchOutput(input ?? '', map.show ?? {}));
    return Promise.resolve(Buffer.from(''));
  };
  return { git, calls };
}

interface MockChild extends EventEmitter {
  stdout: EventEmitter;
  stderr: EventEmitter;
  stdin: { write: ReturnType<typeof vi.fn>; end: ReturnType<typeof vi.fn>; on: ReturnType<typeof vi.fn> };
}
function makeChild(): MockChild {
  const child = new EventEmitter() as MockChild;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.stdin = { write: vi.fn(), end: vi.fn(), on: vi.fn() };
  return child;
}

beforeEach(() => vi.mocked(spawn).mockReset());

// ── NullWorkspace ───────────────────────────────────────────────────────────

describe('NullWorkspace', () => {
  it('returns an empty context pack and a no-op refresh', async () => {
    const ws = new NullWorkspace();
    expect(ws.repoId).toBe('');
    expect(await ws.getContextPack()).toEqual(emptyContextPack());
    await expect(ws.refresh()).resolves.toBeUndefined();
  });
});

// ── parseBatch ──────────────────────────────────────────────────────────────

describe('parseBatch', () => {
  it('reads present records and skips missing ones (in input order)', () => {
    const buf = Buffer.concat([
      Buffer.from('oid blob 5\nhello\n'),
      Buffer.from('HEAD:gone missing\n'),
      Buffer.from('oid blob 2\nhi\n'),
    ]);
    const map = parseBatch(['a', 'b', 'c'], buf);
    expect(map.get('a')).toBe('hello');
    expect(map.has('b')).toBe(false);
    expect(map.get('c')).toBe('hi');
  });

  it('stops rather than misparse on truncated output', () => {
    const map = parseBatch(['a', 'b'], Buffer.from('oid blob 5\nhello\n')); // only one record
    expect(map.get('a')).toBe('hello');
    expect(map.has('b')).toBe(false);
  });

  it('slices multi-byte content by byte size', () => {
    const content = 'café'; // é is 2 bytes → 5 bytes total
    const buf = Buffer.concat([
      Buffer.from(`oid blob ${Buffer.byteLength(content)}\n`),
      Buffer.from(content),
      Buffer.from('\n'),
    ]);
    expect(parseBatch(['x'], buf).get('x')).toBe('café');
  });
});

// ── defaultGitRunner (spawn mocked) ─────────────────────────────────────────

describe('defaultGitRunner', () => {
  it('rejects on a non-zero exit, including stderr', async () => {
    const child = makeChild();
    vi.mocked(spawn).mockReturnValue(child as never);
    const p = defaultGitRunner('/r', ['ls-tree']);
    child.stderr.emit('data', Buffer.from('fatal: not a repo'));
    child.emit('close', 128);
    await expect(p).rejects.toThrow(/exited 128/);
  });

  it('rejects when the process errors', async () => {
    const child = makeChild();
    vi.mocked(spawn).mockReturnValue(child as never);
    const p = defaultGitRunner('/r', ['rev-parse']);
    child.emit('error', new Error('ENOENT'));
    await expect(p).rejects.toThrow('ENOENT');
  });
});

// ── InProcessWorkspace (injected git) ───────────────────────────────────────

describe('InProcessWorkspace', () => {
  it('returns the file tree from ls-tree', async () => {
    const { git } = fakeGit({ files: ['src/a.ts', 'README.md'] });
    const pack = await new InProcessWorkspace('/repo', git).getContextPack();
    expect(pack.files).toEqual(['src/a.ts', 'README.md']);
    expect(pack.truncated).toBe(false);
  });

  it('surfaces AGENTS.md / CLAUDE.md conventions', async () => {
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

  it('skips the batch read entirely when there is nothing to read', async () => {
    const { git, calls } = fakeGit({ files: ['README.md', 'LICENSE'] }); // no source, no conventions
    const pack = await new InProcessWorkspace('/repo', git).getContextPack();
    expect(pack.symbols).toEqual([]);
    expect(pack.conventions).toEqual({});
    expect(calls.filter((c) => c[0] === 'cat-file').length).toBe(0); // no batch process
  });

  it('extracts symbols from supported source files in a single batch read', async () => {
    const { git, calls } = fakeGit({
      files: ['src/a.ts', 'README.md'],
      show: { 'src/a.ts': 'export function hello() {}\nexport const x = 1;' },
    });
    const pack = await new InProcessWorkspace('/repo', git).getContextPack();
    expect(pack.symbols).toEqual([
      { name: 'hello', kind: 'function', file: 'src/a.ts' },
      { name: 'x', kind: 'variable', file: 'src/a.ts' },
    ]);
    expect(calls.filter((c) => c[0] === 'cat-file').length).toBe(1); // one batch process
  });

  it('skips a source file whose blob is missing from the batch, keeping the rest', async () => {
    const { git } = fakeGit({ files: ['good.ts', 'bad.ts'], show: { 'good.ts': 'export const g = 1;' } });
    const pack = await new InProcessWorkspace('/repo', git).getContextPack();
    expect(pack.symbols).toEqual([{ name: 'g', kind: 'variable', file: 'good.ts' }]);
  });

  it('caps symbol extraction at 200 source files', async () => {
    const files = Array.from({ length: 201 }, (_, i) => `f${i}.ts`);
    const show: Record<string, string> = {};
    for (const f of files) show[f] = 'export const s = 1;';
    const { git } = fakeGit({ files, show });
    const pack = await new InProcessWorkspace('/repo', git).getContextPack();
    expect(pack.symbols).toHaveLength(200);
  });

  it('serves a cache hit without re-scanning when HEAD is unchanged', async () => {
    const { git, calls } = fakeGit({ sha: 'same', files: ['a.ts'] });
    const ws = new InProcessWorkspace('/repo', git);
    await ws.getContextPack();
    await ws.getContextPack();
    expect(calls.filter((c) => c[0] === 'ls-tree').length).toBe(1); // built once
  });

  it('rebuilds after refresh()', async () => {
    const { git, calls } = fakeGit({ sha: 'same', files: ['a.ts'] });
    const ws = new InProcessWorkspace('/repo', git);
    await ws.getContextPack();
    await ws.refresh();
    await ws.getContextPack();
    expect(calls.filter((c) => c[0] === 'ls-tree').length).toBe(2);
  });

  it('single-flights concurrent first-callers on the same SHA', async () => {
    const { git, calls } = fakeGit({ sha: 'same', files: ['a.ts'], show: { 'a.ts': 'export const a = 1;' } });
    const ws = new InProcessWorkspace('/repo', git);
    const [p1, p2] = [ws.getContextPack(), ws.getContextPack()]; // concurrent, no await between
    const [r1, r2] = await Promise.all([p1, p2]);
    expect(calls.filter((c) => c[0] === 'ls-tree').length).toBe(1); // one shared build
    expect(r1).toBe(r2); // same pack object
  });

  it('uses the default (spawn-backed) git runner when none is injected', async () => {
    vi.mocked(spawn).mockImplementation(((_cmd: string, argv?: string[]) => {
      const args = argv ?? [];
      const child = makeChild();
      queueMicrotask(() => {
        if (args.includes('rev-parse')) child.stdout.emit('data', Buffer.from('sha\n'));
        else if (args.includes('ls-tree')) child.stdout.emit('data', Buffer.from('a.ts\n'));
        else if (args.includes('cat-file')) child.stdout.emit('data', batchOutput('HEAD:a.ts\n', { 'a.ts': 'export const a = 1;' }));
        child.emit('close', 0);
      });
      return child;
    }) as never);
    const pack = await new InProcessWorkspace('/repo').getContextPack();
    expect(pack.files).toEqual(['a.ts']);
    expect(pack.symbols).toEqual([{ name: 'a', kind: 'variable', file: 'a.ts' }]);
  });
});
