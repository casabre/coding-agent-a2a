import { describe, it, expect, afterEach } from 'vitest';
import { OpenCodeAdapter } from '../../../src/adapters/opencode.js';

afterEach(() => {
  delete process.env['OPENCODE_BINARY_PATH'];
});

describe('OpenCodeAdapter', () => {
  describe('resolveBinary()', () => {
    it('returns OPENCODE_BINARY_PATH when set', () => {
      process.env['OPENCODE_BINARY_PATH'] = '/custom/opencode';
      const adapter = new OpenCodeAdapter();
      expect(adapter.resolveBinary()).toBe('/custom/opencode');
    });

    it('returns opencode fallback when env var is not set', () => {
      const adapter = new OpenCodeAdapter();
      expect(adapter.resolveBinary()).toBe('opencode');
    });

    it('trims whitespace from OPENCODE_BINARY_PATH', () => {
      process.env['OPENCODE_BINARY_PATH'] = '  /path/to/opencode  ';
      const adapter = new OpenCodeAdapter();
      expect(adapter.resolveBinary()).toBe('/path/to/opencode');
    });
  });

  describe('buildArgv()', () => {
    const adapter = new OpenCodeAdapter();

    it('includes --stream', () => {
      const args = adapter.buildArgv({ task: 'do stuff', repoPath: '.' });
      expect(args).toContain('--stream');
    });

    it('includes --auto-approve when force is true', () => {
      const args = adapter.buildArgv({ task: 'p', repoPath: '.', force: true });
      expect(args).toContain('--auto-approve');
    });

    it('includes --auto-approve when force is undefined (defaults to force)', () => {
      const args = adapter.buildArgv({ task: 'p', repoPath: '.' });
      expect(args).toContain('--auto-approve');
    });

    it('excludes --auto-approve when force is false', () => {
      const args = adapter.buildArgv({ task: 'p', repoPath: '.', force: false });
      expect(args).not.toContain('--auto-approve');
    });

    it('includes --model and model when model is set', () => {
      const args = adapter.buildArgv({ task: 'p', repoPath: '.', model: 'gpt-4' });
      const idx = args.indexOf('--model');
      expect(idx).toBeGreaterThanOrEqual(0);
      expect(args[idx + 1]).toBe('gpt-4');
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
    const adapter = new OpenCodeAdapter();

    it('detects Approve this command? pattern', () => {
      expect(adapter.isApprovalPrompt('Approve this command?')).toBe(true);
    });

    it('detects [y/N] pattern', () => {
      expect(adapter.isApprovalPrompt('Continue? [y/N]')).toBe(true);
    });

    it('detects (Y/n) pattern', () => {
      expect(adapter.isApprovalPrompt('Run? (Y/n)')).toBe(true);
    });

    it('returns false for plain text without prompt', () => {
      expect(adapter.isApprovalPrompt('Running command...')).toBe(false);
    });

    it('returns false for JSON output', () => {
      expect(adapter.isApprovalPrompt('{"type":"result"}')).toBe(false);
    });
  });

  describe('approvalResponse()', () => {
    it('returns y', () => {
      expect(new OpenCodeAdapter().approvalResponse()).toBe('y');
    });
  });

  describe('parseEvent()', () => {
    const adapter = new OpenCodeAdapter();

    it('parses system/init to init event', () => {
      const event = adapter.parseEvent(JSON.stringify({ type: 'system/init', model: 'gpt-4' }));
      expect(event?.kind).toBe('init');
    });

    it('returns null for malformed JSON', () => {
      expect(adapter.parseEvent('bad json')).toBeNull();
    });
  });
});
