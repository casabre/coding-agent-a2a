import { describe, it, expect, afterEach } from 'vitest';
import { CursorAdapter } from '../../../src/adapters/cursor.js';

afterEach(() => {
  delete process.env['CURSOR_AGENT_PATH'];
});

describe('CursorAdapter', () => {
  describe('resolveBinary()', () => {
    it('returns CURSOR_AGENT_PATH when set', () => {
      process.env['CURSOR_AGENT_PATH'] = '/custom/cursor-agent';
      const adapter = new CursorAdapter();
      expect(adapter.resolveBinary()).toBe('/custom/cursor-agent');
    });

    it('returns cursor-agent fallback when env var is not set', () => {
      const adapter = new CursorAdapter();
      expect(adapter.resolveBinary()).toBe('cursor-agent');
    });

    it('trims whitespace from CURSOR_AGENT_PATH', () => {
      process.env['CURSOR_AGENT_PATH'] = '  /path/to/agent  ';
      const adapter = new CursorAdapter();
      expect(adapter.resolveBinary()).toBe('/path/to/agent');
    });
  });

  describe('buildArgv()', () => {
    const adapter = new CursorAdapter();

    it('includes --print and --output-format stream-json', () => {
      const args = adapter.buildArgv({ task: 'do stuff', repoPath: '.' });
      expect(args).toContain('--print');
      const idx = args.indexOf('--output-format');
      expect(idx).toBeGreaterThanOrEqual(0);
      expect(args[idx + 1]).toBe('stream-json');
    });

    it('includes -f when force is true', () => {
      const args = adapter.buildArgv({ task: 'p', repoPath: '.', force: true });
      expect(args).toContain('-f');
    });

    it('includes -f when force is undefined (defaults to force)', () => {
      const args = adapter.buildArgv({ task: 'p', repoPath: '.' });
      expect(args).toContain('-f');
    });

    it('excludes -f when force is false', () => {
      const args = adapter.buildArgv({ task: 'p', repoPath: '.', force: false });
      expect(args).not.toContain('-f');
    });

    it('includes -m and model when model is set', () => {
      const args = adapter.buildArgv({ task: 'p', repoPath: '.', model: 'claude-opus' });
      const idx = args.indexOf('-m');
      expect(idx).toBeGreaterThanOrEqual(0);
      expect(args[idx + 1]).toBe('claude-opus');
    });

    it('excludes -m when model is undefined', () => {
      const args = adapter.buildArgv({ task: 'p', repoPath: '.' });
      expect(args).not.toContain('-m');
    });

    it('appends task as last argument', () => {
      const args = adapter.buildArgv({ task: 'do the thing', repoPath: '.' });
      expect(args[args.length - 1]).toBe('do the thing');
    });
  });

  describe('isApprovalPrompt()', () => {
    const adapter = new CursorAdapter();

    it('detects [Y/n] pattern', () => {
      expect(adapter.isApprovalPrompt('Run command? [Y/n]')).toBe(true);
    });

    it('detects (y/N) pattern', () => {
      expect(adapter.isApprovalPrompt('Continue? (y/N)')).toBe(true);
    });

    it('detects [y/N] pattern', () => {
      expect(adapter.isApprovalPrompt('Proceed? [y/N]')).toBe(true);
    });

    it('detects (Y/n) pattern', () => {
      expect(adapter.isApprovalPrompt('Are you sure? (Y/n)')).toBe(true);
    });

    it('returns false for regular text', () => {
      expect(adapter.isApprovalPrompt('{"type":"result"}')).toBe(false);
    });
  });

  describe('approvalResponse()', () => {
    it('returns y', () => {
      expect(new CursorAdapter().approvalResponse()).toBe('y');
    });
  });

  describe('parseEvent()', () => {
    const adapter = new CursorAdapter();

    it('parses system/init to init event', () => {
      const event = adapter.parseEvent(JSON.stringify({ type: 'system/init', model: 'claude-3' }));
      expect(event?.kind).toBe('init');
    });

    it('returns null for malformed JSON', () => {
      expect(adapter.parseEvent('bad json')).toBeNull();
    });
  });
});
