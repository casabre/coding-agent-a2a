import type { ProcessAdapter, RunOptions, AdapterCapabilities, AgentEvent } from './base.js';
import { parseSharedNdjsonEvent } from './ndjson-helpers.js';

/**
 * Adapter for Codex CLI (codex.sh).
 * 
 * Codex CLI uses NDJSON streaming output with --stream flag.
 * Supports --yes and --auto-approve flags for auto-approval,
 * --model for model selection, and --cwd for working directory.
 */
export class CodexAdapter implements ProcessAdapter {
  readonly name = 'codex';
  readonly capabilities: AdapterCapabilities = {
    streaming: true,
    sessionResume: false,
    shellApproval: true,  // Codex has approval prompts
  };

  resolveBinary(): string {
    return process.env['CODEX_BINARY_PATH']?.trim() || 'codex';
  }

  buildArgv(options: RunOptions): string[] {
    const args: string[] = ['--stream'];
    if (options.force !== false) {
      // Both flags included for forward-compat; verify against the installed binary version.
      args.push('--yes', '--auto-approve');
    }
    if (options.model) {
      args.push('--model', options.model);
    }
    if (options.repoPath) {
      args.push('--cwd', options.repoPath);
    }
    args.push(options.task);
    return args;
  }

  parseEvent(line: string): AgentEvent | null {
    return parseSharedNdjsonEvent(line);
  }

  isApprovalPrompt(line: string): boolean {
    return /^\s*Approve\?\s*\(y\/n\)/i.test(line) ||
           /^\[Approve\]\s*\(y\/n\)/i.test(line);
  }

  approvalResponse(): string {
    return 'y';
  }
}
