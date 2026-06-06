import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { writeFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const AUTH_ENV_KEYS = [
  'CONFIG_FILE', 'AUTH_ENABLED', 'AUTH_OIDC_DISCOVERY_URL',
  'AUTH_AUTHORIZATION_URL', 'AUTH_TOKEN_URL', 'AUTH_JWKS_URI',
  'AUTH_ISSUER', 'AUTH_AUDIENCE', 'AUTH_REQUIRED_SCOPES',
  'AUTH_SERVER_URL', 'AUTH_RESOURCE_URL', 'AUTH_ALLOWED_REDIRECT_URIS',
  'PORT',
];

function saveEnv() {
  return Object.fromEntries(AUTH_ENV_KEYS.map((k) => [k, process.env[k]]));
}

function restoreEnv(saved: Record<string, string | undefined>) {
  for (const key of AUTH_ENV_KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
}

async function loadFreshConfig() {
  const mod = await import('../../../src/config.js?t=' + Date.now());
  return mod.loadConfig();
}

let savedEnv: Record<string, string | undefined>;

beforeEach(() => {
  savedEnv = saveEnv();
  for (const key of AUTH_ENV_KEYS) delete process.env[key];
});

afterEach(() => {
  restoreEnv(savedEnv);
  vi.restoreAllMocks();
});

describe('loadConfig — boolEnv passthrough', () => {
  it('accepts boolean value from JSON config file for agentForce', async () => {
    // Exercises config.ts boolEnv: typeof val === 'boolean' branch (JSON files provide real booleans)
    const path = join(tmpdir(), `config-test-bool-${Date.now()}.json`);
    writeFileSync(path, JSON.stringify({ agentForce: false }));
    process.env['CONFIG_FILE'] = path;
    try {
      const config = await loadFreshConfig();
      expect(config.agentForce).toBe(false);
    } finally {
      unlinkSync(path);
    }
  });
});

describe('loadConfig — CONFIG_FILE', () => {
  it('loads values from JSON file', async () => {
    const path = join(tmpdir(), `config-test-${Date.now()}.json`);
    writeFileSync(path, JSON.stringify({ port: 9999, agentAdapter: 'generic' }));
    process.env['CONFIG_FILE'] = path;
    try {
      const config = await loadFreshConfig();
      expect(config.port).toBe(9999);
      expect(config.agentAdapter).toBe('generic');
    } finally {
      unlinkSync(path);
    }
  });

  it('env vars override JSON file values', async () => {
    const path = join(tmpdir(), `config-test-${Date.now()}.json`);
    writeFileSync(path, JSON.stringify({ port: 9999 }));
    process.env['CONFIG_FILE'] = path;
    process.env['PORT'] = '8888';
    try {
      const config = await loadFreshConfig();
      expect(config.port).toBe(8888);
    } finally {
      unlinkSync(path);
    }
  });

  it('throws when CONFIG_FILE does not exist', async () => {
    process.env['CONFIG_FILE'] = '/nonexistent/path/config.json';
    await expect(loadFreshConfig()).rejects.toThrow(/Failed to load CONFIG_FILE/);
  });
});

describe('loadConfig — AUTH_ENABLED cross-field validation', () => {
  it('throws when AUTH_ENABLED=true without AUTH_ISSUER and AUTH_AUDIENCE', async () => {
    process.env['AUTH_ENABLED'] = 'true';
    process.env['AUTH_AUTHORIZATION_URL'] = 'https://idp.example.com/authorize';
    process.env['AUTH_TOKEN_URL'] = 'https://idp.example.com/token';
    process.env['AUTH_JWKS_URI'] = 'https://idp.example.com/.well-known/jwks.json';
    await expect(loadFreshConfig()).rejects.toThrow(/Invalid configuration/);
  });

  it('throws when AUTH_ENABLED=true without manual URLs and no discovery URL', async () => {
    process.env['AUTH_ENABLED'] = 'true';
    process.env['AUTH_ISSUER'] = 'https://idp.example.com';
    process.env['AUTH_AUDIENCE'] = 'my-api';
    await expect(loadFreshConfig()).rejects.toThrow(/Invalid configuration/);
  });

  it('passes when AUTH_ENABLED=true with discovery URL + issuer + audience', async () => {
    const discoveryData = {
      authorization_endpoint: 'https://idp.example.com/authorize',
      token_endpoint: 'https://idp.example.com/token',
      jwks_uri: 'https://idp.example.com/.well-known/jwks.json',
    };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(discoveryData),
    }));
    process.env['AUTH_ENABLED'] = 'true';
    process.env['AUTH_OIDC_DISCOVERY_URL'] = 'https://idp.example.com/.well-known/openid-configuration';
    process.env['AUTH_ISSUER'] = 'https://idp.example.com';
    process.env['AUTH_AUDIENCE'] = 'my-api';
    const config = await loadFreshConfig();
    expect(config.authEnabled).toBe(true);
    expect(config.authAuthorizationUrl).toBe(discoveryData.authorization_endpoint);
    expect(config.authTokenUrl).toBe(discoveryData.token_endpoint);
    expect(config.authJwksUri).toBe(discoveryData.jwks_uri);
  });

  it('AUTH_ENABLED=false (default) — no auth validation applied', async () => {
    const config = await loadFreshConfig();
    expect(config.authEnabled).toBeUndefined();
  });
});

describe('loadConfig — OIDC discovery hydration', () => {
  it('fetchOidcDiscovery network failure throws human-readable error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Connection refused')));
    process.env['AUTH_ENABLED'] = 'true';
    process.env['AUTH_OIDC_DISCOVERY_URL'] = 'https://idp.example.com/.well-known/openid-configuration';
    process.env['AUTH_ISSUER'] = 'https://idp.example.com';
    process.env['AUTH_AUDIENCE'] = 'my-api';
    await expect(loadFreshConfig()).rejects.toThrow(/OIDC discovery unreachable/);
    await expect(loadFreshConfig()).rejects.toThrow('https://idp.example.com/.well-known/openid-configuration');
  });

  it('fetchOidcDiscovery HTTP 404 throws with status in message', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404 }));
    process.env['AUTH_ENABLED'] = 'true';
    process.env['AUTH_OIDC_DISCOVERY_URL'] = 'https://idp.example.com/.well-known/openid-configuration';
    process.env['AUTH_ISSUER'] = 'https://idp.example.com';
    process.env['AUTH_AUDIENCE'] = 'my-api';
    await expect(loadFreshConfig()).rejects.toThrow(/HTTP 404/);
  });

  it('hydrateFromDiscovery returns new object — original config unchanged', async () => {
    const discoveryData = {
      authorization_endpoint: 'https://idp.example.com/authorize',
      token_endpoint: 'https://idp.example.com/token',
      jwks_uri: 'https://idp.example.com/.well-known/jwks.json',
    };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(discoveryData),
    }));
    process.env['AUTH_ENABLED'] = 'true';
    process.env['AUTH_OIDC_DISCOVERY_URL'] = 'https://idp.example.com/.well-known/openid-configuration';
    process.env['AUTH_ISSUER'] = 'https://idp.example.com';
    process.env['AUTH_AUDIENCE'] = 'my-api';

    const configA = await loadFreshConfig();
    const configB = await loadFreshConfig();
    // Each call produces an independent object
    expect(configA).not.toBe(configB);
    expect(configA.authAuthorizationUrl).toBe(discoveryData.authorization_endpoint);
  });

  it('manual override takes precedence over discovery values', async () => {
    const discoveryData = {
      authorization_endpoint: 'https://idp.example.com/authorize',
      token_endpoint: 'https://idp.example.com/token',
      jwks_uri: 'https://idp.example.com/.well-known/jwks.json',
    };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(discoveryData),
    }));
    process.env['AUTH_ENABLED'] = 'true';
    process.env['AUTH_OIDC_DISCOVERY_URL'] = 'https://idp.example.com/.well-known/openid-configuration';
    process.env['AUTH_ISSUER'] = 'https://idp.example.com';
    process.env['AUTH_AUDIENCE'] = 'my-api';
    process.env['AUTH_AUTHORIZATION_URL'] = 'https://custom.example.com/authorize';

    const config = await loadFreshConfig();
    expect(config.authAuthorizationUrl).toBe('https://custom.example.com/authorize');
  });
});

describe('loadConfig — AUTH_SERVER_URL defaults', () => {
  it('defaults authServerUrl to http://localhost:PORT when not set', async () => {
    process.env['PORT'] = '41242';
    const config = await loadFreshConfig();
    expect(config.authServerUrl).toBe('http://localhost:41242');
  });

  it('defaults authResourceUrl to /mcp path on authServerUrl', async () => {
    process.env['PORT'] = '41242';
    const config = await loadFreshConfig();
    expect(config.authResourceUrl).toBe('http://localhost:41242/mcp');
  });
});

describe('loadConfig — AUTH_ALLOWED_REDIRECT_URIS parsing', () => {
  it('parses comma-separated redirect URIs into array', async () => {
    process.env['AUTH_ALLOWED_REDIRECT_URIS'] = 'https://a.example.com/cb,https://b.example.com/cb';
    const config = await loadFreshConfig();
    expect(config.authAllowedRedirectUris).toEqual(['https://a.example.com/cb', 'https://b.example.com/cb']);
  });

  it('returns undefined when AUTH_ALLOWED_REDIRECT_URIS is not set', async () => {
    const config = await loadFreshConfig();
    expect(config.authAllowedRedirectUris).toBeUndefined();
  });
});

describe('loadConfig — AUTH_REQUIRED_SCOPES parsing', () => {
  it('parses comma-separated scopes into array', async () => {
    process.env['AUTH_REQUIRED_SCOPES'] = 'agent:run,agent:read';
    const config = await loadFreshConfig();
    expect(config.authRequiredScopes).toEqual(['agent:run', 'agent:read']);
  });

  it('trims whitespace from scope values', async () => {
    process.env['AUTH_REQUIRED_SCOPES'] = ' agent:run , agent:read ';
    const config = await loadFreshConfig();
    expect(config.authRequiredScopes).toEqual(['agent:run', 'agent:read']);
  });

  it('returns undefined when AUTH_REQUIRED_SCOPES is not set', async () => {
    const config = await loadFreshConfig();
    expect(config.authRequiredScopes).toBeUndefined();
  });
});
