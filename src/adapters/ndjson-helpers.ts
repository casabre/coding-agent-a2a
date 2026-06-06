import type { AgentEvent, AgentStats } from './base.js';

type ContentBlock =
  | { type: 'text'; text: string }
  | { type: string; [k: string]: unknown };

interface RawInit {
  type: 'system/init';
  model?: string;
  sessionId?: string;
  [k: string]: unknown;
}

interface RawAssistant {
  type: 'assistant';
  message: { role: string; content: ContentBlock[] };
}

interface RawToolUse {
  type: 'tool_use';
  id: string;
  name: string;
  input: unknown;
}

interface RawToolResult {
  type: 'tool_result';
  tool_use_id: string;
  content: string | ContentBlock[];
}

interface RawResult {
  type: 'result';
  cost?: { input_tokens?: number; output_tokens?: number };
  session_id?: string;
  [k: string]: unknown;
}

interface RawError {
  type: 'error';
  error: { type?: string; message: string };
}

type RawEvent = RawInit | RawAssistant | RawToolUse | RawToolResult | RawResult | RawError | { type: string };

export function extractText(content: string | ContentBlock[]): string {
  if (typeof content === 'string') return content;
  return content
    .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
    .map((b) => b.text)
    .join('');
}

export function parseSharedNdjsonEvent(line: string): AgentEvent | null {
  let raw: RawEvent;
  try {
    raw = JSON.parse(line) as RawEvent;
  } catch {
    return null;
  }

  switch (raw.type) {
    case 'system/init': {
      const e = raw as RawInit;
      return { kind: 'init', sessionId: e.sessionId, model: e.model };
    }
    case 'assistant': {
      const e = raw as RawAssistant;
      const text = extractText(e.message.content);
      if (!text) return null;
      return { kind: 'thinking', text };
    }
    case 'tool_use': {
      const e = raw as RawToolUse;
      return { kind: 'tool_use', tool: e.name, input: e.input };
    }
    case 'tool_result': {
      const e = raw as RawToolResult;
      return { kind: 'tool_result', tool: e.tool_use_id, output: extractText(e.content), isError: false };
    }
    case 'result': {
      const e = raw as RawResult;
      const stats: AgentStats = {};
      if (e.cost?.input_tokens !== undefined) stats.inputTokens = e.cost.input_tokens;
      if (e.cost?.output_tokens !== undefined) stats.outputTokens = e.cost.output_tokens;
      return { kind: 'done', summary: '', stats };
    }
    case 'error': {
      const e = raw as RawError;
      return { kind: 'error', message: e.error.message };
    }
    default:
      return null;
  }
}
