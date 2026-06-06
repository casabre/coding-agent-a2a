import { describe, it, expect, vi } from 'vitest';
import * as http from 'node:http';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import request from 'supertest';
import type { CodingAgentAdapter } from '../../src/adapters/base.js';
import type { Config } from '../../src/types.js';
import type { AgentExecutor, ExecutionEventBus, RequestContext } from '@a2a-js/sdk/server';
import { AgentEvent } from '@a2a-js/sdk/server';
import { TaskState } from '@a2a-js/sdk';
import { createCombinedApp } from '../../src/combined-server.js';
import { v4 as uuidv4 } from 'uuid';

const A2A_VERSION = '1.0';

const baseConfig: Config = {
  port: 41244,
  agentAdapter: 'cursor',
  agentModel: undefined,
  agentTimeoutMs: 5000,
  agentIdleExitMs: 0,
  agentForce: true,
  agentRepoPath: '.',
  mcpTransport: 'http',
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

function makeCompletingA2AExecutor(): AgentExecutor {
  return {
    execute: vi.fn(async (ctx: RequestContext, bus: ExecutionEventBus) => {
      bus.publish(AgentEvent.task({
        id: ctx.taskId,
        contextId: ctx.contextId,
        status: { state: TaskState.TASK_STATE_SUBMITTED, timestamp: new Date().toISOString(), message: undefined },
        artifacts: [],
        history: [],
        metadata: undefined,
      }));
      bus.publish(AgentEvent.statusUpdate({
        taskId: ctx.taskId,
        contextId: ctx.contextId,
        status: { state: TaskState.TASK_STATE_COMPLETED, timestamp: new Date().toISOString(), message: undefined },
        metadata: undefined,
      }));
      bus.finished();
    }),
    cancelTask: vi.fn(async () => {}),
  };
}

function jsonRpc(method: string, params: Record<string, unknown>, id = 1) {
  return { jsonrpc: '2.0', id, method, params };
}

function makeMessage(text: string) {
  return { messageId: uuidv4(), role: 'ROLE_USER', parts: [{ text }] };
}

async function startServer(config = baseConfig): Promise<{ server: http.Server; port: number }> {
  const app = createCombinedApp(config, mockAdapter, { executor: makeCompletingA2AExecutor() });
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const addr = server.address() as { port: number };
  return { server, port: addr.port };
}

const authConfig: Config = {
  ...baseConfig,
  authEnabled: true,
  authIssuer: 'https://idp.example.com',
  authAudience: 'coding-agent',
  authJwksUri: 'https://idp.example.com/.well-known/jwks.json',
  authAuthorizationUrl: 'https://idp.example.com/authorize',
  authTokenUrl: 'https://idp.example.com/token',
  authServerUrl: 'http://localhost:41244',
  authResourceUrl: 'http://localhost:41244/mcp',
};

describe('Combined server — production verifier path', () => {
  it('createCombinedApp with authEnabled and no injected verifier — no-token request returns 401', async () => {
    // Exercises combined-server.ts:32 — createTokenVerifier(config) called when options.verifier is absent
    const app = createCombinedApp(authConfig, mockAdapter);
    const res = await request(app)
      .post('/a2a/jsonrpc')
      .send({ jsonrpc: '2.0', id: 1, method: 'SendMessage', params: {} });
    expect(res.status).toBe(401);
  });
});

describe('Combined server (A2A + MCP/HTTP)', () => {
  describe('A2A surface still works', () => {
    it('GET /.well-known/agent-card.json returns 200', async () => {
      const app = createCombinedApp(baseConfig, mockAdapter, { executor: makeCompletingA2AExecutor() });
      const res = await request(app).get('/.well-known/agent-card.json');
      expect(res.status).toBe(200);
      expect(res.body.skills).toBeDefined();
    });

    it('SendMessage returns a result', async () => {
      const app = createCombinedApp(baseConfig, mockAdapter, { executor: makeCompletingA2AExecutor() });
      const res = await request(app)
        .post('/a2a/jsonrpc')
        .set('A2A-Version', A2A_VERSION)
        .send(jsonRpc('SendMessage', { message: makeMessage('hello'), configuration: { returnImmediately: false } }));
      expect(res.status).toBe(200);
      expect(res.body.result).toBeDefined();
    });
  });

  describe('MCP HTTP surface', () => {
    it('GET /mcp responds (MCP transport endpoint active)', async () => {
      const { server, port } = await startServer();
      try {
        const client = new Client({ name: 'test', version: '0.0.0' });
        const transport = new StreamableHTTPClientTransport(
          new URL(`http://localhost:${port}/mcp`),
        );
        await client.connect(transport);
        const tools = await client.listTools();
        expect(tools.tools.map((t) => t.name)).toContain('coding_agent_run');
        await client.close();
      } finally {
        server.close();
      }
    });

    it('coding_agent_info returns adapter info via HTTP MCP', async () => {
      const { server, port } = await startServer();
      try {
        const client = new Client({ name: 'test', version: '0.0.0' });
        const transport = new StreamableHTTPClientTransport(
          new URL(`http://localhost:${port}/mcp`),
        );
        await client.connect(transport);
        const result = await client.callTool({ name: 'coding_agent_info', arguments: {} });
        const data = result as { content: Array<{ text: string }> };
        const parsed = JSON.parse(data.content[0].text) as { adapter: string };
        expect(parsed.adapter).toBe('mock');
        await client.close();
      } finally {
        server.close();
      }
    });
  });

  describe('Both protocols work on the same port', () => {
    it('A2A and MCP can both be called on the same server instance', async () => {
      const { server, port } = await startServer();
      try {
        // A2A call
        const a2aRes = await new Promise<{ status: number; body: unknown }>((resolve) => {
          const req = http.request(
            { hostname: 'localhost', port, path: '/a2a/jsonrpc', method: 'POST' },
            (res) => {
              let data = '';
              res.on('data', (c: string) => { data += c; });
              res.on('end', () => resolve({ status: res.statusCode ?? 0, body: JSON.parse(data) }));
            },
          );
          req.setHeader('Content-Type', 'application/json');
          req.setHeader('A2A-Version', A2A_VERSION);
          req.write(JSON.stringify(jsonRpc('SendMessage', { message: makeMessage('task'), configuration: { returnImmediately: false } })));
          req.end();
        });
        expect(a2aRes.status).toBe(200);

        // MCP call
        const client = new Client({ name: 'test', version: '0.0.0' });
        const transport = new StreamableHTTPClientTransport(
          new URL(`http://localhost:${port}/mcp`),
        );
        await client.connect(transport);
        const tools = await client.listTools();
        expect(tools.tools.length).toBeGreaterThan(0);
        await client.close();
      } finally {
        server.close();
      }
    });
  });
});
