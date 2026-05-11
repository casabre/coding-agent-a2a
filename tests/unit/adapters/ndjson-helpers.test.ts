import { describe, it, expect } from 'vitest';
import { parseSharedNdjsonEvent, extractText } from '../../../src/adapters/ndjson-helpers.js';

describe('extractText', () => {
  it('returns string content directly', () => {
    expect(extractText('hello world')).toBe('hello world');
  });

  it('concatenates text blocks from array', () => {
    const blocks = [
      { type: 'text' as const, text: 'foo' },
      { type: 'text' as const, text: 'bar' },
    ];
    expect(extractText(blocks)).toBe('foobar');
  });

  it('skips non-text blocks in array', () => {
    const blocks = [
      { type: 'tool_use' as const, id: 'x', name: 'bash', input: {} },
      { type: 'text' as const, text: 'result' },
    ] as Parameters<typeof extractText>[0];
    expect(extractText(blocks)).toBe('result');
  });

  it('returns empty string for empty array', () => {
    expect(extractText([])).toBe('');
  });
});

describe('parseSharedNdjsonEvent', () => {
  it('returns null for malformed JSON', () => {
    expect(parseSharedNdjsonEvent('not json')).toBeNull();
  });

  it('returns null for unknown type', () => {
    expect(parseSharedNdjsonEvent(JSON.stringify({ type: 'unknown_type' }))).toBeNull();
  });

  describe('system/init', () => {
    it('maps to init event', () => {
      const event = parseSharedNdjsonEvent(JSON.stringify({ type: 'system/init' }));
      expect(event).toEqual({ kind: 'init', sessionId: undefined, model: undefined });
    });

    it('includes model and sessionId when present', () => {
      const event = parseSharedNdjsonEvent(
        JSON.stringify({ type: 'system/init', model: 'claude-3', sessionId: 'sess-1' }),
      );
      expect(event).toEqual({ kind: 'init', model: 'claude-3', sessionId: 'sess-1' });
    });
  });

  describe('assistant', () => {
    it('maps text content to thinking event', () => {
      const event = parseSharedNdjsonEvent(
        JSON.stringify({
          type: 'assistant',
          message: { role: 'assistant', content: [{ type: 'text', text: 'Hello!' }] },
        }),
      );
      expect(event).toEqual({ kind: 'thinking', text: 'Hello!' });
    });

    it('returns null when no text content', () => {
      const event = parseSharedNdjsonEvent(
        JSON.stringify({
          type: 'assistant',
          message: { role: 'assistant', content: [{ type: 'tool_use', id: 'x', name: 'bash', input: {} }] },
        }),
      );
      expect(event).toBeNull();
    });
  });

  describe('tool_use', () => {
    it('maps to tool_use event with tool name and input', () => {
      const event = parseSharedNdjsonEvent(
        JSON.stringify({ type: 'tool_use', id: 'u1', name: 'read_file', input: { path: 'x.ts' } }),
      );
      expect(event).toEqual({ kind: 'tool_use', tool: 'read_file', input: { path: 'x.ts' } });
    });
  });

  describe('tool_result', () => {
    it('maps string content to tool_result event', () => {
      const event = parseSharedNdjsonEvent(
        JSON.stringify({ type: 'tool_result', tool_use_id: 'u1', content: 'file contents' }),
      );
      expect(event).toEqual({ kind: 'tool_result', tool: '', output: 'file contents', isError: false });
    });

    it('maps array content blocks to tool_result event', () => {
      const event = parseSharedNdjsonEvent(
        JSON.stringify({
          type: 'tool_result',
          tool_use_id: 'u1',
          content: [{ type: 'text', text: 'result text' }],
        }),
      );
      expect(event).toEqual({ kind: 'tool_result', tool: '', output: 'result text', isError: false });
    });
  });

  describe('result', () => {
    it('maps to done event with empty summary', () => {
      const event = parseSharedNdjsonEvent(JSON.stringify({ type: 'result' }));
      expect(event?.kind).toBe('done');
      expect((event as { kind: 'done'; summary: string }).summary).toBe('');
    });

    it('extracts cost tokens into stats', () => {
      const event = parseSharedNdjsonEvent(
        JSON.stringify({ type: 'result', cost: { input_tokens: 100, output_tokens: 50 } }),
      );
      expect(event?.kind).toBe('done');
      const done = event as { kind: 'done'; summary: string; stats: { inputTokens: number; outputTokens: number } };
      expect(done.stats.inputTokens).toBe(100);
      expect(done.stats.outputTokens).toBe(50);
    });
  });

  describe('error', () => {
    it('maps to error event with message', () => {
      const event = parseSharedNdjsonEvent(
        JSON.stringify({ type: 'error', error: { message: 'something failed' } }),
      );
      expect(event).toEqual({ kind: 'error', message: 'something failed' });
    });
  });
});
