/**
 * Project conventions surfaced to a task so an agent need not rediscover them each run.
 * All fields optional — only what the repo actually declares is populated.
 */
export interface Conventions {
  /** Contents of `AGENTS.md`, if present. */
  agentsMd?: string;
  /** Contents of `CLAUDE.md`, if present. */
  claudeMd?: string;
  /** The `test` script from `package.json`, if declared. */
  testCommand?: string;
}

/** A symbol/definition slice. Empty in the §0.1 cache; populated once tree-sitter indexing lands. */
export interface SymbolSlice {
  name: string;
  kind: string;
  file: string;
}

/**
 * The relevant slice of a repository for one task: file list, conventions, and (later)
 * symbol slices. Built from a git-SHA-addressed cache so unchanged content is never re-read.
 */
export interface ContextPack {
  /** Repo-relative file paths (from `git ls-tree`). */
  files: string[];
  conventions: Conventions;
  symbols: SymbolSlice[];
  /** `true` when the pack was truncated to fit a token budget (always `false` in the §0.1 cache). */
  truncated: boolean;
}

/**
 * Long-lived, per-repo context source. §0.1 scope: a cross-invocation discovery cache
 * (file tree + conventions), so a task gets a context pack instead of cold-scanning the repo.
 *
 * COW worktrees + `mergeDiff` (concurrent-agents trigger) and tree-sitter symbol indexing are
 * follow-ups; they attach to this same port. Consumers depend on this interface, never on a
 * concrete workspace, so the default {@link NullWorkspace} keeps the Cursor-only path identical.
 */
export interface Workspace {
  /** Stable identity of the repository this workspace serves. */
  readonly repoId: string;
  /** Builds the context pack for a task. */
  getContextPack(task: string): Promise<ContextPack>;
  /** Re-reads repository state; incremental via git-SHA addressing. */
  refresh(): Promise<void>;
}

/** Empty context pack — the shape returned when no workspace is active. */
export function emptyContextPack(): ContextPack {
  return { files: [], conventions: {}, symbols: [], truncated: false };
}

/**
 * The default {@link Workspace}: no discovery, no cache. `getContextPack` returns an empty pack,
 * so wiring it in leaves the task prompt (and thus behavior) unchanged. This is what keeps the
 * routing-off / no-workspace path byte-identical.
 */
export class NullWorkspace implements Workspace {
  readonly repoId = '';
  getContextPack(): Promise<ContextPack> {
    return Promise.resolve(emptyContextPack());
  }
  refresh(): Promise<void> {
    return Promise.resolve();
  }
}
