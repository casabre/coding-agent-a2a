import { describe, it, expect, afterEach } from 'vitest';
import { CodexAdapter } from '../../../src/adapters/codex.js';

afterEach(() => {
  delete process.env['CODEX_BINARY_PATH'];
});

describe('CodexAdapter', () => {
  describe('resolveBinary()', () => {
    it('returns CODEX_BINARY_PATH when set', () => {
      process.env['CODEX_BINARY_PATH'] = '/custom/codex';
      const adapter = new CodexAdapter();
      expect(adapter.resolveBinary()).toBe('/custom/codex');
    });

    it('returns codex fallback when env var is not set', () => {
      const adapter = new CodexAdapter();
      expect(adapter.resolveBinary()).toBe('codex');
    });

    it('trims whitespace from CODEX_BINARY_PATH', () => {
      process.env['CODEX_BINARY_PATH'] = '  /path/to/codex  ';
      const adapter = new CodexAdapter();
      expect(adapter.resolveBinary()).toBe('/path/to/codex');
    });
  });

  describe('buildArgv()', () => {
    const adapter = new CodexAdapter();

    it('includes --stream', () => {
      const args = adapter.buildArgv({ task: 'do stuff', repoPath: '.' });
      expect(args).toContain('--stream');
    });

    it('includes --yes and --auto-approve when force is true', () => {
      const args = adapter.buildArgv({ task: 'p', repoPath: '.', force: true });
      expect(args).toContain('--yes');
      expect(args).toContain('--auto-approve');
    });

    it('includes --yes and --auto-approve when force is undefined (defaults to force)', () => {
      const args = adapter.buildArgv({ task: 'p', repoPath: '.' });
      expect(args).toContain('--yes');
      expect(args).toContain('--auto-approve');
    });

    it('excludes --yes and --auto-approve when force is false', () => {
      const args = adapter.buildArgv({ task: 'p', repoPath: '.', force: false });
      expect(args).not.toContain('--yes');
      expect(args).not.toContain('--auto-approve');
    });

    it('includes --model and model when model is set', () => {
      const args = adapter.buildArgv({ task: 'p', repoPath: '.', model: 'codex-pro' });
      const idx = args.indexOf('--model');
      expect(idx).toBeGreaterThanOrEqual(0);
      expect(args[idx + 1]).toBe('codex-pro');
    });

    it('includes --cwd and repoPath when repoPath is set', () => {
      const args = adapter.buildArgv({ task: 'p', repoPath: '/my/repo' });
      const idx = args.indexOf('--cwd');
      expect(idx).toBeGreaterThanOrEqual(0);
      expect(args[idx + 1]).toBe('/my/repo');
    });

    it('appends task as last argument', () => {
      const args = adapter.buildArgv({ task: 'do the thing', repoPath: '.' });
      expect(args[args.length - 1]).toBe('do the thing');
    });
  });

  describe('isApprovalPrompt()', () => {
    const adapter = new CodexAdapter();

    it('detects Approve? (y/n) pattern', () => {
      expect(adapter.isApprovalPrompt('Approve? (y/n)')).toBe(true);
    });

    it('detects [Approve] (y/n) pattern', () => {
      expect(adapter.isApprovalPrompt('[Approve] (y/n)')).toBe(true);
    });

    it('returns false for regular text', () => {
      expect(adapter.isApprovalPrompt('{"type":"result"}')).toBe(false);
    });
  });

  describe('approvalResponse()', () => {
    it('returns y', () => {
      expect(new CodexAdapter().approvalResponse()).toBe('y');
    });
  });

  describe('parseEvent()', () => {
    const adapter = new CodexAdapter();

    it('parses system/init to init event', () => {
      const event = adapter.parseEvent(JSON.stringify({ type: 'system/init', model: 'codex-pro' }));
      expect(event?.kind).toBe('init');
    });

    it('returns null for malformed JSON', () => {
      expect(adapter.parseEvent('bad json')).toBeNull();
    });
  });
});
