import { spawn } from 'node:child_process';
import type { Conventions, ContextPack, SymbolSlice, Workspace } from './workspace.js';
import { extractSymbols, isSupportedSource } from './symbol-index.js';

/** Cap on source files read per build, to bound cost on large repos. */
const MAX_SYMBOL_FILES = 200;

/** Convention files read (if present) for the context pack. */
const CONVENTION_FILES = ['AGENTS.md', 'CLAUDE.md', 'package.json'] as const;

/** Runs a git subcommand (optionally feeding `input` on stdin) and resolves its stdout. Injectable for testing. */
export type GitRunner = (args: string[], input?: string) => Promise<Buffer>;

/**
 * Default {@link GitRunner}: spawns `git` against `repoPath`, streams stdout into a buffer, and
 * (unlike a fixed `maxBuffer`) grows with the output. Used for both text commands and the
 * binary-safe `cat-file --batch` stream.
 */
export function defaultGitRunner(repoPath: string, args: string[], input?: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const child = spawn('git', ['-C', repoPath, ...args]);
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    child.stdout.on('data', (chunk: Buffer) => out.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => err.push(chunk));
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve(Buffer.concat(out));
      else reject(new Error(`git ${args.join(' ')} exited ${String(code)}: ${Buffer.concat(err).toString('utf8').trim()}`));
    });
    child.stdin.on('error', () => { /* ignore EPIPE if git exits before we finish writing */ });
    if (input !== undefined) child.stdin.write(input);
    child.stdin.end();
  });
}

/**
 * Parses `git cat-file --batch` output. For each requested path (in input order) the stream is
 * either `<oid> <type> <size>\n<size bytes>\n` (present) or `<input> missing\n` (absent). Byte
 * offsets are used throughout so multi-byte content is sliced correctly.
 *
 * Exported for direct unit testing of the record framing.
 */
export function parseBatch(paths: string[], out: Buffer): Map<string, string> {
  const contents = new Map<string, string>();
  let pos = 0;
  for (const path of paths) {
    const newline = out.indexOf(0x0a, pos);
    if (newline === -1) break; // truncated/short output — stop rather than misparse
    const header = out.toString('utf8', pos, newline);
    pos = newline + 1;
    const parts = header.split(' ');
    if (parts[parts.length - 1] === 'missing') continue; // no content record follows
    const size = Number(parts[2]);
    contents.set(path, out.toString('utf8', pos, pos + size));
    pos += size + 1; // skip the content and its trailing newline
  }
  return contents;
}

/** Extracts the `test` script from a package.json string, tolerating malformed JSON. */
function testCommandFrom(packageJson: string): string | undefined {
  try {
    const pkg = JSON.parse(packageJson) as { scripts?: Record<string, string> };
    return pkg.scripts?.test;
  } catch {
    return undefined;
  }
}

/**
 * In-process {@link Workspace} backed by a git-SHA-addressed discovery cache.
 *
 * `getContextPack` returns the file tree + conventions + a TS/JS symbol index, rebuilding only
 * when `HEAD` changes. All file contents for a build are read in **one** `git cat-file --batch`
 * process (not one `git show` per file). Concurrent first-callers on the same SHA share a single
 * build (single-flight), so the work runs once.
 */
export class InProcessWorkspace implements Workspace {
  readonly repoId: string;
  private readonly _repoPath: string;
  private readonly _git: GitRunner | undefined;
  private _cachedSha: string | null = null;
  private _cachedPack: ContextPack | null = null;
  private _inflight: Promise<ContextPack> | null = null;
  private _inflightSha: string | null = null;

  constructor(repoPath: string, git?: GitRunner) {
    this._repoPath = repoPath;
    this.repoId = repoPath;
    this._git = git;
  }

  async getContextPack(): Promise<ContextPack> {
    const sha = (await this._text(['rev-parse', 'HEAD'])).trim();
    if (this._cachedPack !== null && this._cachedSha === sha) {
      return this._cachedPack; // cache hit — no re-scan
    }
    // Single-flight: concurrent callers on the same SHA share one build instead of racing.
    if (this._inflight !== null && this._inflightSha === sha) {
      return this._inflight;
    }
    this._inflightSha = sha;
    this._inflight = this._build(sha).finally(() => {
      this._inflight = null;
      this._inflightSha = null;
    });
    return this._inflight;
  }

  refresh(): Promise<void> {
    this._cachedSha = null;
    this._cachedPack = null;
    return Promise.resolve();
  }

  private async _build(sha: string): Promise<ContextPack> {
    const files = (await this._text(['ls-tree', '-r', '--name-only', 'HEAD']))
      .split('\n').map((s) => s.trim()).filter(Boolean);
    const conventionPaths = CONVENTION_FILES.filter((f) => files.includes(f));
    const sourcePaths = files.filter(isSupportedSource).slice(0, MAX_SYMBOL_FILES);
    const contents = await this._batchRead([...new Set([...conventionPaths, ...sourcePaths])]);

    const pack: ContextPack = {
      files,
      conventions: this._conventions(contents),
      symbols: this._symbols(sourcePaths, contents),
      truncated: false,
    };
    this._cachedSha = sha;
    this._cachedPack = pack;
    return pack;
  }

  private _conventions(contents: Map<string, string>): Conventions {
    const conventions: Conventions = {};
    const agentsMd = contents.get('AGENTS.md');
    if (agentsMd !== undefined) conventions.agentsMd = agentsMd;
    const claudeMd = contents.get('CLAUDE.md');
    if (claudeMd !== undefined) conventions.claudeMd = claudeMd;
    const pkg = contents.get('package.json');
    if (pkg !== undefined) {
      const testCommand = testCommandFrom(pkg);
      if (testCommand !== undefined) conventions.testCommand = testCommand;
    }
    return conventions;
  }

  private _symbols(sourcePaths: string[], contents: Map<string, string>): SymbolSlice[] {
    const symbols: SymbolSlice[] = [];
    for (const path of sourcePaths) {
      const content = contents.get(path);
      if (content === undefined) continue; // blob missing/unreadable — skip, don't sink the pack
      symbols.push(...extractSymbols(path, content));
    }
    return symbols;
  }

  private async _batchRead(paths: string[]): Promise<Map<string, string>> {
    if (paths.length === 0) return new Map();
    const input = paths.map((p) => `HEAD:${p}`).join('\n') + '\n';
    return parseBatch(paths, await this._run(['cat-file', '--batch'], input));
  }

  private async _text(args: string[]): Promise<string> {
    return (await this._run(args)).toString('utf8');
  }

  private _run(args: string[], input?: string): Promise<Buffer> {
    return this._git ? this._git(args, input) : defaultGitRunner(this._repoPath, args, input);
  }
}
