import { execFileSync } from 'node:child_process';
import type { Conventions, ContextPack, SymbolSlice, Workspace } from './workspace.js';
import { extractSymbols, isSupportedSource } from './symbol-index.js';

/** Cap on source files parsed per build, to bound cost on large repos. */
const MAX_SYMBOL_FILES = 200;

/** Runs a git subcommand in the repo and returns stdout. Injectable for testing. */
export type GitRunner = (args: string[]) => string;

/** Upper bound on a single git command's stdout (default is only 1 MB — too small for ls-tree). */
const GIT_MAX_BUFFER = 64 * 1024 * 1024;

/** Default {@link GitRunner}: shells out to the `git` binary against `repoPath`. */
export function defaultGitRunner(repoPath: string, args: string[]): string {
  return execFileSync('git', ['-C', repoPath, ...args], {
    encoding: 'utf-8',
    maxBuffer: GIT_MAX_BUFFER,
  });
}

/**
 * In-process {@link Workspace} backed by a git-SHA-addressed discovery cache.
 *
 * `getContextPack` returns the file tree + project conventions for the repo, rebuilding only
 * when `HEAD` changes — so a repeat task on an unchanged repo is served from cache instead of
 * cold-scanning. Symbol slices are left empty here; tree-sitter indexing is a follow-up that
 * populates `ContextPack.symbols` behind the same shape.
 *
 * Git calls are synchronous; `getContextPack`/`refresh` are async to match the {@link Workspace}
 * port and to leave room for an out-of-process implementation later.
 */
export class InProcessWorkspace implements Workspace {
  readonly repoId: string;
  private readonly _repoPath: string;
  private readonly _git: GitRunner | undefined;
  private _cachedSha: string | null = null;
  private _cachedPack: ContextPack | null = null;

  constructor(repoPath: string, git?: GitRunner) {
    this._repoPath = repoPath;
    this.repoId = repoPath;
    this._git = git;
  }

  getContextPack(): Promise<ContextPack> {
    // No single-flight needed while _build() is synchronous: there is no await between the
    // cache check and set, so concurrent callers cannot both miss. Add one if this ever goes
    // out-of-process/async.
    const sha = this._run(['rev-parse', 'HEAD']).trim();
    if (this._cachedPack !== null && this._cachedSha === sha) {
      return Promise.resolve(this._cachedPack); // cache hit — no re-scan
    }
    const pack = this._build();
    this._cachedSha = sha;
    this._cachedPack = pack;
    return Promise.resolve(pack);
  }

  refresh(): Promise<void> {
    this._cachedSha = null;
    this._cachedPack = null;
    return Promise.resolve();
  }

  private _run(args: string[]): string {
    return this._git ? this._git(args) : defaultGitRunner(this._repoPath, args);
  }

  private _build(): ContextPack {
    const files = this._run(['ls-tree', '-r', '--name-only', 'HEAD'])
      .split('\n').map((s) => s.trim()).filter(Boolean);
    return { files, conventions: this._conventions(files), symbols: this._symbols(files), truncated: false };
  }

  /**
   * Extracts symbols from up to {@link MAX_SYMBOL_FILES} supported source files.
   *
   * Note: synchronous (one `git show` per file) so it blocks the event loop on large repos —
   * acceptable at §0.1 scale (cached per HEAD SHA). Escalation if it becomes a latency issue:
   * read all blobs in one process via `git cat-file --batch`, and/or offload to a worker thread.
   * A single unreadable file is skipped, not fatal (see the try/catch below).
   */
  private _symbols(files: string[]): SymbolSlice[] {
    const symbols: SymbolSlice[] = [];
    let parsed = 0;
    for (const file of files) {
      if (parsed >= MAX_SYMBOL_FILES) break;
      if (!isSupportedSource(file)) continue;
      parsed += 1;
      try {
        symbols.push(...extractSymbols(file, this._show(file)));
      } catch {
        // One unreadable file (e.g. a git show error) must not sink the whole pack — skip it.
      }
    }
    return symbols;
  }

  private _conventions(files: string[]): Conventions {
    const conventions: Conventions = {};
    if (files.includes('AGENTS.md')) conventions.agentsMd = this._show('AGENTS.md');
    if (files.includes('CLAUDE.md')) conventions.claudeMd = this._show('CLAUDE.md');
    if (files.includes('package.json')) {
      const testCommand = this._testCommand();
      if (testCommand !== undefined) conventions.testCommand = testCommand;
    }
    return conventions;
  }

  private _show(path: string): string {
    return this._run(['show', `HEAD:${path}`]);
  }

  private _testCommand(): string | undefined {
    try {
      const pkg = JSON.parse(this._show('package.json')) as { scripts?: Record<string, string> };
      return pkg.scripts?.test;
    } catch {
      return undefined;
    }
  }
}
