import { describe, it, expect } from 'vitest';
import { classify, normalizeProfile } from '../../../src/routing/classifier.js';

describe('classify', () => {
  it('classifies architectural/multi-file work as COMPLEX', () => {
    expect(classify('Refactor the auth module')).toBe('COMPLEX');
    expect(classify('migrate the database layer')).toBe('COMPLEX');
    expect(classify('debug the failing checkout flow')).toBe('COMPLEX');
    expect(classify('review the security of the token path')).toBe('COMPLEX');
    expect(classify('make this change across the codebase')).toBe('COMPLEX');
  });

  it('classifies trivial mechanical edits as ROUTINE', () => {
    expect(classify('rename the variable foo to bar')).toBe('ROUTINE');
    expect(classify('fix a typo in the README')).toBe('ROUTINE');
    expect(classify('add a docstring to parseEvent')).toBe('ROUTINE');
    expect(classify('remove unused imports')).toBe('ROUTINE');
  });

  it('defaults ordinary feature work to MID', () => {
    expect(classify('add a health endpoint')).toBe('MID');
    expect(classify('write a test for the poll handler')).toBe('MID');
  });

  it('lets COMPLEX win over ROUTINE when both keywords appear', () => {
    expect(classify('refactor and rename the helpers')).toBe('COMPLEX');
  });

  it('biases very long prompts to COMPLEX', () => {
    expect(classify('please '.repeat(300))).toBe('COMPLEX');
  });
});

describe('normalizeProfile', () => {
  it('accepts recognised profiles case-insensitively', () => {
    expect(normalizeProfile('complex')).toBe('COMPLEX');
    expect(normalizeProfile('MID')).toBe('MID');
    expect(normalizeProfile('Routine')).toBe('ROUTINE');
  });

  it('returns undefined for unknown or non-string values', () => {
    expect(normalizeProfile('nonsense')).toBeUndefined();
    expect(normalizeProfile(undefined)).toBeUndefined();
    expect(normalizeProfile(42)).toBeUndefined();
  });
});
