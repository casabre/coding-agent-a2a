import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ProcessAdapter } from '../adapters/base.js';
import type { Config } from '../types.js';
import { McpTaskManager } from './task-manager.js';
import { createRouter } from '../routing/router.js';
import { registerTools } from './tools.js';

/**
 * Creates an {@link McpServer} with all five coding-agent tools registered and returns it
 * alongside its {@link McpTaskManager}.
 *
 * The returned server is not yet connected to a transport.
 * Connect it via {@link startStdioTransport} (stdio) or {@link createHttpTransport} (HTTP).
 */
export function createMcpServer(
  adapter: ProcessAdapter,
  config: Config,
): { server: McpServer; taskManager: McpTaskManager } {
  const server = new McpServer({
    name: 'coding-agent-a2a',
    version: process.env['npm_package_version'] ?? '0.1.0',
  });
  const taskManager = new McpTaskManager(adapter, config, createRouter(config, adapter));
  registerTools(server, adapter, taskManager);
  return { server, taskManager };
}
