import { access } from 'node:fs/promises';
import { sep } from 'node:path';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

vi.mock('node:fs/promises', () => ({
  access: vi.fn(),
  constants: { X_OK: 1 },
}));

import { assertBinaryAccessible } from '../../src/binary-check.js';

describe('assertBinaryAccessible', () => {
  let savedPath: string | undefined;

  beforeEach(() => {
    savedPath = process.env['PATH'];
    vi.resetAllMocks();
  });

  afterEach(() => {
    process.env['PATH'] = savedPath;
  });

  describe(`explicit path (contains '${sep}')`, () => {
    it('resolves when the binary is accessible', async () => {
      vi.mocked(access).mockResolvedValue(undefined);
      const binary = `${sep}usr${sep}bin${sep}cursor-agent`;
      await expect(assertBinaryAccessible(binary)).resolves.toBeUndefined();
      expect(access).toHaveBeenCalledWith(binary, 1);
    });

    it('throws when the binary is not accessible', async () => {
      vi.mocked(access).mockRejectedValue(new Error('EACCES'));
      const binary = `${sep}usr${sep}bin${sep}cursor-agent`;
      await expect(assertBinaryAccessible(binary)).rejects.toThrow(
        `Binary not found or not executable: ${binary}`,
      );
    });
  });

  describe('command name (no path separator)', () => {
    it('resolves when the command is found in the first PATH directory', async () => {
      process.env['PATH'] = '/usr/bin:/usr/local/bin';
      vi.mocked(access).mockResolvedValue(undefined);
      await expect(assertBinaryAccessible('cursor-agent')).resolves.toBeUndefined();
    });

    it('resolves when found after skipping an inaccessible directory', async () => {
      process.env['PATH'] = '/usr/bin:/usr/local/bin';
      vi.mocked(access).mockImplementation(async (path) => {
        if (String(path) === '/usr/local/bin/cursor-agent') return undefined;
        throw new Error('ENOENT');
      });
      await expect(assertBinaryAccessible('cursor-agent')).resolves.toBeUndefined();
    });

    it('throws when the command is not found in any PATH directory', async () => {
      process.env['PATH'] = '/usr/bin:/usr/local/bin';
      vi.mocked(access).mockRejectedValue(new Error('ENOENT'));
      await expect(assertBinaryAccessible('cursor-agent')).rejects.toThrow(
        "'cursor-agent' not found on PATH",
      );
    });

    it('throws when PATH is empty', async () => {
      process.env['PATH'] = '';
      await expect(assertBinaryAccessible('cursor-agent')).rejects.toThrow(
        "'cursor-agent' not found on PATH",
      );
    });

    it('throws when PATH is undefined', async () => {
      delete process.env['PATH'];
      await expect(assertBinaryAccessible('cursor-agent')).rejects.toThrow(
        "'cursor-agent' not found on PATH",
      );
    });
  });
});
