# A2A Protocol Reference

coding-agent-a2a implements [Google's Agent-to-Agent (A2A) protocol v0.3.0](https://google.github.io/A2A) using `@a2a-js/sdk` v0.3.13.

---

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/.well-known/agent-card.json` | Agent discovery — returns the AgentCard. |
| `POST` | `/a2a/jsonrpc` | JSON-RPC 2.0 handler — all A2A methods go here. |

---

## Agent Card

The agent card is the entry point for A2A discovery. Fetch it before calling any JSON-RPC method.

```bash
curl http://localhost:41242/.well-known/agent-card.json
```

```json
{
  "name": "coding-agent-a2a (cursor)",
  "description": "Delegates coding tasks to the cursor agent and streams results back via the A2A protocol.",
  "protocolVersion": "0.3.0",
  "version": "0.1.0",
  "url": "http://localhost:41242/a2a/jsonrpc",
  "capabilities": {
    "streaming": true,
    "pushNotifications": false,
    "stateTransitionHistory": true
  },
  "defaultInputModes": ["text/plain"],
  "defaultOutputModes": ["text/plain", "application/json"],
  "skills": [
    {
      "id": "code-task",
      "name": "Execute coding task",
      "description": "Runs a coding task (edit, refactor, analyse, explain, test) via a coding agent CLI.",
      "tags": ["coding", "refactor", "edit", "test"],
      "inputModes": ["text/plain"],
      "outputModes": ["text/plain", "application/json"],
      "examples": [
        "Refactor the auth module to use JWT",
        "Add unit tests for src/utils/date.ts",
        "Explain how the rate limiter works"
      ]
    }
  ]
}
```

`name` reflects the active adapter (e.g. `"claude-code"` when `AGENT_ADAPTER=claude-code`).

---

## JSON-RPC envelope

All A2A method calls use a standard JSON-RPC 2.0 envelope:

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "<method>",
  "params": { ... }
}
```

Responses follow the same envelope with a `result` or `error` field.

---

## Methods

### `message/send`

Sends a message and waits for the task to reach a terminal state before returning (blocking). Use for short tasks or when the client cannot process SSE.

**Request**

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "message/send",
  "params": {
    "message": {
      "kind": "message",
      "messageId": "msg-uuid",
      "role": "user",
      "parts": [{ "kind": "text", "text": "Add a health check endpoint" }]
    },
    "configuration": {
      "blocking": true
    }
  }
}
```

**Response** — the task in its final state:

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "kind": "task",
    "id": "task-uuid",
    "contextId": "ctx-uuid",
    "status": { "state": "completed", "timestamp": "2026-05-10T18:00:00Z" },
    "artifacts": [...],
    "history": [...]
  }
}
```

---

### `message/stream`

Sends a message and streams task updates as Server-Sent Events (SSE). Preferred for long-running tasks.

**Request**

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "message/stream",
  "params": {
    "message": {
      "kind": "message",
      "messageId": "msg-uuid",
      "role": "user",
      "parts": [{ "kind": "text", "text": "Refactor the auth module to use JWT" }]
    }
  }
}
```

**Response** — SSE stream (`Content-Type: text/event-stream`):

```
data: {"kind":"status-update","taskId":"task-uuid","contextId":"ctx-uuid","final":false,"status":{"state":"working","timestamp":"2026-05-10T18:00:00Z"}}

data: {"kind":"artifact-update","taskId":"task-uuid","contextId":"ctx-uuid","append":true,"artifact":{"artifactId":"art-uuid","name":"assistant-response","parts":[{"kind":"text","text":"I'll start by reading the auth module..."}]}}

data: {"kind":"status-update","taskId":"task-uuid","contextId":"ctx-uuid","final":false,"status":{"state":"working","timestamp":"2026-05-10T18:00:01Z","message":{"kind":"message","role":"agent","parts":[{"kind":"text","text":"Using tool: read_file"}]}}}

data: {"kind":"artifact-update","taskId":"task-uuid","contextId":"ctx-uuid","artifact":{"artifactId":"res-uuid","name":"result","parts":[{"kind":"data","data":{"summary":"Refactored auth.ts to use JWT."}}]}}

data: {"kind":"status-update","taskId":"task-uuid","contextId":"ctx-uuid","final":true,"status":{"state":"completed","timestamp":"2026-05-10T18:00:10Z"}}
```

The stream closes after the event with `"final": true`.

---

### `tasks/get`

Retrieves the current state of an existing task.

**Request**

```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "method": "tasks/get",
  "params": { "taskId": "task-uuid" }
}
```

**Response**

```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "result": {
    "kind": "task",
    "id": "task-uuid",
    "status": { "state": "working", "timestamp": "..." },
    ...
  }
}
```

Returns a JSON-RPC error (`-32001 TaskNotFound`) if the task does not exist.

---

### `tasks/cancel`

Cancels an in-progress task. The runner receives SIGTERM immediately; the task transitions to `canceled`.

**Request**

```json
{
  "jsonrpc": "2.0",
  "id": 3,
  "method": "tasks/cancel",
  "params": { "taskId": "task-uuid" }
}
```

Calling `tasks/cancel` on a task that is already in a terminal state (`completed`, `failed`, `canceled`) is a no-op.

---

## A2A events

Events streamed over SSE map to internal `AgentEvent`s as follows:

| `AgentEvent.kind` | A2A event | Notes |
|-------------------|-----------|-------|
| `init` | `status-update { state: 'working' }` | Always emitted. If `model` or `sessionId` present, also emits `artifact-update` with metadata. |
| `thinking` | `artifact-update` (name: `assistant-response`, `append: true`) | Text is appended; multiple chunks build up the full response. |
| `tool_use` | `status-update { state: 'working' }` | Message includes `"Using tool: <name>"`. |
| `tool_result` | `status-update { state: 'working' }` | Message includes a truncated tool output (≤200 chars). |
| `done` | `status-update { state: 'completed', final: true }` | If summary or stats present, also emits `artifact-update` with result data. |
| `error` | `status-update { state: 'failed', final: true }` | Message includes the error text. |
| `approval_required` | `status-update { state: 'input-required' }` | Not final; stream stays open. Respond by sending another message. |

---

## Task state machine

```
submitted
   │ execute() called
   ▼
working ◄──────────────────────────── (resume after input-required)
   │
   ├── agent exits 0 + done event ─────────► completed [terminal]
   ├── agent exits non-zero ────────────────► failed    [terminal]
   ├── error event ─────────────────────────► failed    [terminal]
   ├── timeout / idle expiry ───────────────► failed    [terminal]
   ├── tasks/cancel ────────────────────────► canceled  [terminal]
   └── approval_required event ─────────────► input-required
                                                 │
                                       message/send (with answer)
                                                 │
                                                 ▼
                                              working
```

---

## Resuming after `input-required`

When `AGENT_FORCE=false`, the CLI may pause and ask for shell-command approval. The task enters the `input-required` state.

To resume:

```json
{
  "jsonrpc": "2.0",
  "id": 4,
  "method": "message/send",
  "params": {
    "message": {
      "kind": "message",
      "messageId": "msg-2",
      "role": "user",
      "contextId": "<same contextId>",
      "parts": [{ "kind": "text", "text": "y" }]
    }
  }
}
```

The executor detects the existing runner for that `taskId` and calls `runner.resume("y")`, writing it to stdin.

---

## Error codes

| Code | Message | Cause |
|------|---------|-------|
| `-32700` | Parse error | Request body is not valid JSON. |
| `-32600` | Invalid request | Required JSON-RPC fields missing. |
| `-32601` | Method not found | Unknown A2A method. |
| `-32001` | TaskNotFound | `tasks/get` or `tasks/cancel` for unknown taskId. |

---

## Example: streaming request with curl

```bash
curl -N -X POST http://localhost:41242/a2a/jsonrpc \
  -H "Content-Type: application/json" \
  -H "Accept: text/event-stream" \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "message/stream",
    "params": {
      "message": {
        "kind": "message",
        "messageId": "test-1",
        "role": "user",
        "parts": [{"kind": "text", "text": "Explain the main function in src/index.ts"}]
      }
    }
  }'
```
