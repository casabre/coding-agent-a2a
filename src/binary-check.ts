import { access, constants } from 'node:fs/promises';
import { sep, delimiter, resolve } from 'node:path';

export async function assertBinaryAccessible(binary: string): Promise<void> {
  if (binary.includes(sep)) {
    try {
      await access(binary, constants.X_OK);
      return;
    } catch {
      throw new Error(`Binary not found or not executable: ${binary}`);
    }
  }
  const dirs = (process.env['PATH'] ?? '').split(delimiter).filter(Boolean);
  for (const dir of dirs) {
    try {
      await access(resolve(dir, binary), constants.X_OK);
      return;
    } catch {
      // not in this directory
    }
  }
  throw new Error(`'${binary}' not found on PATH — install it or set the path via env var`);
}
