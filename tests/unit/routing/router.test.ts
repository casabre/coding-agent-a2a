import { describe, it, expect } from 'vitest';
import { FixedRouter, ProfileRouter, createRouter } from '../../../src/routing/router.js';
import { resolveAdapter } from '../../../src/adapters/index.js';
import type { Config, RoutingConfig } from '../../../src/types.js';

const cursor = resolveAdapter('cursor');

const routing: RoutingConfig = {
  COMPLEX: { adapter: 'cursor' },
  MID:     { adapter: 'claude-code', model: 'some-model' },
  ROUTINE: { adapter: 'codex' },
};

describe('FixedRouter', () => {
  it('always returns the single adapter regardless of task', () => {
    const r = new FixedRouter(cursor);
    expect(r.select('refactor everything').adapter).toBe(cursor);
    expect(r.select('rename x').profile).toBe('fixed');
    expect(r.select('anything').model).toBeUndefined();
  });
});

describe('ProfileRouter', () => {
  it('maps the classified profile to its adapter', () => {
    const r = new ProfileRouter(routing);
    expect(r.select('refactor the auth module').adapter.name).toBe('cursor');   // COMPLEX
    expect(r.select('rename foo to bar').adapter.name).toBe('codex');           // ROUTINE
    expect(r.select('add a feature').adapter.name).toBe('claude-code');         // MID
  });

  it('carries the per-profile model override', () => {
    const r = new ProfileRouter(routing);
    expect(r.select('add a feature').model).toBe('some-model'); // MID has a model
    expect(r.select('refactor x').model).toBeUndefined();       // COMPLEX has none
  });

  it('honours an explicit profile over the classifier', () => {
    const r = new ProfileRouter(routing);
    // "rename" would classify ROUTINE, but explicit COMPLEX wins
    expect(r.select('rename foo', 'COMPLEX').adapter.name).toBe('cursor');
    expect(r.select('rename foo', 'complex').profile).toBe('COMPLEX');
  });

  it('falls back to the classifier when the explicit profile is unrecognised', () => {
    const r = new ProfileRouter(routing);
    expect(r.select('rename foo', 'garbage').adapter.name).toBe('codex'); // ROUTINE
  });

  it('rejects an unknown adapter name at construction (fail fast)', () => {
    expect(() => new ProfileRouter({
      COMPLEX: { adapter: 'nope' },
      MID:     { adapter: 'cursor' },
      ROUTINE: { adapter: 'cursor' },
    })).toThrow(/Unknown adapter/);
  });
});

describe('createRouter', () => {
  const base = { agentAdapter: 'cursor' } as unknown as Config;

  it('returns a FixedRouter when no routing config is present', () => {
    const r = createRouter(base, cursor);
    expect(r).toBeInstanceOf(FixedRouter);
    expect(r.select('refactor').profile).toBe('fixed');
  });

  it('returns a ProfileRouter when routing config is present', () => {
    const r = createRouter({ ...base, routing }, cursor);
    expect(r).toBeInstanceOf(ProfileRouter);
    expect(r.select('rename x').adapter.name).toBe('codex');
  });
});
