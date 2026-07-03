import type { AgentExecutor, ExecutionEventBus, RequestContext } from '@a2a-js/sdk/server';
import { AgentEvent } from '@a2a-js/sdk/server';
import { TaskState, Role, type Part } from '@a2a-js/sdk';
import type { Config } from './types.js';
import type { ProcessAdapter } from './adapters/base.js';
import type { Runner } from './runner.js';
import type { Router } from './routing/router.js';
import { FixedRouter } from './routing/router.js';
import { ProcessRunner } from './process-runner.js';
import { mapAgentEventToA2A } from './a2a-mapper.js';
import { v4 as uuidv4 } from 'uuid';

export class AgentTaskExecutor implements AgentExecutor {
  private readonly _config: Config;
  private readonly _router: Router;
  private readonly _activeRunners = new Map<string, Runner>();

  /**
   * @param router - Per-request adapter selector. Defaults to a {@link FixedRouter} around
   *   `adapter` (routing disabled) so existing callers are unchanged.
   */
  constructor(config: Config, adapter: ProcessAdapter, router?: Router) {
    this._config = config;
    this._router = router ?? new FixedRouter(adapter);
  }

  execute = async (requestContext: RequestContext, eventBus: ExecutionEventBus): Promise<void> => {
    const { taskId, contextId } = requestContext;

    const prompt = requestContext.userMessage.parts
      .filter((p): p is Part => p.content?.$case === 'text')
      .map((p) => (p.content as { $case: 'text'; value: string }).value)
      .join('\n');

    // Re-subscribe: if a runner exists for this task (e.g. after input-required), resume it
    let runner = this._activeRunners.get(taskId);
    if (runner !== undefined) {
      runner.resume(prompt);
      return;
    }

    // Publish initial Task to seed the ResultManager's currentTask in the SDK
    eventBus.publish(AgentEvent.task({
      id: taskId,
      contextId,
      status: { state: TaskState.TASK_STATE_SUBMITTED, timestamp: new Date().toISOString(), message: undefined },
      artifacts: [],
      history: [],
      metadata: undefined,
    }));

    const route = this._router.select(prompt, readProfile(requestContext.userMessage.metadata));
    const runConfig = route.model !== undefined ? { ...this._config, agentModel: route.model } : this._config;
    runner = new ProcessRunner({ task: prompt, adapter: route.adapter, config: runConfig });
    this._activeRunners.set(taskId, runner);

    return new Promise<void>((resolve) => {
      runner!.on('agent-event', (agentEvent) => {
        const a2aResult = mapAgentEventToA2A(agentEvent, taskId, contextId);
        if (a2aResult === null) return;
        const events = Array.isArray(a2aResult) ? a2aResult : [a2aResult];
        for (const event of events) {
          eventBus.publish(event);
        }
      });

      runner!.on('done', (exitCode) => {
        this._activeRunners.delete(taskId);
        if (exitCode !== 0) {
          eventBus.publish(AgentEvent.statusUpdate({
            taskId,
            contextId,
            status: {
              state: TaskState.TASK_STATE_FAILED,
              timestamp: new Date().toISOString(),
              message: agentMessage(contextId, `agent exited with code ${exitCode}`),
            },
            metadata: undefined,
          }));
        }
        eventBus.finished();
        resolve();
      });

      runner!.on('error', (err) => {
        this._activeRunners.delete(taskId);
        eventBus.publish(AgentEvent.statusUpdate({
          taskId,
          contextId,
          status: {
            state: TaskState.TASK_STATE_FAILED,
            timestamp: new Date().toISOString(),
            message: agentMessage(contextId, err.message),
          },
          metadata: undefined,
        }));
        eventBus.finished();
        resolve();
      });

      runner!.start();
    });
  };

  cancelTask = async (taskId: string, eventBus: ExecutionEventBus): Promise<void> => {
    const runner = this._activeRunners.get(taskId);
    if (runner === undefined) {
      console.warn(`[agent-task-executor] cancelTask: no active runner for taskId=${taskId}`);
      return;
    }
    this._activeRunners.delete(taskId);
    runner.cancel();
    eventBus.publish(AgentEvent.statusUpdate({
      taskId,
      contextId: taskId,
      status: {
        state: TaskState.TASK_STATE_CANCELED,
        timestamp: new Date().toISOString(),
        message: undefined,
      },
      metadata: undefined,
    }));
    eventBus.finished();
  };
}

/**
 * Best-effort read of an explicit routing profile from A2A message metadata
 * (`metadata.profile`). Returns `undefined` when absent — the router then classifies the task.
 */
function readProfile(metadata: unknown): string | undefined {
  if (typeof metadata !== 'object' || metadata === null) return undefined;
  const value = (metadata as Record<string, unknown>)['profile'];
  return typeof value === 'string' ? value : undefined;
}

function agentMessage(contextId: string, text: string) {
  return {
    messageId: uuidv4(),
    role: Role.ROLE_AGENT,
    contextId,
    taskId: '',
    parts: [{ content: { $case: 'text' as const, value: text }, filename: '', mediaType: 'text/plain', metadata: undefined }],
    metadata: undefined,
    extensions: [],
    referenceTaskIds: [],
  };
}
