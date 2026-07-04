import { resolve, relative, isAbsolute, dirname, basename, join } from 'node:path';
import { realpathSync } from 'node:fs';

/**
 * Canonicalises a path so symlinks are followed consistently for both the root and the target.
 * If the full path exists, its real path is returned; if only the leaf is missing, the real
 * parent is used with the leaf re-appended (so a not-yet-created dir still compares correctly);
 * otherwise it falls back to plain normalisation.
 */
function canonicalize(path: string): string {
  const abs = resolve(path);
  try {
    return realpathSync(abs);
  } catch {
    try {
      return join(realpathSync(dirname(abs)), basename(abs));
    } catch {
      return abs;
    }
  }
}

/**
 * Returns `true` when `target` resolves to `root` or a path nested inside it.
 * Symlinks are followed (via {@link canonicalize}) so a link inside `root` pointing outside
 * is correctly rejected; `..` segments and relative inputs are normalised.
 */
export function isPathWithin(root: string, target: string): boolean {
  const rel = relative(canonicalize(root), canonicalize(target));
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
