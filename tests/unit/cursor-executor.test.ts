import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'node:events';
import type { Config } from '../../src/types.js';
import type { AgentEvent, CodingAgentAdapter } from '../../src/adapters/base.js';
import type { TaskStatusUpdateEvent } from '@a2a-js/sdk';
import type { RequestContext } from '@a2a-js/sdk/server';

// vi.mock factories are hoisted — use vi.fn() inline, not external variables
vi.mock('../../src/cursor-runner.js', async () => {
  const { EventEmitter } = await import('node:events');
  const instance = new EventEmitter() as EventEmitter & {
    start: ReturnType<typeof vi.fn>;
    cancel: ReturnType<typeof vi.fn>;
    resume: ReturnType<typeof vi.fn>;
  };
  instance.start = vi.fn();
  instance.cancel = vi.fn();
  instance.resume = vi.fn();
  const CursorRunner = vi.fn(() => instance);
  return { CursorRunner, __instance: instance };
});

vi.mock('../../src/a2a-mapper.js', () => ({
  mapAgentEventToA2A: vi.fn(() => null),
}));

import { CursorAgentExecutor } from '../../src/cursor-executor.js';
import { mapAgentEventToA2A } from '../../src/a2a-mapper.js';
import { CursorRunner } from '../../src/cursor-runner.js';

const runnerMod = await import('../../src/cursor-runner.js') as unknown as {
  CursorRunner: ReturnType<typeof vi.fn>;
  __instance: EventEmitter & { start: ReturnType<typeof vi.fn>; cancel: ReturnType<typeof vi.fn>; resume: ReturnType<typeof vi.fn> };
};

function getMockRunner() {
  return runnerMod.__instance;
}

const baseConfig: Config = {
  port: 41242,
  agentAdapter: 'cursor',
  agentModel: undefined,
  agentTimeoutMs: 5000,
  agentIdleExitMs: 0,
  agentForce: true,
  agentRepoPath: '.',
  mcpTransport: 'stdio',
  logLevel: 'warn',
};

const mockAdapter: CodingAgentAdapter = {
  name: 'mock',
  capabilities: { streaming: true, sessionResume: false, shellApproval: false },
  resolveBinary: vi.fn(() => 'mock-agent'),
  buildArgv: vi.fn(() => ['--print', 'task']),
  parseEvent: vi.fn(() => null),
  isApprovalPrompt: vi.fn(() => false),
  approvalResponse: vi.fn(() => 'y'),
};

function makeBus() {
  return {
    publish: vi.fn(),
    finished: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
    once: vi.fn(),
    removeAllListeners: vi.fn(),
  };
}

function makeContext(overrides: Partial<{
  taskId: string;
  contextId: string;
  parts: Array<{ kind: 'text'; text: string }>;
}> = {}): RequestContext {
  return {
    taskId: overrides.taskId ?? 'task-1',
    contextId: overrides.contextId ?? 'ctx-1',
    userMessage: {
      kind: 'message',
      messageId: 'msg-1',
      role: 'user',
      contextId: overrides.contextId ?? 'ctx-1',
      parts: overrides.parts ?? [{ kind: 'text', text: 'do stuff' }],
    },
  } as unknown as RequestContext;
}

beforeEach(() => {
  vi.mocked(CursorRunner).mockClear();
  const runner = getMockRunner();
  runner.removeAllListeners();
  runner.start = vi.fn();
  runner.cancel = vi.fn();
  runner.resume = vi.fn();
  vi.mocked(mapAgentEventToA2A).mockReturnValue(null);
});

describe('CursorAgentExecutor', () => {
  describe('execute()', () => {
    it('spawns runner with task extracted from message parts', async () => {
      const executor = new CursorAgentExecutor(baseConfig, mockAdapter);
      const bus = makeBus();
      const ctx = makeContext({ parts: [{ kind: 'text', text: 'refactor auth' }] });

      const execPromise = executor.execute(ctx, bus);
      getMockRunner().emit('done', 0, '');
      await execPromise;

      expect(vi.mocked(CursorRunner)).toHaveBeenCalledWith(
        expect.objectContaining({ task: 'refactor auth' }),
      );
    });

    it('joins multiple text parts with newline', async () => {
      const executor = new CursorAgentExecutor(baseConfig, mockAdapter);
      const bus = makeBus();
      const ctx = makeContext({
        parts: [
          { kind: 'text', text: 'part one' },
          { kind: 'text', text: 'part two' },
        ],
      });

      const execPromise = executor.execute(ctx, bus);
      getMockRunner().emit('done', 0, '');
      await execPromise;

      expect(vi.mocked(CursorRunner)).toHaveBeenCalledWith(
        expect.objectContaining({ task: 'part one\npart two' }),
      );
    });

    it('passes empty string as task when no text parts', async () => {
      const executor = new CursorAgentExecutor(baseConfig, mockAdapter);
      const bus = makeBus();
      const ctx = makeContext({ parts: [] });

      const execPromise = executor.execute(ctx, bus);
      getMockRunner().emit('done', 0, '');
      await execPromise;

      expect(vi.mocked(CursorRunner)).toHaveBeenCalledWith(
        expect.objectContaining({ task: '' }),
      );
    });

    it('calls runner.start()', async () => {
      const executor = new CursorAgentExecutor(baseConfig, mockAdapter);
      const bus = makeBus();

      const execPromise = executor.execute(makeContext(), bus);
      getMockRunner().emit('done', 0, '');
      await execPromise;

      expect(getMockRunner().start).toHaveBeenCalled();
    });

    it('publishes mapped A2A event for each agent-event', async () => {
      const executor = new CursorAgentExecutor(baseConfig, mockAdapter);
      const bus = makeBus();
      const fakeA2AEvent: TaskStatusUpdateEvent = {
        kind: 'status-update',
        taskId: 'task-1',
        contextId: 'ctx-1',
        final: false,
        status: { state: 'working' },
      };
      vi.mocked(mapAgentEventToA2A).mockReturnValue(fakeA2AEvent);

      const execPromise = executor.execute(makeContext(), bus);
      getMockRunner().emit('agent-event', { kind: 'init' } as AgentEvent);
      getMockRunner().emit('done', 0, '');
      await execPromise;

      expect(bus.publish).toHaveBeenCalledWith(fakeA2AEvent);
    });

    it('does not publish mapped events when mapper returns null', async () => {
      const executor = new CursorAgentExecutor(baseConfig, mockAdapter);
      const bus = makeBus();
      vi.mocked(mapAgentEventToA2A).mockReturnValue(null);

      const execPromise = executor.execute(makeContext(), bus);
      getMockRunner().emit('agent-event', { kind: 'thinking', text: 'x' } as AgentEvent);
      getMockRunner().emit('done', 0, '');
      await execPromise;

      // Only the initial task event is published; no mapped events
      const nonTaskCalls = (bus.publish.mock.calls as Array<[{ kind: string }]>).filter(
        ([e]) => e.kind !== 'task',
      );
      expect(nonTaskCalls).toHaveLength(0);
    });

    it('publishes each event when mapper returns an array', async () => {
      const executor = new CursorAgentExecutor(baseConfig, mockAdapter);
      const bus = makeBus();
      const ev1: TaskStatusUpdateEvent = { kind: 'status-update', taskId: 't', contextId: 'c', final: false, status: { state: 'working' } };
      const ev2: TaskStatusUpdateEvent = { kind: 'status-update', taskId: 't', contextId: 'c', final: false, status: { state: 'working' } };
      vi.mocked(mapAgentEventToA2A).mockReturnValue([ev1, ev2]);

      const execPromise = executor.execute(makeContext(), bus);
      getMockRunner().emit('agent-event', { kind: 'init' } as AgentEvent);
      getMockRunner().emit('done', 0, '');
      await execPromise;

      // Initial task event (1) + 2 mapped events = 3 total
      expect(bus.publish).toHaveBeenCalledTimes(3);
    });

    it('on exit code 0 calls finished() without publishing failed status', async () => {
      const executor = new CursorAgentExecutor(baseConfig, mockAdapter);
      const bus = makeBus();

      const execPromise = executor.execute(makeContext(), bus);
      getMockRunner().emit('done', 0, '');
      await execPromise;

      expect(bus.finished).toHaveBeenCalled();
      const failedCalls = (bus.publish.mock.calls as Array<[TaskStatusUpdateEvent]>).filter(
        ([e]) => e.kind === 'status-update' && e.status.state === 'failed',
      );
      expect(failedCalls).toHaveLength(0);
    });

    it('on non-zero exit publishes failed status and calls finished()', async () => {
      const executor = new CursorAgentExecutor(baseConfig, mockAdapter);
      const bus = makeBus();

      const execPromise = executor.execute(makeContext(), bus);
      getMockRunner().emit('done', 2, '');
      await execPromise;

      const failedCalls = (bus.publish.mock.calls as Array<[TaskStatusUpdateEvent]>).filter(
        ([e]) => e.kind === 'status-update' && e.status.state === 'failed',
      );
      expect(failedCalls).toHaveLength(1);
      expect(bus.finished).toHaveBeenCalled();
    });

    it('on runner error publishes failed status and calls finished()', async () => {
      const executor = new CursorAgentExecutor(baseConfig, mockAdapter);
      const bus = makeBus();

      const execPromise = executor.execute(makeContext(), bus);
      getMockRunner().emit('error', new Error('spawn failed'));
      await execPromise;

      const failedCalls = (bus.publish.mock.calls as Array<[TaskStatusUpdateEvent]>).filter(
        ([e]) => e.kind === 'status-update' && e.status.state === 'failed',
      );
      expect(failedCalls).toHaveLength(1);
      expect(bus.finished).toHaveBeenCalled();
    });

    it('removes runner from map after completion (new execute creates new runner)', async () => {
      const executor = new CursorAgentExecutor(baseConfig, mockAdapter);
      const bus = makeBus();
      const ctx = makeContext({ taskId: 'task-x' });

      const execPromise = executor.execute(ctx, bus);
      getMockRunner().emit('done', 0, '');
      await execPromise;

      vi.mocked(CursorRunner).mockClear();
      const execPromise2 = executor.execute(ctx, bus);
      getMockRunner().emit('done', 0, '');
      await execPromise2;

      expect(vi.mocked(CursorRunner)).toHaveBeenCalledTimes(1);
    });

    it('re-subscribe: calls runner.resume() instead of spawning new runner', async () => {
      const executor = new CursorAgentExecutor(baseConfig, mockAdapter);
      const bus = makeBus();
      const ctx = makeContext({ taskId: 'task-1' });

      executor.execute(ctx, bus);

      vi.mocked(CursorRunner).mockClear();
      const resumeCtx = makeContext({ taskId: 'task-1', parts: [{ kind: 'text', text: 'y' }] });
      executor.execute(resumeCtx, bus);

      expect(vi.mocked(CursorRunner)).not.toHaveBeenCalled();
      expect(getMockRunner().resume).toHaveBeenCalledWith('y');
    });
  });

  describe('cancelTask()', () => {
    it('calls runner.cancel() for active task', async () => {
      const executor = new CursorAgentExecutor(baseConfig, mockAdapter);
      const bus = makeBus();
      executor.execute(makeContext({ taskId: 'task-1' }), bus);

      const cancelBus = makeBus();
      await executor.cancelTask('task-1', cancelBus);

      expect(getMockRunner().cancel).toHaveBeenCalled();
    });

    it('publishes canceled status and calls finished()', async () => {
      const executor = new CursorAgentExecutor(baseConfig, mockAdapter);
      const bus = makeBus();
      executor.execute(makeContext({ taskId: 'task-1' }), bus);

      const cancelBus = makeBus();
      await executor.cancelTask('task-1', cancelBus);

      const canceledCalls = (cancelBus.publish.mock.calls as Array<[TaskStatusUpdateEvent]>).filter(
        ([e]) => e.kind === 'status-update' && e.status.state === 'canceled',
      );
      expect(canceledCalls).toHaveLength(1);
      expect(cancelBus.finished).toHaveBeenCalled();
    });

    it('no error for unknown taskId', async () => {
      const executor = new CursorAgentExecutor(baseConfig, mockAdapter);
      const cancelBus = makeBus();
      await expect(executor.cancelTask('nonexistent-task', cancelBus)).resolves.toBeUndefined();
    });
  });
});
