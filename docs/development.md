# Development Guide

This document explains how the codebase is structured, how to work with it locally, and how the test suite is organised.

For contribution rules (PR process, code standards, how to add an adapter) see [CONTRIBUTING.md](../CONTRIBUTING.md).
For module responsibilities and design decisions see [architecture.md](architecture.md).

---

## Table of contents

1. [Local setup](#1-local-setup)
2. [Project structure](#2-project-structure)
3. [Test strategy](#3-test-strategy)
4. [Running specific tests](#4-running-specific-tests)
5. [Adding a new adapter](#5-adding-a-new-adapter)
6. [Event flow walkthrough](#6-event-flow-walkthrough)
7. [Adapters quick reference](#7-adapters-quick-reference)

---

## 1. Local setup

```bash
git clone https://github.com/casabre/coding-agent-a2a
cd coding-agent-a2a
npm install
npm run build           # compile TypeScript → dist/
cp .env.example .env    # then edit AGENT_ADAPTER and AGENT_REPO_PATH
npm run dev             # tsx watch — recompiles on save
```

All npm scripts:

| Script | Description |
|--------|-------------|
| `npm run build` | Compile TypeScript to `dist/` |
| `npm run typecheck` | Type-check without emitting (fast) |
| `npm run dev` | Watch mode with hot reload |
| `npm start` | Run the compiled build |
| `npm test` | Run unit + integration tests once |
| `npm run test:watch` | Rerun tests on file change |
| `npm run test:coverage` | Run with coverage report (enforces 100%) |
| `npm run test:e2e` | End-to-end tests (requires CLI on PATH) |
| `npm run lint` | ESLint |

---

## 2. Project structure

```
src/
├── index.ts              Entry point
├── config.ts             Env-var parsing → Config
├── types.ts              Shared interfaces (Config)
├── combined-server.ts    Express app factory (A2A + MCP/HTTP)
├── server.ts             A2A-only Express app factory
├── agent-card.ts         A2A AgentCard builder
├── agent-task-executor.ts    A2A AgentExecutor (spawns runner per task)
├── process-runner.ts      Child-process manager + NDJSON stream parser
├── a2a-mapper.ts         Pure: AgentEvent → A2A SDK event(s)
├── event-bus.ts          Process-wide pub/sub (EventBus singleton)
│
├── adapters/
│   ├── base.ts           CodingAgentAdapter interface + AgentEvent union
│   ├── cursor.ts         Cursor adapter
│   ├── claude-code.ts    Claude Code adapter
│   ├── index.ts          Adapter registry (resolveAdapter)
│   └── ndjson-helpers.ts Shared NDJSON event parser
│
└── mcp/
    ├── server.ts         createMcpServer
    ├── tools.ts          registerTools (5 MCP tools)
    ├── task-manager.ts   McpTaskManager (UUID job store)
    ├── stdio-transport.ts Connect McpServer to stdio
    └── http-transport.ts StreamableHTTPServerTransport factory

tests/
├── unit/
│   ├── a2a-mapper.test.ts
│   ├── config.test.ts
│   ├── agent-task-executor.test.ts
│   ├── process-runner.test.ts
│   ├── event-bus.test.ts
│   ├── adapters/
│   │   ├── cursor.test.ts
│   │   ├── claude-code.test.ts
│   │   ├── ndjson-helpers.test.ts
│   │   └── index.test.ts
│   └── mcp/
│       ├── server.test.ts
│       ├── task-manager.test.ts
│       └── tools.test.ts
├── integration/
│   ├── server.test.ts
│   ├── combined-server.test.ts
│   └── stdio-transport.test.ts
└── e2e/
    └── full-flow.test.ts   (requires CURSOR_E2E=1)
```

---

## 3. Test strategy

The test suite follows a strict pyramid: many unit tests, a handful of integration tests, and optional e2e tests guarded behind an env var.

### Unit tests

Each `src/` module has a corresponding unit test. External I/O is mocked:

- **`process-runner.test.ts`** — `node:child_process.spawn` is mocked via `vi.mock`. A controllable `EventEmitter` with mock `stdout`/`stderr`/`stdin` streams stands in for the real child process. Tests verify NDJSON parsing, timeout logic, idle-kill, SIGTERM/SIGKILL sequencing.

- **`a2a-mapper.test.ts`** — No mocks. The mapper is a pure function; all 17 cases assert the exact A2A event shape returned for each `AgentEvent` variant.

- **`agent-task-executor.test.ts`** — Both `process-runner.js` and `a2a-mapper.js` are mocked. Tests assert that the executor wires events correctly, handles cancellation, and cleans up the runner map.

- **`mcp/task-manager.test.ts`** — `process-runner.js` and `event-bus.js` are mocked. Tests cover the full job lifecycle: `startJob` → `pollJob` → `getResult` / `cancelJob`.

- **`mcp/tools.test.ts`** — `McpTaskManager` is a mock object. Tests call each tool via an in-memory MCP client (`InMemoryTransport.createLinkedPair()`) and assert the JSON responses.

- **`config.test.ts`** — Manipulates `process.env` directly. Tests cover all env vars, edge cases (empty string, invalid numbers), and the `LOG_LEVEL` passthrough.

- **`event-bus.test.ts`** — Tests `emitJobEvent`, `onJobEvent`, `onAllJobEvents`, and that unsubscribe functions work.

### Integration tests

- **`server.test.ts`** — Starts the full Express app with `supertest`. Uses a mock `AgentExecutor` that publishes controlled event sequences. Tests all HTTP surface: agent card, JSON-RPC error handling, A2A methods.

- **`combined-server.test.ts`** — Starts the combined A2A + MCP/HTTP app on a random port. Tests that both protocols respond correctly on the same server instance, using a real `Client` from `@modelcontextprotocol/sdk`.

- **`stdio-transport.test.ts`** — Tests the MCP server tools via in-memory transport. Verifies `coding_agent_info` returns the correct adapter and that tool names match the expected set.

### Coverage enforcement

`vitest.config.ts` sets `thresholds: { lines: 100, branches: 100, functions: 100 }`. CI fails if any threshold is not met. Type-only files (`types.ts`, `adapters/base.ts`) and the entry point (`index.ts`) are excluded from the thresholds.

### Mocking pattern for `vi.mock` with EventEmitter

Several tests mock `ProcessRunner` using Vitest's module mock with a shared singleton:

```typescript
vi.mock('../../src/process-runner.js', async () => {
  const { EventEmitter } = await import('node:events');
  const instance = new EventEmitter() as EventEmitter & {
    start: ReturnType<typeof vi.fn>;
    cancel: ReturnType<typeof vi.fn>;
  };
  instance.start = vi.fn();
  instance.cancel = vi.fn();
  const ProcessRunner = vi.fn(() => instance);
  return { ProcessRunner, __instance: instance };
});
```

The `__instance` export lets tests emit events on the mock runner and assert downstream behaviour:

```typescript
getMockRunner().emit('agent-event', { kind: 'thinking', text: 'hello' });
expect(vi.mocked(eventBus.emitJobEvent)).toHaveBeenCalledWith(jobId, { kind: 'thinking', text: 'hello' });
```

---

## 4. Running specific tests

Run a single test file:

```bash
npx vitest run tests/unit/a2a-mapper.test.ts
```

Run tests matching a name pattern:

```bash
npx vitest run -t "pollJob"
```

Watch a single file:

```bash
npx vitest tests/unit/mcp/task-manager.test.ts
```

---

## 5. Adding a new adapter

See [CONTRIBUTING.md § Adding a new adapter](../CONTRIBUTING.md#4-adding-a-new-adapter) for the full step-by-step guide.

In brief:
1. Create `src/adapters/my-agent.ts` implementing `CodingAgentAdapter`.
2. Register it in `src/adapters/index.ts`.
3. Add `tests/unit/adapters/my-agent.test.ts` with 100% coverage.
4. Add the adapter name to `AGENT_ADAPTER` docs in `docs/deployment.md`.

The shared `parseSharedNdjsonEvent` in `ndjson-helpers.ts` handles the common `system/init` / `assistant` / `tool_use` / `tool_result` / `result` / `error` schema used by both Cursor and Claude Code. If your CLI uses the same schema, reuse it. If not, implement `parseEvent` directly.

---

## 6. Event flow walkthrough

Here is how a single task travels through the system from MCP call to CLI and back.

```
1. MCP host → coding_agent_run { task: "refactor auth" }

2. tools.ts → taskManager.startJob("refactor auth")

3. McpTaskManager:
   a. Generates jobId = "uuid-1234"
   b. Creates ProcessRunner({ task, adapter, config })
   c. Registers listeners on runner
   d. Calls runner.start()

4. ProcessRunner:
   a. Calls adapter.resolveBinary() → "cursor-agent"
   b. Calls adapter.buildArgv({ task, repoPath, ... }) →
      ["--print", "--output-format", "stream-json", "-f", "refactor auth"]
   c. Spawns: child_process.spawn("cursor-agent", [...args], { cwd, shell: false })

5. CLI writes to stdout:
   {"type":"system/init","model":"claude-opus-4-5"}

6. ProcessRunner:
   a. Reads buffered stdout line-by-line
   b. For each line: adapter.isApprovalPrompt(line) → false
   c. adapter.parseEvent(line) → { kind: 'init', model: 'claude-opus-4-5' }
   d. Emits 'agent-event', { kind: 'init', model: 'claude-opus-4-5' }

7. McpTaskManager receives 'agent-event':
   a. job.events.push(event)
   b. eventBus.emitJobEvent(jobId, event)

8. MCP host → coding_agent_poll { jobId: "uuid-1234", sinceLine: 0 }
   → taskManager.pollJob("uuid-1234", 0)
   ← { events: [{ kind: 'init', ... }], done: false }

9. ... more events arrive ...

10. CLI writes: {"type":"result","cost":{"input_tokens":1200,"output_tokens":300}}
    → runner emits 'agent-event', { kind: 'done', summary: '', stats: { inputTokens: 1200, ... } }
    → job.events.push(event)

11. CLI exits 0 → runner emits 'done', 0, ""
    → job.done = true; job.exitCode = 0

12. MCP host → coding_agent_result { jobId: "uuid-1234" }
    → taskManager.getResult("uuid-1234")
    ← { summary: '', stats: { inputTokens: 1200, ... }, done: true }
    → job removed from _jobs map
```

---

## 7. Adapters quick reference

| Adapter | `AGENT_ADAPTER` value | Binary env override | Force flag | Model flag |
|---------|----------------------|---------------------|------------|------------|
| Cursor | `cursor` | `CURSOR_AGENT_PATH` | `-f` | `-m <model>` |
| Claude Code | `claude-code` | `CLAUDE_CODE_PATH` | `--dangerously-skip-permissions` | `--model <model>` |

Both adapters use the same `--print --output-format stream-json` flags to enable NDJSON streaming.
