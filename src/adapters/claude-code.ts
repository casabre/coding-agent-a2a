import type { CodingAgentAdapter, RunOptions, AdapterCapabilities, AgentEvent } from './base.js';
import { parseSharedNdjsonEvent } from './ndjson-helpers.js';

const APPROVAL_RE = /\[Y\/n\]|\(y\/N\)|\[y\/N\]|\(Y\/n\)/i;

export class ClaudeCodeAdapter implements CodingAgentAdapter {
  readonly name = 'claude-code';

  readonly capabilities: AdapterCapabilities = {
    streaming: true,
    sessionResume: false,
    shellApproval: true,
  };

  resolveBinary(): string {
    return process.env['CLAUDE_CODE_PATH']?.trim() || 'claude';
  }

  buildArgv(options: RunOptions): string[] {
    const args: string[] = ['--print', '--output-format', 'stream-json'];
    if (options.force !== false) args.push('--dangerously-skip-permissions');
    if (options.model) args.push('--model', options.model);
    args.push(options.task);
    return args;
  }

  parseEvent(line: string): AgentEvent | null {
    return parseSharedNdjsonEvent(line);
  }

  isApprovalPrompt(line: string): boolean {
    return APPROVAL_RE.test(line);
  }

  approvalResponse(): string {
    return 'y';
  }
}
