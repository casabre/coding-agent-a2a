import express from 'express';
import type { Express, Request } from 'express';
import { DefaultRequestHandler, InMemoryTaskStore } from '@a2a-js/sdk/server';
import { agentCardHandler, jsonRpcHandler, UserBuilder } from '@a2a-js/sdk/server/express';
import type { AgentExecutor, User } from '@a2a-js/sdk/server';
import { requireBearerAuth } from '@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js';
import { buildAgentCard } from './agent-card.js';
import type { Config } from './types.js';
import type { ProcessAdapter } from './adapters/base.js';
import type { TokenVerifier } from './auth/verifier.js';
import { createTokenVerifier } from './auth/verifier.js';
import { AgentTaskExecutor } from './agent-task-executor.js';
import { createRouter } from './routing/router.js';
import { createWorkspace } from './context/index.js';

export interface AppOptions {
  executor?: AgentExecutor;
  verifier?: TokenVerifier;
}

export function createApp(
  config: Config,
  adapter: ProcessAdapter,
  options?: AppOptions,
): Express {
  const agentCard = buildAgentCard(config, adapter);
  const activeExecutor = options?.executor
    ?? new AgentTaskExecutor(config, adapter, createRouter(config, adapter), createWorkspace(config));
  const taskStore = new InMemoryTaskStore();
  const handler = new DefaultRequestHandler(agentCard, taskStore, activeExecutor);

  const app = express();
  app.use(express.json());

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', adapter: config.agentAdapter });
  });

  app.use(
    '/.well-known/agent-card.json',
    agentCardHandler({ agentCardProvider: handler }),
  );

  if (config.authEnabled) {
    const activeVerifier = options?.verifier ?? createTokenVerifier(config);
    const authMw = requireBearerAuth({
      verifier: activeVerifier,
      requiredScopes: config.authRequiredScopes,
      resourceMetadataUrl: config.authResourceUrl,
    });
    const userBuilder = (req: Request): Promise<User> => {
      const auth = req.auth!;
      return Promise.resolve({
        get isAuthenticated() { return true; },
        get userName() { return auth.clientId || 'unknown'; },
      } as User);
    };

    app.use('/a2a/jsonrpc', authMw, jsonRpcHandler({ requestHandler: handler, userBuilder }));
  } else {
    app.use(
      '/a2a/jsonrpc',
      jsonRpcHandler({ requestHandler: handler, userBuilder: UserBuilder.noAuthentication }),
    );
  }

  return app;
}
