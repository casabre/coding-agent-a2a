import type { ContextPack } from './workspace.js';

/** Maximum number of file paths to inline in the context header. */
const MAX_FILES = 50;

/** Strips the block-closing delimiter from untrusted repo text so it can't break out of the context block. */
function sanitize(text: string): string {
  return text.split('</workspace-context>').join('');
}

/**
 * Prepends a compact workspace-context block to a task prompt, drawn from the discovery cache.
 *
 * Returns the task **unchanged** when the pack carries nothing (e.g. from `NullWorkspace` or a
 * disabled workspace) — this is what keeps the no-workspace path byte-identical.
 */
export function augmentTaskPrompt(task: string, pack: ContextPack): string {
  const sections: string[] = [];
  if (pack.conventions.agentsMd) sections.push(`AGENTS.md:\n${sanitize(pack.conventions.agentsMd)}`);
  if (pack.conventions.claudeMd) sections.push(`CLAUDE.md:\n${sanitize(pack.conventions.claudeMd)}`);
  if (pack.conventions.testCommand) sections.push(`Test command: ${pack.conventions.testCommand}`);
  if (pack.symbols.length > 0) {
    sections.push(`Symbols: ${pack.symbols.map((s) => s.name).join(', ')}`);
  }
  if (pack.files.length > 0) {
    const shown = pack.files.slice(0, MAX_FILES).join(', ');
    const more = pack.files.length > MAX_FILES ? `, …(+${pack.files.length - MAX_FILES})` : '';
    sections.push(`Files (${pack.files.length}): ${shown}${more}`);
  }
  if (sections.length === 0) return task;
  return `<workspace-context>\n${sections.join('\n\n')}\n</workspace-context>\n\n${task}`;
}
