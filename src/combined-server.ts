import type { Express } from 'express';
import type { AgentExecutor } from '@a2a-js/sdk/server';
import type { CodingAgentAdapter } from './adapters/base.js';
import type { Config } from './types.js';
import { createApp } from './server.js';
import { createMcpServer } from './mcp/server.js';
import { createHttpTransport, handleMcpRequest } from './mcp/http-transport.js';

/**
 * Creates an Express app that serves both the A2A JSON-RPC surface and the MCP HTTP surface on the same port.
 *
 * - A2A routes: `GET /.well-known/agent-card.json`, `POST /a2a/jsonrpc`
 * - MCP routes: `POST|GET|DELETE /mcp` (Streamable HTTP transport)
 *
 * @param config - Server configuration.
 * @param adapter - The active coding-agent adapter.
 * @param executor - Optional A2A executor override (useful in tests to inject a mock).
 */
export function createCombinedApp(
  config: Config,
  adapter: CodingAgentAdapter,
  executor?: AgentExecutor,
): Express {
  const app = createApp(config, adapter, executor);

  const { server: mcpServer } = createMcpServer(adapter, config);
  const mcpTransport = createHttpTransport();

  app.post('/mcp', (req, res) => { void handleMcpRequest(mcpTransport, req, res); });
  app.get('/mcp', (req, res) => { void handleMcpRequest(mcpTransport, req, res); });
  app.delete('/mcp', (req, res) => { void handleMcpRequest(mcpTransport, req, res); });

  void mcpServer.connect(mcpTransport);

  return app;
}
