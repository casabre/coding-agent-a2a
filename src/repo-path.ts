import { resolve, relative, isAbsolute } from 'node:path';

/**
 * Returns `true` when `target` resolves to `root` or a path nested inside it.
 * Both are resolved to absolute paths first, so relative inputs and `..` segments
 * are normalised before comparison.
 */
export function isPathWithin(root: string, target: string): boolean {
  const rel = relative(resolve(root), resolve(target));
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

/**
 * Throws if `repoPath` is not within any of `allowedRoots` — the repo-path allow-list
 * that confines a caller-supplied working directory to operator-approved roots.
 *
 * Only called when confinement is enabled (roots configured); when the allow-list is
 * unset the caller skips this check entirely (behavior unchanged).
 *
 * @param repoPath - The requested working directory (absolute, or relative to cwd).
 * @param allowedRoots - Operator-approved root directories from `AGENT_ALLOWED_REPO_ROOTS`.
 * @throws {Error} If `repoPath` escapes every allowed root.
 */
export function assertRepoPathAllowed(repoPath: string, allowedRoots: string[]): void {
  const allowed = allowedRoots.some((root) => isPathWithin(root, repoPath));
  if (!allowed) {
    throw new Error(
      `repoPath "${repoPath}" is outside the allowed roots (${allowedRoots.join(', ')})`,
    );
  }
}
