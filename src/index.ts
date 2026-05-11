import { loadConfig } from './config.js';
import { resolveAdapter } from './adapters/index.js';
import { createCombinedApp } from './combined-server.js';
import { createMcpServer } from './mcp/server.js';
import { startStdioTransport } from './mcp/stdio-transport.js';

const config = (() => {
  try {
    return loadConfig();
  } catch (err) {
    console.error(`[coding-agent-a2a] Configuration error: ${String(err)}`);
    process.exit(1);
  }
})();

const adapter = resolveAdapter(config.agentAdapter);
const app = createCombinedApp(config, adapter);

app.listen(config.port, () => {
  const version = process.env['npm_package_version'] ?? '0.1.0';
  console.log(`coding-agent-a2a v${version}`);
  console.log(`adapter:       ${adapter.name}`);
  console.log(`A2A endpoint:  http://localhost:${config.port}/a2a/jsonrpc`);
  console.log(`Agent Card:    http://localhost:${config.port}/.well-known/agent-card.json`);
  if (config.mcpTransport === 'http') {
    console.log(`MCP transport: http → http://localhost:${config.port}/mcp`);
  } else {
    console.log(`MCP transport: stdio`);
  }
});

if (config.mcpTransport === 'stdio') {
  const { server: mcpServer } = createMcpServer(adapter, config);
  void startStdioTransport(mcpServer);
}
