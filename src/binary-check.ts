import { access, constants } from 'node:fs/promises';
import { sep, delimiter, resolve } from 'node:path';

const WIN_EXTENSIONS = ['.exe', '.cmd', '.bat', '.com'] as const;

export function executableAccessMode(platform: NodeJS.Platform = process.platform): number {
  return platform === 'win32' ? constants.F_OK : constants.X_OK;
}

export function executableExtensions(platform: NodeJS.Platform = process.platform): readonly string[] {
  return platform === 'win32' ? WIN_EXTENSIONS : [];
}

async function isAccessible(filePath: string, platform: NodeJS.Platform = process.platform): Promise<boolean> {
  try {
    await access(filePath, executableAccessMode(platform));
    return true;
  } catch {
    return false;
  }
}

async function findOnPath(binary: string, platform: NodeJS.Platform = process.platform): Promise<boolean> {
  const dirs = (process.env['PATH'] ?? '').split(delimiter).filter(Boolean);
  for (const dir of dirs) {
    const direct = resolve(dir, binary);
    if (await isAccessible(direct, platform)) return true;
    for (const ext of executableExtensions(platform)) {
      if (await isAccessible(direct + ext, platform)) return true;
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
