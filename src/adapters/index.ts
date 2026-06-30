import type { ProcessAdapter } from './base.js';
import { CursorAdapter } from './cursor.js';
import { ClaudeCodeAdapter } from './claude-code.js';
import { VibeAdapter } from './vibe.js';
import { CodexAdapter } from './codex.js';
import { OpenCodeAdapter } from './opencode.js';
import { GenericAdapter } from './generic.js';

const registry: Record<string, ProcessAdapter> = {
  cursor: new CursorAdapter(),
  'claude-code': new ClaudeCodeAdapter(),
  vibe: new VibeAdapter(),
  codex: new CodexAdapter(),
  opencode: new OpenCodeAdapter(),
  generic: new GenericAdapter(),
};

/**
 * Looks up a registered {@link CodingAgentAdapter} by name.
 *
 * @param name - Adapter identifier (e.g. `"cursor"`, `"claude-code"`, `"vibe"`, `"codex"`, `"opencode"`, `"generic"`). Case-sensitive.
 * @throws {Error} If `name` is not in the registry.
 */
export function resolveAdapter(name: string): ProcessAdapter {
  const adapter = registry[name];
  if (!adapter) {
    throw new Error(
      `Unknown adapter "${name}". Available: ${Object.keys(registry).join(', ')}`,
    );
  }
  return adapter;
}
