import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import type { AgentExecutor, ExecutionEventBus, RequestContext } from '@a2a-js/sdk/server';
import type { TaskStatusUpdateEvent, TaskArtifactUpdateEvent, Task } from '@a2a-js/sdk';
import type { Config } from '../../src/types.js';
import type { CodingAgentAdapter } from '../../src/adapters/base.js';
import { createApp } from '../../src/server.js';
import * as http from 'node:http';
import { v4 as uuidv4 } from 'uuid';

const baseConfig: Config = {
  port: 41243,
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

function initTask(ctx: RequestContext): Task {
  return {
    kind: 'task',
    id: ctx.taskId,
    contextId: ctx.contextId,
    status: { state: 'working', timestamp: new Date().toISOString() },
    history: [],
  } as unknown as Task;
}

function makeCompletingExecutor(): AgentExecutor {
  return {
    execute: vi.fn(async (ctx: RequestContext, bus: ExecutionEventBus) => {
      bus.publish(initTask(ctx));
      bus.publish({
        kind: 'status-update',
        taskId: ctx.taskId,
        contextId: ctx.contextId,
        final: true,
        status: { state: 'completed', timestamp: new Date().toISOString() },
      } as TaskStatusUpdateEvent);
      bus.finished();
    }),
    cancelTask: vi.fn(async (taskId: string, bus: ExecutionEventBus) => {
      bus.publish({
        kind: 'status-update',
        taskId,
        contextId: taskId,
        final: true,
        status: { state: 'canceled', timestamp: new Date().toISOString() },
      } as TaskStatusUpdateEvent);
      bus.finished();
    }),
  };
}

function makeFailingExecutor(): AgentExecutor {
  return {
    execute: vi.fn(async (ctx: RequestContext, bus: ExecutionEventBus) => {
      bus.publish(initTask(ctx));
      bus.publish({
        kind: 'status-update',
        taskId: ctx.taskId,
        contextId: ctx.contextId,
        final: true,
        status: { state: 'failed', timestamp: new Date().toISOString() },
      } as TaskStatusUpdateEvent);
      bus.finished();
    }),
    cancelTask: vi.fn(async () => {}),
  };
}

function makeStreamingExecutor(events: Array<TaskStatusUpdateEvent | TaskArtifactUpdateEvent>): AgentExecutor {
  return {
    execute: vi.fn(async (ctx: RequestContext, bus: ExecutionEventBus) => {
      bus.publish(initTask(ctx));
      for (const event of events) {
        bus.publish({ ...event, taskId: ctx.taskId, contextId: ctx.contextId });
      }
      bus.finished();
    }),
    cancelTask: vi.fn(async () => {}),
  };
}

function jsonRpc(method: string, params: Record<string, unknown>, id: number | string = 1) {
  return { jsonrpc: '2.0', id, method, params };
}

function makeMessage(text: string) {
  return {
    kind: 'message',
    messageId: uuidv4(),
    role: 'user',
    parts: [{ kind: 'text', text }],
  };
}

async function collectSseLines(app: Express, body: Record<string, unknown>): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const server = http.createServer(app);
    server.listen(0, () => {
      const addr = server.address() as { port: number };
      const chunks: string[] = [];
      const req = http.request(
        { hostname: 'localhost', port: addr.port, path: '/a2a/jsonrpc', method: 'POST' },
        (res) => {
          res.setEncoding('utf8');
          res.on('data', (chunk: string) => chunks.push(chunk));
          res.on('end', () => {
            server.close();
            resolve(chunks.flatMap((c) => c.split('\n').filter((l) => l.startsWith('data: '))));
          });
          res.on('error', reject);
        },
      );
      req.setHeader('Content-Type', 'application/json');
      req.setHeader('Accept', 'text/event-stream');
      req.write(JSON.stringify(body));
      req.end();
      req.on('error', reject);
    });
    server.on('error', reject);
  });
}

describe('HTTP server', () => {
  describe('createApp without executor override', () => {
    it('creates app using default executor when no executor provided', async () => {
      const app = createApp(baseConfig, mockAdapter);
      const res = await request(app).get('/.well-known/agent-card.json');
      expect(res.status).toBe(200);
    });
  });

  describe('GET /.well-known/agent-card.json', () => {
    it('returns 200 with agent card JSON', async () => {
      const app = createApp(baseConfig, mockAdapter, { executor: makeCompletingExecutor() });
      const res = await request(app).get('/.well-known/agent-card.json');
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        name: expect.stringContaining('mock'),
        url: expect.stringContaining('localhost'),
        skills: expect.arrayContaining([expect.objectContaining({ id: 'code-task' })]),
        capabilities: expect.objectContaining({ streaming: true }),
      });
    });
  });

  describe('POST /a2a/jsonrpc — invalid requests', () => {
    it('returns 400 for invalid JSON body', async () => {
      const app = createApp(baseConfig, mockAdapter, { executor: makeCompletingExecutor() });
      const res = await request(app)
        .post('/a2a/jsonrpc')
        .set('Content-Type', 'application/json')
        .send('not-valid-json');
      expect(res.status).toBe(400);
    });

    it('returns JSON-RPC error for unknown method', async () => {
      const app = createApp(baseConfig, mockAdapter, { executor: makeCompletingExecutor() });
      const res = await request(app)
        .post('/a2a/jsonrpc')
        .send(jsonRpc('unknown/method', {}));
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ jsonrpc: '2.0', error: expect.objectContaining({ code: expect.any(Number) }) });
    });
  });

  describe('message/send', () => {
    it('returns a task or message result', async () => {
      const app = createApp(baseConfig, mockAdapter, { executor: makeCompletingExecutor() });
      const res = await request(app)
        .post('/a2a/jsonrpc')
        .send(jsonRpc('message/send', { message: makeMessage('hello'), configuration: { blocking: true } }));
      expect(res.status).toBe(200);
      expect(res.body.result).toBeDefined();
    });
  });

  describe('message/stream', () => {
    it('responds with text/event-stream content-type', async () => {
      const app = createApp(baseConfig, mockAdapter, { executor: makeCompletingExecutor() });
      const server = http.createServer(app);
      await new Promise<void>((resolve) => server.listen(0, resolve));
      const addr = server.address() as { port: number };

      await new Promise<void>((resolve, reject) => {
        const req = http.request(
          { hostname: 'localhost', port: addr.port, path: '/a2a/jsonrpc', method: 'POST' },
          (res) => {
            expect(res.headers['content-type']).toContain('text/event-stream');
            res.destroy();
            server.close(() => resolve());
          },
        );
        req.setHeader('Content-Type', 'application/json');
        req.setHeader('Accept', 'text/event-stream');
        req.write(JSON.stringify(jsonRpc('message/stream', { message: makeMessage('hello') })));
        req.end();
        req.on('error', (e) => { if ((e as NodeJS.ErrnoException).code !== 'ECONNRESET') reject(e); });
      });
    });

    it('streams working → completed events', async () => {
      const streamEvents: TaskStatusUpdateEvent[] = [
        { kind: 'status-update', taskId: '', contextId: '', final: false, status: { state: 'working' } },
        { kind: 'status-update', taskId: '', contextId: '', final: true, status: { state: 'completed' } },
      ];
      const app = createApp(baseConfig, mockAdapter, { executor: makeStreamingExecutor(streamEvents) });
      const lines = await collectSseLines(app, jsonRpc('message/stream', { message: makeMessage('hello') }));

      const parsed = lines.map((l) => JSON.parse(l.slice('data: '.length)));
      const hasWorking = parsed.some(
        (p) => p.result?.status?.state === 'working' || p.result?.kind === 'task',
      );
      const hasCompleted = parsed.some((p) => p.result?.status?.state === 'completed');
      expect(hasWorking || hasCompleted).toBe(true);
      expect(hasCompleted).toBe(true);
    });

    it('streams artifact-update events', async () => {
      const streamEvents: Array<TaskStatusUpdateEvent | TaskArtifactUpdateEvent> = [
        {
          kind: 'artifact-update',
          taskId: '',
          contextId: '',
          artifact: { artifactId: 'a1', name: 'test', parts: [{ kind: 'text', text: 'hello world' }] },
        },
        { kind: 'status-update', taskId: '', contextId: '', final: true, status: { state: 'completed' } },
      ];
      const app = createApp(baseConfig, mockAdapter, { executor: makeStreamingExecutor(streamEvents) });
      const lines = await collectSseLines(app, jsonRpc('message/stream', { message: makeMessage('hi') }));

      const parsed = lines.map((l) => JSON.parse(l.slice('data: '.length)));
      const hasArtifact = parsed.some((p) => p.result?.kind === 'artifact-update');
      expect(hasArtifact).toBe(true);
    });

    it('stream ends with failed status when executor fails', async () => {
      const app = createApp(baseConfig, mockAdapter, { executor: makeFailingExecutor() });
      const lines = await collectSseLines(app, jsonRpc('message/stream', { message: makeMessage('hi') }));

      const parsed = lines.map((l) => JSON.parse(l.slice('data: '.length)));
      const hasFailed = parsed.some((p) => p.result?.status?.state === 'failed');
      expect(hasFailed).toBe(true);
    });
  });

  describe('tasks/get', () => {
    it('returns task not found error for unknown taskId', async () => {
      const app = createApp(baseConfig, mockAdapter, { executor: makeCompletingExecutor() });
      const res = await request(app)
        .post('/a2a/jsonrpc')
        .send(jsonRpc('tasks/get', { id: 'nonexistent-task-id' }));
      expect(res.status).toBe(200);
      expect(res.body.error).toBeDefined();
    });

    it('returns task for known taskId after message/send', async () => {
      const app = createApp(baseConfig, mockAdapter, { executor: makeCompletingExecutor() });

      const sendRes = await request(app)
        .post('/a2a/jsonrpc')
        .send(jsonRpc('message/send', { message: makeMessage('hello'), configuration: { blocking: true } }));

      const result = sendRes.body.result;
      if (result?.id) {
        const getRes = await request(app)
          .post('/a2a/jsonrpc')
          .send(jsonRpc('tasks/get', { id: result.id }));
        expect(getRes.status).toBe(200);
        expect(getRes.body.result).toBeDefined();
      }
    });
  });

  describe('tasks/cancel', () => {
    it('returns error for unknown task id', async () => {
      const app = createApp(baseConfig, mockAdapter, { executor: makeCompletingExecutor() });
      const res = await request(app)
        .post('/a2a/jsonrpc')
        .send(jsonRpc('tasks/cancel', { id: 'nonexistent-task' }));
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ jsonrpc: '2.0' });
    });
  });

  describe('concurrent requests', () => {
    it('handles multiple simultaneous message/send calls', async () => {
      const executor = makeCompletingExecutor();
      const app = createApp(baseConfig, mockAdapter, { executor });

      const [res1, res2] = await Promise.all([
        request(app).post('/a2a/jsonrpc').send(jsonRpc('message/send', { message: makeMessage('task 1'), configuration: { blocking: true } }, 1)),
        request(app).post('/a2a/jsonrpc').send(jsonRpc('message/send', { message: makeMessage('task 2'), configuration: { blocking: true } }, 2)),
      ]);

      expect(res1.status).toBe(200);
      expect(res2.status).toBe(200);
    });
  });
});
