import ts from 'typescript';
import type { SymbolSlice } from './workspace.js';

/** Matches TypeScript/JavaScript source extensions: .ts .tsx .mts .cts .js .jsx .mjs .cjs */
const SUPPORTED_SOURCE = /\.(?:m|c)?[jt]sx?$/;

/** Whether a repo path is a source file the symbol indexer can parse. */
export function isSupportedSource(path: string): boolean {
  return SUPPORTED_SOURCE.test(path);
}

/**
 * Extracts top-level declarations (functions, classes, interfaces, type aliases, enums, and
 * variable bindings) from a TS/JS source string via the TypeScript compiler API.
 *
 * Uses the compiler (pure JS, no native/wasm) rather than tree-sitter to keep the runtime and
 * Docker image dependency-light for this TypeScript-centric tool; multi-language indexing via
 * tree-sitter/LSP remains the documented escalation behind this same {@link SymbolSlice} shape.
 */
export function extractSymbols(filePath: string, source: string): SymbolSlice[] {
  const sourceFile = ts.createSourceFile(filePath, source, ts.ScriptTarget.Latest, false);
  const symbols: SymbolSlice[] = [];
  const add = (kind: string, name: string): void => {
    symbols.push({ name, kind, file: filePath });
  };

  for (const statement of sourceFile.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name) {
      add('function', statement.name.text);
    } else if (ts.isClassDeclaration(statement) && statement.name) {
      add('class', statement.name.text);
    } else if (ts.isInterfaceDeclaration(statement)) {
      add('interface', statement.name.text);
    } else if (ts.isTypeAliasDeclaration(statement)) {
      add('type', statement.name.text);
    } else if (ts.isEnumDeclaration(statement)) {
      add('enum', statement.name.text);
    } else if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name)) add('variable', declaration.name.text);
      }
    }
  }
  return symbols;
}
