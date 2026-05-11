# Claude Desktop Configuration

coding-agent-a2a exposes an MCP server that Claude Desktop can connect to via two transport modes.

## Option A — stdio (MCP_TRANSPORT=stdio, recommended for local use)

Claude Desktop manages the process lifecycle. The A2A endpoint is also available on `PORT`.

Add to `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS):

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

For the claude-code adapter:

```json
{
  "mcpServers": {
    "coding-agent-a2a": {
      "command": "node",
      "args": ["/absolute/path/to/coding-agent-a2a/dist/index.js"],
      "env": {
        "MCP_TRANSPORT": "stdio",
        "AGENT_ADAPTER": "claude-code",
        "AGENT_REPO_PATH": "/absolute/path/to/your/repo",
        "PORT": "41242"
      }
    }
  }
}
```

## Option B — Streamable HTTP (MCP_TRANSPORT=http)

First start the server manually:

```bash
MCP_TRANSPORT=http AGENT_ADAPTER=cursor AGENT_REPO_PATH=/path/to/repo node dist/index.js
```

Then configure Claude Desktop:

```json
{
  "mcpServers": {
    "coding-agent-a2a": {
      "url": "http://localhost:41242/mcp"
    }
  }
}
```

Option B requires the server to be running before Claude Desktop starts. Option A is self-contained.

## Available MCP tools

| Tool | Description |
|------|-------------|
| `coding_agent_run` | Submit a coding task; returns `job_id` immediately |
| `coding_agent_poll` | Poll events for a job since a given offset |
| `coding_agent_result` | Retrieve final result and clean up the job |
| `coding_agent_cancel` | Cancel a running job |
| `coding_agent_info` | Return adapter name, capabilities, and server version |
