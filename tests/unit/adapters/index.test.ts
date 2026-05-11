import { describe, it, expect } from 'vitest';
import { resolveAdapter } from '../../../src/adapters/index.js';

describe('resolveAdapter', () => {
  it('resolves cursor adapter by name', () => {
    const adapter = resolveAdapter('cursor');
    expect(adapter.name).toBe('cursor');
  });

  it('resolves claude-code adapter by name', () => {
    const adapter = resolveAdapter('claude-code');
    expect(adapter.name).toBe('claude-code');
  });

  it('throws for unknown adapter name', () => {
    expect(() => resolveAdapter('unknown-agent')).toThrow(/"unknown-agent"/);
  });

  it('error message lists available adapters', () => {
    expect(() => resolveAdapter('codex')).toThrow(/cursor/);
  });
});
