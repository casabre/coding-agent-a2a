import type { CodingAgentAdapter, RunOptions, AdapterCapabilities, AgentEvent } from './base.js';
import { parseSharedNdjsonEvent } from './ndjson-helpers.js';

export function tokenizeArgs(raw: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let inQuote = false;

  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (ch === '"') {
      inQuote = !inQuote;
    } else if (ch === ' ' && !inQuote) {
      if (current.length > 0) {
        tokens.push(current);
        current = '';
      }
    } else {
      current += ch;
    }
  }

  if (inQuote) {
    throw new Error(`Unmatched quote in AGENT_ARGS: ${raw}`);
  }
  if (current.length > 0) tokens.push(current);
  return tokens;
}

/**
 * Generic adapter for custom coding agent CLIs.
 * 
 * Uses environment variables for full configuration:
 * - AGENT_BINARY: Path to the binary (required)
 * - AGENT_ARGS: Default arguments to pass to the binary
 * - AGENT_APPROVAL_PATTERN: Regex pattern to detect approval prompts
 * - AGENT_APPROVAL_RESPONSE: Response to send for approval prompts
 * 
 * Assumes the binary produces NDJSON-compatible streaming output.
 */
export class GenericAdapter implements CodingAgentAdapter {
  readonly name = 'generic';
  readonly capabilities: AdapterCapabilities = {
    streaming: true,
    sessionResume: false,
    shellApproval: false,
  };

  resolveBinary(): string {
    const binary = process.env['AGENT_BINARY']?.trim();
    if (!binary) {
      throw new Error('AGENT_BINARY environment variable is required for generic adapter');
    }
    return binary;
  }

  buildArgv(options: RunOptions): string[] {
    const baseArgs = process.env['AGENT_ARGS']?.trim() || '';
    const args: string[] = baseArgs ? tokenizeArgs(baseArgs) : [];
    args.push(options.task);
    return args;
  }

  parseEvent(line: string): AgentEvent | null {
    return parseSharedNdjsonEvent(line);
  }

  isApprovalPrompt(line: string): boolean {
    const pattern = process.env['AGENT_APPROVAL_PATTERN']?.trim();
    if (pattern) {
      try {
        return new RegExp(pattern).test(line);
      } catch {
        // Invalid regex - fall through to default
      }
    }
    // Default patterns for common approval prompts
    return /\(y\/n\)\s*$/i.test(line) || 
           /\ [Yy]\/N\s*$/i.test(line) ||
           /\[[YyNn]\/.*\]\s*$/i.test(line) ||
           /^Do you want to /i.test(line) ||
           /^Continue\?\s*$/i.test(line);
  }

  approvalResponse(): string {
    return process.env['AGENT_APPROVAL_RESPONSE']?.trim() || 'y';
  }
}
