import { describe, it, expect } from 'vitest';
import { isPathWithin, assertRepoPathAllowed } from '../../src/repo-path.js';

describe('isPathWithin', () => {
  it('accepts the root itself and nested paths', () => {
    expect(isPathWithin('/work', '/work')).toBe(true);
    expect(isPathWithin('/work', '/work/repo')).toBe(true);
    expect(isPathWithin('/work', '/work/a/b/c')).toBe(true);
  });

  it('rejects siblings, parents, and escapes', () => {
    expect(isPathWithin('/work', '/other')).toBe(false);
    expect(isPathWithin('/work', '/')).toBe(false);
    expect(isPathWithin('/work', '/work/../etc')).toBe(false);
    expect(isPathWithin('/work', '/workshop')).toBe(false); // prefix but not nested
  });

  it('normalises relative inputs before comparing', () => {
    expect(isPathWithin('/work', '/work/./repo/../repo')).toBe(true);
  });
});

describe('assertRepoPathAllowed', () => {
  it('passes when the path is within an allowed root', () => {
    expect(() => assertRepoPathAllowed('/work/repo', ['/work'])).not.toThrow();
    expect(() => assertRepoPathAllowed('/b/x', ['/a', '/b'])).not.toThrow();
  });

  it('throws when the path escapes every allowed root', () => {
    expect(() => assertRepoPathAllowed('/etc/passwd', ['/work', '/srv']))
      .toThrow(/outside the allowed roots/);
  });
});
