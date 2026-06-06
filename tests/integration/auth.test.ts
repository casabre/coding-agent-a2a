import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import * as http from 'node:http';
import request from 'supertest';
import { generateKeyPair, exportJWK, SignJWT } from 'jose';
import type { JSONWebKeySet } from 'jose';
import type { Config } from '../../src/config.js';
import type { CodingAgentAdapter } from '../../src/adapters/base.js';
import type { AgentExecutor, ExecutionEventBus, RequestContext } from '@a2a-js/sdk/server';
import { AgentEvent } from '@a2a-js/sdk/server';
import { TaskState } from '@a2a-js/sdk';
import { createCombinedApp } from '../../src/combined-server.js';
import { createTokenVerifier } from '../../src/auth/verifier.js';
import { v4 as uuidv4 } from 'uuid';

const A2A_VERSION = '1.0';

let server: http.Server;
let serverPort: number;
let privateKey: CryptoKey;

const mockAdapter: CodingAgentAdapter = {
  name: 'mock',
  capabilities: { streaming: true, sessionResume: false, shellApproval: false },
  resolveBinary: vi.fn(() => 'mock-agent'),
  buildArgv: vi.fn(() => ['--print', 'task']),
  parseEvent: vi.fn(() => null),
  isApprovalPrompt: vi.fn(() => false),
  approvalResponse: vi.fn(() => 'y'),
};

function makeCompletingExecutor(): AgentExecutor {
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

beforeAll(async () => {
  const keyPair = await generateKeyPair('RS256');
  privateKey = keyPair.privateKey as CryptoKey;
  const jwk = await exportJWK(keyPair.publicKey);
  const jwksSet: JSONWebKeySet = { keys: [{ ...jwk, kid: 'test-key-1', alg: 'RS256' }] };

  const authConfig: Config = {
    port: 0,
    agentAdapter: 'mock',
    agentModel: undefined,
    agentTimeoutMs: 5000,
    agentIdleExitMs: 0,
    agentForce: true,
    agentRepoPath: '.',
    mcpTransport: 'http',
    logLevel: 'warn',
    authEnabled: true,
    authIssuer: 'https://idp.example.com',
    authAudience: 'coding-agent',
    authJwksUri: 'https://idp.example.com/.well-known/jwks.json',
    authAuthorizationUrl: 'https://idp.example.com/authorize',
    authTokenUrl: 'https://idp.example.com/token',
    authServerUrl: 'http://localhost:41246',
    authResourceUrl: 'http://localhost:41246/mcp',
  };

  const verifier = createTokenVerifier(authConfig, jwksSet);
  const app = createCombinedApp(authConfig, mockAdapter, {
    executor: makeCompletingExecutor(),
    verifier,
  });

  await new Promise<void>((resolve) => {
    server = http.createServer(app);
    server.listen(0, resolve);
  });
  serverPort = (server.address() as { port: number }).port;
});

afterAll(() => {
  server?.close();
});

async function signValidToken(sub = 'client-1', scopes?: string) {
  return new SignJWT({ sub, ...(scopes ? { scope: scopes } : {}) })
    .setProtectedHeader({ alg: 'RS256', kid: 'test-key-1' })
    .setIssuedAt()
    .setIssuer('https://idp.example.com')
    .setAudience('coding-agent')
    .setExpirationTime('1h')
    .sign(privateKey);
}

async function signTokenWithoutSub() {
  return new SignJWT({})
    .setProtectedHeader({ alg: 'RS256', kid: 'test-key-1' })
    .setIssuedAt()
    .setIssuer('https://idp.example.com')
    .setAudience('coding-agent')
    .setExpirationTime('1h')
    .sign(privateKey);
}

describe('Auth-enabled combined server', () => {
  it('GET /health returns 200 without token', async () => {
    const res = await request(`http://localhost:${serverPort}`).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });

  it('GET /.well-known/agent-card.json returns 200 without token', async () => {
    const res = await request(`http://localhost:${serverPort}`)
      .get('/.well-known/agent-card.json');
    expect(res.status).toBe(200);
    expect(res.body.name).toBeDefined();
  });

  it('GET /.well-known/oauth-authorization-server returns 200 with correct shape', async () => {
    const res = await request(`http://localhost:${serverPort}`)
      .get('/.well-known/oauth-authorization-server');
    expect(res.status).toBe(200);
    expect(res.body.issuer).toBeDefined();
    expect(res.body.authorization_endpoint).toBeDefined();
    expect(res.body.token_endpoint).toBeDefined();
  });

  it('POST /a2a/jsonrpc without token returns 401', async () => {
    const res = await request(`http://localhost:${serverPort}`)
      .post('/a2a/jsonrpc')
      .send({ jsonrpc: '2.0', id: 1, method: 'SendMessage', params: {} });
    expect(res.status).toBe(401);
    expect(res.headers['www-authenticate']).toMatch(/Bearer/i);
  });

  it('POST /a2a/jsonrpc with expired JWT returns 401', async () => {
    const expiredToken = await new SignJWT({ sub: 'client-1' })
      .setProtectedHeader({ alg: 'RS256', kid: 'test-key-1' })
      .setIssuedAt()
      .setIssuer('https://idp.example.com')
      .setAudience('coding-agent')
      .setExpirationTime(new Date(0))
      .sign(privateKey);
    const res = await request(`http://localhost:${serverPort}`)
      .post('/a2a/jsonrpc')
      .set('Authorization', `Bearer ${expiredToken}`)
      .send({ jsonrpc: '2.0', id: 1, method: 'SendMessage', params: {} });
    expect(res.status).toBe(401);
  });

  it('POST /a2a/jsonrpc with valid JWT passes auth', async () => {
    const token = await signValidToken();
    const message = {
      messageId: uuidv4(),
      role: 'ROLE_USER',
      parts: [{ text: 'hello' }],
    };
    const res = await request(`http://localhost:${serverPort}`)
      .post('/a2a/jsonrpc')
      .set('Authorization', `Bearer ${token}`)
      .set('A2A-Version', A2A_VERSION)
      .send({
        jsonrpc: '2.0',
        id: 1,
        method: 'SendMessage',
        params: { message, configuration: { returnImmediately: false } },
      });
    // Auth passed — response is 200 (task result or error from executor, not 401)
    expect(res.status).toBe(200);
    expect(res.status).not.toBe(401);
  });

  it('POST /a2a/jsonrpc with valid JWT and no sub falls back to unknown userName', async () => {
    const token = await signTokenWithoutSub();
    const message = { messageId: uuidv4(), role: 'ROLE_USER', parts: [{ text: 'hello' }] };
    const res = await request(`http://localhost:${serverPort}`)
      .post('/a2a/jsonrpc')
      .set('Authorization', `Bearer ${token}`)
      .set('A2A-Version', A2A_VERSION)
      .send({ jsonrpc: '2.0', id: 2, method: 'SendMessage', params: { message, configuration: { returnImmediately: false } } });
    expect(res.status).toBe(200);
  });

  it('GET /mcp without token returns 401', async () => {
    const res = await request(`http://localhost:${serverPort}`).get('/mcp');
    expect(res.status).toBe(401);
    expect(res.headers['www-authenticate']).toMatch(/Bearer/i);
  });
});
