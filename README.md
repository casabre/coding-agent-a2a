# coding-agent-a2a

A2A + MCP server that wraps any supported coding-agent CLI (Cursor, Claude Code) and exposes it to orchestrators over **two protocols simultaneously** on the same port:

| Protocol | Transport | Who uses it |
|----------|-----------|-------------|
| **A2A** v0.3.0 | HTTP JSON-RPC 2.0 + SSE | Claude Code, any A2A-compatible orchestrator |
| **MCP** | stdio or HTTP (`/mcp`) | Claude Desktop, any MCP host |

Both protocols share the same underlying adapter, runner, and process-lifecycle logic.

---

## Quick start

### Prerequisites

- Node.js 20 or later
- One supported CLI on your `PATH` (or set the path explicitly via env var):
  - `cursor-agent` — [Cursor](https://cursor.sh) agent CLI
  - `claude` — [Claude Code](https://claude.ai/code) CLI
  - `vibe` — [Mistral Vibe](https://docs.mistral.ai/mistral-vibe/terminal) CLI
  - `codex` — [Codex](https://codex.sh) CLI
  - `opencode` — [OpenCode](https://github.com/saoudrizwan/OpenCode) CLI
  - Any custom CLI via the `generic` adapter

### Install and run

```bash
git clone https://github.com/casabre/coding-agent-a2a
cd coding-agent-a2a
npm install
npm run build
```

Copy and edit the example env file:

```bash
cp .env.example .env
# Set at minimum: AGENT_ADAPTER and AGENT_REPO_PATH
```

Start the server:

```bash
npm start
# coding-agent-a2a v0.1.0
# adapter:       cursor
# A2A endpoint:  http://localhost:41242/a2a/jsonrpc
# Agent Card:    http://localhost:41242/.well-known/agent-card.json
# MCP transport: stdio
```

### Use with Claude Desktop

See **[docs/deployment.md](docs/deployment.md#claude-desktop)** for step-by-step Claude Desktop configuration, or jump directly to **[docs/claude-desktop-config.md](docs/claude-desktop-config.md)**.

---

## Architecture overview

```mermaid
graph TB
    subgraph Clients["External clients"]
        MCPHost["MCP Host\n(Claude Desktop)"]
        A2AClient["A2A Orchestrator\n(Claude Code)"]
    end

    subgraph Server["coding-agent-a2a  :41242"]
        Health["GET /health\n(no auth)"]
        AgentCard["GET /.well-known/agent-card.json\n(no auth)"]
        AuthMeta["OAuth metadata + proxy\n/.well-known/* · /authorize · /token\n(no auth — public PKCE endpoints)"]
        AuthMW["Bearer auth middleware\n(when AUTH_ENABLED=true)"]
        A2ARoute["POST /a2a/jsonrpc\nA2A layer"]
        MCPRoute["stdio or /mcp\nMCP layer"]
        Runner["CursorRunner\nspawn + NDJSON parse"]
        Adapters["Adapters\ncursor · claude-code · vibe · codex · opencode · generic"]
    end

    IdP["Identity Provider\n(OIDC)"]
    CLI["cursor-agent  or  claude  or  vibe  or  codex  or  opencode"]

    MCPHost   -->|"stdio / HTTP"| MCPRoute
    A2AClient -->|"JSON-RPC + SSE"| A2ARoute
    MCPHost   -.->|"OAuth PKCE dance"| AuthMeta
    AuthMeta  -.->|"proxied"| IdP
    A2ARoute  --> AuthMW
    MCPRoute  --> AuthMW
    AuthMW    --> Runner
    Runner    --> Adapters
    Adapters  -->|spawn| CLI
```

For a detailed component breakdown, design decisions, and event-flow diagrams, see **[docs/architecture.md](docs/architecture.md)**.

---

## Environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `41242` | HTTP port (A2A and, when `MCP_TRANSPORT=http`, MCP) |
| `AGENT_ADAPTER` | `cursor` | `cursor` \| `claude-code` \| `vibe` \| `codex` \| `opencode` \| `generic` |
| `AGENT_MODEL` | — | Model override forwarded to the CLI |
| `AGENT_TIMEOUT_MS` | `120000` | Hard timeout per task (ms); `0` = disabled |
| `AGENT_IDLE_EXIT_MS` | `0` | Kill if no stdout for this long (ms); `0` = disabled |
| `AGENT_FORCE` | `true` | Skip shell-approval prompts (`-f` / `--dangerously-skip-permissions`) |
| `AGENT_REPO_PATH` | `.` | Working directory passed to the CLI as `cwd` |
| `MCP_TRANSPORT` | `stdio` | `stdio` (Claude Desktop spawns the process) or `http` |
| `LOG_LEVEL` | `info` | `debug` \| `info` \| `warn` \| `error` |
| `CONFIG_FILE` | — | Path to a JSON config file; env vars always override file values |
| `VIBE_BINARY_PATH` | `vibe` | Path to Vibe CLI binary |
| `CODEX_BINARY_PATH` | `codex` | Path to Codex CLI binary |
| `OPENCODE_BINARY_PATH` | `opencode` | Path to OpenCode CLI binary |
| `AGENT_BINARY` | — | Path to custom binary (required for `generic` adapter) |
| `AGENT_ARGS` | `""` | Default arguments for custom binary (double-quoted strings supported) |
| `AGENT_APPROVAL_PATTERN` | — | Regex pattern to detect approval prompts (for `generic` adapter) |
| `AGENT_APPROVAL_RESPONSE` | `y` | Response string for approval prompts (for `generic` adapter) |

**Authentication variables** (all optional; only used when `AUTH_ENABLED=true`):

| Variable | Default | Description |
|----------|---------|-------------|
| `AUTH_ENABLED` | `false` | Enable OAuth 2.0 Bearer auth on `/a2a/jsonrpc` and `/mcp` |
| `AUTH_OIDC_DISCOVERY_URL` | — | OIDC discovery URL; auto-fills the three URLs below |
| `AUTH_AUTHORIZATION_URL` | — | IdP `/authorize` endpoint (required if no discovery URL) |
| `AUTH_TOKEN_URL` | — | IdP `/token` endpoint (required if no discovery URL) |
| `AUTH_JWKS_URI` | — | IdP JWKS endpoint for token verification (required if no discovery URL) |
| `AUTH_ISSUER` | — | Expected `iss` claim (required when `AUTH_ENABLED=true`) |
| `AUTH_AUDIENCE` | — | Expected `aud` claim (required when `AUTH_ENABLED=true`) |
| `AUTH_REQUIRED_SCOPES` | — | Comma-separated scopes required on incoming tokens (e.g. `agent:run`) |
| `AUTH_SERVER_URL` | `http://localhost:PORT` | This server as Authorization Server (OAuth metadata issuer URL) |
| `AUTH_RESOURCE_URL` | `AUTH_SERVER_URL/mcp` | This server as Resource Server (RFC 9728) |
| `AUTH_ALLOWED_REDIRECT_URIS` | — | Comma-separated allowed redirect URIs; if unset, IdP validates |

Full configuration reference with validation rules: **[docs/deployment.md#configuration](docs/deployment.md#configuration)**.

### Authentication

By default (`AUTH_ENABLED=false`) all routes are open — suitable for local development and trusted-network deployments.

Set `AUTH_ENABLED=true` to require OAuth 2.0 Bearer tokens on:
- `POST /a2a/jsonrpc` — A2A JSON-RPC surface
- `POST|GET|DELETE /mcp` — MCP HTTP transport (when `MCP_TRANSPORT=http`)

The `stdio` MCP path is never affected by auth (the process is spawned directly by Claude Desktop — process-level trust).

The server mounts a full OAuth 2.0 proxy via the MCP SDK's `ProxyOAuthServerProvider`, so MCP clients (Claude Desktop, Claude Code) get standard `/.well-known/oauth-authorization-server` discovery and a complete Authorization Code + PKCE dance through to your IdP — without you implementing any OAuth logic.

#### Quickest setup — OIDC discovery URL

```bash
AUTH_ENABLED=true
AUTH_OIDC_DISCOVERY_URL=https://idp.example.com/.well-known/openid-configuration
AUTH_ISSUER=https://idp.example.com
AUTH_AUDIENCE=coding-agent
```

This auto-populates `AUTH_AUTHORIZATION_URL`, `AUTH_TOKEN_URL`, and `AUTH_JWKS_URI` from the IdP's discovery document at startup.

#### Manual URL setup (no discovery URL)

```bash
AUTH_ENABLED=true
AUTH_AUTHORIZATION_URL=https://idp.example.com/authorize
AUTH_TOKEN_URL=https://idp.example.com/token
AUTH_JWKS_URI=https://idp.example.com/.well-known/jwks.json
AUTH_ISSUER=https://idp.example.com
AUTH_AUDIENCE=coding-agent
```

#### OAuth endpoints exposed by this server

When `AUTH_ENABLED=true`, the following endpoints are mounted automatically (no auth required on them — these are public metadata/proxy endpoints):

| Endpoint | Description |
|----------|-------------|
| `GET /.well-known/oauth-authorization-server` | OAuth server metadata (RFC 8414) |
| `GET /.well-known/oauth-protected-resource` | Resource server metadata (RFC 9728) |
| `GET /authorize` | Proxies to IdP authorize endpoint |
| `POST /token` | Proxies to IdP token endpoint |

#### Production notes

- `AUTH_SERVER_URL` must be HTTPS in production (the MCP SDK enforces this). `localhost` is whitelisted for development.
- Restrict redirect URIs with `AUTH_ALLOWED_REDIRECT_URIS` for public deployments; if unset, redirect URI validation is delegated to the IdP.
- CORS is set to `*` on all auth/discovery endpoints (intentional — these serve public PKCE-protected flows). Use a reverse proxy (nginx, Caddy) if you need restricted CORS.

---

### Using Different Adapters

#### Vibe CLI
```bash
export AGENT_ADAPTER=vibe
export VIBE_BINARY_PATH=/path/to/vibe  # Optional, defaults to "vibe"
export AGENT_REPO_PATH=/path/to/repo
npm start
```

#### Codex CLI
```bash
export AGENT_ADAPTER=codex
export CODEX_BINARY_PATH=/path/to/codex  # Optional, defaults to "codex"
export AGENT_REPO_PATH=/path/to/repo
npm start
```

#### OpenCode CLI
```bash
export AGENT_ADAPTER=opencode
export OPENCODE_BINARY_PATH=/path/to/opencode  # Optional, defaults to "opencode"
export AGENT_REPO_PATH=/path/to/repo
npm start
```

#### Custom CLI (Generic Adapter)
```bash
export AGENT_ADAPTER=generic
export AGENT_BINARY=/path/to/your-agent  # Required
export AGENT_ARGS="--stream --model my-model"  # Optional: default args
export AGENT_APPROVAL_PATTERN="\[Y\/n\]"  # Optional: custom approval pattern
export AGENT_APPROVAL_RESPONSE="yes"  # Optional: custom approval response
npm start
```

> **Note:** The `generic` adapter assumes your CLI produces NDJSON-compatible streaming output. All built-in adapters (`cursor`, `claude-code`, `vibe`, `codex`, `opencode`) use the same NDJSON event parser.

---

## MCP tools

| Tool | Description |
|------|-------------|
| `coding_agent_run` | Submit a coding task; returns `job_id` immediately |
| `coding_agent_poll` | Poll new events since a given line offset |
| `coding_agent_result` | Retrieve the final result and clean up the job |
| `coding_agent_cancel` | Cancel a running job |
| `coding_agent_info` | Return adapter name, capabilities, and server version |

Full parameter schemas and examples: **[docs/api/mcp-tools.md](docs/api/mcp-tools.md)**.

---

## A2A protocol

The A2A surface exposes one skill (`code-task`) and supports streaming via `message/stream`.

| Endpoint | Auth | Description |
|----------|------|-------------|
| `GET /health` | none | Liveness probe — returns `{"status":"ok","adapter":"<name>"}` |
| `GET /.well-known/agent-card.json` | none | A2A agent card (spec-required, always public) |
| `POST /a2a/jsonrpc` | Bearer (when `AUTH_ENABLED=true`) | JSON-RPC 2.0 + SSE streaming |

Full method reference, event shapes, and state machine: **[docs/api/a2a.md](docs/api/a2a.md)**.

---

## Development

See **[docs/development.md](docs/development.md)** for:
- Local dev setup
- Test strategy (unit / integration / e2e)
- How to add a new adapter

See **[CONTRIBUTING.md](CONTRIBUTING.md)** for the PR process and code standards.

---

## Credits

Event-mapping patterns and protocol wiring inspired by:

- **cursor-agent-mcp** by sailay1996 — MIT License ([LICENSES/cursor-agent-mcp.LICENSE](LICENSES/cursor-agent-mcp.LICENSE))
- **A2A-MCP-Server** by GongRzhe — Apache 2.0 License ([LICENSES/a2a-mcp-server.LICENSE](LICENSES/a2a-mcp-server.LICENSE))
