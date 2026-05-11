# Deployment Guide

This guide covers everything needed to run coding-agent-a2a in production or locally: prerequisites, installation, configuration, transport modes, and Claude Desktop integration.

---

## Table of contents

1. [Prerequisites](#1-prerequisites)
2. [Installation](#2-installation)
3. [Configuration](#3-configuration)
4. [Transport modes](#4-transport-modes)
5. [Claude Desktop](#5-claude-desktop)
6. [Health checking](#6-health-checking)
7. [Logging and monitoring](#7-logging-and-monitoring)
8. [Troubleshooting](#8-troubleshooting)

---

## 1. Prerequisites

| Requirement | Version | Notes |
|-------------|---------|-------|
| Node.js | ≥ 20 | LTS recommended |
| npm | ≥ 10 | Bundled with Node.js 20 |
| cursor-agent | any | Required when `AGENT_ADAPTER=cursor` |
| claude (Claude Code CLI) | any | Required when `AGENT_ADAPTER=claude-code` |

Install the CLI for your chosen adapter:

```bash
# Cursor
npm install -g cursor-agent   # or follow Cursor's docs

# Claude Code
npm install -g @anthropic-ai/claude-code
```

Verify the CLI is reachable:

```bash
cursor-agent --version
claude --version
```

---

## 2. Installation

### From npm (production)

```bash
npm install -g coding-agent-a2a
coding-agent-a2a
```

When installed globally, `coding-agent-a2a` is available as a binary.

### From source

```bash
git clone https://github.com/casabre/coding-agent-a2a
cd coding-agent-a2a
npm install
npm run build
npm start
```

---

## 3. Configuration

All configuration is through environment variables. Copy `.env.example` as a starting point:

```bash
cp .env.example .env
```

### Full reference

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `PORT` | number | `41242` | HTTP port. Both A2A and (when `MCP_TRANSPORT=http`) MCP listen here. |
| `AGENT_ADAPTER` | string | `cursor` | Which CLI adapter to use. Must be `cursor` or `claude-code`. |
| `CURSOR_AGENT_PATH` | string | `cursor-agent` | Full path to the cursor-agent binary. Only used when `AGENT_ADAPTER=cursor`. |
| `CLAUDE_CODE_PATH` | string | `claude` | Full path to the Claude Code binary. Only used when `AGENT_ADAPTER=claude-code`. |
| `AGENT_MODEL` | string | _(CLI default)_ | Model override forwarded to the CLI (e.g. `claude-opus-4-5`). Leave blank to use the CLI's configured default. |
| `AGENT_TIMEOUT_MS` | number | `120000` | Hard timeout per task in milliseconds. The process is killed and the task fails after this duration. Set to `0` to disable. |
| `AGENT_IDLE_EXIT_MS` | number | `0` | Idle-kill threshold in milliseconds. The process is killed if no stdout arrives for this long. `0` disables idle detection. Useful to recover from hung processes. |
| `AGENT_FORCE` | boolean | `true` | When `true`, the CLI skips all shell-command approval prompts (`-f` / `--dangerously-skip-permissions`). When `false`, tasks may pause in `input-required` state awaiting approval. |
| `AGENT_REPO_PATH` | string | `.` | Absolute path used as the CLI's working directory. Should point to the repository the agent will edit. |
| `MCP_TRANSPORT` | string | `stdio` | MCP transport mode. See [Transport modes](#4-transport-modes). |
| `LOG_LEVEL` | string | `info` | Logging verbosity: `debug` \| `info` \| `warn` \| `error`. Use `debug` to see unparsed CLI lines. |

### Validation rules

- `PORT`, `AGENT_TIMEOUT_MS`, `AGENT_IDLE_EXIT_MS` must be non-negative integers.
- `AGENT_ADAPTER` must be `cursor` or `claude-code` (case-sensitive).
- `MCP_TRANSPORT` defaults to `stdio` for any value other than `http`.
- `AGENT_FORCE` accepts `true`, `1`, `yes`, `on` (case-insensitive) as truthy; anything else is falsy.

The process exits with code 1 on a configuration error and logs a human-readable message.

---

## 4. Transport modes

### `MCP_TRANSPORT=stdio` (default — local use)

The process exposes:
- **MCP over stdin/stdout** — the parent process (e.g. Claude Desktop) communicates via the Stdio transport.
- **A2A over HTTP** on `PORT` — any A2A client can reach it at `http://localhost:PORT/a2a/jsonrpc`.

In this mode the process is typically managed by Claude Desktop, which starts it on demand and restarts it on crash.

### `MCP_TRANSPORT=http` (server mode)

The process exposes both protocols over HTTP on `PORT`:
- **A2A** at `POST /a2a/jsonrpc`
- **MCP** at `POST|GET|DELETE /mcp` (Streamable HTTP transport)

Start the server:

```bash
MCP_TRANSPORT=http AGENT_ADAPTER=cursor AGENT_REPO_PATH=/path/to/repo node dist/index.js
```

Claude Desktop connects with a URL instead of spawning a process:

```json
{
  "mcpServers": {
    "coding-agent-a2a": {
      "url": "http://localhost:41242/mcp"
    }
  }
}
```

---

## 5. Claude Desktop

For full step-by-step instructions including JSON config snippets for both modes, see **[claude-desktop-config.md](claude-desktop-config.md)**.

**Quick summary for stdio mode** — add to `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS):

```json
{
  "mcpServers": {
    "coding-agent-a2a": {
      "command": "node",
      "args": ["/absolute/path/to/coding-agent-a2a/dist/index.js"],
      "env": {
        "MCP_TRANSPORT": "stdio",
        "AGENT_ADAPTER": "cursor",
        "AGENT_REPO_PATH": "/absolute/path/to/your/repo",
        "PORT": "41242"
      }
    }
  }
}
```

Restart Claude Desktop after editing the config.

---

## 6. Health checking

There is no dedicated `/health` endpoint. Use the agent card as a liveness probe:

```bash
curl -f http://localhost:41242/.well-known/agent-card.json
```

Returns `200 OK` with the agent card JSON when the server is running and ready.

For monitoring systems, poll this endpoint every 30 s. A non-200 or connection error indicates the process is down.

---

## 7. Logging and monitoring

### Log levels

| `LOG_LEVEL` | What is logged |
|-------------|----------------|
| `error` | Fatal errors and configuration failures |
| `warn` | Non-fatal issues (e.g. unknown taskId for cancel, executor warnings) |
| `info` | Startup banner (adapter, port, transport) |
| `debug` | All of the above + unparsed CLI lines skipped by the NDJSON parser |

Use `debug` when troubleshooting NDJSON parsing issues. Avoid in production — it can be noisy.

### Startup output

On successful start, the server logs:

```
coding-agent-a2a v0.1.0
adapter:       cursor
A2A endpoint:  http://localhost:41242/a2a/jsonrpc
Agent Card:    http://localhost:41242/.well-known/agent-card.json
MCP transport: stdio
```

### Key metrics to watch (production)

| Signal | How to capture |
|--------|----------------|
| Process alive | Poll `GET /.well-known/agent-card.json` |
| Task failures | Watch for `"state":"failed"` in A2A SSE streams or `kind:"error"` in MCP poll responses |
| Process crashes | Systemd / PM2 restart count; alert on rapid restarts |
| Task duration | Measure time from `coding_agent_run` to `done: true` in `coding_agent_poll` |

---

## 8. Troubleshooting

### The server starts but the CLI process fails immediately

**Symptom:** Tasks fail with `"Failed to spawn"` or similar.

**Checks:**
1. Verify the CLI is on `PATH`: `which cursor-agent` / `which claude`
2. Or set the explicit path: `CURSOR_AGENT_PATH=/path/to/cursor-agent`
3. Verify the CLI runs interactively: `cursor-agent --version`
4. Check that `AGENT_REPO_PATH` exists and is readable.

### NDJSON parsing errors / no events

**Symptom:** Tasks run but produce no `thinking` or `done` events.

**Checks:**
1. Set `LOG_LEVEL=debug` to see all raw CLI lines.
2. Verify the CLI supports `--output-format stream-json`:
   ```bash
   cursor-agent --print --output-format stream-json "echo hello" 2>&1 | head -5
   ```
3. Confirm the first line is a JSON object (e.g. `{"type":"system/init",...}`).

### Tasks time out unexpectedly

**Symptom:** Tasks fail with exit code -1 or a timeout message.

**Checks:**
1. Check `AGENT_TIMEOUT_MS` — the default is 2 minutes. Increase for long tasks.
2. If tasks appear to hang with no output, also check `AGENT_IDLE_EXIT_MS`.

### Claude Desktop does not show MCP tools

**Checks:**
1. Verify the path in `claude_desktop_config.json` points to `dist/index.js` (after `npm run build`).
2. Open Claude Desktop's MCP logs (Settings → Developer → MCP Logs).
3. Try `MCP_TRANSPORT=http` and test with the MCP inspector before configuring Claude Desktop.

### Port already in use

```
Error: listen EADDRINUSE :::41242
```

Either change `PORT` in `.env`, or identify and stop the conflicting process:

```bash
lsof -i :41242
```
