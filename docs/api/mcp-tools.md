# MCP Tools Reference

cursor-agent-a2a registers five MCP tools. All tools are available whether the MCP transport is `stdio` or `http`.

**Typical usage sequence:**

```
coding_agent_run  →  coding_agent_poll (×N)  →  coding_agent_result
```

---

## `coding_agent_run`

Submits a coding task to the active agent CLI and returns a `job_id` immediately. The CLI process is spawned in the background; use `coding_agent_poll` to stream progress.

### Parameters

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `task` | `string` | Yes | Natural-language task prompt sent to the CLI. |
| `repoPath` | `string` | No | Absolute path to the repository. Defaults to `AGENT_REPO_PATH` env var (`.` if unset). |
| `model` | `string` | No | Model override (e.g. `claude-opus-4-5`). Defaults to `AGENT_MODEL` env var. |
| `force` | `boolean` | No | When `false`, shell-approval prompts pause the job (emit `approval_required` events). Defaults to `AGENT_FORCE` env var (`true`). |

### Returns

```json
{ "job_id": "550e8400-e29b-41d4-a716-446655440000" }
```

### Example

```json
{
  "name": "coding_agent_run",
  "arguments": {
    "task": "Refactor the auth module to use JWT instead of sessions",
    "repoPath": "/home/user/my-project",
    "model": "claude-opus-4-5"
  }
}
```

Response:

```json
{
  "content": [{
    "type": "text",
    "text": "{\"job_id\":\"550e8400-e29b-41d4-a716-446655440000\"}"
  }]
}
```

---

## `coding_agent_poll`

Returns events that have arrived since a given offset. Call repeatedly until `done` is `true`.

### Parameters

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `jobId` | `string` | Yes | UUID returned by `coding_agent_run`. |
| `sinceLine` | `number` | No | Index of the first event to return. Pass `0` (default) for all events, or the length of the previously received `events` array to fetch only new ones. |

### Returns

```json
{
  "events": [...],
  "done": false
}
```

`events` is an array of `AgentEvent` objects (see [Event types](#event-types) below).
`done` is `true` once the CLI process has exited (success or failure).

Returns `isError: true` with `"Unknown job: <jobId>"` if the job does not exist.

### Polling pattern

```javascript
let sinceLine = 0;
while (true) {
  const result = await client.callTool({
    name: 'coding_agent_poll',
    arguments: { jobId, sinceLine }
  });
  const { events, done } = JSON.parse(result.content[0].text);
  sinceLine += events.length;
  // process events...
  if (done) break;
  await new Promise(r => setTimeout(r, 500)); // back-off between polls
}
```

### Example

```json
{
  "name": "coding_agent_poll",
  "arguments": { "jobId": "550e8400-...", "sinceLine": 0 }
}
```

Response:

```json
{
  "content": [{
    "type": "text",
    "text": "{\"events\":[{\"kind\":\"init\",\"model\":\"claude-opus-4-5\"},{\"kind\":\"thinking\",\"text\":\"I'll start by reading the auth module...\"}],\"done\":false}"
  }]
}
```

---

## `coding_agent_result`

Retrieves the final result of a completed job and removes it from memory. Can be called before the job completes — in that case the job is not removed and `done` is `false`.

### Parameters

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `jobId` | `string` | Yes | UUID returned by `coding_agent_run`. |

### Returns

```json
{
  "summary": "Refactored auth.ts to use JWT. Updated login, logout, and middleware.",
  "stats": {
    "inputTokens": 12400,
    "outputTokens": 3200
  },
  "done": true
}
```

`summary` is the agent's self-reported completion message (may be empty if the CLI did not emit one).
`stats` contains token counts when the CLI reports them (optional).
`done` indicates whether the job has finished.

Returns `isError: true` if the job does not exist.

### Example

```json
{
  "name": "coding_agent_result",
  "arguments": { "jobId": "550e8400-..." }
}
```

---

## `coding_agent_cancel`

Terminates a running job immediately (SIGTERM → SIGKILL after 2 s) and removes it from memory.

### Parameters

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `jobId` | `string` | Yes | UUID returned by `coding_agent_run`. |

### Returns

```json
{ "cancelled": true }
```

Returns `isError: true` if the job does not exist.

### Example

```json
{
  "name": "coding_agent_cancel",
  "arguments": { "jobId": "550e8400-..." }
}
```

---

## `coding_agent_info`

Returns information about the active adapter and server. Useful for debugging and for clients that need to verify configuration before submitting tasks.

### Parameters

None.

### Returns

```json
{
  "adapter": "cursor",
  "capabilities": {
    "streaming": true,
    "sessionResume": false,
    "shellApproval": true
  },
  "version": "0.1.0"
}
```

### Example

```json
{ "name": "coding_agent_info", "arguments": {} }
```

---

## Event types

The `events` array returned by `coding_agent_poll` contains `AgentEvent` objects. Each has a `kind` discriminant:

| `kind` | Additional fields | Description |
|--------|-------------------|-------------|
| `init` | `model?`, `sessionId?` | CLI process started. Emitted first. |
| `thinking` | `text` | Agent is composing a response. Text chunks accumulate. |
| `tool_use` | `tool`, `input` | Agent called a tool (e.g. file read, bash command). |
| `tool_result` | `tool`, `output`, `isError` | Tool returned a result. |
| `approval_required` | `prompt` | CLI is waiting for shell-command approval. Call `coding_agent_run` with `force: false` to receive these. |
| `done` | `summary`, `stats?` | Run completed successfully. Last event in a successful sequence. |
| `error` | `message` | Run failed. Last event in a failed sequence. |

### Example event sequence

```json
[
  { "kind": "init", "model": "claude-opus-4-5", "sessionId": "abc123" },
  { "kind": "thinking", "text": "I'll start by reading the existing auth module." },
  { "kind": "tool_use", "tool": "read_file", "input": { "path": "src/auth.ts" } },
  { "kind": "tool_result", "tool": "read_file", "output": "...", "isError": false },
  { "kind": "thinking", "text": "Now I'll refactor the session handling to use JWT." },
  { "kind": "done", "summary": "Refactored auth.ts to use JWT.", "stats": { "inputTokens": 4200 } }
]
```
