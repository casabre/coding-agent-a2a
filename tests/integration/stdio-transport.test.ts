import { describe, it, expect } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { startStdioTransport } from '../../src/mcp/stdio-transport.js';
import type { CodingAgentAdapter } from '../../src/adapters/base.js';
import type { Config } from '../../src/types.js';
import { createMcpServer } from '../../src/mcp/server.js';

const mockAdapter: CodingAgentAdapter = {
  name: 'mock',
  capabilities: { streaming: true, sessionResume: false, shellApproval: false },
  resolveBinary: () => 'mock-agent',
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

describe('startStdioTransport', () => {
  it('is a function that accepts an McpServer', () => {
    expect(typeof startStdioTransport).toBe('function');
  });

  it('returns a Promise', () => {
    // We verify the export is a function returning a Promise.
    // Full stdin/stdout integration requires subprocess testing (see e2e tests).
    const server = new McpServer({ name: 'test', version: '0.0.0' });
    const result = startStdioTransport(server);
    // It returns a Promise (resolves when connected)
    expect(result).toBeInstanceOf(Promise);
    // Don't await — this would block on stdin in a real process
    // Abort is handled by transport.close()
    void result;
  });
});

describe('MCP server via in-memory transport (stdio-equivalent)', () => {
  it('tools are callable after connecting via in-memory transport', async () => {
    const { server } = createMcpServer(mockAdapter, baseConfig);
    const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);

    const client = new Client({ name: 'test', version: '0.0.0' });
    await client.connect(clientTransport);

    const tools = await client.listTools();
    expect(tools.tools.map((t) => t.name)).toContain('coding_agent_info');

    const result = await client.callTool({ name: 'coding_agent_info', arguments: {} });
    const data = result as { content: Array<{ text: string }> };
    const parsed = JSON.parse(data.content[0].text) as { adapter: string };
    expect(parsed.adapter).toBe('mock');

    await client.close();
    await server.close();
  });

  it('coding_agent_info returns version field', async () => {
    const { server } = createMcpServer(mockAdapter, baseConfig);
    const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    const client = new Client({ name: 'test', version: '0.0.0' });
    await client.connect(clientTransport);

    const result = await client.callTool({ name: 'coding_agent_info', arguments: {} });
    const data = result as { content: Array<{ text: string }> };
    const parsed = JSON.parse(data.content[0].text) as { version: string };
    expect(parsed.version).toBeDefined();

    await client.close();
    await server.close();
  });
});
