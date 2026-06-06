import type { AgentCard } from '@a2a-js/sdk';
import type { Config } from './types.js';
import type { CodingAgentAdapter } from './adapters/base.js';

export function buildAgentCard(config: Config, adapter: CodingAgentAdapter): AgentCard {
  const card: AgentCard = {
    name: `coding-agent-a2a (${adapter.name})`,
    description: `Delegates coding tasks to the ${adapter.name} agent and streams results back via the A2A protocol.`,
    protocolVersion: '0.3.0',
    version: '0.1.0',
    url: `http://localhost:${config.port}/a2a/jsonrpc`,
    capabilities: {
      streaming: true,
      pushNotifications: false,
      stateTransitionHistory: true,
    },
    defaultInputModes: ['text/plain'],
    defaultOutputModes: ['text/plain', 'application/json'],
    skills: [
      {
        id: 'code-task',
        name: 'Execute coding task',
        description:
          'Runs a coding task (edit, refactor, analyse, explain, test) via a coding agent CLI. Streams NDJSON events as A2A artifacts in real time.',
        tags: ['coding', 'refactor', 'edit', 'test'],
        inputModes: ['text/plain'],
        outputModes: ['text/plain', 'application/json'],
        examples: [
          'Refactor the auth module to use JWT',
          'Add unit tests for src/utils/date.ts',
          'Explain how the rate limiter works',
        ],
      },
    ],
  };

  // AgentCard.securitySchemes is supported in @a2a-js/sdk v0.3.13
  if (config.authEnabled && config.authServerUrl) {
    card.securitySchemes = {
      oauth2: {
        type: 'oauth2',
        flows: {
          authorizationCode: {
            authorizationUrl: config.authAuthorizationUrl!,
            tokenUrl: config.authTokenUrl!,
            scopes: Object.fromEntries(
              (config.authRequiredScopes ?? []).map((s) => [s, s]),
            ),
          },
        },
      },
    };
    card.security = [{ oauth2: config.authRequiredScopes ?? [] }];
  }

  return card;
}
