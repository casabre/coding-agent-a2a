# Changelog

All notable changes to coding-agent-a2a are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versions follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html) and are derived from git tags at release time.

---

## [Unreleased]

---

## [0.1.0] — 2026-05-10

Initial release.

### Added

**Core server**
- Express HTTP server exposing A2A v0.3.0 and MCP on the same port.
- `GET /.well-known/agent-card.json` — A2A agent discovery endpoint.
- `POST /a2a/jsonrpc` — A2A JSON-RPC 2.0 handler (`message/send`, `message/stream`, `tasks/get`, `tasks/cancel`).
- `POST|GET|DELETE /mcp` — MCP Streamable HTTP transport endpoint.

**Dual-transport MCP**
- `MCP_TRANSPORT=stdio` — Claude Desktop can spawn the process directly; MCP is handled over stdio while A2A runs on HTTP.
- `MCP_TRANSPORT=http` — both protocols share the HTTP port.

**MCP tools**
- `coding_agent_run` — submits a task, returns `job_id` immediately.
- `coding_agent_poll` — incremental event polling with `sinceLine` offset.
- `coding_agent_result` — retrieves final summary and cleans up the job.
- `coding_agent_cancel` — terminates a running job.
- `coding_agent_info` — returns adapter name, capabilities, and server version.

**Adapters**
- `cursor` adapter — wraps `cursor-agent --print --output-format stream-json`.
- `claude-code` adapter — wraps `claude --print --output-format stream-json`.
- Shared NDJSON parser for event types: `system/init`, `assistant`, `tool_use`, `tool_result`, `result`, `error`.

**Process management**
- Hard timeout (`AGENT_TIMEOUT_MS`).
- Idle-kill timer (`AGENT_IDLE_EXIT_MS`).
- Graceful cancellation: SIGTERM → SIGKILL after 2 s.
- `approval_required` events when `AGENT_FORCE=false`.

**Event bus**
- Process-wide pub/sub (`EventBus`) with per-job and wildcard channels.

**CI/CD**
- GitHub Actions: parallel lint + typecheck + test gates; build gate after all pass.
- Tag-triggered npm publish with version derived from the git tag.
- 100% line, branch, and function coverage enforced in CI.

[Unreleased]: https://github.com/casabre/coding-agent-a2a/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/casabre/coding-agent-a2a/releases/tag/v0.1.0
