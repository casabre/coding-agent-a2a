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

  it('resolves vibe adapter by name', () => {
    const adapter = resolveAdapter('vibe');
    expect(adapter.name).toBe('vibe');
  });

  it('resolves codex adapter by name', () => {
    const adapter = resolveAdapter('codex');
    expect(adapter.name).toBe('codex');
  });

  it('resolves opencode adapter by name', () => {
    const adapter = resolveAdapter('opencode');
    expect(adapter.name).toBe('opencode');
  });

  it('resolves generic adapter by name', () => {
    const adapter = resolveAdapter('generic');
    expect(adapter.name).toBe('generic');
  });

  it('throws for unknown adapter name', () => {
    expect(() => resolveAdapter('unknown-agent')).toThrow(/"unknown-agent"/);
  });

  it('error message lists available adapters', () => {
    expect(() => resolveAdapter('nonexistent')).toThrow(/cursor/);
  });
});
