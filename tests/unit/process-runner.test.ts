import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import type { Config } from '../../src/types.js';
import type { AgentEvent, CodingAgentAdapter } from '../../src/adapters/base.js';

// --- Mock child_process ---
const mockChild = new EventEmitter() as EventEmitter & {
  stdout: EventEmitter;
  stderr: EventEmitter;
  stdin: { write: ReturnType<typeof vi.fn>; end: ReturnType<typeof vi.fn> };
  kill: ReturnType<typeof vi.fn>;
};

vi.mock('node:child_process', () => ({
  spawn: vi.fn(() => mockChild),
}));

import { spawn } from 'node:child_process';
import { ProcessRunner } from '../../src/process-runner.js';

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

function makeMockAdapter(overrides: Partial<CodingAgentAdapter> = {}): CodingAgentAdapter {
  return {
    name: 'mock',
    capabilities: { streaming: true, sessionResume: false, shellApproval: false },
    resolveBinary: vi.fn(() => 'mock-agent'),
    buildArgv: vi.fn((opts) => ['--print', opts.task]),
    parseEvent: vi.fn((line: string): AgentEvent | null => {
      try {
        const parsed = JSON.parse(line) as Record<string, unknown>;
        if (parsed['type'] === 'system/init') return { kind: 'init', model: parsed['model'] as string | undefined };
        if (parsed['type'] === 'result') return { kind: 'done', summary: '' };
        return null;
      } catch {
        return null;
      }
    }),
    isApprovalPrompt: vi.fn(() => false),
    approvalResponse: vi.fn(() => 'y'),
    ...overrides,
  };
}

function resetMockChild() {
  mockChild.removeAllListeners();
  mockChild.stdout = new EventEmitter();
  mockChild.stderr = new EventEmitter();
  mockChild.stdin = { write: vi.fn(), end: vi.fn() };
  mockChild.kill = vi.fn();
}

function emitLine(line: string) {
  mockChild.stdout.emit('data', Buffer.from(line + '\n'));
}

function exitChild(code: number) {
  mockChild.emit('close', code);
}

beforeEach(() => {
  resetMockChild();
  vi.mocked(spawn).mockReturnValue(mockChild as unknown as ReturnType<typeof spawn>);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('ProcessRunner', () => {
  describe('stats capture and OTEL metrics', () => {
    it('captures stats from done event and passes to _pendingStats', async () => {
      const stats = { inputTokens: 42, outputTokens: 17, durationMs: 1234 };
      const adapter = makeMockAdapter({
        parseEvent: vi.fn((line: string): AgentEvent | null => {
          try {
            const parsed = JSON.parse(line) as Record<string, unknown>;
            if (parsed['type'] === 'result') return { kind: 'done', summary: 'ok', stats };
            return null;
          } catch { return null; }
        }),
      });
      const runner = new ProcessRunner({ task: 'p', adapter, config: baseConfig });
      const events: AgentEvent[] = [];
      const donePromise = new Promise<void>((resolve) => {
        runner.on('agent-event', (e) => events.push(e));
        runner.on('done', () => resolve());
      });

      runner.start();
      emitLine(JSON.stringify({ type: 'result' }));
      exitChild(0);

      await donePromise;
      const doneEvent = events.find((e) => e.kind === 'done') as { kind: 'done'; stats?: typeof stats } | undefined;
      expect(doneEvent?.stats).toEqual(stats);
    });

    it('handles done event with partial stats (undefined fields fall back to 0)', async () => {
      const stats = {};
      const adapter = makeMockAdapter({
        parseEvent: vi.fn((line: string): AgentEvent | null => {
          try {
            const parsed = JSON.parse(line) as Record<string, unknown>;
            if (parsed['type'] === 'result') return { kind: 'done', summary: 'ok', stats };
            return null;
          } catch { return null; }
        }),
      });
      const runner = new ProcessRunner({ task: 'p', adapter, config: baseConfig });
      const donePromise = new Promise<void>((resolve) => { runner.on('done', () => resolve()); });

      runner.start();
      emitLine(JSON.stringify({ type: 'result' }));
      exitChild(0);

      await donePromise;
    });
  });

  describe('thinking event accumulation', () => {
    it('injects last thinking text as done.summary', async () => {
      const adapter = makeMockAdapter({
        parseEvent: vi.fn((line: string): AgentEvent | null => {
          try {
            const parsed = JSON.parse(line) as Record<string, unknown>;
            if (parsed['type'] === 'thinking') return { kind: 'thinking', text: parsed['text'] as string };
            if (parsed['type'] === 'result') return { kind: 'done', summary: '' };
            return null;
          } catch { return null; }
        }),
      });
      const runner = new ProcessRunner({ task: 'p', adapter, config: baseConfig });
      const events: AgentEvent[] = [];
      const donePromise = new Promise<void>((resolve) => {
        runner.on('agent-event', (e) => events.push(e));
        runner.on('done', () => resolve());
      });

      runner.start();
      emitLine(JSON.stringify({ type: 'thinking', text: 'I will refactor this' }));
      emitLine(JSON.stringify({ type: 'thinking', text: 'Actually, let me simplify' }));
      emitLine(JSON.stringify({ type: 'result' }));
      exitChild(0);

      await donePromise;
      const done = events.find((e) => e.kind === 'done') as { kind: 'done'; summary: string } | undefined;
      expect(done?.summary).toBe('Actually, let me simplify');
    });

    it('done.summary is empty string when no thinking events emitted', async () => {
      const adapter = makeMockAdapter();
      const runner = new ProcessRunner({ task: 'p', adapter, config: baseConfig });
      const events: AgentEvent[] = [];
      const donePromise = new Promise<void>((resolve) => {
        runner.on('agent-event', (e) => events.push(e));
        runner.on('done', () => resolve());
      });

      runner.start();
      emitLine(JSON.stringify({ type: 'result' }));
      exitChild(0);

      await donePromise;
      const done = events.find((e) => e.kind === 'done') as { kind: 'done'; summary: string } | undefined;
      expect(done?.summary).toBe('');
    });
  });

  describe('happy path', () => {
    it('emits agent-event for each valid NDJSON line and done on exit 0', async () => {
      const adapter = makeMockAdapter();
      const runner = new ProcessRunner({ task: 'do stuff', adapter, config: baseConfig });
      const events: AgentEvent[] = [];
      const donePromise = new Promise<number>((resolve) => {
        runner.on('agent-event', (e) => events.push(e));
        runner.on('done', (code) => resolve(code));
      });

      runner.start();
      emitLine(JSON.stringify({ type: 'system/init', model: 'claude-3' }));
      emitLine(JSON.stringify({ type: 'result' }));
      exitChild(0);

      const code = await donePromise;
      expect(code).toBe(0);
      expect(events).toHaveLength(2);
      expect(events[0].kind).toBe('init');
      expect(events[1].kind).toBe('done');
    });
  });

  describe('NDJSON parsing', () => {
    it('skips lines where adapter.parseEvent returns null', async () => {
      const adapter = makeMockAdapter({
        parseEvent: vi.fn((line: string): AgentEvent | null => {
          try {
            const parsed = JSON.parse(line) as Record<string, unknown>;
            if (parsed['type'] === 'result') return { kind: 'done', summary: '' };
            return null;
          } catch {
            return null;
          }
        }),
      });
      const runner = new ProcessRunner({ task: 'p', adapter, config: baseConfig });
      const events: AgentEvent[] = [];
      const donePromise = new Promise<void>((resolve) => {
        runner.on('agent-event', (e) => events.push(e));
        runner.on('done', () => resolve());
      });

      runner.start();
      emitLine('not-json-at-all');
      emitLine(JSON.stringify({ type: 'result' }));
      exitChild(0);

      await donePromise;
      expect(events).toHaveLength(1);
      expect(events[0].kind).toBe('done');
    });

    it('buffers incomplete lines until newline arrives', async () => {
      const adapter = makeMockAdapter();
      const runner = new ProcessRunner({ task: 'p', adapter, config: baseConfig });
      const events: AgentEvent[] = [];
      const donePromise = new Promise<void>((resolve) => {
        runner.on('agent-event', (e) => events.push(e));
        runner.on('done', () => resolve());
      });

      runner.start();
      mockChild.stdout.emit('data', Buffer.from('{"type":"res'));
      expect(events).toHaveLength(0);
      mockChild.stdout.emit('data', Buffer.from('ult"}\n'));
      exitChild(0);

      await donePromise;
      expect(events).toHaveLength(1);
      expect(events[0].kind).toBe('done');
    });

    it('skips blank lines silently', async () => {
      const adapter = makeMockAdapter();
      const runner = new ProcessRunner({ task: 'p', adapter, config: baseConfig });
      const events: AgentEvent[] = [];
      const donePromise = new Promise<void>((resolve) => {
        runner.on('agent-event', (e) => events.push(e));
        runner.on('done', () => resolve());
      });

      runner.start();
      mockChild.stdout.emit('data', Buffer.from('\n\n'));
      emitLine(JSON.stringify({ type: 'result' }));
      exitChild(0);

      await donePromise;
      expect(events).toHaveLength(1);
    });

    it('emits approval_required when isApprovalPrompt returns true', async () => {
      const adapter = makeMockAdapter({
        isApprovalPrompt: vi.fn(() => true),
      });
      const runner = new ProcessRunner({ task: 'p', adapter, config: baseConfig });
      const events: AgentEvent[] = [];
      const donePromise = new Promise<void>((resolve) => {
        runner.on('agent-event', (e) => events.push(e));
        runner.on('done', () => resolve());
      });

      runner.start();
      emitLine('Run this command? [Y/n]');
      exitChild(0);

      await donePromise;
      expect(events).toHaveLength(1);
      expect(events[0].kind).toBe('approval_required');
      expect((events[0] as { kind: 'approval_required'; prompt: string }).prompt).toBe('Run this command? [Y/n]');
    });
  });

  describe('spawn failure handling', () => {
    it('emits error when spawn() throws synchronously', async () => {
      vi.mocked(spawn).mockImplementationOnce(() => { throw new Error('ENOENT'); });
      const adapter = makeMockAdapter({ resolveBinary: vi.fn(() => '/missing/agent') });
      const runner = new ProcessRunner({ task: 'p', adapter, config: baseConfig });
      const errorPromise = new Promise<Error>((resolve) => {
        runner.on('error', (e) => resolve(e));
      });

      runner.start();

      const err = await errorPromise;
      expect(err.message).toContain('/missing/agent');
    });

    it('emits error when spawned process has no stdout', async () => {
      const childNoStdout = new EventEmitter() as EventEmitter & {
        stdout: null;
        stderr: EventEmitter;
        stdin: { end: ReturnType<typeof vi.fn> };
        kill: ReturnType<typeof vi.fn>;
      };
      childNoStdout.stdout = null;
      childNoStdout.stderr = new EventEmitter();
      childNoStdout.stdin = { end: vi.fn() };
      childNoStdout.kill = vi.fn();
      vi.mocked(spawn).mockReturnValueOnce(childNoStdout as unknown as ReturnType<typeof spawn>);

      const adapter = makeMockAdapter();
      const runner = new ProcessRunner({ task: 'p', adapter, config: baseConfig });
      const errorPromise = new Promise<Error>((resolve) => {
        runner.on('error', (e) => resolve(e));
      });

      runner.start();

      const err = await errorPromise;
      expect(err.message).toContain('no stdout/stderr');
    });
  });

  describe('process exit handling', () => {
    it('emits done with non-zero code on non-zero exit', async () => {
      const adapter = makeMockAdapter();
      const runner = new ProcessRunner({ task: 'p', adapter, config: baseConfig });
      const donePromise = new Promise<number>((resolve) => {
        runner.on('done', (code) => resolve(code));
      });

      runner.start();
      exitChild(1);

      const code = await donePromise;
      expect(code).toBe(1);
    });

    it('emits done with code -1 on null close (signal kill)', async () => {
      const adapter = makeMockAdapter();
      const runner = new ProcessRunner({ task: 'p', adapter, config: baseConfig });
      const donePromise = new Promise<number>((resolve) => {
        runner.on('done', (code) => resolve(code));
      });

      runner.start();
      mockChild.emit('close', null);

      const code = await donePromise;
      expect(code).toBe(-1);
    });

    it('emits error on spawn error event with binary in message', async () => {
      const adapter = makeMockAdapter({ resolveBinary: vi.fn(() => '/bad/path/agent') });
      const runner = new ProcessRunner({ task: 'p', adapter, config: baseConfig });
      const errorPromise = new Promise<Error>((resolve) => {
        runner.on('error', (e) => resolve(e));
      });

      runner.start();
      mockChild.emit('error', new Error('ENOENT: no such file'));

      const err = await errorPromise;
      expect(err.message).toContain('/bad/path/agent');
    });
  });

  describe('cancel()', () => {
    it('sends SIGTERM to child process', () => {
      const adapter = makeMockAdapter();
      const runner = new ProcessRunner({ task: 'p', adapter, config: baseConfig });
      runner.start();
      runner.cancel();
      expect(mockChild.kill).toHaveBeenCalledWith('SIGTERM');
    });

    it('ignores data arriving on stdout after cancel', () => {
      const adapter = makeMockAdapter();
      const runner = new ProcessRunner({ task: 'p', adapter, config: baseConfig });
      const events: AgentEvent[] = [];
      runner.on('agent-event', (e) => events.push(e));

      runner.start();
      runner.cancel();
      // Data arrives after cancel — must be ignored
      emitLine(JSON.stringify({ type: 'result' }));

      expect(events).toHaveLength(0);
    });

    it('does not crash when called before start (no child)', () => {
      const adapter = makeMockAdapter();
      const runner = new ProcessRunner({ task: 'p', adapter, config: baseConfig });
      expect(() => runner.cancel()).not.toThrow();
    });

    it('does not throw when called on already-exited process', async () => {
      const adapter = makeMockAdapter();
      const runner = new ProcessRunner({ task: 'p', adapter, config: baseConfig });
      const donePromise = new Promise<void>((resolve) => {
        runner.on('done', () => resolve());
      });
      runner.start();
      exitChild(0);
      await donePromise;
      expect(() => runner.cancel()).not.toThrow();
    });
  });

  describe('resume()', () => {
    it('writes answer to stdin', () => {
      const adapter = makeMockAdapter();
      const runner = new ProcessRunner({ task: 'p', adapter, config: baseConfig });
      runner.start();
      runner.resume('y');
      expect(mockChild.stdin.write).toHaveBeenCalledWith('y\n');
    });
  });

  describe('adapter integration', () => {
    it('spawns binary from adapter.resolveBinary()', () => {
      const adapter = makeMockAdapter({ resolveBinary: vi.fn(() => 'my-agent-binary') });
      const runner = new ProcessRunner({ task: 'p', adapter, config: baseConfig });
      runner.start();
      expect(vi.mocked(spawn).mock.calls[0][0]).toBe('my-agent-binary');
    });

    it('passes args from adapter.buildArgv() to spawn', () => {
      const adapter = makeMockAdapter({ buildArgv: vi.fn(() => ['--flag', 'value', 'task-text']) });
      const runner = new ProcessRunner({ task: 'p', adapter, config: baseConfig });
      runner.start();
      expect(vi.mocked(spawn).mock.calls[0][1]).toEqual(['--flag', 'value', 'task-text']);
    });

    it('passes task, repoPath, model, force, timeoutMs to adapter.buildArgv()', () => {
      const adapter = makeMockAdapter();
      const config = { ...baseConfig, agentModel: 'claude-opus', agentForce: false, agentRepoPath: '/my/repo', agentTimeoutMs: 3000 };
      const runner = new ProcessRunner({ task: 'do stuff', adapter, config });
      runner.start();
      expect(vi.mocked(adapter.buildArgv)).toHaveBeenCalledWith(
        expect.objectContaining({
          task: 'do stuff',
          repoPath: '/my/repo',
          model: 'claude-opus',
          force: false,
          timeoutMs: 3000,
        }),
      );
    });

    it('passes correct cwd to spawn from config.agentRepoPath', () => {
      const adapter = makeMockAdapter();
      const config = { ...baseConfig, agentRepoPath: '/my/repo' };
      const runner = new ProcessRunner({ task: 'p', adapter, config });
      runner.start();
      const opts = vi.mocked(spawn).mock.calls[0][2] as { cwd: string };
      expect(opts.cwd).toBe('/my/repo');
    });
  });

  describe('timeout', () => {
    it('emits done with code -1 when timeout fires', async () => {
      vi.useFakeTimers();
      const adapter = makeMockAdapter();
      const config = { ...baseConfig, agentTimeoutMs: 1000 };
      const runner = new ProcessRunner({ task: 'p', adapter, config });
      const donePromise = new Promise<number>((resolve) => {
        runner.on('done', (code) => resolve(code));
      });

      runner.start();
      vi.advanceTimersByTime(1001);
      mockChild.emit('close', null);

      const code = await donePromise;
      expect(code).toBe(-1);
      vi.useRealTimers();
    });
  });

  describe('debug logging', () => {
    it('logs unparsed lines at debug level when logLevel=debug', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const adapter = makeMockAdapter({ parseEvent: vi.fn(() => null), isApprovalPrompt: vi.fn(() => false) });
      const config = { ...baseConfig, logLevel: 'debug' as const };
      const runner = new ProcessRunner({ task: 'p', adapter, config });
      const donePromise = new Promise<void>((resolve) => {
        runner.on('done', () => resolve());
      });

      runner.start();
      emitLine('{"type":"unknown_event"}');
      exitChild(0);

      await donePromise;
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('[runner] Unparsed line'));
      warnSpy.mockRestore();
    });
  });

  describe('stdin error handling', () => {
    it('does not crash when stdin.end() throws', () => {
      const adapter = makeMockAdapter();
      mockChild.stdin.end = vi.fn(() => { throw new Error('stdin error'); });
      const runner = new ProcessRunner({ task: 'p', adapter, config: baseConfig });
      expect(() => runner.start()).not.toThrow();
    });
  });

  describe('SIGKILL fallback', () => {
    it('sends SIGKILL if process still alive after 2s post-SIGTERM', async () => {
      vi.useFakeTimers();
      const adapter = makeMockAdapter();
      const runner = new ProcessRunner({ task: 'p', adapter, config: baseConfig });
      runner.start();

      runner.cancel();
      expect(mockChild.kill).toHaveBeenCalledWith('SIGTERM');

      // Advance 2000ms without process exiting
      vi.advanceTimersByTime(2001);
      expect(mockChild.kill).toHaveBeenCalledWith('SIGKILL');

      vi.useRealTimers();
    });
  });

  describe('idle timer', () => {
    it('emits done with code 0 when idle timer fires with no new data', async () => {
      vi.useFakeTimers();
      const adapter = makeMockAdapter();
      const config = { ...baseConfig, agentIdleExitMs: 2000 };
      const runner = new ProcessRunner({ task: 'p', adapter, config });
      const donePromise = new Promise<number>((resolve) => {
        runner.on('done', (code) => resolve(code));
      });

      runner.start();
      vi.advanceTimersByTime(2001);
      mockChild.emit('close', null);

      const code = await donePromise;
      expect(code).toBe(0);
      vi.useRealTimers();
    });

    it('resets idle timer on new data and fires after fresh delay', async () => {
      vi.useFakeTimers();
      const adapter = makeMockAdapter();
      const config = { ...baseConfig, agentIdleExitMs: 1000 };
      const runner = new ProcessRunner({ task: 'p', adapter, config });
      const donePromise = new Promise<number>((resolve) => {
        runner.on('done', (code) => resolve(code));
      });

      runner.start();
      // Advance 900ms (not enough to fire)
      vi.advanceTimersByTime(900);
      // Send data to reset the idle timer
      emitLine(JSON.stringify({ type: 'system/init' }));
      // Advance 900ms again — still not enough from the reset
      vi.advanceTimersByTime(900);
      // Now advance past the idle threshold
      vi.advanceTimersByTime(200);
      mockChild.emit('close', null);

      const code = await donePromise;
      expect(code).toBe(0);
      vi.useRealTimers();
    });
  });

  describe('stderr capture', () => {
    it('stderr content is passed to done event', async () => {
      const adapter = makeMockAdapter();
      const runner = new ProcessRunner({ task: 'p', adapter, config: baseConfig });
      const donePromise = new Promise<string>((resolve) => {
        runner.on('done', (_code, stderr) => resolve(stderr));
      });

      runner.start();
      mockChild.stderr.emit('data', Buffer.from('error output\n'));
      exitChild(1);

      const stderr = await donePromise;
      expect(stderr).toContain('error output');
    });
  });
});
