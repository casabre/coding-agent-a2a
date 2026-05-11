import { describe, it, expect, afterEach } from 'vitest';
import { ClaudeCodeAdapter } from '../../../src/adapters/claude-code.js';

afterEach(() => {
  delete process.env['CLAUDE_CODE_PATH'];
});

describe('ClaudeCodeAdapter', () => {
  describe('resolveBinary()', () => {
    it('returns CLAUDE_CODE_PATH when set', () => {
      process.env['CLAUDE_CODE_PATH'] = '/custom/claude';
      const adapter = new ClaudeCodeAdapter();
      expect(adapter.resolveBinary()).toBe('/custom/claude');
    });

    it('returns claude fallback when env var is not set', () => {
      const adapter = new ClaudeCodeAdapter();
      expect(adapter.resolveBinary()).toBe('claude');
    });

    it('trims whitespace from CLAUDE_CODE_PATH', () => {
      process.env['CLAUDE_CODE_PATH'] = '  /path/to/claude  ';
      const adapter = new ClaudeCodeAdapter();
      expect(adapter.resolveBinary()).toBe('/path/to/claude');
    });
  });

  describe('buildArgv()', () => {
    const adapter = new ClaudeCodeAdapter();

    it('includes --print and --output-format stream-json', () => {
      const args = adapter.buildArgv({ task: 'do stuff', repoPath: '.' });
      expect(args).toContain('--print');
      const idx = args.indexOf('--output-format');
      expect(idx).toBeGreaterThanOrEqual(0);
      expect(args[idx + 1]).toBe('stream-json');
    });

    it('includes --dangerously-skip-permissions when force is true', () => {
      const args = adapter.buildArgv({ task: 'p', repoPath: '.', force: true });
      expect(args).toContain('--dangerously-skip-permissions');
    });

    it('includes --dangerously-skip-permissions when force is undefined', () => {
      const args = adapter.buildArgv({ task: 'p', repoPath: '.' });
      expect(args).toContain('--dangerously-skip-permissions');
    });

    it('excludes --dangerously-skip-permissions when force is false', () => {
      const args = adapter.buildArgv({ task: 'p', repoPath: '.', force: false });
      expect(args).not.toContain('--dangerously-skip-permissions');
    });

    it('includes --model and model when model is set', () => {
      const args = adapter.buildArgv({ task: 'p', repoPath: '.', model: 'claude-opus-4' });
      const idx = args.indexOf('--model');
      expect(idx).toBeGreaterThanOrEqual(0);
      expect(args[idx + 1]).toBe('claude-opus-4');
    });

    it('excludes --model when model is undefined', () => {
      const args = adapter.buildArgv({ task: 'p', repoPath: '.' });
      expect(args).not.toContain('--model');
    });

    it('appends task as last argument', () => {
      const args = adapter.buildArgv({ task: 'do the thing', repoPath: '.' });
      expect(args[args.length - 1]).toBe('do the thing');
    });
  });

  describe('isApprovalPrompt()', () => {
    const adapter = new ClaudeCodeAdapter();

    it('detects [Y/n] pattern', () => {
      expect(adapter.isApprovalPrompt('Allow this? [Y/n]')).toBe(true);
    });

    it('returns false for regular JSON lines', () => {
      expect(adapter.isApprovalPrompt('{"type":"result"}')).toBe(false);
    });
  });

  describe('approvalResponse()', () => {
    it('returns y', () => {
      expect(new ClaudeCodeAdapter().approvalResponse()).toBe('y');
    });
  });

  describe('parseEvent()', () => {
    const adapter = new ClaudeCodeAdapter();

    it('parses system/init to init event', () => {
      const event = adapter.parseEvent(JSON.stringify({ type: 'system/init', model: 'claude-3' }));
      expect(event?.kind).toBe('init');
    });

    it('returns null for malformed JSON', () => {
      expect(adapter.parseEvent('bad json')).toBeNull();
    });
  });
});
