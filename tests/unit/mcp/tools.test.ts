import { describe, it, expect, vi, beforeEach } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { McpTaskManager } from '../../../src/mcp/task-manager.js';
import type { CodingAgentAdapter } from '../../../src/adapters/base.js';
import { registerTools } from '../../../src/mcp/tools.js';

function makeMockTaskManager(): McpTaskManager {
  return {
    startJob: vi.fn(() => 'job-123'),
    getJob: vi.fn(() => undefined),
    pollJob: vi.fn(() => ({ events: [], done: false })),
    cancelJob: vi.fn(() => true),
    getResult: vi.fn(() => ({ summary: 'done', done: true })),
  } as unknown as McpTaskManager;
}

const mockAdapter: CodingAgentAdapter = {
  name: 'mock-adapter',
  capabilities: { streaming: true, sessionResume: false, shellApproval: false },
  resolveBinary: vi.fn(() => 'mock-binary'),
  buildArgv: vi.fn(() => []),
  parseEvent: vi.fn(() => null),
  isApprovalPrompt: vi.fn(() => false),
  approvalResponse: vi.fn(() => 'y'),
};

async function createConnectedPair(server: McpServer): Promise<Client> {
  const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: 'test-client', version: '0.0.0' });
  await client.connect(clientTransport);
  return client;
}

type ToolResult = { content: Array<{ type: string; text: string }>; isError?: boolean };

async function callTool(client: Client, name: string, args: Record<string, unknown> = {}): Promise<ToolResult> {
  return await client.callTool({ name, arguments: args }) as ToolResult;
}

describe('registerTools', () => {
  let server: McpServer;
  let taskManager: McpTaskManager;
  let client: Client;

  beforeEach(async () => {
    server = new McpServer({ name: 'test', version: '0.0.0' });
    taskManager = makeMockTaskManager();
    registerTools(server, mockAdapter, taskManager);
    client = await createConnectedPair(server);
  });

  describe('coding_agent_run', () => {
    it('calls taskManager.startJob with task and returns job_id', async () => {
      vi.mocked(taskManager.startJob).mockReturnValue('job-abc');
      const result = await callTool(client, 'coding_agent_run', { task: 'refactor auth' });
      expect(taskManager.startJob).toHaveBeenCalledWith('refactor auth', expect.objectContaining({}));
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.job_id).toBe('job-abc');
    });

    it('passes optional model, repoPath, force overrides', async () => {
      await callTool(client, 'coding_agent_run', {
        task: 'fix bug',
        model: 'claude-opus',
        repoPath: '/my/repo',
        force: false,
      });
      expect(taskManager.startJob).toHaveBeenCalledWith(
        'fix bug',
        expect.objectContaining({ model: 'claude-opus', repoPath: '/my/repo', force: false }),
      );
    });
  });

  describe('coding_agent_poll', () => {
    it('returns events and done flag', async () => {
      vi.mocked(taskManager.pollJob).mockReturnValue({
        events: [{ kind: 'thinking', text: 'working...' }],
        done: false,
      });
      const result = await callTool(client, 'coding_agent_poll', { jobId: 'job-1', sinceLine: 0 });
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.events).toHaveLength(1);
      expect(parsed.done).toBe(false);
    });

    it('uses sinceLine=0 as default', async () => {
      await callTool(client, 'coding_agent_poll', { jobId: 'job-1' });
      expect(taskManager.pollJob).toHaveBeenCalledWith('job-1', 0);
    });

    it('returns isError for unknown jobId', async () => {
      vi.mocked(taskManager.pollJob).mockReturnValue(null);
      const result = await callTool(client, 'coding_agent_poll', { jobId: 'unknown' });
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Unknown job');
    });
  });

  describe('coding_agent_result', () => {
    it('returns summary and done flag', async () => {
      vi.mocked(taskManager.getResult).mockReturnValue({ summary: 'Refactored auth', done: true });
      const result = await callTool(client, 'coding_agent_result', { jobId: 'job-1' });
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.summary).toBe('Refactored auth');
      expect(parsed.done).toBe(true);
    });

    it('returns isError for unknown jobId', async () => {
      vi.mocked(taskManager.getResult).mockReturnValue(null);
      const result = await callTool(client, 'coding_agent_result', { jobId: 'missing' });
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Unknown job');
    });
  });

  describe('coding_agent_cancel', () => {
    it('returns cancelled: true for active job', async () => {
      vi.mocked(taskManager.cancelJob).mockReturnValue(true);
      const result = await callTool(client, 'coding_agent_cancel', { jobId: 'job-1' });
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.cancelled).toBe(true);
    });

    it('returns isError for unknown jobId', async () => {
      vi.mocked(taskManager.cancelJob).mockReturnValue(false);
      const result = await callTool(client, 'coding_agent_cancel', { jobId: 'unknown' });
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Unknown job');
    });
  });

  describe('coding_agent_info', () => {
    it('returns adapter name and capabilities', async () => {
      const result = await callTool(client, 'coding_agent_info');
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.adapter).toBe('mock-adapter');
      expect(parsed.capabilities).toMatchObject({ streaming: true });
    });

    it('falls back to 0.1.0 version when npm_package_version env is unset', async () => {
      const prev = process.env['npm_package_version'];
      delete process.env['npm_package_version'];
      try {
        const result = await callTool(client, 'coding_agent_info');
        const parsed = JSON.parse(result.content[0].text) as { version: string };
        expect(parsed.version).toBe('0.1.0');
      } finally {
        if (prev !== undefined) process.env['npm_package_version'] = prev;
      }
    });
  });
});
