import { describe, it, expect } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { CodingAgentAdapter } from '../../../src/adapters/base.js';
import type { Config } from '../../../src/types.js';
import { createMcpServer } from '../../../src/mcp/server.js';

const mockAdapter: CodingAgentAdapter = {
  name: 'test-adapter',
  capabilities: { streaming: true, sessionResume: false, shellApproval: false },
  resolveBinary: () => 'test-binary',
  buildArgv: () => [],
  parseEvent: () => null,
  isApprovalPrompt: () => false,
  approvalResponse: () => 'y',
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

const EXPECTED_TOOLS = [
  'coding_agent_run',
  'coding_agent_poll',
  'coding_agent_result',
  'coding_agent_cancel',
  'coding_agent_info',
];

async function createClient(config = baseConfig): Promise<Client> {
  const { server } = createMcpServer(mockAdapter, config);
  const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: 'test-client', version: '0.0.0' });
  await client.connect(clientTransport);
  return client;
}

describe('createMcpServer', () => {
  it('returns an McpServer and McpTaskManager', () => {
    const { server, taskManager } = createMcpServer(mockAdapter, baseConfig);
    expect(server).toBeDefined();
    expect(taskManager).toBeDefined();
  });

  it('registers all five tools', async () => {
    const client = await createClient();
    const result = await client.listTools();
    const names = result.tools.map((t) => t.name);
    for (const expected of EXPECTED_TOOLS) {
      expect(names).toContain(expected);
    }
  });

  it('tool names match expected schema exactly', async () => {
    const client = await createClient();
    const result = await client.listTools();
    const names = result.tools.map((t) => t.name).sort();
    expect(names).toEqual([...EXPECTED_TOOLS].sort());
  });

  it('server name is coding-agent-a2a', async () => {
    const { server } = createMcpServer(mockAdapter, baseConfig);
    const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'test-client', version: '0.0.0' });
    const connectServer = server.connect(serverTransport);
    const connectClient = client.connect(clientTransport);
    await Promise.all([connectServer, connectClient]);
    expect(client.getServerVersion()?.name).toBe('coding-agent-a2a');
  });

  it('falls back to 0.1.0 version when npm_package_version env is unset', async () => {
    const prev = process.env['npm_package_version'];
    delete process.env['npm_package_version'];
    try {
      const { server } = createMcpServer(mockAdapter, baseConfig);
      const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
      const client = new Client({ name: 'test-client', version: '0.0.0' });
      await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
      expect(client.getServerVersion()?.version).toBe('0.1.0');
    } finally {
      if (prev !== undefined) process.env['npm_package_version'] = prev;
    }
  });
});
