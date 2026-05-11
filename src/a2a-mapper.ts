import type {
  TaskStatusUpdateEvent,
  TaskArtifactUpdateEvent,
  TextPart,
  DataPart,
} from '@a2a-js/sdk';
import type { Artifact1 } from '@a2a-js/sdk';
import { v4 as uuidv4 } from 'uuid';
import type { AgentEvent } from './adapters/base.js';

export type A2AEvent = TaskStatusUpdateEvent | TaskArtifactUpdateEvent;

/**
 * Translates a normalised {@link AgentEvent} into one or two A2A SDK events.
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
  agentEvent: AgentEvent,
  taskId: string,
  contextId: string,
): A2AEvent | A2AEvent[] | null {
  const now = new Date().toISOString();

  switch (agentEvent.kind) {
    case 'init': {
      const statusEvent: TaskStatusUpdateEvent = {
        kind: 'status-update',
        taskId,
        contextId,
        final: false,
        status: { state: 'working', timestamp: now },
      };
      if (agentEvent.model !== undefined || agentEvent.sessionId !== undefined) {
        const metadataArtifact: TaskArtifactUpdateEvent = {
          kind: 'artifact-update',
          taskId,
          contextId,
          artifact: buildArtifact('agent-metadata', [
            dataPart({ model: agentEvent.model, sessionId: agentEvent.sessionId }),
          ]),
        };
        return [statusEvent, metadataArtifact];
      }
      return statusEvent;
    }

    case 'thinking': {
      if (agentEvent.text.length === 0) return null;
      return {
        kind: 'artifact-update',
        taskId,
        contextId,
        append: true,
        artifact: buildArtifact('assistant-response', [textPart(agentEvent.text)]),
      };
    }

    case 'tool_use': {
      return {
        kind: 'status-update',
        taskId,
        contextId,
        final: false,
        status: {
          state: 'working',
          timestamp: now,
          message: statusMessage(contextId, `Using tool: ${agentEvent.tool}`),
        },
      };
    }

    case 'tool_result': {
      const raw = agentEvent.output;
      const summary = raw.length > 200 ? raw.slice(0, 200) + '…' : raw;
      return {
        kind: 'status-update',
        taskId,
        contextId,
        final: false,
        status: {
          state: 'working',
          timestamp: now,
          message: statusMessage(contextId, `Tool result: ${summary}`),
        },
      };
    }

    case 'done': {
      const completedStatus: TaskStatusUpdateEvent = {
        kind: 'status-update',
        taskId,
        contextId,
        final: true,
        status: { state: 'completed', timestamp: now },
      };
      if (agentEvent.summary.length > 0 || agentEvent.stats !== undefined) {
        const resultArtifact: TaskArtifactUpdateEvent = {
          kind: 'artifact-update',
          taskId,
          contextId,
          artifact: buildArtifact('result', [
            dataPart({ summary: agentEvent.summary, stats: agentEvent.stats }),
          ]),
        };
        return [completedStatus, resultArtifact];
      }
      return completedStatus;
    }

    case 'error': {
      return {
        kind: 'status-update',
        taskId,
        contextId,
        final: true,
        status: {
          state: 'failed',
          timestamp: now,
          message: statusMessage(contextId, agentEvent.message),
        },
      };
    }

    case 'approval_required': {
      return {
        kind: 'status-update',
        taskId,
        contextId,
        final: false,
        status: {
          state: 'input-required',
          timestamp: now,
          message: statusMessage(contextId, `Approve: ${agentEvent.prompt}?`),
        },
      };
    }

    default:
      return null;
  }
}

function buildArtifact(name: string, parts: (TextPart | DataPart)[]): Artifact1 {
  return { artifactId: uuidv4(), name, parts };
}

function textPart(text: string): TextPart {
  return { kind: 'text', text };
}

function dataPart(data: Record<string, unknown>): DataPart {
  return { kind: 'data', data };
}

function statusMessage(contextId: string, text: string) {
  return {
    kind: 'message' as const,
    messageId: uuidv4(),
    role: 'agent' as const,
    contextId,
    parts: [textPart(text)],
  };
}
