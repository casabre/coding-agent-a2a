import express from 'express';
import type { Express } from 'express';
import { DefaultRequestHandler, InMemoryTaskStore } from '@a2a-js/sdk/server';
import { agentCardHandler, jsonRpcHandler, UserBuilder } from '@a2a-js/sdk/server/express';
import type { AgentExecutor } from '@a2a-js/sdk/server';
import { buildAgentCard } from './agent-card.js';
import type { Config } from './types.js';
import type { CodingAgentAdapter } from './adapters/base.js';
import { CursorAgentExecutor } from './cursor-executor.js';

export function createApp(
  config: Config,
  adapter: CodingAgentAdapter,
  executor?: AgentExecutor,
): Express {
  const agentCard = buildAgentCard(config, adapter);
  const activeExecutor = executor ?? new CursorAgentExecutor(config, adapter);
  const taskStore = new InMemoryTaskStore();
  const handler = new DefaultRequestHandler(agentCard, taskStore, activeExecutor);

  const app = express();
  app.use(express.json());

  app.use(
    '/.well-known/agent-card.json',
    agentCardHandler({ agentCardProvider: handler }),
  );

  app.use(
    '/a2a/jsonrpc',
    jsonRpcHandler({ requestHandler: handler, userBuilder: UserBuilder.noAuthentication }),
  );

  return app;
}
