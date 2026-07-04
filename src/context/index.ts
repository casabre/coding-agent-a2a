import type { Config } from '../types.js';
import type { Workspace } from './workspace.js';
import { InProcessWorkspace } from './in-process-workspace.js';

/**
 * Builds the {@link Workspace} for the running server.
 *
 * Returns an {@link InProcessWorkspace} over `agentRepoPath` when `workspaceEnabled` is set,
 * otherwise `undefined` — and consumers treat "no workspace" as "no context pack", keeping the
 * default path byte-identical.
 */
export function createWorkspace(config: Config): Workspace | undefined {
  return config.workspaceEnabled ? new InProcessWorkspace(config.agentRepoPath) : undefined;
}
