import type { AgentCard } from '@a2a-js/sdk';
import type { Config } from './types.js';
import type { CodingAgentAdapter } from './adapters/base.js';

export function buildAgentCard(config: Config, adapter: CodingAgentAdapter): AgentCard {
  const card: AgentCard = {
    name: `coding-agent-a2a (${adapter.name})`,
    description: `Delegates coding tasks to the ${adapter.name} agent and streams results back via the A2A protocol.`,
    version: '0.1.0',
    provider: undefined,
    supportedInterfaces: [
      {
        url: `http://localhost:${config.port}/a2a/jsonrpc`,
        protocolBinding: 'JSONRPC',
        protocolVersion: '1.0',
        tenant: '',
      },
    ],
    capabilities: {
      streaming: true,
      pushNotifications: false,
      extensions: [],
    },
    defaultInputModes: ['text/plain'],
    defaultOutputModes: ['text/plain', 'application/json'],
    securitySchemes: {},
    securityRequirements: [],
    signatures: [],
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
        securityRequirements: [],
      },
    ],
  };

  if (config.authEnabled && config.authServerUrl) {
    card.securitySchemes = {
      oauth2: {
        scheme: {
          $case: 'oauth2SecurityScheme',
          value: {
            description: '',
            oauth2MetadataUrl: '',
            flows: {
              flow: {
                $case: 'authorizationCode',
                value: {
                  authorizationUrl: config.authAuthorizationUrl!,
                  tokenUrl: config.authTokenUrl!,
                  refreshUrl: '',
                  pkceRequired: false,
                  scopes: Object.fromEntries(
                    (config.authRequiredScopes ?? []).map((s) => [s, s]),
                  ),
                },
              },
            },
          },
        },
      },
    };
    card.securityRequirements = [
      {
        schemes: Object.fromEntries([
          ['oauth2', { list: config.authRequiredScopes ?? [] }],
        ]),
      },
    ];
  }

  return card;
}
