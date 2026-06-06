import { describe, it, expect, beforeAll } from 'vitest';
import { generateKeyPair, exportJWK, SignJWT } from 'jose';
import type { JSONWebKeySet } from 'jose';
import type { Config } from '../../../src/config.js';
import { createTokenVerifier } from '../../../src/auth/verifier.js';

let privateKey: CryptoKey;
let jwksSet: JSONWebKeySet;

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
  authIssuer: 'https://idp.example.com',
  authAudience: 'coding-agent',
  authJwksUri: 'https://idp.example.com/.well-known/jwks.json',
};

beforeAll(async () => {
  const keyPair = await generateKeyPair('RS256');
  privateKey = keyPair.privateKey as CryptoKey;
  const jwk = await exportJWK(keyPair.publicKey);
  jwksSet = { keys: [{ ...jwk, kid: 'test-key-1', alg: 'RS256' }] };
});

function signToken(
  payload: Record<string, unknown>,
  options?: { expiresIn?: string; issuer?: string; audience?: string },
) {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: 'RS256', kid: 'test-key-1' })
    .setIssuedAt()
    .setIssuer(options?.issuer ?? 'https://idp.example.com')
    .setAudience(options?.audience ?? 'coding-agent')
    .setExpirationTime(options?.expiresIn ?? '1h')
    .sign(privateKey);
}

describe('createTokenVerifier', () => {
  describe('valid token', () => {
    it('returns AuthInfo with correct clientId from sub claim', async () => {
      const token = await signToken({ sub: 'client-123' });
      const verifier = createTokenVerifier(baseConfig, jwksSet);
      const info = await verifier.verifyAccessToken(token);
      expect(info.clientId).toBe('client-123');
      expect(info.token).toBe(token);
    });

    it('extracts scopes from scope string claim', async () => {
      const token = await signToken({ sub: 'client-1', scope: 'agent:run agent:read' });
      const verifier = createTokenVerifier(baseConfig, jwksSet);
      const info = await verifier.verifyAccessToken(token);
      expect(info.scopes).toEqual(['agent:run', 'agent:read']);
    });

    it('extracts scopes from scp array claim', async () => {
      const token = await signToken({ sub: 'client-1', scp: ['agent:run', 'agent:read'] });
      const verifier = createTokenVerifier(baseConfig, jwksSet);
      const info = await verifier.verifyAccessToken(token);
      expect(info.scopes).toEqual(['agent:run', 'agent:read']);
    });

    it('returns empty scopes when no scope claim present', async () => {
      const token = await signToken({ sub: 'client-1' });
      const verifier = createTokenVerifier(baseConfig, jwksSet);
      const info = await verifier.verifyAccessToken(token);
      expect(info.scopes).toEqual([]);
    });

    it('sets expiresAt from exp claim', async () => {
      const token = await signToken({ sub: 'client-1' });
      const verifier = createTokenVerifier(baseConfig, jwksSet);
      const info = await verifier.verifyAccessToken(token);
      expect(typeof info.expiresAt).toBe('number');
      expect(info.expiresAt).toBeGreaterThan(Date.now() / 1000);
    });
  });

  describe('invalid token', () => {
    it('rejects expired token', async () => {
      const token = await new SignJWT({ sub: 'client-1' })
        .setProtectedHeader({ alg: 'RS256', kid: 'test-key-1' })
        .setIssuedAt()
        .setIssuer('https://idp.example.com')
        .setAudience('coding-agent')
        .setExpirationTime(new Date(0))
        .sign(privateKey);
      const verifier = createTokenVerifier(baseConfig, jwksSet);
      await expect(verifier.verifyAccessToken(token)).rejects.toThrow();
    });

    it('rejects token with wrong issuer', async () => {
      const token = await signToken({ sub: 'client-1' }, { issuer: 'https://wrong-issuer.com' });
      const verifier = createTokenVerifier(baseConfig, jwksSet);
      await expect(verifier.verifyAccessToken(token)).rejects.toThrow();
    });

    it('rejects token with wrong audience', async () => {
      const token = await signToken({ sub: 'client-1' }, { audience: 'wrong-audience' });
      const verifier = createTokenVerifier(baseConfig, jwksSet);
      await expect(verifier.verifyAccessToken(token)).rejects.toThrow();
    });

    it('rejects malformed token string', async () => {
      const verifier = createTokenVerifier(baseConfig, jwksSet);
      await expect(verifier.verifyAccessToken('not.a.jwt')).rejects.toThrow();
    });
  });
});
