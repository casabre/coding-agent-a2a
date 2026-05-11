import type { CodingAgentAdapter } from './base.js';
import { CursorAdapter } from './cursor.js';
import { ClaudeCodeAdapter } from './claude-code.js';

// TODO: add 'codex' adapter here when implemented
const registry: Record<string, CodingAgentAdapter> = {
  cursor: new CursorAdapter(),
  'claude-code': new ClaudeCodeAdapter(),
};

/**
 * Looks up a registered {@link CodingAgentAdapter} by name.
 *
 * @param name - Adapter identifier (e.g. `"cursor"`, `"claude-code"`). Case-sensitive.
 * @throws {Error} If `name` is not in the registry.
 */
export function resolveAdapter(name: string): CodingAgentAdapter {
  const adapter = registry[name];
  if (!adapter) {
    throw new Error(
      `Unknown adapter "${name}". Available: ${Object.keys(registry).join(', ')}`,
    );
  }
  return adapter;
}
