/**
 * Task-complexity routing profiles. A profile selects which backend adapter runs a task.
 *
 * - `COMPLEX`  — architectural / multi-file / risky work; keep on the strongest backend.
 * - `MID`      — ordinary feature work.
 * - `ROUTINE`  — trivial, mechanical edits; cheapest backend.
 */
export type RoutingProfile = 'COMPLEX' | 'MID' | 'ROUTINE';

/** Substrings that mark a task as COMPLEX (checked first — safer to over-provision). */
const COMPLEX_KEYWORDS = [
  'refactor', 'architecture', 'architect', 'migrate', 'migration', 'debug',
  'security', 'across the codebase', 'redesign', 'rewrite', 'design ',
];

/** Substrings that mark a task as ROUTINE (checked only if not COMPLEX). */
const ROUTINE_KEYWORDS = [
  'rename', 'reformat', 'format ', 'typo', 'add a comment', 'docstring',
  'lint', 'remove unused', 'fix indentation',
];

/** Prompts longer than this bias upward to COMPLEX regardless of keywords. */
const COMPLEX_LENGTH_THRESHOLD = 1500;

/**
 * Classifies a task prompt into a {@link RoutingProfile} via a keyword/length heuristic.
 *
 * Precedence: COMPLEX (keyword or long prompt) → ROUTINE (keyword) → MID (default).
 * COMPLEX wins ties because over-provisioning a routine task is cheaper than
 * under-provisioning a hard one. No ML — this is deterministic and dependency-free.
 *
 * @param task - The natural-language task prompt.
 */
export function classify(task: string): RoutingProfile {
  const t = task.toLowerCase();
  if (task.length > COMPLEX_LENGTH_THRESHOLD) return 'COMPLEX';
  if (COMPLEX_KEYWORDS.some((k) => t.includes(k))) return 'COMPLEX';
  if (ROUTINE_KEYWORDS.some((k) => t.includes(k))) return 'ROUTINE';
  return 'MID';
}

/**
 * Normalises an arbitrary string (e.g. from request metadata) into a {@link RoutingProfile},
 * or `undefined` if it is not a recognised profile name. Case-insensitive.
 */
export function normalizeProfile(value: unknown): RoutingProfile | undefined {
  if (typeof value !== 'string') return undefined;
  const up = value.toUpperCase();
  return up === 'COMPLEX' || up === 'MID' || up === 'ROUTINE' ? up : undefined;
}
