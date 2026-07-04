import { describe, it, expect } from 'vitest';
import { extractSymbols, isSupportedSource } from '../../../src/context/symbol-index.js';

describe('isSupportedSource', () => {
  it('accepts TS/JS extensions', () => {
    for (const p of ['a.ts', 'a.tsx', 'a.mts', 'a.cts', 'a.js', 'a.jsx', 'a.mjs', 'a.cjs']) {
      expect(isSupportedSource(p)).toBe(true);
    }
  });
  it('rejects non-source files', () => {
    for (const p of ['README.md', 'package.json', 'a.py', 'a.txt']) {
      expect(isSupportedSource(p)).toBe(false);
    }
  });
});

describe('extractSymbols', () => {
  it('extracts each top-level declaration kind', () => {
    const src = `
      export function foo() {}
      export class Bar {}
      export interface Baz {}
      export type Qux = string;
      export enum Color { Red }
      export const answer = 42;
      let mutable = 1;
    `;
    const symbols = extractSymbols('src/a.ts', src);
    const byKind = (kind: string) => symbols.filter((s) => s.kind === kind).map((s) => s.name);
    expect(byKind('function')).toEqual(['foo']);
    expect(byKind('class')).toEqual(['Bar']);
    expect(byKind('interface')).toEqual(['Baz']);
    expect(byKind('type')).toEqual(['Qux']);
    expect(byKind('enum')).toEqual(['Color']);
    expect(byKind('variable')).toEqual(['answer', 'mutable']);
    expect(symbols.every((s) => s.file === 'src/a.ts')).toBe(true);
  });

  it('skips anonymous default function/class declarations (no name)', () => {
    expect(extractSymbols('a.ts', 'export default function () {}')).toEqual([]);
    expect(extractSymbols('a.ts', 'export default class {}')).toEqual([]);
  });

  it('skips destructuring bindings (non-identifier names)', () => {
    const symbols = extractSymbols('a.ts', 'const { x, y } = point;');
    expect(symbols).toEqual([]);
  });

  it('returns nothing for empty or declaration-free source', () => {
    expect(extractSymbols('a.ts', '')).toEqual([]);
    expect(extractSymbols('a.ts', 'foo(); bar();')).toEqual([]);
  });
});
