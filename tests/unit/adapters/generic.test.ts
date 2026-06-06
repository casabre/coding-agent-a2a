import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { GenericAdapter, tokenizeArgs } from '../../../src/adapters/generic.js';

afterEach(() => {
  delete process.env['AGENT_BINARY'];
  delete process.env['AGENT_ARGS'];
  delete process.env['AGENT_APPROVAL_PATTERN'];
  delete process.env['AGENT_APPROVAL_RESPONSE'];
});

describe('GenericAdapter', () => {
  describe('resolveBinary()', () => {
    it('returns AGENT_BINARY when set', () => {
      process.env['AGENT_BINARY'] = '/custom/agent';
      const adapter = new GenericAdapter();
      expect(adapter.resolveBinary()).toBe('/custom/agent');
    });

    it('throws error when AGENT_BINARY is not set', () => {
      const adapter = new GenericAdapter();
      expect(() => adapter.resolveBinary()).toThrow('AGENT_BINARY environment variable is required');
    });

    it('trims whitespace from AGENT_BINARY', () => {
      process.env['AGENT_BINARY'] = '  /path/to/agent  ';
      const adapter = new GenericAdapter();
      expect(adapter.resolveBinary()).toBe('/path/to/agent');
    });
  });

  describe('buildArgv()', () => {
    beforeEach(() => {
      process.env['AGENT_BINARY'] = '/custom/agent';
    });

    it('appends task as last argument', () => {
      const adapter = new GenericAdapter();
      const args = adapter.buildArgv({ task: 'do the thing', repoPath: '.' });
      expect(args[args.length - 1]).toBe('do the thing');
    });

    it('includes AGENT_ARGS when set', () => {
      process.env['AGENT_ARGS'] = '--stream --model my-model';
      const adapter = new GenericAdapter();
      const args = adapter.buildArgv({ task: 'do stuff', repoPath: '.' });
      expect(args).toContain('--stream');
      expect(args).toContain('--model');
      expect(args).toContain('my-model');
    });

    it('handles empty AGENT_ARGS', () => {
      process.env['AGENT_ARGS'] = '';
      const adapter = new GenericAdapter();
      const args = adapter.buildArgv({ task: 'do stuff', repoPath: '.' });
      expect(args).toEqual(['do stuff']);
    });

    it('handles undefined AGENT_ARGS', () => {
      const adapter = new GenericAdapter();
      const args = adapter.buildArgv({ task: 'do stuff', repoPath: '.' });
      expect(args).toEqual(['do stuff']);
    });
  });

  describe('isApprovalPrompt()', () => {
    beforeEach(() => {
      process.env['AGENT_BINARY'] = '/custom/agent';
    });

    it('detects (y/n) pattern by default', () => {
      const adapter = new GenericAdapter();
      expect(adapter.isApprovalPrompt('Run command? (y/n)')).toBe(true);
    });

    it('detects (Y/n) pattern by default', () => {
      const adapter = new GenericAdapter();
      expect(adapter.isApprovalPrompt('Continue? (Y/n)')).toBe(true);
    });

    it('detects Do you want to pattern by default', () => {
      const adapter = new GenericAdapter();
      expect(adapter.isApprovalPrompt('Do you want to continue?')).toBe(true);
    });

    it('detects Continue? pattern by default', () => {
      const adapter = new GenericAdapter();
      expect(adapter.isApprovalPrompt('Continue?')).toBe(true);
    });

    it('uses custom AGENT_APPROVAL_PATTERN when set', () => {
      process.env['AGENT_APPROVAL_PATTERN'] = /Approve\?\s*\(yes\/no\)/.source;
      const adapter = new GenericAdapter();
      expect(adapter.isApprovalPrompt('Approve? (yes/no)')).toBe(true);
      expect(adapter.isApprovalPrompt('Confirm? (y/n)')).toBe(false);
    });

    it('returns false for regular text', () => {
      const adapter = new GenericAdapter();
      expect(adapter.isApprovalPrompt('{"type":"result"}')).toBe(false);
    });

    it('handles invalid regex pattern gracefully', () => {
      process.env['AGENT_APPROVAL_PATTERN'] = '[invalid';
      const adapter = new GenericAdapter();
      // Should fall back to default pattern
      expect(adapter.isApprovalPrompt('Run command? (y/n)')).toBe(true);
    });
  });

  describe('approvalResponse()', () => {
    beforeEach(() => {
      process.env['AGENT_BINARY'] = '/custom/agent';
    });

    it('returns y by default', () => {
      const adapter = new GenericAdapter();
      expect(adapter.approvalResponse()).toBe('y');
    });

    it('returns AGENT_APPROVAL_RESPONSE when set', () => {
      process.env['AGENT_APPROVAL_RESPONSE'] = 'yes';
      const adapter = new GenericAdapter();
      expect(adapter.approvalResponse()).toBe('yes');
    });

    it('trims whitespace from AGENT_APPROVAL_RESPONSE', () => {
      process.env['AGENT_APPROVAL_RESPONSE'] = '  yes  ';
      const adapter = new GenericAdapter();
      expect(adapter.approvalResponse()).toBe('yes');
    });
  });

  describe('buildArgv() with quoted AGENT_ARGS', () => {
    beforeEach(() => {
      process.env['AGENT_BINARY'] = '/custom/agent';
    });

    it('splits quoted path with spaces into single token', () => {
      process.env['AGENT_ARGS'] = '--flag "path with spaces"';
      const adapter = new GenericAdapter();
      const args = adapter.buildArgv({ task: 'task', repoPath: '.' });
      expect(args).toContain('path with spaces');
      expect(args).toContain('--flag');
    });
  });

  describe('parseEvent()', () => {
    beforeEach(() => {
      process.env['AGENT_BINARY'] = '/custom/agent';
    });

    it('parses system/init to init event', () => {
      const adapter = new GenericAdapter();
      const event = adapter.parseEvent(JSON.stringify({ type: 'system/init', model: 'custom-model' }));
      expect(event?.kind).toBe('init');
    });

    it('returns null for malformed JSON', () => {
      const adapter = new GenericAdapter();
      expect(adapter.parseEvent('bad json')).toBeNull();
    });
  });
});

describe('tokenizeArgs', () => {
  it('splits simple space-separated args', () => {
    expect(tokenizeArgs('--stream --model gpt-4')).toEqual(['--stream', '--model', 'gpt-4']);
  });

  it('treats double-quoted string as single token', () => {
    expect(tokenizeArgs('--flag "path with spaces"')).toEqual(['--flag', 'path with spaces']);
  });

  it('handles multiple quoted tokens', () => {
    expect(tokenizeArgs('"first arg" "second arg"')).toEqual(['first arg', 'second arg']);
  });

  it('handles adjacent quoted and unquoted tokens', () => {
    expect(tokenizeArgs('--cwd "/my path" --model gpt')).toEqual(['--cwd', '/my path', '--model', 'gpt']);
  });

  it('single quotes pass through as regular characters', () => {
    expect(tokenizeArgs("--flag 'value'")).toEqual(['--flag', "'value'"]);
  });

  it('returns empty array for empty string', () => {
    expect(tokenizeArgs('')).toEqual([]);
  });

  it('returns empty array for whitespace-only string', () => {
    expect(tokenizeArgs('   ')).toEqual([]);
  });

  it('throws on unmatched double quote', () => {
    expect(() => tokenizeArgs('--flag "unterminated')).toThrow('Unmatched quote in AGENT_ARGS');
  });
});
