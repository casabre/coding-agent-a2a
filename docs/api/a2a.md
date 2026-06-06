# A2A Protocol Reference

coding-agent-a2a implements [Google's Agent-to-Agent (A2A) protocol v1.0](https://google.github.io/A2A) using `@a2a-js/sdk` v1.0.0-alpha.0.

---

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/.well-known/agent-card.json` | Agent discovery — returns the AgentCard. |
| `POST` | `/a2a/jsonrpc` | JSON-RPC 2.0 handler — all A2A methods go here. |

All JSON-RPC requests must include the header:

```
A2A-Version: 1.0
```

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
  "version": "0.1.0",
  "supportedInterfaces": [
    {
      "url": "http://localhost:41242/a2a/jsonrpc",
      "protocolVersion": "1.0"
    }
  ],
  "capabilities": {
    "streaming": true,
    "pushNotifications": false
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

### `SendMessage`

Sends a message and waits for the task to reach a terminal state before returning. Use for short tasks or when the client cannot process SSE.

**Request**

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "SendMessage",
  "params": {
    "message": {
      "messageId": "msg-uuid",
      "role": "ROLE_USER",
      "parts": [{ "text": "Add a health check endpoint" }]
    },
    "configuration": {
      "returnImmediately": false
    }
  }
}
```

**Response** — the task wrapped in `result.task`:

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "task": {
      "id": "task-uuid",
      "contextId": "ctx-uuid",
      "status": { "state": "TASK_STATE_COMPLETED", "timestamp": "2026-05-10T18:00:00Z" },
      "artifacts": [],
      "history": []
    }
  }
}
```

---

### `SendStreamingMessage`

Sends a message and streams task updates as Server-Sent Events (SSE). Preferred for long-running tasks.

**Request**

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "SendStreamingMessage",
  "params": {
    "message": {
      "messageId": "msg-uuid",
      "role": "ROLE_USER",
      "parts": [{ "text": "Refactor the auth module to use JWT" }]
    }
  }
}
```

**Response** — SSE stream (`Content-Type: text/event-stream`). Each event is a JSON-RPC result frame:

```
data: {"jsonrpc":"2.0","id":1,"result":{"statusUpdate":{"taskId":"task-uuid","contextId":"ctx-uuid","status":{"state":"TASK_STATE_WORKING","timestamp":"2026-05-10T18:00:00Z"}}}}

data: {"jsonrpc":"2.0","id":1,"result":{"artifactUpdate":{"taskId":"task-uuid","contextId":"ctx-uuid","artifact":{"artifactId":"art-uuid","name":"assistant-response","parts":[{"text":"I'll start by reading the auth module..."}]},"append":true,"lastChunk":false}}}

data: {"jsonrpc":"2.0","id":1,"result":{"statusUpdate":{"taskId":"task-uuid","contextId":"ctx-uuid","status":{"state":"TASK_STATE_WORKING","timestamp":"2026-05-10T18:00:01Z","message":{"role":"ROLE_AGENT","parts":[{"text":"Using tool: read_file"}]}}}}}

data: {"jsonrpc":"2.0","id":1,"result":{"artifactUpdate":{"taskId":"task-uuid","contextId":"ctx-uuid","artifact":{"artifactId":"res-uuid","name":"result","parts":[{"data":{"summary":"Refactored auth.ts to use JWT."}}]},"append":false,"lastChunk":true}}}

data: {"jsonrpc":"2.0","id":1,"result":{"statusUpdate":{"taskId":"task-uuid","contextId":"ctx-uuid","status":{"state":"TASK_STATE_COMPLETED","timestamp":"2026-05-10T18:00:10Z"}}}}
```

The stream closes after the `TASK_STATE_COMPLETED` (or `TASK_STATE_FAILED`) status update.

---

### `GetTask`

Retrieves the current state of an existing task.

**Request**

```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "method": "GetTask",
  "params": { "id": "task-uuid" }
}
```

**Response**

```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "result": {
    "task": {
      "id": "task-uuid",
      "status": { "state": "TASK_STATE_WORKING", "timestamp": "..." }
    }
  }
}
```

Returns a JSON-RPC error (`-32001 TaskNotFound`) if the task does not exist.

---

### `CancelTask`

Cancels an in-progress task. The runner receives SIGTERM immediately; the task transitions to `TASK_STATE_CANCELED`.

**Request**

```json
{
  "jsonrpc": "2.0",
  "id": 3,
  "method": "CancelTask",
  "params": { "id": "task-uuid" }
}
```

Calling `CancelTask` on a task that is already in a terminal state (`TASK_STATE_COMPLETED`, `TASK_STATE_FAILED`, `TASK_STATE_CANCELED`) is a no-op.

---

## A2A events

Events streamed over SSE map to internal `AgentEvent`s as follows:

| `AgentEvent.kind` | SSE field | Task state | Notes |
|-------------------|-----------|------------|-------|
| `init` | `statusUpdate` | `TASK_STATE_WORKING` | Always emitted first. If `model` or `sessionId` present, also emits `artifactUpdate` with name `agent-metadata`. |
| `thinking` | `artifactUpdate` (name: `assistant-response`, `append: true`) | — | Text is appended; multiple chunks build the full response. |
| `tool_use` | `statusUpdate` | `TASK_STATE_WORKING` | Status message includes `"Using tool: <name>"`. |
| `tool_result` | `statusUpdate` | `TASK_STATE_WORKING` | Status message includes a truncated tool output (≤ 200 chars). |
| `done` | `statusUpdate` | `TASK_STATE_COMPLETED` | If summary or stats present, also emits `artifactUpdate` with name `result`. |
| `error` | `statusUpdate` | `TASK_STATE_FAILED` | Status message includes the error text. |
| `approval_required` | `statusUpdate` | `TASK_STATE_INPUT_REQUIRED` | Stream stays open. Respond with `SendMessage` to resume. |

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
   ├── CancelTask ──────────────────────────► canceled  [terminal]
   └── approval_required event ─────────────► input-required
                                                 │
                                       SendMessage (with answer)
                                                 │
                                                 ▼
                                              working
```

---

## Resuming after `input-required`

When `AGENT_FORCE=false`, the CLI may pause and ask for shell-command approval. The task enters the `TASK_STATE_INPUT_REQUIRED` state.

To resume, send a new message with the same `contextId`:

```json
{
  "jsonrpc": "2.0",
  "id": 4,
  "method": "SendMessage",
  "params": {
    "message": {
      "messageId": "msg-2",
      "role": "ROLE_USER",
      "contextId": "<same contextId>",
      "parts": [{ "text": "y" }]
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
| `-32001` | TaskNotFound | `GetTask` or `CancelTask` for unknown task id. |

---

## Example: streaming request with curl

```bash
curl -N -X POST http://localhost:41242/a2a/jsonrpc \
  -H "Content-Type: application/json" \
  -H "Accept: text/event-stream" \
  -H "A2A-Version: 1.0" \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "SendStreamingMessage",
    "params": {
      "message": {
        "messageId": "test-1",
        "role": "ROLE_USER",
        "parts": [{"text": "Explain the main function in src/index.ts"}]
      }
    }
  }'
```
