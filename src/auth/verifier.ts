import { createRemoteJWKSet, createLocalJWKSet, jwtVerify } from 'jose';
import type { JSONWebKeySet } from 'jose';
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import { InvalidTokenError } from '@modelcontextprotocol/sdk/server/auth/errors.js';
import type { Config } from '../config.js';

export interface TokenVerifier {
  verifyAccessToken(token: string): Promise<AuthInfo>;
}

export function createTokenVerifier(config: Config, jwksSet?: JSONWebKeySet): TokenVerifier {
  const JWKS = jwksSet
    ? createLocalJWKSet(jwksSet)
    : createRemoteJWKSet(new URL(config.authJwksUri!));

  return {
    async verifyAccessToken(token: string): Promise<AuthInfo> {
      let payload;
      try {
        ({ payload } = await jwtVerify(token, JWKS, {
          issuer: config.authIssuer,
          audience: config.authAudience,
        }));
      } catch (err) {
        throw new InvalidTokenError(err instanceof Error ? err.message : 'Token verification failed');
      }

      let scopes: string[] = [];
      if (typeof payload['scope'] === 'string') {
        scopes = payload['scope'].split(' ').filter(Boolean);
      } else if (Array.isArray(payload['scp'])) {
        scopes = (payload['scp'] as string[]).filter(Boolean);
      }

      return {
        token,
        clientId: typeof payload['sub'] === 'string' ? payload['sub'] : '',
        scopes,
        expiresAt: typeof payload['exp'] === 'number' ? payload['exp'] : undefined,
        extra: payload as Record<string, unknown>,
      };
    },
  };
}
