import { ProxyOAuthServerProvider } from '@modelcontextprotocol/sdk/server/auth/providers/proxyProvider.js';
import type { Config } from '../config.js';
import type { TokenVerifier } from './verifier.js';

export function createOAuthProvider(config: Config, verifier: TokenVerifier): ProxyOAuthServerProvider {
  return new ProxyOAuthServerProvider({
    endpoints: {
      authorizationUrl: config.authAuthorizationUrl!,
      tokenUrl: config.authTokenUrl!,
    },
    verifyAccessToken: (token) => verifier.verifyAccessToken(token),
    getClient: async (clientId) => {
      if (config.authAllowedRedirectUris?.length) {
        return { client_id: clientId, redirect_uris: config.authAllowedRedirectUris };
      }
      // No allowlist — trust IdP to validate redirect_uri at authorization time
      return { client_id: clientId, redirect_uris: [] };
    },
  });
}
