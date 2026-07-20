import { access, constants } from 'node:fs/promises';
import { sep, delimiter, resolve } from 'node:path';

const WIN_EXTENSIONS = ['.exe', '.cmd', '.bat', '.com'] as const;

async function isAccessible(filePath: string): Promise<boolean> {
  try {
    await access(filePath, process.platform === 'win32' ? constants.F_OK : constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

async function findOnPath(binary: string): Promise<boolean> {
  const dirs = (process.env['PATH'] ?? '').split(delimiter).filter(Boolean);
  for (const dir of dirs) {
    const direct = resolve(dir, binary);
    if (await isAccessible(direct)) return true;
    if (process.platform === 'win32') {
      for (const ext of WIN_EXTENSIONS) {
        if (await isAccessible(direct + ext)) return true;
      }
    }
  }
  return false;
}

export async function assertBinaryAccessible(binary: string): Promise<void> {
  if (binary.includes(sep)) {
    if (await isAccessible(binary)) return;
    throw new Error(`Binary not found or not executable: ${binary}`);
  }
  if (await findOnPath(binary)) return;
  throw new Error(`'${binary}' not found on PATH — install it or set the path via env var`);
}
