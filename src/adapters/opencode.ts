import type { CodingAgentAdapter, RunOptions, AdapterCapabilities, AgentEvent } from './base.js';
import { parseSharedNdjsonEvent } from './ndjson-helpers.js';

/**
 * Adapter for OpenCode CLI.
 * 
 * OpenCode CLI uses streaming JSON output with --stream flag.
 * Supports --auto-approve flag for auto-approval,
 * --model for model selection, and --cwd for working directory.
 */
export class OpenCodeAdapter implements CodingAgentAdapter {
  readonly name = 'opencode';
  readonly capabilities: AdapterCapabilities = {
    streaming: true,
    sessionResume: false,
    shellApproval: true,  // OpenCode has approval prompts
  };

  resolveBinary(): string {
    return process.env['OPENCODE_BINARY_PATH']?.trim() || 'opencode';
  }

  buildArgv(options: RunOptions): string[] {
    const args: string[] = ['--stream'];
    if (options.force !== false) {
      args.push('--auto-approve');
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
    return /Approve\s+this\s+command\?/i.test(line) ||
           /\[y\/N\]/i.test(line) ||
           /\(Y\/n\)/i.test(line);
  }

  approvalResponse(): string {
    return 'y';
  }
}
