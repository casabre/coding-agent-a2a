import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'node:events';
import type { Config } from '../../src/types.js';
import type { AgentEvent, CodingAgentAdapter } from '../../src/adapters/base.js';
import { TaskState } from '@a2a-js/sdk';
import type { AgentExecutionEvent } from '@a2a-js/sdk/server';
import type { RequestContext } from '@a2a-js/sdk/server';

// vi.mock factories are hoisted — use vi.fn() inline, not external variables
vi.mock('../../src/process-runner.js', async () => {
  const { EventEmitter } = await import('node:events');
  const instance = new EventEmitter() as EventEmitter & {
    start: ReturnType<typeof vi.fn>;
    cancel: ReturnType<typeof vi.fn>;
    resume: ReturnType<typeof vi.fn>;
  };
  instance.start = vi.fn();
  instance.cancel = vi.fn();
  instance.resume = vi.fn();
  const ProcessRunner = vi.fn(() => instance);
  return { ProcessRunner, __instance: instance };
});

vi.mock('../../src/a2a-mapper.js', () => ({
  mapAgentEventToA2A: vi.fn(() => null),
}));

import { AgentTaskExecutor } from '../../src/agent-task-executor.js';
import { mapAgentEventToA2A } from '../../src/a2a-mapper.js';
import { ProcessRunner } from '../../src/process-runner.js';

const runnerMod = await import('../../src/process-runner.js') as unknown as {
  ProcessRunner: ReturnType<typeof vi.fn>;
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
  parts: Array<{ content: { $case: 'text'; value: string }; filename: string; mediaType: string; metadata: undefined }>;
}> = {}): RequestContext {
  return {
    taskId: overrides.taskId ?? 'task-1',
    contextId: overrides.contextId ?? 'ctx-1',
    userMessage: {
      messageId: 'msg-1',
      role: 1, // ROLE_USER
      contextId: overrides.contextId ?? 'ctx-1',
      taskId: '',
      parts: overrides.parts ?? [{ content: { $case: 'text', value: 'do stuff' }, filename: '', mediaType: '', metadata: undefined }],
      metadata: undefined,
      extensions: [],
      referenceTaskIds: [],
    },
  } as unknown as RequestContext;
}

function makeTextPart(text: string) {
  return { content: { $case: 'text' as const, value: text }, filename: '', mediaType: '', metadata: undefined };
}

beforeEach(() => {
  vi.mocked(ProcessRunner).mockClear();
  const runner = getMockRunner();
  runner.removeAllListeners();
  runner.start = vi.fn();
  runner.cancel = vi.fn();
  runner.resume = vi.fn();
  vi.mocked(mapAgentEventToA2A).mockReturnValue(null);
});

describe('AgentTaskExecutor', () => {
  describe('execute()', () => {
    it('spawns runner with task extracted from message parts', async () => {
      const executor = new AgentTaskExecutor(baseConfig, mockAdapter);
      const bus = makeBus();
      const ctx = makeContext({ parts: [makeTextPart('refactor auth')] });

      const execPromise = executor.execute(ctx, bus);
      getMockRunner().emit('done', 0, '');
      await execPromise;

      expect(vi.mocked(ProcessRunner)).toHaveBeenCalledWith(
        expect.objectContaining({ task: 'refactor auth' }),
      );
    });

    it('joins multiple text parts with newline', async () => {
      const executor = new AgentTaskExecutor(baseConfig, mockAdapter);
      const bus = makeBus();
      const ctx = makeContext({
        parts: [makeTextPart('part one'), makeTextPart('part two')],
      });

      const execPromise = executor.execute(ctx, bus);
      getMockRunner().emit('done', 0, '');
      await execPromise;

      expect(vi.mocked(ProcessRunner)).toHaveBeenCalledWith(
        expect.objectContaining({ task: 'part one\npart two' }),
      );
    });

    it('passes empty string as task when no text parts', async () => {
      const executor = new AgentTaskExecutor(baseConfig, mockAdapter);
      const bus = makeBus();
      const ctx = makeContext({ parts: [] });

      const execPromise = executor.execute(ctx, bus);
      getMockRunner().emit('done', 0, '');
      await execPromise;

      expect(vi.mocked(ProcessRunner)).toHaveBeenCalledWith(
        expect.objectContaining({ task: '' }),
      );
    });

    it('calls runner.start()', async () => {
      const executor = new AgentTaskExecutor(baseConfig, mockAdapter);
      const bus = makeBus();

      const execPromise = executor.execute(makeContext(), bus);
      getMockRunner().emit('done', 0, '');
      await execPromise;

      expect(getMockRunner().start).toHaveBeenCalled();
    });

    it('publishes mapped A2A event for each agent-event', async () => {
      const executor = new AgentTaskExecutor(baseConfig, mockAdapter);
      const bus = makeBus();
      const fakeA2AEvent: AgentExecutionEvent = {
        kind: 'statusUpdate',
        data: {
          taskId: 'task-1',
          contextId: 'ctx-1',
          status: { state: TaskState.TASK_STATE_WORKING, timestamp: '', message: undefined },
          metadata: undefined,
        },
      };
      vi.mocked(mapAgentEventToA2A).mockReturnValue(fakeA2AEvent);

      const execPromise = executor.execute(makeContext(), bus);
      getMockRunner().emit('agent-event', { kind: 'init' } as AgentEvent);
      getMockRunner().emit('done', 0, '');
      await execPromise;

      expect(bus.publish).toHaveBeenCalledWith(fakeA2AEvent);
    });

    it('does not publish mapped events when mapper returns null', async () => {
      const executor = new AgentTaskExecutor(baseConfig, mockAdapter);
      const bus = makeBus();
      vi.mocked(mapAgentEventToA2A).mockReturnValue(null);

      const execPromise = executor.execute(makeContext(), bus);
      getMockRunner().emit('agent-event', { kind: 'thinking', text: 'x' } as AgentEvent);
      getMockRunner().emit('done', 0, '');
      await execPromise;

      // Only the initial task event is published; no mapped events
      const nonTaskCalls = (bus.publish.mock.calls as Array<[AgentExecutionEvent]>).filter(
        ([e]) => e.kind !== 'task',
      );
      expect(nonTaskCalls).toHaveLength(0);
    });

    it('publishes each event when mapper returns an array', async () => {
      const executor = new AgentTaskExecutor(baseConfig, mockAdapter);
      const bus = makeBus();
      const ev1: AgentExecutionEvent = { kind: 'statusUpdate', data: { taskId: 't', contextId: 'c', status: { state: TaskState.TASK_STATE_WORKING, timestamp: '', message: undefined }, metadata: undefined } };
      const ev2: AgentExecutionEvent = { kind: 'statusUpdate', data: { taskId: 't', contextId: 'c', status: { state: TaskState.TASK_STATE_WORKING, timestamp: '', message: undefined }, metadata: undefined } };
      vi.mocked(mapAgentEventToA2A).mockReturnValue([ev1, ev2]);

      const execPromise = executor.execute(makeContext(), bus);
      getMockRunner().emit('agent-event', { kind: 'init' } as AgentEvent);
      getMockRunner().emit('done', 0, '');
      await execPromise;

      // Initial task event (1) + 2 mapped events = 3 total
      expect(bus.publish).toHaveBeenCalledTimes(3);
    });

    it('on exit code 0 calls finished() without publishing failed status', async () => {
      const executor = new AgentTaskExecutor(baseConfig, mockAdapter);
      const bus = makeBus();

      const execPromise = executor.execute(makeContext(), bus);
      getMockRunner().emit('done', 0, '');
      await execPromise;

      expect(bus.finished).toHaveBeenCalled();
      const failedCalls = (bus.publish.mock.calls as Array<[AgentExecutionEvent]>).filter(
        ([e]) => e.kind === 'statusUpdate' && (e as { kind: 'statusUpdate'; data: { status: { state: TaskState } } }).data.status.state === TaskState.TASK_STATE_FAILED,
      );
      expect(failedCalls).toHaveLength(0);
    });

    it('on non-zero exit publishes failed status and calls finished()', async () => {
      const executor = new AgentTaskExecutor(baseConfig, mockAdapter);
      const bus = makeBus();

      const execPromise = executor.execute(makeContext(), bus);
      getMockRunner().emit('done', 2, '');
      await execPromise;

      const failedCalls = (bus.publish.mock.calls as Array<[AgentExecutionEvent]>).filter(
        ([e]) => e.kind === 'statusUpdate' && (e as { kind: 'statusUpdate'; data: { status: { state: TaskState } } }).data.status.state === TaskState.TASK_STATE_FAILED,
      );
      expect(failedCalls).toHaveLength(1);
      expect(bus.finished).toHaveBeenCalled();
    });

    it('on runner error publishes failed status and calls finished()', async () => {
      const executor = new AgentTaskExecutor(baseConfig, mockAdapter);
      const bus = makeBus();

      const execPromise = executor.execute(makeContext(), bus);
      getMockRunner().emit('error', new Error('spawn failed'));
      await execPromise;

      const failedCalls = (bus.publish.mock.calls as Array<[AgentExecutionEvent]>).filter(
        ([e]) => e.kind === 'statusUpdate' && (e as { kind: 'statusUpdate'; data: { status: { state: TaskState } } }).data.status.state === TaskState.TASK_STATE_FAILED,
      );
      expect(failedCalls).toHaveLength(1);
      expect(bus.finished).toHaveBeenCalled();
    });

    it('removes runner from map after completion (new execute creates new runner)', async () => {
      const executor = new AgentTaskExecutor(baseConfig, mockAdapter);
      const bus = makeBus();
      const ctx = makeContext({ taskId: 'task-x' });

      const execPromise = executor.execute(ctx, bus);
      getMockRunner().emit('done', 0, '');
      await execPromise;

      vi.mocked(ProcessRunner).mockClear();
      const execPromise2 = executor.execute(ctx, bus);
      getMockRunner().emit('done', 0, '');
      await execPromise2;

      expect(vi.mocked(ProcessRunner)).toHaveBeenCalledTimes(1);
    });

    it('re-subscribe: calls runner.resume() instead of spawning new runner', async () => {
      const executor = new AgentTaskExecutor(baseConfig, mockAdapter);
      const bus = makeBus();
      const ctx = makeContext({ taskId: 'task-1' });

      executor.execute(ctx, bus);

      vi.mocked(ProcessRunner).mockClear();
      const resumeCtx = makeContext({ taskId: 'task-1', parts: [makeTextPart('y')] });
      executor.execute(resumeCtx, bus);

      expect(vi.mocked(ProcessRunner)).not.toHaveBeenCalled();
      expect(getMockRunner().resume).toHaveBeenCalledWith('y');
    });
  });

  describe('cancelTask()', () => {
    it('calls runner.cancel() for active task', async () => {
      const executor = new AgentTaskExecutor(baseConfig, mockAdapter);
      const bus = makeBus();
      executor.execute(makeContext({ taskId: 'task-1' }), bus);

      const cancelBus = makeBus();
      await executor.cancelTask('task-1', cancelBus);

      expect(getMockRunner().cancel).toHaveBeenCalled();
    });

    it('publishes canceled status and calls finished()', async () => {
      const executor = new AgentTaskExecutor(baseConfig, mockAdapter);
      const bus = makeBus();
      executor.execute(makeContext({ taskId: 'task-1' }), bus);

      const cancelBus = makeBus();
      await executor.cancelTask('task-1', cancelBus);

      const canceledCalls = (cancelBus.publish.mock.calls as Array<[AgentExecutionEvent]>).filter(
        ([e]) => e.kind === 'statusUpdate' && (e as { kind: 'statusUpdate'; data: { status: { state: TaskState } } }).data.status.state === TaskState.TASK_STATE_CANCELED,
      );
      expect(canceledCalls).toHaveLength(1);
      expect(cancelBus.finished).toHaveBeenCalled();
    });

    it('no error for unknown taskId', async () => {
      const executor = new AgentTaskExecutor(baseConfig, mockAdapter);
      const cancelBus = makeBus();
      await expect(executor.cancelTask('nonexistent-task', cancelBus)).resolves.toBeUndefined();
    });
  });
});

describe('AgentTaskExecutor routing', () => {
  function contextWithMetadata(metadata: unknown, taskId: string): RequestContext {
    return {
      taskId,
      contextId: 'ctx-r',
      userMessage: {
        messageId: 'm', role: 1, contextId: 'ctx-r', taskId: '',
        parts: [makeTextPart('do stuff')],
        metadata, extensions: [], referenceTaskIds: [],
      },
    } as unknown as RequestContext;
  }

  it('runs the router-selected adapter and applies its model override', () => {
    const routed = { ...mockAdapter, name: 'routed' };
    const seen: unknown[] = [];
    const router = {
      select: (_task: string, profile?: unknown) => {
        seen.push(profile);
        return { adapter: routed, model: 'routed-model', profile: 'MID' as const };
      },
    };
    const executor = new AgentTaskExecutor(baseConfig, mockAdapter, router);
    void executor.execute(contextWithMetadata({ profile: 'MID' }, 'task-r1'), makeBus() as never);

    expect(seen).toEqual(['MID']); // readProfile extracted the string from metadata
    expect(vi.mocked(ProcessRunner)).toHaveBeenCalledWith(
      expect.objectContaining({
        adapter: routed,
        config: expect.objectContaining({ agentModel: 'routed-model' }),
      }),
    );
  });

  it('passes undefined profile when metadata is null or lacks a string profile', () => {
    const seen: unknown[] = [];
    const router = {
      select: (_task: string, profile?: unknown) => {
        seen.push(profile);
        return { adapter: mockAdapter, profile: 'fixed' as const };
      },
    };
    const executor = new AgentTaskExecutor(baseConfig, mockAdapter, router);
    void executor.execute(contextWithMetadata({ profile: 123 }, 'task-r2'), makeBus() as never); // object, non-string
    void executor.execute(contextWithMetadata(null, 'task-r3'), makeBus() as never);              // null

    expect(seen).toEqual([undefined, undefined]);
  });
});
