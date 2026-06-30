import cors from 'cors';
import type { Express } from 'express';
import type { ProcessAdapter } from './adapters/base.js';
import type { Config } from './types.js';
import type { AppOptions } from './server.js';
import { createApp } from './server.js';
import { createMcpServer } from './mcp/server.js';
import { createHttpTransport, handleMcpRequest } from './mcp/http-transport.js';
import { createTokenVerifier } from './auth/verifier.js';
import { createOAuthProvider } from './auth/provider.js';
import { mcpAuthRouter } from '@modelcontextprotocol/sdk/server/auth/router.js';
import { requireBearerAuth } from '@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js';

/**
 * Creates an Express app that serves both the A2A JSON-RPC surface and the MCP HTTP surface on the same port.
 *
 * - A2A routes: `GET /health`, `GET /.well-known/agent-card.json`, `POST /a2a/jsonrpc`
 * - MCP routes: `POST|GET|DELETE /mcp` (Streamable HTTP transport, HTTP mode only)
 * - Auth: when `AUTH_ENABLED=true`, Bearer auth is enforced on `/a2a/jsonrpc` and `/mcp` (HTTP mode)
 */
export function createCombinedApp(
  config: Config,
  adapter: ProcessAdapter,
  options?: AppOptions,
): Express {
  const app = createApp(config, adapter, options);

  const { server: mcpServer } = createMcpServer(adapter, config);
  const mcpTransport = createHttpTransport();

  if (config.authEnabled) {
    const activeVerifier = options?.verifier ?? createTokenVerifier(config);
    const provider = createOAuthProvider(config, activeVerifier);

    // CORS before mcpAuthRouter so all OAuth discovery/token endpoints are accessible
    app.use(cors({ origin: '*' }));

    app.use(mcpAuthRouter({
      provider,
      issuerUrl: new URL(config.authServerUrl!),
      resourceServerUrl: new URL(config.authResourceUrl!),
    }));

    if (config.mcpTransport === 'http') {
      const authMw = requireBearerAuth({
        verifier: activeVerifier,
        requiredScopes: config.authRequiredScopes,
        resourceMetadataUrl: config.authResourceUrl,
      });
      app.post('/mcp', authMw, (req, res) => { void handleMcpRequest(mcpTransport, req, res); });
      app.get('/mcp', authMw, (req, res) => { void handleMcpRequest(mcpTransport, req, res); });
      app.delete('/mcp', authMw, (req, res) => { void handleMcpRequest(mcpTransport, req, res); });
    }
  } else if (config.mcpTransport === 'http') {
    app.post('/mcp', (req, res) => { void handleMcpRequest(mcpTransport, req, res); });
    app.get('/mcp', (req, res) => { void handleMcpRequest(mcpTransport, req, res); });
    app.delete('/mcp', (req, res) => { void handleMcpRequest(mcpTransport, req, res); });
  }

  void mcpServer.connect(mcpTransport);

  return app;
}
