import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'node:events';
import type { Config } from '../../../src/types.js';
import type { CodingAgentAdapter, AgentEvent } from '../../../src/adapters/base.js';

// Mock ProcessRunner before importing
vi.mock('../../../src/process-runner.js', async () => {
  const { EventEmitter } = await import('node:events');
  const instance = new EventEmitter() as EventEmitter & {
    start: ReturnType<typeof vi.fn>;
    cancel: ReturnType<typeof vi.fn>;
  };
  instance.start = vi.fn();
  instance.cancel = vi.fn();
  const ProcessRunner = vi.fn(() => instance);
  return { ProcessRunner, __instance: instance };
});

// Mock event-bus to isolate from global state
vi.mock('../../../src/event-bus.js', () => ({
  eventBus: {
    emitJobEvent: vi.fn(),
    onJobEvent: vi.fn(() => () => {}),
    onAllJobEvents: vi.fn(() => () => {}),
  },
}));

import { McpTaskManager } from '../../../src/mcp/task-manager.js';
import { ProcessRunner } from '../../../src/process-runner.js';
import { eventBus } from '../../../src/event-bus.js';

const runnerMod = await import('../../../src/process-runner.js') as unknown as {
  ProcessRunner: ReturnType<typeof vi.fn>;
  __instance: EventEmitter & { start: ReturnType<typeof vi.fn>; cancel: ReturnType<typeof vi.fn> };
};

function getMockRunner() {
  return runnerMod.__instance;
}

const mockAdapter: CodingAgentAdapter = {
  name: 'mock',
  capabilities: { streaming: true, sessionResume: false, shellApproval: false },
  resolveBinary: vi.fn(() => 'mock-binary'),
  buildArgv: vi.fn(() => []),
  parseEvent: vi.fn(() => null),
  isApprovalPrompt: vi.fn(() => false),
  approvalResponse: vi.fn(() => 'y'),
};

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

beforeEach(() => {
  vi.mocked(ProcessRunner).mockClear();
  const runner = getMockRunner();
  runner.removeAllListeners();
  runner.start = vi.fn();
  runner.cancel = vi.fn();
  vi.mocked(eventBus.emitJobEvent).mockClear();
});

describe('McpTaskManager', () => {
  describe('startJob', () => {
    it('returns a job id string', () => {
      const mgr = new McpTaskManager(mockAdapter, baseConfig);
      const jobId = mgr.startJob('do stuff');
      expect(typeof jobId).toBe('string');
      expect(jobId.length).toBeGreaterThan(0);
    });

    it('calls runner.start()', () => {
      const mgr = new McpTaskManager(mockAdapter, baseConfig);
      mgr.startJob('do stuff');
      expect(getMockRunner().start).toHaveBeenCalled();
    });

    it('applies model override to config', () => {
      const mgr = new McpTaskManager(mockAdapter, baseConfig);
      mgr.startJob('task', { model: 'override-model' });
      expect(vi.mocked(ProcessRunner)).toHaveBeenCalledWith(
        expect.objectContaining({ config: expect.objectContaining({ agentModel: 'override-model' }) }),
      );
    });

    it('applies repoPath override to config', () => {
      const mgr = new McpTaskManager(mockAdapter, baseConfig);
      mgr.startJob('task', { repoPath: '/custom/repo' });
      expect(vi.mocked(ProcessRunner)).toHaveBeenCalledWith(
        expect.objectContaining({ config: expect.objectContaining({ agentRepoPath: '/custom/repo' }) }),
      );
    });

    it('applies force override to config', () => {
      const mgr = new McpTaskManager(mockAdapter, baseConfig);
      mgr.startJob('task', { force: false });
      expect(vi.mocked(ProcessRunner)).toHaveBeenCalledWith(
        expect.objectContaining({ config: expect.objectContaining({ agentForce: false }) }),
      );
    });

    it('rejects a repoPath outside the allowed roots when confinement is on', () => {
      const confined: Config = { ...baseConfig, allowedRepoRoots: ['/work'] };
      const mgr = new McpTaskManager(mockAdapter, confined);
      expect(() => mgr.startJob('task', { repoPath: '/etc' })).toThrow(/outside the allowed roots/);
      expect(vi.mocked(ProcessRunner)).not.toHaveBeenCalled();
    });

    it('allows a repoPath within the allowed roots when confinement is on', () => {
      const confined: Config = { ...baseConfig, allowedRepoRoots: ['/work'] };
      const mgr = new McpTaskManager(mockAdapter, confined);
      expect(() => mgr.startJob('task', { repoPath: '/work/repo' })).not.toThrow();
    });

    it('skips the check when no allow-list is configured (unchanged behavior)', () => {
      const mgr = new McpTaskManager(mockAdapter, baseConfig);
      expect(() => mgr.startJob('task', { repoPath: '/anywhere' })).not.toThrow();
    });

    it('emits to eventBus on agent-event', () => {
      const mgr = new McpTaskManager(mockAdapter, baseConfig);
      const jobId = mgr.startJob('task');
      const evt: AgentEvent = { kind: 'thinking', text: 'hello' };
      getMockRunner().emit('agent-event', evt);
      expect(vi.mocked(eventBus.emitJobEvent)).toHaveBeenCalledWith(jobId, evt);
    });

    it('emits error event to eventBus on runner error', () => {
      const mgr = new McpTaskManager(mockAdapter, baseConfig);
      const jobId = mgr.startJob('task');
      getMockRunner().emit('error', new Error('spawn failed'));
      expect(vi.mocked(eventBus.emitJobEvent)).toHaveBeenCalledWith(
        jobId,
        expect.objectContaining({ kind: 'error', message: 'spawn failed' }),
      );
    });

    it('marks job as done on runner done event', () => {
      const mgr = new McpTaskManager(mockAdapter, baseConfig);
      const jobId = mgr.startJob('task');
      getMockRunner().emit('done', 0, '');
      const job = mgr.getJob(jobId);
      expect(job?.done).toBe(true);
    });
  });

  describe('getJob', () => {
    it('returns undefined for unknown jobId', () => {
      const mgr = new McpTaskManager(mockAdapter, baseConfig);
      expect(mgr.getJob('nonexistent')).toBeUndefined();
    });

    it('returns job snapshot with events and done', () => {
      const mgr = new McpTaskManager(mockAdapter, baseConfig);
      const jobId = mgr.startJob('task');
      const evt: AgentEvent = { kind: 'init' };
      getMockRunner().emit('agent-event', evt);
      const job = mgr.getJob(jobId);
      expect(job?.events).toHaveLength(1);
      expect(job?.done).toBe(false);
    });
  });

  describe('pollJob', () => {
    it('returns null for unknown jobId', () => {
      const mgr = new McpTaskManager(mockAdapter, baseConfig);
      expect(mgr.pollJob('nonexistent', 0)).toBeNull();
    });

    it('returns events from sinceLine offset', () => {
      const mgr = new McpTaskManager(mockAdapter, baseConfig);
      const jobId = mgr.startJob('task');
      getMockRunner().emit('agent-event', { kind: 'init' } as AgentEvent);
      getMockRunner().emit('agent-event', { kind: 'thinking', text: 'x' } as AgentEvent);
      const result = mgr.pollJob(jobId, 1);
      expect(result?.events).toHaveLength(1);
      expect(result?.events[0].kind).toBe('thinking');
    });

    it('reflects done state', () => {
      const mgr = new McpTaskManager(mockAdapter, baseConfig);
      const jobId = mgr.startJob('task');
      getMockRunner().emit('done', 0, '');
      const result = mgr.pollJob(jobId, 0);
      expect(result?.done).toBe(true);
    });
  });

  describe('cancelJob', () => {
    it('returns false for unknown jobId', () => {
      const mgr = new McpTaskManager(mockAdapter, baseConfig);
      expect(mgr.cancelJob('nonexistent')).toBe(false);
    });

    it('calls runner.cancel() and removes job', () => {
      const mgr = new McpTaskManager(mockAdapter, baseConfig);
      const jobId = mgr.startJob('task');
      const ok = mgr.cancelJob(jobId);
      expect(ok).toBe(true);
      expect(getMockRunner().cancel).toHaveBeenCalled();
      expect(mgr.getJob(jobId)).toBeUndefined();
    });
  });

  describe('getResult', () => {
    it('returns null for unknown jobId', () => {
      const mgr = new McpTaskManager(mockAdapter, baseConfig);
      expect(mgr.getResult('nonexistent')).toBeNull();
    });

    it('returns summary from done event', () => {
      const mgr = new McpTaskManager(mockAdapter, baseConfig);
      const jobId = mgr.startJob('task');
      getMockRunner().emit('agent-event', { kind: 'done', summary: 'Refactored code' } as AgentEvent);
      getMockRunner().emit('done', 0, '');
      const result = mgr.getResult(jobId);
      expect(result?.summary).toBe('Refactored code');
    });

    it('removes job after done result is retrieved', () => {
      const mgr = new McpTaskManager(mockAdapter, baseConfig);
      const jobId = mgr.startJob('task');
      getMockRunner().emit('done', 0, '');
      mgr.getResult(jobId);
      expect(mgr.getJob(jobId)).toBeUndefined();
    });

    it('returns empty summary when no done event in events', () => {
      const mgr = new McpTaskManager(mockAdapter, baseConfig);
      const jobId = mgr.startJob('task');
      getMockRunner().emit('done', 0, '');
      const result = mgr.getResult(jobId);
      expect(result?.summary).toBe('');
    });

    it('does not remove job if not done yet', () => {
      const mgr = new McpTaskManager(mockAdapter, baseConfig);
      const jobId = mgr.startJob('task');
      // Not done yet
      const result = mgr.getResult(jobId);
      expect(result?.done).toBe(false);
      // Job should still be present
      expect(mgr.getJob(jobId)).toBeDefined();
    });
  });
});
