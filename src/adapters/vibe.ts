import type { ProcessAdapter, RunOptions, AdapterCapabilities, AgentEvent } from './base.js';
import { parseSharedNdjsonEvent } from './ndjson-helpers.js';

/**
 * Adapter for Mistral Vibe CLI.
 * 
 * Vibe CLI uses NDJSON streaming output with --output-format stream-json.
 * Supports --trust flag for auto-approval, --model for model selection,
 * and --workdir for working directory.
 */
export class VibeAdapter implements ProcessAdapter {
  readonly name = 'vibe';
  readonly capabilities: AdapterCapabilities = {
    streaming: true,
    sessionResume: false,
    shellApproval: false,  // Vibe uses --trust to skip approvals
  };

  resolveBinary(): string {
    return process.env['VIBE_BINARY_PATH']?.trim() || 'vibe';
  }

  buildArgv(options: RunOptions): string[] {
    const args: string[] = ['--output-format', 'stream-json'];
    if (options.force !== false) {
      args.push('--trust');
    }
    if (options.model) {
      args.push('--model', options.model);
    }
    if (options.repoPath) {
      args.push('--workdir', options.repoPath);
    }
    args.push(options.task);
    return args;
  }

  parseEvent(line: string): AgentEvent | null {
    return parseSharedNdjsonEvent(line);
  }

  isApprovalPrompt(line: string): boolean {
    return /\(y\/n\)\s*$/i.test(line) || /\[Y\/n\]\s*$/i.test(line);
  }

  approvalResponse(): string {
    return 'y';
  }
}
