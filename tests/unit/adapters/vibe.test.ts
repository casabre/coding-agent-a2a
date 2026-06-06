import { describe, it, expect, afterEach } from 'vitest';
import { VibeAdapter } from '../../../src/adapters/vibe.js';

afterEach(() => {
  delete process.env['VIBE_BINARY_PATH'];
});

describe('VibeAdapter', () => {
  describe('resolveBinary()', () => {
    it('returns VIBE_BINARY_PATH when set', () => {
      process.env['VIBE_BINARY_PATH'] = '/custom/vibe';
      const adapter = new VibeAdapter();
      expect(adapter.resolveBinary()).toBe('/custom/vibe');
    });

    it('returns vibe fallback when env var is not set', () => {
      const adapter = new VibeAdapter();
      expect(adapter.resolveBinary()).toBe('vibe');
    });

    it('trims whitespace from VIBE_BINARY_PATH', () => {
      process.env['VIBE_BINARY_PATH'] = '  /path/to/vibe  ';
      const adapter = new VibeAdapter();
      expect(adapter.resolveBinary()).toBe('/path/to/vibe');
    });
  });

  describe('buildArgv()', () => {
    const adapter = new VibeAdapter();

    it('includes --output-format stream-json', () => {
      const args = adapter.buildArgv({ task: 'do stuff', repoPath: '.' });
      const idx = args.indexOf('--output-format');
      expect(idx).toBeGreaterThanOrEqual(0);
      expect(args[idx + 1]).toBe('stream-json');
    });

    it('includes --trust when force is true', () => {
      const args = adapter.buildArgv({ task: 'p', repoPath: '.', force: true });
      expect(args).toContain('--trust');
    });

    it('includes --trust when force is undefined (defaults to force)', () => {
      const args = adapter.buildArgv({ task: 'p', repoPath: '.' });
      expect(args).toContain('--trust');
    });

    it('excludes --trust when force is false', () => {
      const args = adapter.buildArgv({ task: 'p', repoPath: '.', force: false });
      expect(args).not.toContain('--trust');
    });

    it('includes --model and model when model is set', () => {
      const args = adapter.buildArgv({ task: 'p', repoPath: '.', model: 'mistral-large' });
      const idx = args.indexOf('--model');
      expect(idx).toBeGreaterThanOrEqual(0);
      expect(args[idx + 1]).toBe('mistral-large');
    });

    it('includes --workdir and repoPath when repoPath is set', () => {
      const args = adapter.buildArgv({ task: 'p', repoPath: '/my/repo' });
      const idx = args.indexOf('--workdir');
      expect(idx).toBeGreaterThanOrEqual(0);
      expect(args[idx + 1]).toBe('/my/repo');
    });

    it('appends task as last argument', () => {
      const args = adapter.buildArgv({ task: 'do the thing', repoPath: '.' });
      expect(args[args.length - 1]).toBe('do the thing');
    });
  });

  describe('isApprovalPrompt()', () => {
    const adapter = new VibeAdapter();

    it('detects (y/n) pattern at end of line', () => {
      expect(adapter.isApprovalPrompt('Run command? (y/n)')).toBe(true);
    });

    it('detects [Y/n] pattern at end of line', () => {
      expect(adapter.isApprovalPrompt('Continue? [Y/n]')).toBe(true);
    });

    it('detects (y/n) pattern with trailing space', () => {
      expect(adapter.isApprovalPrompt('Run command? (y/n) ')).toBe(true);
    });

    it('returns false for regular text', () => {
      expect(adapter.isApprovalPrompt('{"type":"result"}')).toBe(false);
    });
  });

  describe('approvalResponse()', () => {
    it('returns y', () => {
      expect(new VibeAdapter().approvalResponse()).toBe('y');
    });
  });

  describe('parseEvent()', () => {
    const adapter = new VibeAdapter();

    it('parses system/init to init event', () => {
      const event = adapter.parseEvent(JSON.stringify({ type: 'system/init', model: 'mistral-large' }));
      expect(event?.kind).toBe('init');
    });

    it('returns null for malformed JSON', () => {
      expect(adapter.parseEvent('bad json')).toBeNull();
    });
  });
});
