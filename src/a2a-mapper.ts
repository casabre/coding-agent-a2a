import {
  TaskState,
  Role,
  type TaskStatusUpdateEvent,
  type TaskArtifactUpdateEvent,
  type Artifact,
  type Part,
  type Message,
} from '@a2a-js/sdk';
import { AgentEvent } from '@a2a-js/sdk/server';
import type { AgentExecutionEvent } from '@a2a-js/sdk/server';
import { v4 as uuidv4 } from 'uuid';
import type { AgentEvent as CodingAgentEvent } from './adapters/base.js';

export type A2AEvent = AgentExecutionEvent;

/**
 * Translates a normalised {@link CodingAgentEvent} into one or two A2A 1.0 events.
 *
 * Returns `null` for events that should not produce an A2A update (e.g. empty `thinking` text).
 * Returns an array when a single agent event maps to multiple A2A events (e.g. `init` with model
 * metadata produces a `status-update` + an `artifact-update`).
 *
 * This function is pure — no I/O, no side effects, no exceptions.
 *
 * @param agentEvent - Parsed event from the CLI stdout stream.
 * @param taskId - A2A task UUID (from {@link RequestContext}).
 * @param contextId - A2A context UUID (from {@link RequestContext}).
 */
export function mapAgentEventToA2A(
  agentEvent: CodingAgentEvent,
  taskId: string,
  contextId: string,
): A2AEvent | A2AEvent[] | null {
  const now = new Date().toISOString();

  switch (agentEvent.kind) {
    case 'init': {
      const statusEvent = AgentEvent.statusUpdate(statusUpdate(taskId, contextId, TaskState.TASK_STATE_WORKING, now));
      if (agentEvent.model !== undefined || agentEvent.sessionId !== undefined) {
        const metadataArtifact = AgentEvent.artifactUpdate(artifactUpdate(taskId, contextId, buildArtifact('agent-metadata', [
          dataPart({ model: agentEvent.model, sessionId: agentEvent.sessionId }),
        ])));
        return [statusEvent, metadataArtifact];
      }
      return statusEvent;
    }

    case 'thinking': {
      if (agentEvent.text.length === 0) return null;
      return AgentEvent.artifactUpdate({
        taskId,
        contextId,
        append: true,
        lastChunk: false,
        artifact: buildArtifact('assistant-response', [textPart(agentEvent.text)]),
        metadata: undefined,
      });
    }

    case 'tool_use': {
      return AgentEvent.statusUpdate(statusUpdate(
        taskId, contextId, TaskState.TASK_STATE_WORKING, now,
        statusMessage(contextId, `Using tool: ${agentEvent.tool}`),
      ));
    }

    case 'tool_result': {
      const raw = agentEvent.output;
      const summary = raw.length > 200 ? raw.slice(0, 200) + '…' : raw;
      return AgentEvent.statusUpdate(statusUpdate(
        taskId, contextId, TaskState.TASK_STATE_WORKING, now,
        statusMessage(contextId, `Tool result: ${summary}`),
      ));
    }

    case 'done': {
      const completedStatus = AgentEvent.statusUpdate(statusUpdate(taskId, contextId, TaskState.TASK_STATE_COMPLETED, now));
      if (agentEvent.summary.length > 0 || agentEvent.stats !== undefined) {
        const resultArtifact = AgentEvent.artifactUpdate(artifactUpdate(taskId, contextId, buildArtifact('result', [
          dataPart({ summary: agentEvent.summary, stats: agentEvent.stats }),
        ]), { lastChunk: true }));
        return [completedStatus, resultArtifact];
      }
      return completedStatus;
    }

    case 'error': {
      return AgentEvent.statusUpdate(statusUpdate(
        taskId, contextId, TaskState.TASK_STATE_FAILED, now,
        statusMessage(contextId, agentEvent.message),
      ));
    }

    case 'approval_required': {
      return AgentEvent.statusUpdate(statusUpdate(
        taskId, contextId, TaskState.TASK_STATE_INPUT_REQUIRED, now,
        statusMessage(contextId, `Approve: ${agentEvent.prompt}?`),
      ));
    }

    default:
      return null;
  }
}

function statusUpdate(
  taskId: string,
  contextId: string,
  state: TaskState,
  timestamp: string,
  message?: Message,
): TaskStatusUpdateEvent {
  return { taskId, contextId, status: { state, timestamp, message }, metadata: undefined };
}

function artifactUpdate(
  taskId: string,
  contextId: string,
  artifact: Artifact,
  opts: { lastChunk?: boolean } = {},
): TaskArtifactUpdateEvent {
  return { taskId, contextId, artifact, append: false, lastChunk: opts.lastChunk ?? false, metadata: undefined };
}

function buildArtifact(name: string, parts: Part[]): Artifact {
  return { artifactId: uuidv4(), name, description: '', parts, metadata: undefined, extensions: [] };
}

function textPart(text: string): Part {
  return { content: { $case: 'text', value: text }, filename: '', mediaType: 'text/plain', metadata: undefined };
}

function dataPart(data: Record<string, unknown>): Part {
  return { content: { $case: 'data', value: data }, filename: '', mediaType: 'application/json', metadata: undefined };
}

function statusMessage(contextId: string, text: string): Message {
  return {
    messageId: uuidv4(),
    role: Role.ROLE_AGENT,
    contextId,
    taskId: '',
    parts: [textPart(text)],
    metadata: undefined,
    extensions: [],
    referenceTaskIds: [],
  };
}
