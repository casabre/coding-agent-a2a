import { createRemoteJWKSet, createLocalJWKSet, jwtVerify } from 'jose';
import type { JSONWebKeySet } from 'jose';
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import { InvalidTokenError } from '@modelcontextprotocol/sdk/server/auth/errors.js';
import { SpanStatusCode } from '@opentelemetry/api';
import type { Config } from '../config.js';
import { tracer, context } from '../telemetry.js';

export interface TokenVerifier {
  verifyAccessToken(token: string): Promise<AuthInfo>;
}

export function createTokenVerifier(config: Config, jwksSet?: JSONWebKeySet): TokenVerifier {
  const JWKS = jwksSet
    ? createLocalJWKSet(jwksSet)
    : createRemoteJWKSet(new URL(config.authJwksUri!));

  return {
    async verifyAccessToken(token: string): Promise<AuthInfo> {
      const span = tracer.startSpan('auth.verify_token', {}, context.active());
      let payload;
      try {
        ({ payload } = await jwtVerify(token, JWKS, {
          issuer: config.authIssuer,
          audience: config.authAudience,
        }));
        span.setAttributes({ 'auth.issuer': config.authIssuer ?? '', 'auth.success': true });
      } catch (err) {
        const message = err instanceof Error ? err.message : /* c8 ignore next */ 'Token verification failed';
        span.setAttributes({ 'auth.success': false, 'auth.error': message });
        span.setStatus({ code: SpanStatusCode.ERROR, message });
        span.end();
        throw new InvalidTokenError(message);
      }

      let scopes: string[] = [];
      if (typeof payload['scope'] === 'string') {
        scopes = payload['scope'].split(' ').filter(Boolean);
      } else if (Array.isArray(payload['scp'])) {
        scopes = (payload['scp'] as string[]).filter(Boolean);
      }

      span.end();
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
