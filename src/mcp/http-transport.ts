import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { IncomingMessage, ServerResponse } from 'node:http';

export function createHttpTransport(): StreamableHTTPServerTransport {
  return new StreamableHTTPServerTransport({
    sessionIdGenerator: () => crypto.randomUUID(),
  });
}

export async function handleMcpRequest(
  transport: StreamableHTTPServerTransport,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  await transport.handleRequest(req, res, (req as IncomingMessage & { body?: unknown }).body);
}
