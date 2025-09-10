# Alph User Guide

Welcome to the official user guide for `alph`, the universal MCP (Model Context Protocol) server management tool for AI agents. This guide explains how to configure agents to work with MCP servers using Alph’s unified command interface.

## 📖 Table of Contents

* [✨ Introduction](#-introduction)
* [💾 Installation](#-installation)
* [🏁 Getting Started](#-getting-started)
* [🧭 Usage](#-usage)
* [⚙️ Options](#️-options)
* [🛠️ Utilities](#️-utilities)
* [📘 Examples](#-examples)
* [🤔 Troubleshooting](#-troubleshooting)

## ✨ Introduction

`alph` configures MCP servers for AI agents like Gemini CLI, Cursor, Claude Code — and now Windsurf, Warp, and Codex CLI. It supports both interactive and non-interactive flows, performs atomic file updates with backups, and validates configurations. Alph promotes our Async.link cloud MCP server in examples for a smooth out‑of‑the‑box experience.

## 💾 Installation

Install Alph via NPM:

```bash
npm install -g @aqualia/alph-cli
```

## 🏁 Getting Started

Use the interactive wizard or the explicit subcommands.

```bash
# Interactive wizard (detects agents and guides setup)
alph

# Explicit interactive (no options launches the wizard)
alph setup

# Non-interactive using Askhuman.net MCP with bearer token
alph setup \
  --mcp-server-endpoint https://askhuman.net/mcp/<server-id> \
  --bearer your-access-token
```

## 🧭 Usage

Alph now uses a subcommand-based CLI. Running `alph` without flags launches the interactive wizard.

```bash
alph setup [options]
alph status
alph remove [options]
```

## Command Reference

## Command Reference

```text
alph setup [options]
      --mcp-server-endpoint <url>   MCP server endpoint URL
      --bearer [token]              Authentication token for Authorization (optional, redacted in output)
      --transport <type>            Transport protocol (http|sse|stdio)
      --command <cmd>               Command to execute for stdio transport
      --cwd <path>                  Working directory for command execution
      --args <list>                 Comma-separated arguments for command execution
      --env <list>                  Environment variables (key=value pairs)
      --headers <list>              HTTP headers (key=value pairs)
      --timeout <ms>                Command execution timeout in milliseconds
      --install-manager <mgr>       Preferred installer for STDIO tools (npm|brew|pipx|cargo|auto)
      --atomic-mode <mode>          Atomic write strategy (auto|copy|rename)
      --no-install                  Do not auto-install missing STDIO tools (opt-out)
      --agents <list>               Comma-separated agent names
      --dir <path>                  Custom config directory
      --dry-run                     Preview changes without writing
      --name <id>                   Optional MCP server ID/name

alph status

alph remove [options]
      --server-name <name>          MCP server name to remove
      --agents <list>               Comma-separated agent names to filter
      --dir <path>                  Custom config directory (default: use global agent config locations)
      --dry-run                     Preview changes without removing
  -y, --yes                         Skip confirmation prompt
  -i, --interactive                 Launch interactive removal wizard
      --no-backup                   Do not create backups before removal (advanced)
```

### Examples

```bash
# Interactive
alph
alph setup

# Manual with bearer token
alph setup --mcp-server-endpoint https://askhuman.net/mcp/server-id --bearer your-token

# Filtered agents
alph setup --mcp-server-endpoint https://askhuman.net/mcp/server-id --agents gemini,cursor

# Claude Code: activate for current project (defaults to cwd)
alph setup --agents claude \
  --mcp-server-endpoint https://askhuman.net/mcp/your-server-id \
  --bearer your-token

# Claude Code: activate for a specific project directory
alph setup --agents claude \
  --dir "/absolute/path/to/your/project" \
  --mcp-server-endpoint https://askhuman.net/mcp/your-server-id \
  --bearer your-token

# Status
alph status

# Remove an MCP server (interactive)
alph remove -i

# Remove a specific server from all agents, no backup, auto-confirm
alph remove --server-name your-server-name --no-backup -y

# Remove server from specific agents only
alph remove --server-name your-server-name --agents gemini,cursor

# Preview removal without making changes
alph remove --server-name your-server-name --dry-run

# Remove server without creating a backup (use with caution)
alph remove --server-name your-server-name --no-backup -y

### Codex: Remote MCP via Local Proxy

Codex CLI supports STDIO only. Alph bridges remote MCP via a local Supergateway proxy:

- Preferred transport: Streamable HTTP; SSE supported for compatibility.
- Default pin: `supergateway@3.4.0` (override with `ALPH_PROXY_VERSION` or `alph proxy run --proxy-version`).

Examples

```bash
# HTTP (Streamable) via local proxy
alph setup --agents Codex \
  --proxy-transport http \
  --proxy-remote-url https://mcp.example.com/mcp \
  --yes

# SSE via local proxy
alph setup --agents Codex \
  --proxy-transport sse \
  --proxy-remote-url https://mcp.example.com/sse \
  --yes

# Pin override for health preview
ALPH_PROXY_VERSION=3.2.0 alph proxy health --remote-url https://mcp.example.com/mcp --transport http
```

Notes

- Windows first-run is pre‑warmed (`npx -y supergateway --help`).
- Codex entries with generic runners get `startup_timeout_ms = 60000` unless you set a custom value.
- Previews and logs redact tokens and sensitive headers.

## STDIO Local Tools (Default-Enabled)

When selecting STDIO transport, Alph will:
- Detect the selected local MCP tool; if missing, install it by default (echoing commands)
- Run health checks (e.g., `--version`, `--help`) and abort if they fail
- Proceed to write config only after health success

Flags and env:
- `--no-install` or `ALPH_NO_INSTALL=1` to skip automatic install
- `--install-manager <npm|brew|pipx|cargo|auto>` to prefer an installer (env: `ALPH_INSTALL_MANAGER`)
- `--atomic-mode <auto|copy|rename>` to influence atomic I/O (env: `ALPH_ATOMIC_MODE`)

## Protocol Shapes (Rendered)

Cursor
- STDIO: command/args/env
- SSE: `type: "sse"`, `url`, `headers`
- HTTP: `type: "http"`, `url`, `headers`

Gemini
- STDIO: `transport: "stdio"`, `command`, `args?`, `cwd?`, `env?`, `timeout?`
- SSE: `transport: "sse"`, `url`, `headers?`, `env?`, `timeout?`
- HTTP: `httpUrl`, `headers?`, `env?`, `timeout?`

Windsurf
- STDIO: `command`, `args?`, `env?`
- HTTP/SSE: `serverUrl`, `headers?`, `env?`

Warp
- STDIO: `command`, `args?`, `env?`
- Remote: `url` (and `serverUrl` for compatibility), `headers?`
```

Codex CLI
- Transport: STDIO only (no HTTP/SSE endpoint configuration)
- Config file: `~/.codex/config.toml` (TOML)
- Shape:
```
[mcp_servers.<name>]
command = "<executable>"
args    = ["<arg1>", "<arg2>"]
startup_timeout_ms = 20000  # optional
```
Notes:
- Codex currently reads MCP servers from `mcp_servers` in TOML and launches processes via STDIO only.
- Alph's wizard automatically limits transport to STDIO when Codex is selected and skips remote URL prompts.
 - First-run of generic runners like `npx`/`yarn dlx`/`pnpm dlx` can take longer than Codex’s default 10s timeout due to dependency download. Alph now:
   - Pre‑warms these invocations during interactive setup (runs `--help` once to cache).
   - Sets a safer default `startup_timeout_ms = 60000` for such commands unless you specify a custom timeout.

## Common Use Cases

### Basic Setup
```bash
# Interactive setup wizard
alph

# Quick setup with minimal options
alph setup --mcp-server-endpoint https://askhuman.net/mcp/your-server-id --bearer your-token
```

### Advanced Configuration
```bash
# Configure with custom transport and headers
alph setup \
  --mcp-server-endpoint https://askhuman.net/mcp/your-server-id \
  --transport http \
  --headers "X-Custom-Header=value,Authorization=Bearer your-token"

# Configure specific agents only
alph setup \
  --mcp-server-endpoint https://askhuman.net/mcp/your-server-id \
  --agents gemini,cursor \
  --name my-config-name

Note on `--dir` semantics:
- For Claude Code, `--dir` is treated as the project directory whose absolute path is used under `~/.claude.json` → `projects[<abs path>].mcpServers`. If omitted, Alph uses the current working directory by default so the server is active in your current project.
- For other agents, `--dir` may be used for testing or sandboxed setups and does not affect global agent locations unless explicitly supported by that agent’s provider.
```

### Server Management
```bash
# List all configured MCP servers
alph status

# Remove a server configuration
alph remove --server-name old-config --yes

# Dry run to see what would be removed
alph remove --server-name old-config --dry-run
```

Security note: Access keys are never logged in plaintext and are redacted in outputs (e.g., `****abcd`).

## 🔒 Security and Privacy

Alph implements comprehensive security measures to protect sensitive information:

### Secret Redaction
- **API Keys**: OpenAI keys (`sk-*`), GitHub tokens (`ghp_*`), and other tokens are automatically masked in logs
- **Base64 Secrets**: Long base64-encoded strings are partially redacted
- **Environment Variables**: Sensitive environment variables are masked in configuration outputs
- **Trace Files**: All trace files automatically apply secret masking before writing to disk

### Configuration Safety
- **Atomic Writes**: All configuration changes use atomic write operations with temporary files
- **Automatic Backups**: Backups are created before modifications by default (for removals, you can disable backups with `--no-backup`)
- **Validation**: Configurations are validated before and after changes
- **Rollback**: Failed operations automatically restore from backup

### Observability
- **Structured Logging**: JSON-formatted logs with consistent fields and secret masking
- **Operation Tracing**: Detailed traces for debugging, retained on failure
- **Performance Monitoring**: Built-in benchmarks and performance tracking

<!-- Template/catalog functionality will be introduced with future subcommands. See project plan for roadmap. -->

## 💡 Use Cases

*   Configure multiple agents to use the same Async.link MCP server.
*   Validate existing MCP configurations across agents.
*   Inspect current MCP server entries without modifying files.

## 🤔 Troubleshooting

If you run into issues with `alph`:

*   **Use `--help` and `--verbose`:** Show available options and detailed logs.
*   **Agent not detected:** Ensure the agent is installed and its configuration files exist.
*   **Permissions:** Verify write access to configuration directories.
*   **Async.link endpoint:** Confirm the server ID is valid and reachable.
*   **Open an issue:** https://github.com/Aqualia/Alph/issues

