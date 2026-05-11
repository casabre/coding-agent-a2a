import { describe, it, expect } from 'vitest';
import { mapAgentEventToA2A } from '../../src/a2a-mapper.js';
import type { TaskStatusUpdateEvent, TaskArtifactUpdateEvent } from '@a2a-js/sdk';
import type { AgentEvent } from '../../src/adapters/base.js';

const TASK_ID = 'task-1';
const CTX_ID = 'ctx-1';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

type MappedResult = ReturnType<typeof mapAgentEventToA2A>;

function single(result: MappedResult): TaskStatusUpdateEvent | TaskArtifactUpdateEvent {
  expect(Array.isArray(result)).toBe(false);
  expect(result).not.toBeNull();
  return result as TaskStatusUpdateEvent | TaskArtifactUpdateEvent;
}

function arr(result: MappedResult): Array<TaskStatusUpdateEvent | TaskArtifactUpdateEvent> {
  expect(Array.isArray(result)).toBe(true);
  return result as Array<TaskStatusUpdateEvent | TaskArtifactUpdateEvent>;
}

describe('mapAgentEventToA2A', () => {
  describe('init', () => {
    it('without model returns single working status update', () => {
      const event: AgentEvent = { kind: 'init' };
      const result = single(mapAgentEventToA2A(event, TASK_ID, CTX_ID));
      expect(result.kind).toBe('status-update');
      const su = result as TaskStatusUpdateEvent;
      expect(su.status.state).toBe('working');
      expect(su.final).toBe(false);
      expect(su.taskId).toBe(TASK_ID);
      expect(su.contextId).toBe(CTX_ID);
    });

    it('with model returns status update + metadata artifact', () => {
      const event: AgentEvent = { kind: 'init', model: 'claude-3', sessionId: 'sess-1' };
      const results = arr(mapAgentEventToA2A(event, TASK_ID, CTX_ID));
      expect(results).toHaveLength(2);
      expect(results[0].kind).toBe('status-update');
      expect(results[1].kind).toBe('artifact-update');
      const artifact = (results[1] as TaskArtifactUpdateEvent).artifact;
      expect(artifact.name).toBe('agent-metadata');
      const data = artifact.parts[0] as { kind: 'data'; data: Record<string, unknown> };
      expect(data.data).toMatchObject({ model: 'claude-3', sessionId: 'sess-1' });
    });

    it('with only sessionId also returns array', () => {
      const event: AgentEvent = { kind: 'init', sessionId: 'sess-1' };
      const results = arr(mapAgentEventToA2A(event, TASK_ID, CTX_ID));
      expect(results).toHaveLength(2);
    });

    it('status update timestamp is ISO 8601', () => {
      const event: AgentEvent = { kind: 'init' };
      const result = single(mapAgentEventToA2A(event, TASK_ID, CTX_ID)) as TaskStatusUpdateEvent;
      expect(result.status.timestamp).toMatch(ISO_RE);
    });
  });

  describe('thinking', () => {
    it('returns artifact-update with append: true', () => {
      const event: AgentEvent = { kind: 'thinking', text: 'Hello!' };
      const result = single(mapAgentEventToA2A(event, TASK_ID, CTX_ID)) as TaskArtifactUpdateEvent;
      expect(result.kind).toBe('artifact-update');
      expect(result.append).toBe(true);
      expect(result.artifact.name).toBe('assistant-response');
      const part = result.artifact.parts[0] as { kind: 'text'; text: string };
      expect(part.text).toBe('Hello!');
    });

    it('returns null for empty text', () => {
      const event: AgentEvent = { kind: 'thinking', text: '' };
      expect(mapAgentEventToA2A(event, TASK_ID, CTX_ID)).toBeNull();
    });

    it('artifactId is a valid UUID v4', () => {
      const event: AgentEvent = { kind: 'thinking', text: 'x' };
      const result = single(mapAgentEventToA2A(event, TASK_ID, CTX_ID)) as TaskArtifactUpdateEvent;
      expect(result.artifact.artifactId).toMatch(UUID_RE);
    });
  });

  describe('tool_use', () => {
    it('returns working status update with tool name', () => {
      const event: AgentEvent = { kind: 'tool_use', tool: 'read_file', input: {} };
      const result = single(mapAgentEventToA2A(event, TASK_ID, CTX_ID)) as TaskStatusUpdateEvent;
      expect(result.status.state).toBe('working');
      expect(result.final).toBe(false);
      const text = (result.status.message!.parts[0] as { kind: 'text'; text: string }).text;
      expect(text).toBe('Using tool: read_file');
    });

    it('includes bash tool name', () => {
      const event: AgentEvent = { kind: 'tool_use', tool: 'bash', input: {} };
      const result = single(mapAgentEventToA2A(event, TASK_ID, CTX_ID)) as TaskStatusUpdateEvent;
      const text = (result.status.message!.parts[0] as { kind: 'text'; text: string }).text;
      expect(text).toBe('Using tool: bash');
    });
  });

  describe('tool_result', () => {
    it('returns working status update with output content', () => {
      const event: AgentEvent = { kind: 'tool_result', tool: 'read_file', output: 'file contents here', isError: false };
      const result = single(mapAgentEventToA2A(event, TASK_ID, CTX_ID)) as TaskStatusUpdateEvent;
      expect(result.status.state).toBe('working');
      const text = (result.status.message!.parts[0] as { kind: 'text'; text: string }).text;
      expect(text).toContain('file contents here');
    });

    it('truncates long output at 200 chars with ellipsis', () => {
      const long = 'x'.repeat(300);
      const event: AgentEvent = { kind: 'tool_result', tool: 'bash', output: long, isError: false };
      const result = single(mapAgentEventToA2A(event, TASK_ID, CTX_ID)) as TaskStatusUpdateEvent;
      const text = (result.status.message!.parts[0] as { kind: 'text'; text: string }).text;
      expect(text.endsWith('…')).toBe(true);
      expect(text.length).toBeLessThanOrEqual(220);
    });
  });

  describe('done', () => {
    it('returns completed status with final: true for empty summary', () => {
      const event: AgentEvent = { kind: 'done', summary: '' };
      const result = single(mapAgentEventToA2A(event, TASK_ID, CTX_ID)) as TaskStatusUpdateEvent;
      expect(result.status.state).toBe('completed');
      expect(result.final).toBe(true);
    });

    it('with non-empty summary returns array with result artifact', () => {
      const event: AgentEvent = { kind: 'done', summary: 'Refactored auth module', stats: { inputTokens: 10 } };
      const results = arr(mapAgentEventToA2A(event, TASK_ID, CTX_ID));
      expect(results).toHaveLength(2);
      expect(results[0].kind).toBe('status-update');
      expect(results[1].kind).toBe('artifact-update');
      const artifact = (results[1] as TaskArtifactUpdateEvent).artifact;
      expect(artifact.name).toBe('result');
    });

    it('with only stats returns array with result artifact', () => {
      const event: AgentEvent = { kind: 'done', summary: '', stats: { durationMs: 5000 } };
      const results = arr(mapAgentEventToA2A(event, TASK_ID, CTX_ID));
      expect(results).toHaveLength(2);
    });
  });

  describe('error', () => {
    it('returns failed status with final: true and error message', () => {
      const event: AgentEvent = { kind: 'error', message: 'something went wrong' };
      const result = single(mapAgentEventToA2A(event, TASK_ID, CTX_ID)) as TaskStatusUpdateEvent;
      expect(result.status.state).toBe('failed');
      expect(result.final).toBe(true);
      const text = (result.status.message!.parts[0] as { kind: 'text'; text: string }).text;
      expect(text).toBe('something went wrong');
    });
  });

  describe('approval_required', () => {
    it('returns input-required status with not final', () => {
      const event: AgentEvent = { kind: 'approval_required', prompt: 'rm -rf dist' };
      const result = single(mapAgentEventToA2A(event, TASK_ID, CTX_ID)) as TaskStatusUpdateEvent;
      expect(result.status.state).toBe('input-required');
      expect(result.final).toBe(false);
      const text = (result.status.message!.parts[0] as { kind: 'text'; text: string }).text;
      expect(text).toContain('rm -rf dist');
    });
  });

  describe('unknown event kind', () => {
    it('returns null', () => {
      const event = { kind: 'unknown_kind' } as unknown as AgentEvent;
      expect(mapAgentEventToA2A(event, TASK_ID, CTX_ID)).toBeNull();
    });
  });
});
