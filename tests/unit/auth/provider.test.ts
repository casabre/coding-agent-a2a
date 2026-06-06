import { describe, it, expect, vi } from 'vitest';
import type { Config } from '../../../src/config.js';
import { createOAuthProvider } from '../../../src/auth/provider.js';
import type { TokenVerifier } from '../../../src/auth/verifier.js';

const baseConfig: Config = {
  port: 41242,
  agentAdapter: 'cursor',
  agentModel: undefined,
  agentTimeoutMs: 5000,
  agentIdleExitMs: 0,
  agentForce: true,
  agentRepoPath: '.',
  mcpTransport: 'stdio',
  logLevel: 'warn',
  authEnabled: true,
  authAuthorizationUrl: 'https://idp.example.com/authorize',
  authTokenUrl: 'https://idp.example.com/token',
  authJwksUri: 'https://idp.example.com/.well-known/jwks.json',
  authIssuer: 'https://idp.example.com',
  authAudience: 'coding-agent',
};

function makeVerifier(): TokenVerifier {
  return {
    verifyAccessToken: vi.fn().mockResolvedValue({
      token: 'test',
      clientId: 'client-1',
      scopes: ['agent:run'],
    }),
  };
}

describe('createOAuthProvider', () => {
  it('returns a ProxyOAuthServerProvider instance', () => {
    const provider = createOAuthProvider(baseConfig, makeVerifier());
    expect(provider).toBeDefined();
    expect(typeof provider.verifyAccessToken).toBe('function');
    expect(provider.clientsStore).toBeDefined();
  });

  it('verifyAccessToken delegates to the injected verifier', async () => {
    const verifier = makeVerifier();
    const provider = createOAuthProvider(baseConfig, verifier);
    await provider.verifyAccessToken('some-token');
    expect(verifier.verifyAccessToken).toHaveBeenCalledWith('some-token');
  });

  describe('getClient', () => {
    it('returns allowed redirect_uris when AUTH_ALLOWED_REDIRECT_URIS is set', async () => {
      const config: Config = {
        ...baseConfig,
        authAllowedRedirectUris: ['https://claude.ai/callback', 'https://app.example.com/callback'],
      };
      const provider = createOAuthProvider(config, makeVerifier());
      const client = await provider.clientsStore.getClient('any-client');
      expect(client?.redirect_uris).toEqual([
        'https://claude.ai/callback',
        'https://app.example.com/callback',
      ]);
    });

    it('returns empty redirect_uris when AUTH_ALLOWED_REDIRECT_URIS is not set', async () => {
      const provider = createOAuthProvider(baseConfig, makeVerifier());
      const client = await provider.clientsStore.getClient('any-client');
      expect(client?.redirect_uris).toEqual([]);
    });

    it('returns client_id matching the requested clientId', async () => {
      const provider = createOAuthProvider(baseConfig, makeVerifier());
      const client = await provider.clientsStore.getClient('my-client-id');
      expect(client?.client_id).toBe('my-client-id');
    });
  });
});
