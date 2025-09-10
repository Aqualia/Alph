# Protocol Rendering Examples

These examples show how Alph renders MCP server configuration for different agents and transports.

## Cursor (project scope file)

- STDIO:

```json
{
  "mcpServers": {
    "github": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/github-mcp"],
      "env": {
        "GITHUB_TOKEN": "${GITHUB_TOKEN}"
      }
    }
  }
}
```

- SSE:

```json
{
  "mcpServers": {
    "linear": {
      "type": "sse",
      "url": "https://mcp.linear.app/sse",
      "headers": {
        "Authorization": "Bearer ${LINEAR_TOKEN}"
      }
    }
  }
}
```

- HTTP:

```json
{
  "mcpServers": {
    "notion": {
      "type": "http",
      "url": "https://mcp.notion.com/mcp",
      "headers": {
        "Authorization": "Bearer ${NOTION_TOKEN}"
      }
    }
  }
}
```

## Gemini (settings.json)

- STDIO:

```json
{
  "mcpServers": {
    "github": {
      "transport": "stdio",
      "command": "github-mcp",
      "args": [],
      "env": {
        "GITHUB_TOKEN": "${GITHUB_TOKEN}"
      }
    }
  }
}
```

- SSE:

```json
{
  "mcpServers": {
    "linear": {
      "transport": "sse",
      "url": "https://mcp.linear.app/sse",
      "headers": {
        "Authorization": "Bearer ${LINEAR_TOKEN}"
      }
    }
  }
}
```

- HTTP:

```json
{
  "mcpServers": {
    "notion": {
      "httpUrl": "https://mcp.notion.com/mcp",
      "headers": {
        "Authorization": "Bearer ${NOTION_TOKEN}"
      }
    }
  }
}
```

For agent-specific configuration guides, see `docs/agents/README.md`.
