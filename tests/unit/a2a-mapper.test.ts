import { describe, it, expect } from 'vitest';
import { mapAgentEventToA2A } from '../../src/a2a-mapper.js';
import { TaskState } from '@a2a-js/sdk';
import type { AgentExecutionEvent } from '@a2a-js/sdk/server';
import type { TaskStatusUpdateEvent, TaskArtifactUpdateEvent } from '@a2a-js/sdk';
import type { AgentEvent } from '../../src/adapters/base.js';

const TASK_ID = 'task-1';
const CTX_ID = 'ctx-1';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

type MappedResult = ReturnType<typeof mapAgentEventToA2A>;

function single(result: MappedResult): AgentExecutionEvent {
  expect(Array.isArray(result)).toBe(false);
  expect(result).not.toBeNull();
  return result as AgentExecutionEvent;
}

function arr(result: MappedResult): AgentExecutionEvent[] {
  expect(Array.isArray(result)).toBe(true);
  return result as AgentExecutionEvent[];
}

function asStatusUpdate(event: AgentExecutionEvent): TaskStatusUpdateEvent {
  expect(event.kind).toBe('statusUpdate');
  return (event as { kind: 'statusUpdate'; data: TaskStatusUpdateEvent }).data;
}

function asArtifactUpdate(event: AgentExecutionEvent): TaskArtifactUpdateEvent {
  expect(event.kind).toBe('artifactUpdate');
  return (event as { kind: 'artifactUpdate'; data: TaskArtifactUpdateEvent }).data;
}

describe('mapAgentEventToA2A', () => {
  describe('init', () => {
    it('without model returns single working status update', () => {
      const event: AgentEvent = { kind: 'init' };
      const result = single(mapAgentEventToA2A(event, TASK_ID, CTX_ID));
      const su = asStatusUpdate(result);
      expect(su.status?.state).toBe(TaskState.TASK_STATE_WORKING);
      expect(su.taskId).toBe(TASK_ID);
      expect(su.contextId).toBe(CTX_ID);
    });

    it('with model returns status update + metadata artifact', () => {
      const event: AgentEvent = { kind: 'init', model: 'claude-3', sessionId: 'sess-1' };
      const results = arr(mapAgentEventToA2A(event, TASK_ID, CTX_ID));
      expect(results).toHaveLength(2);
      const su = asStatusUpdate(results[0]);
      expect(su.status?.state).toBe(TaskState.TASK_STATE_WORKING);
      const au = asArtifactUpdate(results[1]);
      expect(au.artifact?.name).toBe('agent-metadata');
      const data = au.artifact?.parts[0]?.content;
      expect(data?.$case).toBe('data');
      if (data?.$case === 'data') {
        expect(data.value).toMatchObject({ model: 'claude-3', sessionId: 'sess-1' });
      }
    });

    it('with only sessionId also returns array', () => {
      const event: AgentEvent = { kind: 'init', sessionId: 'sess-1' };
      const results = arr(mapAgentEventToA2A(event, TASK_ID, CTX_ID));
      expect(results).toHaveLength(2);
    });

    it('status update timestamp is ISO 8601', () => {
      const event: AgentEvent = { kind: 'init' };
      const result = single(mapAgentEventToA2A(event, TASK_ID, CTX_ID));
      const su = asStatusUpdate(result);
      expect(su.status?.timestamp).toMatch(ISO_RE);
    });
  });

  describe('thinking', () => {
    it('returns artifactUpdate with append: true', () => {
      const event: AgentEvent = { kind: 'thinking', text: 'Hello!' };
      const result = single(mapAgentEventToA2A(event, TASK_ID, CTX_ID));
      const au = asArtifactUpdate(result);
      expect(au.append).toBe(true);
      expect(au.artifact?.name).toBe('assistant-response');
      const part = au.artifact?.parts[0]?.content;
      expect(part?.$case).toBe('text');
      if (part?.$case === 'text') {
        expect(part.value).toBe('Hello!');
      }
    });

    it('returns null for empty text', () => {
      const event: AgentEvent = { kind: 'thinking', text: '' };
      expect(mapAgentEventToA2A(event, TASK_ID, CTX_ID)).toBeNull();
    });

    it('artifactId is a valid UUID v4', () => {
      const event: AgentEvent = { kind: 'thinking', text: 'x' };
      const result = single(mapAgentEventToA2A(event, TASK_ID, CTX_ID));
      const au = asArtifactUpdate(result);
      expect(au.artifact?.artifactId).toMatch(UUID_RE);
    });
  });

  describe('tool_use', () => {
    it('returns working status update with tool name', () => {
      const event: AgentEvent = { kind: 'tool_use', tool: 'read_file', input: {} };
      const result = single(mapAgentEventToA2A(event, TASK_ID, CTX_ID));
      const su = asStatusUpdate(result);
      expect(su.status?.state).toBe(TaskState.TASK_STATE_WORKING);
      const msgPart = su.status?.message?.parts[0]?.content;
      expect(msgPart?.$case).toBe('text');
      if (msgPart?.$case === 'text') {
        expect(msgPart.value).toBe('Using tool: read_file');
      }
    });

    it('includes bash tool name', () => {
      const event: AgentEvent = { kind: 'tool_use', tool: 'bash', input: {} };
      const result = single(mapAgentEventToA2A(event, TASK_ID, CTX_ID));
      const su = asStatusUpdate(result);
      const msgPart = su.status?.message?.parts[0]?.content;
      if (msgPart?.$case === 'text') {
        expect(msgPart.value).toBe('Using tool: bash');
      }
    });
  });

  describe('tool_result', () => {
    it('returns working status update with output content', () => {
      const event: AgentEvent = { kind: 'tool_result', tool: 'read_file', output: 'file contents here', isError: false };
      const result = single(mapAgentEventToA2A(event, TASK_ID, CTX_ID));
      const su = asStatusUpdate(result);
      expect(su.status?.state).toBe(TaskState.TASK_STATE_WORKING);
      const msgPart = su.status?.message?.parts[0]?.content;
      if (msgPart?.$case === 'text') {
        expect(msgPart.value).toContain('file contents here');
      }
    });

    it('truncates long output at 200 chars with ellipsis', () => {
      const long = 'x'.repeat(300);
      const event: AgentEvent = { kind: 'tool_result', tool: 'bash', output: long, isError: false };
      const result = single(mapAgentEventToA2A(event, TASK_ID, CTX_ID));
      const su = asStatusUpdate(result);
      const msgPart = su.status?.message?.parts[0]?.content;
      if (msgPart?.$case === 'text') {
        expect(msgPart.value.endsWith('…')).toBe(true);
        expect(msgPart.value.length).toBeLessThanOrEqual(220);
      }
    });
  });

  describe('done', () => {
    it('returns completed status for empty summary', () => {
      const event: AgentEvent = { kind: 'done', summary: '' };
      const result = single(mapAgentEventToA2A(event, TASK_ID, CTX_ID));
      const su = asStatusUpdate(result);
      expect(su.status?.state).toBe(TaskState.TASK_STATE_COMPLETED);
    });

    it('with non-empty summary returns array with result artifact', () => {
      const event: AgentEvent = { kind: 'done', summary: 'Refactored auth module', stats: { inputTokens: 10 } };
      const results = arr(mapAgentEventToA2A(event, TASK_ID, CTX_ID));
      expect(results).toHaveLength(2);
      const su = asStatusUpdate(results[0]);
      expect(su.status?.state).toBe(TaskState.TASK_STATE_COMPLETED);
      const au = asArtifactUpdate(results[1]);
      expect(au.artifact?.name).toBe('result');
    });

    it('with only stats returns array with result artifact', () => {
      const event: AgentEvent = { kind: 'done', summary: '', stats: { durationMs: 5000 } };
      const results = arr(mapAgentEventToA2A(event, TASK_ID, CTX_ID));
      expect(results).toHaveLength(2);
    });
  });

  describe('error', () => {
    it('returns failed status with error message', () => {
      const event: AgentEvent = { kind: 'error', message: 'something went wrong' };
      const result = single(mapAgentEventToA2A(event, TASK_ID, CTX_ID));
      const su = asStatusUpdate(result);
      expect(su.status?.state).toBe(TaskState.TASK_STATE_FAILED);
      const msgPart = su.status?.message?.parts[0]?.content;
      if (msgPart?.$case === 'text') {
        expect(msgPart.value).toBe('something went wrong');
      }
    });
  });

  describe('approval_required', () => {
    it('returns input-required status', () => {
      const event: AgentEvent = { kind: 'approval_required', prompt: 'rm -rf dist' };
      const result = single(mapAgentEventToA2A(event, TASK_ID, CTX_ID));
      const su = asStatusUpdate(result);
      expect(su.status?.state).toBe(TaskState.TASK_STATE_INPUT_REQUIRED);
      const msgPart = su.status?.message?.parts[0]?.content;
      if (msgPart?.$case === 'text') {
        expect(msgPart.value).toContain('rm -rf dist');
      }
    });
  });

  describe('unknown event kind', () => {
    it('returns null', () => {
      const event = { kind: 'unknown_kind' } as unknown as AgentEvent;
      expect(mapAgentEventToA2A(event, TASK_ID, CTX_ID)).toBeNull();
    });
  });
});
