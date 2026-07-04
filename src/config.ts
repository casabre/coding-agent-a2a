import { z } from 'zod';
import { readFileSync } from 'node:fs';

interface OidcDiscovery {
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
  [key: string]: unknown;
}

function boolEnv(defaultVal: boolean) {
  return z.preprocess(
    (val) => {
      if (typeof val === 'boolean') return val;
      if (typeof val === 'string') return ['true', '1', 'yes', 'on'].includes(val.toLowerCase());
      return defaultVal;
    },
    z.boolean().default(defaultVal),
  );
}

/** One routing profile's target: which adapter runs it, and an optional model override. */
const RouteEntrySchema = z.object({
  adapter: z.string(),
  model: z.string().optional(),
});

/**
 * Per-request routing map: task-complexity profile → backend. Optional — when absent, the
 * server uses the single boot `AGENT_ADAPTER` (routing disabled, byte-identical to before).
 */
const RoutingSchema = z.object({
  COMPLEX: RouteEntrySchema,
  MID:     RouteEntrySchema,
  ROUTINE: RouteEntrySchema,
});

export type RoutingConfig = z.infer<typeof RoutingSchema>;

const ConfigSchema = z.object({
  port:            z.coerce.number().int().min(0).default(41242),
  agentAdapter:    z.string().default('cursor'),
  routing:         RoutingSchema.optional(),
  agentModel:      z.string().optional(),
  agentTimeoutMs:  z.coerce.number().int().min(0).default(120_000),
  agentIdleExitMs: z.coerce.number().int().min(0).default(0),
  agentForce:      boolEnv(true),
  agentRepoPath:   z.string().default('.'),
  allowedRepoRoots: z.array(z.string()).optional(),
  workspaceEnabled: boolEnv(false),
  mcpTransport:    z.preprocess(
    (val) => (val === 'http' ? 'http' : val === 'stdio' ? 'stdio' : undefined),
    z.enum(['stdio', 'http']).default('stdio'),
  ),
  logLevel: z.preprocess(
    (val) => (typeof val === 'string' && ['debug', 'info', 'warn', 'error'].includes(val) ? val : undefined),
    z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  ),
  otelEnabled: boolEnv(false),
  authEnabled:             z.boolean().optional(),
  authOidcDiscoveryUrl:    z.string().url().optional(),
  authAuthorizationUrl:    z.string().url().optional(),
  authTokenUrl:            z.string().url().optional(),
  authJwksUri:             z.string().url().optional(),
  authIssuer:              z.string().optional(),
  authAudience:            z.string().optional(),
  authRequiredScopes:      z.array(z.string()).optional(),
  authServerUrl:           z.string().url().optional(),
  authResourceUrl:         z.string().url().optional(),
  authAllowedRedirectUris: z.array(z.string()).optional(),
}).superRefine((data, ctx) => {
  if (!data.authEnabled) return;
  if (!data.authIssuer) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'AUTH_ISSUER required when AUTH_ENABLED=true', path: ['authIssuer'] });
  }
  if (!data.authAudience) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'AUTH_AUDIENCE required when AUTH_ENABLED=true', path: ['authAudience'] });
  }
  if (!data.authOidcDiscoveryUrl) {
    if (!data.authAuthorizationUrl) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'AUTH_AUTHORIZATION_URL required when AUTH_ENABLED=true and AUTH_OIDC_DISCOVERY_URL not set', path: ['authAuthorizationUrl'] });
    }
    if (!data.authTokenUrl) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'AUTH_TOKEN_URL required when AUTH_ENABLED=true and AUTH_OIDC_DISCOVERY_URL not set', path: ['authTokenUrl'] });
    }
    if (!data.authJwksUri) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'AUTH_JWKS_URI required when AUTH_ENABLED=true and AUTH_OIDC_DISCOVERY_URL not set', path: ['authJwksUri'] });
    }
  }
});

export type Config = z.infer<typeof ConfigSchema>;

function loadConfigFromFile(path: string): Record<string, unknown> {
  try {
    const raw = readFileSync(path, 'utf-8');
    return JSON.parse(raw) as Record<string, unknown>;
  } catch (err) {
    throw new Error(`Failed to load CONFIG_FILE at ${path}: ${(err as Error).message}`);
  }
}

function envVals(): Record<string, unknown> {
  const authEnabledRaw = process.env['AUTH_ENABLED'];
  const authRequiredRaw = process.env['AUTH_REQUIRED_SCOPES'];
  const authRedirectRaw = process.env['AUTH_ALLOWED_REDIRECT_URIS'];
  const allowedRepoRootsRaw = process.env['AGENT_ALLOWED_REPO_ROOTS'];
  const raw: Record<string, unknown> = {
    port:            process.env['PORT'],
    agentAdapter:    process.env['AGENT_ADAPTER'],
    agentModel:      process.env['AGENT_MODEL'] || undefined,
    agentTimeoutMs:  process.env['AGENT_TIMEOUT_MS'],
    agentIdleExitMs: process.env['AGENT_IDLE_EXIT_MS'],
    agentForce:      process.env['AGENT_FORCE'],
    agentRepoPath:   process.env['AGENT_REPO_PATH'],
    workspaceEnabled: process.env['WORKSPACE_ENABLED'],
    allowedRepoRoots: allowedRepoRootsRaw
      ? allowedRepoRootsRaw.split(',').map((s) => s.trim()).filter(Boolean)
      : undefined,
    mcpTransport:    process.env['MCP_TRANSPORT'],
    logLevel:        process.env['LOG_LEVEL'],
    otelEnabled: process.env['OTEL_ENABLED'],
    authEnabled: authEnabledRaw !== undefined
      ? ['true', '1', 'yes', 'on'].includes(authEnabledRaw.toLowerCase())
      : undefined,
    authOidcDiscoveryUrl:  process.env['AUTH_OIDC_DISCOVERY_URL'] || undefined,
    authAuthorizationUrl:  process.env['AUTH_AUTHORIZATION_URL'] || undefined,
    authTokenUrl:          process.env['AUTH_TOKEN_URL'] || undefined,
    authJwksUri:           process.env['AUTH_JWKS_URI'] || undefined,
    authIssuer:            process.env['AUTH_ISSUER'] || undefined,
    authAudience:          process.env['AUTH_AUDIENCE'] || undefined,
    authRequiredScopes: authRequiredRaw
      ? authRequiredRaw.split(',').map((s) => s.trim()).filter(Boolean)
      : undefined,
    authServerUrl:    process.env['AUTH_SERVER_URL'] || undefined,
    authResourceUrl:  process.env['AUTH_RESOURCE_URL'] || undefined,
    authAllowedRedirectUris: authRedirectRaw
      ? authRedirectRaw.split(',').map((s) => s.trim()).filter(Boolean)
      : undefined,
  };
  // Strip undefined so JSON file values are not accidentally overwritten
  return Object.fromEntries(Object.entries(raw).filter(([, v]) => v !== undefined));
}

/**
 * Parses nested `ROUTING__<PROFILE>__<FIELD>` env vars (pydantic-settings `env_nested_delimiter`
 * style) into a partial routing object, e.g. `ROUTING__COMPLEX__ADAPTER=cursor` →
 * `{ COMPLEX: { adapter: 'cursor' } }`. Returns `undefined` when no such vars are set.
 */
function envRouting(): Record<string, Record<string, string>> | undefined {
  const out: Record<string, Record<string, string>> = {};
  // Present env keys always map to string values; narrow once to avoid a dead undefined-check.
  const env = process.env as Record<string, string>;
  for (const [key, val] of Object.entries(env)) {
    const match = /^ROUTING__([A-Z]+)__([A-Z]+)$/.exec(key);
    if (!match) continue;
    (out[match[1]] ??= {})[match[2].toLowerCase()] = val;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/**
 * Deep-merges the `routing` block so env overrides individual leaves of the file value
 * (env > file per leaf), rather than replacing the whole object. Returns `undefined` when
 * neither source provides routing.
 */
function mergeRouting(
  fileRouting: unknown,
  env: Record<string, Record<string, string>> | undefined,
): Record<string, unknown> | undefined {
  const base = (typeof fileRouting === 'object' && fileRouting !== null)
    ? (fileRouting as Record<string, Record<string, unknown>>)
    : undefined;
  if (base === undefined && env === undefined) return undefined;
  const merged: Record<string, unknown> = { ...(base ?? {}) };
  for (const [profile, fields] of Object.entries(env ?? {})) {
    merged[profile] = { ...(base?.[profile] ?? {}), ...fields };
  }
  return merged;
}

async function fetchOidcDiscovery(url: string): Promise<OidcDiscovery> {
  let res: Response;
  try {
    res = await fetch(url);
  } catch (err) {
    throw new Error(`OIDC discovery unreachable: ${url} — ${(err as Error).message}`);
  }
  if (!res.ok) {
    throw new Error(`OIDC discovery failed: ${url} → HTTP ${res.status}`);
  }
  return res.json() as Promise<OidcDiscovery>;
}

async function hydrateFromDiscovery(config: Config): Promise<Config> {
  const discovered = await fetchOidcDiscovery(config.authOidcDiscoveryUrl!);
  return {
    ...config,
    authAuthorizationUrl: config.authAuthorizationUrl ?? discovered.authorization_endpoint,
    authTokenUrl:         config.authTokenUrl ?? discovered.token_endpoint,
    authJwksUri:          config.authJwksUri ?? discovered.jwks_uri,
  };
}

export async function loadConfig(): Promise<Config> {
  const fileVals = process.env['CONFIG_FILE'] ? loadConfigFromFile(process.env['CONFIG_FILE']) : {};
  const merged = Object.assign({}, fileVals, envVals());
  const routing = mergeRouting(fileVals['routing'], envRouting());
  if (routing !== undefined) {
    merged['routing'] = routing;
  }
  const result = ConfigSchema.safeParse(merged);
  if (!result.success) {
    const fields = result.error.flatten().fieldErrors;
    throw new Error(`Invalid configuration:\n${JSON.stringify(fields, null, 2)}`);
  }

  let config = result.data;

  if (!config.authServerUrl) {
    config = { ...config, authServerUrl: `http://localhost:${config.port}` };
  }
  if (!config.authResourceUrl) {
    config = { ...config, authResourceUrl: new URL('/mcp', config.authServerUrl).href };
  }

  if (config.authEnabled && config.authOidcDiscoveryUrl) {
    return hydrateFromDiscovery(config);
  }
  return config;
}
