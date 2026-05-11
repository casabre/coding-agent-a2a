import type { AgentExecutor, ExecutionEventBus, RequestContext } from '@a2a-js/sdk/server';
import type { TextPart } from '@a2a-js/sdk';
import type { Config } from './types.js';
import type { CodingAgentAdapter } from './adapters/base.js';
import { CursorRunner } from './cursor-runner.js';
import { mapAgentEventToA2A } from './a2a-mapper.js';
import { v4 as uuidv4 } from 'uuid';

export class CursorAgentExecutor implements AgentExecutor {
  private readonly _config: Config;
  private readonly _adapter: CodingAgentAdapter;
  private readonly _activeRunners = new Map<string, CursorRunner>();

  constructor(config: Config, adapter: CodingAgentAdapter) {
    this._config = config;
    this._adapter = adapter;
  }

  execute = async (requestContext: RequestContext, eventBus: ExecutionEventBus): Promise<void> => {
    const { taskId, contextId } = requestContext;

    const prompt = requestContext.userMessage.parts
      .filter((p): p is TextPart => 'text' in p && p.kind === 'text')
      .map((p) => p.text)
      .join('\n');

    // Re-subscribe: if a runner exists for this task (e.g. after input-required), resume it
    let runner = this._activeRunners.get(taskId);
    if (runner !== undefined) {
      runner.resume(prompt);
      return;
    }

    // Publish initial Task to seed the ResultManager's currentTask in the SDK
    eventBus.publish({
      kind: 'task',
      id: taskId,
      contextId,
      status: { state: 'working', timestamp: new Date().toISOString() },
      history: [],
    });

    runner = new CursorRunner({ task: prompt, adapter: this._adapter, config: this._config });
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
          eventBus.publish({
            kind: 'status-update',
            taskId,
            contextId,
            final: true,
            status: {
              state: 'failed',
              timestamp: new Date().toISOString(),
              message: {
                kind: 'message',
                messageId: uuidv4(),
                role: 'agent',
                contextId,
                parts: [{ kind: 'text', text: `agent exited with code ${exitCode}` }],
              },
            },
          });
        }
        eventBus.finished();
        resolve();
      });

      runner!.on('error', (err) => {
        this._activeRunners.delete(taskId);
        eventBus.publish({
          kind: 'status-update',
          taskId,
          contextId,
          final: true,
          status: {
            state: 'failed',
            timestamp: new Date().toISOString(),
            message: {
              kind: 'message',
              messageId: uuidv4(),
              role: 'agent',
              contextId,
              parts: [{ kind: 'text', text: err.message }],
            },
          },
        });
        eventBus.finished();
        resolve();
      });

      runner!.start();
    });
  };

  cancelTask = async (taskId: string, eventBus: ExecutionEventBus): Promise<void> => {
    const runner = this._activeRunners.get(taskId);
    if (runner === undefined) {
      console.warn(`[cursor-executor] cancelTask: no active runner for taskId=${taskId}`);
      return;
    }
    this._activeRunners.delete(taskId);
    runner.cancel();
    eventBus.publish({
      kind: 'status-update',
      taskId,
      contextId: taskId,
      final: true,
      status: {
        state: 'canceled',
        timestamp: new Date().toISOString(),
      },
    });
    eventBus.finished();
  };
}
