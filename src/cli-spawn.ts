import { spawn } from 'node:child_process';
import type { ChildProcess, SpawnOptionsWithoutStdio } from 'node:child_process';

const WINDOWS_BATCH_SCRIPT = /\.(?:cmd|bat)$/i;

export interface SpawnInvocation {
  command: string;
  argv: string[];
}

/**
 * Builds the argv Node's `child_process.spawn` can execute for a CLI binary.
 *
 * Unix paths are returned unchanged. On Windows, a fully-qualified `.cmd` or
 * `.bat` path cannot be executed directly (Node raises EINVAL); those are run
 * through the system shell instead.
 */
export function buildSpawnInvocation(binary: string, args: readonly string[]): SpawnInvocation {
  if (process.platform === 'win32' && WINDOWS_BATCH_SCRIPT.test(binary)) {
    return {
      command: process.env['ComSpec'] ?? 'cmd.exe',
      argv: ['/d', '/s', '/c', binary, ...args],
    };
  }
  return { command: binary, argv: [...args] };
}

/** Spawns a coding-agent CLI with platform-appropriate command resolution. */
export function spawnCli(
  binary: string,
  args: readonly string[],
  options: SpawnOptionsWithoutStdio,
): ChildProcess {
  const { command, argv } = buildSpawnInvocation(binary, args);
  return spawn(command, argv, options);
}
