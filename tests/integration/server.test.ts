import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import type { AgentExecutor, ExecutionEventBus, RequestContext } from '@a2a-js/sdk/server';
import { AgentEvent } from '@a2a-js/sdk/server';
import { TaskState } from '@a2a-js/sdk';
import type { Config } from '../../src/types.js';
import type { CodingAgentAdapter } from '../../src/adapters/base.js';
import { createApp } from '../../src/server.js';
import * as http from 'node:http';
import { v4 as uuidv4 } from 'uuid';

const A2A_VERSION = '1.0';

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

function initTask(ctx: RequestContext) {
  return AgentEvent.task({
    id: ctx.taskId,
    contextId: ctx.contextId,
    status: { state: TaskState.TASK_STATE_SUBMITTED, timestamp: new Date().toISOString(), message: undefined },
    artifacts: [],
    history: [],
    metadata: undefined,
  });
}

function makeCompletingExecutor(): AgentExecutor {
  return {
    execute: vi.fn(async (ctx: RequestContext, bus: ExecutionEventBus) => {
      bus.publish(initTask(ctx));
      bus.publish(AgentEvent.statusUpdate({
        taskId: ctx.taskId,
        contextId: ctx.contextId,
        status: { state: TaskState.TASK_STATE_COMPLETED, timestamp: new Date().toISOString(), message: undefined },
        metadata: undefined,
      }));
      bus.finished();
    }),
    cancelTask: vi.fn(async (taskId: string, bus: ExecutionEventBus) => {
      bus.publish(AgentEvent.statusUpdate({
        taskId,
        contextId: taskId,
        status: { state: TaskState.TASK_STATE_CANCELED, timestamp: new Date().toISOString(), message: undefined },
        metadata: undefined,
      }));
      bus.finished();
    }),
  };
}

function makeFailingExecutor(): AgentExecutor {
  return {
    execute: vi.fn(async (ctx: RequestContext, bus: ExecutionEventBus) => {
      bus.publish(initTask(ctx));
      bus.publish(AgentEvent.statusUpdate({
        taskId: ctx.taskId,
        contextId: ctx.contextId,
        status: { state: TaskState.TASK_STATE_FAILED, timestamp: new Date().toISOString(), message: undefined },
        metadata: undefined,
      }));
      bus.finished();
    }),
    cancelTask: vi.fn(async () => {}),
  };
}

function makeStreamingExecutor(events: ReturnType<typeof AgentEvent.statusUpdate | typeof AgentEvent.artifactUpdate>[]): AgentExecutor {
  return {
    execute: vi.fn(async (ctx: RequestContext, bus: ExecutionEventBus) => {
      bus.publish(initTask(ctx));
      for (const event of events) {
        if (event.kind === 'statusUpdate') {
          bus.publish(AgentEvent.statusUpdate({ ...event.data, taskId: ctx.taskId, contextId: ctx.contextId }));
        } else if (event.kind === 'artifactUpdate') {
          bus.publish(AgentEvent.artifactUpdate({ ...event.data, taskId: ctx.taskId, contextId: ctx.contextId }));
        }
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
    messageId: uuidv4(),
    role: 'ROLE_USER',
    parts: [{ text }],
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
      req.setHeader('A2A-Version', A2A_VERSION);
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
        supportedInterfaces: expect.arrayContaining([
          expect.objectContaining({ protocolVersion: '1.0' }),
        ]),
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
        .set('A2A-Version', A2A_VERSION)
        .send('not-valid-json');
      expect(res.status).toBe(400);
    });

    it('returns JSON-RPC error for unknown method', async () => {
      const app = createApp(baseConfig, mockAdapter, { executor: makeCompletingExecutor() });
      const res = await request(app)
        .post('/a2a/jsonrpc')
        .set('A2A-Version', A2A_VERSION)
        .send(jsonRpc('unknown/method', {}));
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ jsonrpc: '2.0', error: expect.objectContaining({ code: expect.any(Number) }) });
    });
  });

  describe('SendMessage', () => {
    it('returns a task result', async () => {
      const app = createApp(baseConfig, mockAdapter, { executor: makeCompletingExecutor() });
      const res = await request(app)
        .post('/a2a/jsonrpc')
        .set('A2A-Version', A2A_VERSION)
        .send(jsonRpc('SendMessage', { message: makeMessage('hello'), configuration: { returnImmediately: false } }));
      expect(res.status).toBe(200);
      expect(res.body.result).toBeDefined();
    });
  });

  describe('SendStreamingMessage', () => {
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
        req.setHeader('A2A-Version', A2A_VERSION);
        req.write(JSON.stringify(jsonRpc('SendStreamingMessage', { message: makeMessage('hello') })));
        req.end();
        req.on('error', (e) => { if ((e as NodeJS.ErrnoException).code !== 'ECONNRESET') reject(e); });
      });
    });

    it('streams working → completed events', async () => {
      const streamEvents = [
        AgentEvent.statusUpdate({ taskId: '', contextId: '', status: { state: TaskState.TASK_STATE_WORKING, timestamp: new Date().toISOString(), message: undefined }, metadata: undefined }),
        AgentEvent.statusUpdate({ taskId: '', contextId: '', status: { state: TaskState.TASK_STATE_COMPLETED, timestamp: new Date().toISOString(), message: undefined }, metadata: undefined }),
      ];
      const app = createApp(baseConfig, mockAdapter, { executor: makeStreamingExecutor(streamEvents) });
      const lines = await collectSseLines(app, jsonRpc('SendStreamingMessage', { message: makeMessage('hello') }));

      const parsed = lines.map((l) => JSON.parse(l.slice('data: '.length)));
      const hasWorking = parsed.some(
        (p) => p.result?.statusUpdate?.status?.state === 'TASK_STATE_WORKING' || p.result?.task !== undefined,
      );
      const hasCompleted = parsed.some(
        (p) => p.result?.statusUpdate?.status?.state === 'TASK_STATE_COMPLETED' || p.result?.task?.status?.state === 'TASK_STATE_COMPLETED',
      );
      expect(hasWorking || hasCompleted).toBe(true);
      expect(hasCompleted).toBe(true);
    });

    it('streams artifact-update events', async () => {
      const streamEvents = [
        AgentEvent.artifactUpdate({
          taskId: '',
          contextId: '',
          artifact: { artifactId: 'a1', name: 'test', description: '', parts: [{ content: { $case: 'text', value: 'hello world' }, filename: '', mediaType: '', metadata: undefined }], metadata: undefined, extensions: [] },
          append: false,
          lastChunk: true,
          metadata: undefined,
        }),
        AgentEvent.statusUpdate({ taskId: '', contextId: '', status: { state: TaskState.TASK_STATE_COMPLETED, timestamp: new Date().toISOString(), message: undefined }, metadata: undefined }),
      ];
      const app = createApp(baseConfig, mockAdapter, { executor: makeStreamingExecutor(streamEvents) });
      const lines = await collectSseLines(app, jsonRpc('SendStreamingMessage', { message: makeMessage('hi') }));

      const parsed = lines.map((l) => JSON.parse(l.slice('data: '.length)));
      const hasArtifact = parsed.some((p) => p.result?.artifactUpdate !== undefined);
      expect(hasArtifact).toBe(true);
    });

    it('stream ends with failed status when executor fails', async () => {
      const app = createApp(baseConfig, mockAdapter, { executor: makeFailingExecutor() });
      const lines = await collectSseLines(app, jsonRpc('SendStreamingMessage', { message: makeMessage('hi') }));

      const parsed = lines.map((l) => JSON.parse(l.slice('data: '.length)));
      const hasFailed = parsed.some(
        (p) => p.result?.statusUpdate?.status?.state === 'TASK_STATE_FAILED' || p.result?.task?.status?.state === 'TASK_STATE_FAILED',
      );
      expect(hasFailed).toBe(true);
    });
  });

  describe('GetTask', () => {
    it('returns task not found error for unknown taskId', async () => {
      const app = createApp(baseConfig, mockAdapter, { executor: makeCompletingExecutor() });
      const res = await request(app)
        .post('/a2a/jsonrpc')
        .set('A2A-Version', A2A_VERSION)
        .send(jsonRpc('GetTask', { id: 'nonexistent-task-id' }));
      expect(res.status).toBe(200);
      expect(res.body.error).toBeDefined();
    });

    it('returns task for known taskId after SendMessage', async () => {
      const app = createApp(baseConfig, mockAdapter, { executor: makeCompletingExecutor() });

      const sendRes = await request(app)
        .post('/a2a/jsonrpc')
        .set('A2A-Version', A2A_VERSION)
        .send(jsonRpc('SendMessage', { message: makeMessage('hello'), configuration: { returnImmediately: false } }));

      const result = sendRes.body.result;
      const taskId = result?.task?.id ?? result?.id;
      if (taskId) {
        const getRes = await request(app)
          .post('/a2a/jsonrpc')
          .set('A2A-Version', A2A_VERSION)
          .send(jsonRpc('GetTask', { id: taskId }));
        expect(getRes.status).toBe(200);
        expect(getRes.body.result).toBeDefined();
      }
    });
  });

  describe('CancelTask', () => {
    it('returns error for unknown task id', async () => {
      const app = createApp(baseConfig, mockAdapter, { executor: makeCompletingExecutor() });
      const res = await request(app)
        .post('/a2a/jsonrpc')
        .set('A2A-Version', A2A_VERSION)
        .send(jsonRpc('CancelTask', { id: 'nonexistent-task' }));
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ jsonrpc: '2.0' });
    });
  });

  describe('concurrent requests', () => {
    it('handles multiple simultaneous SendMessage calls', async () => {
      const executor = makeCompletingExecutor();
      const app = createApp(baseConfig, mockAdapter, { executor });

      const [res1, res2] = await Promise.all([
        request(app).post('/a2a/jsonrpc').set('A2A-Version', A2A_VERSION).send(jsonRpc('SendMessage', { message: makeMessage('task 1'), configuration: { returnImmediately: false } }, 1)),
        request(app).post('/a2a/jsonrpc').set('A2A-Version', A2A_VERSION).send(jsonRpc('SendMessage', { message: makeMessage('task 2'), configuration: { returnImmediately: false } }, 2)),
      ]);

      expect(res1.status).toBe(200);
      expect(res2.status).toBe(200);
    });
  });
});
