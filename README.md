 <p align="center">
  <img src="assets/alph-banner.svg" alt="ALPH banner" width="720" />
</p>

## Overview

Configure MCP servers for your AI agents in one command. Alph is a local-first CLI that safely edits agent config files for Gemini, Cursor, Claude, and more — using atomic writes, automatic backups, and easy rollback. No network calls. No lost configs. Just reliable setup.

[![npm version](https://img.shields.io/npm/v/@aqualia/alph-cli)](https://www.npmjs.com/package/@aqualia/alph-cli)
[![npm downloads](https://img.shields.io/npm/dm/@aqualia/alph-cli)](https://www.npmjs.com/package/@aqualia/alph-cli)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

## Demo

![Alph Demo](demo-alph.gif)


## The Problem
Modern AI agents support MCP servers but setting them up means editing fragile local config files per tool and per OS. It’s easy to misplace entries, corrupt JSON, or leak credentials.

## Alph-cli
Alph CLI automates safe, repeatable MCP configuration across agents. It detects installations, previews changes (--dry-run), performs atomic writes, and creates timestamped backups with fast rollback.

## Features

- 🚀 **Easy Installation**: Install globally via NPM without security warnings
- 🔧 **Multi-Agent Support**: Automatically detects and configures multiple AI agents
- 🛡️ **Safe Operations**: Atomic file operations with automatic backup creation
- 🌍 **Cross-Platform**: Works on Windows, macOS, and Linux
- 📦 **Stateless**: No network requests, operates entirely on local files
- 🔄 **Rollback Support**: Easy recovery from configuration issues

### Supported AI Agents

- **Gemini CLI** (`~/.gemini/settings.json`)
- **Cursor** (platform-specific configuration locations)
- **Claude Code** (Claude-specific configuration format)
- **Windsurf** (IDE-specific configuration)
- **Warp** (terminal configuration)
- **Codex CLI** (TOML-based configuration)

See detailed guides in [docs/agents](./docs/agents/README.md).

## Installation

```bash
npm install -g @aqualia/alph-cli
```

### Try in 30 seconds

```bash
npx @aqualia/alph-cli@latest
```

Or install globally and run `alph`.

### Requirements

- Node.js 18.0.0 or higher
- NPM (comes with Node.js)

## Usage

### Quick start (interactive)

```bash
# Launch the wizard to detect agents and guide you through setup
alph

# or explicitly run setup (no options launches the wizard)
alph setup
```

### Setup (non-interactive)

```bash
# Configure detected agents with a remote MCP endpoint (with bearer token)
alph setup \
  --mcp-server-endpoint https://mcp.example.com/server-id \
  --bearer ${YOUR_TOKEN}

# Filter to specific agents
alph setup \
  --mcp-server-endpoint https://mcp.example.com/server-id \
  --agents gemini,cursor \


# Dry-run preview (no file changes)
alph setup \
  --mcp-server-endpoint https://mcp.example.com/server-id \
  --bearer ${YOUR_TOKEN} \
  --agents gemini,cursor \
  --dry-run
```

### STDIO tools (default-on install)

When you choose `--transport stdio` (or pick STDIO in the wizard), Alph will detect and, by default, install the selected local MCP tool if missing, then run health checks before writing any config. You can opt out:

```bash
# Disable auto-install
alph setup --transport stdio --no-install

# Prefer a specific installer
alph setup --transport stdio --install-manager npm

# Control atomic write strategy
ALPH_ATOMIC_MODE=copy alph setup --mcp-server-endpoint https://... --agents gemini
```

### Status

```bash
# Show detected agents and configured MCP servers
alph status
```

### Compatibility Matrix

The following agents are supported across operating systems and transport types:

| Agent        | macOS | Linux | Windows | HTTP | SSE | STDIO |
|--------------|:-----:|:-----:|:-------:|:----:|:---:|:-----:|
| Gemini CLI   |  ✅   |  ✅   |   ✅    |  ✅  | ✅  |  ✅   |
| Cursor       |  ✅   |  ✅   |   ✅    |  ✅  | ✅  |  ✅   |
| Claude Code  |  ✅   |  ✅   |   ✅    |  ✅  | ✅  |  ✅   |
| Windsurf     |  ✅   |  ✅   |   ✅    |  ✅  | ✅  |  ✅   |
| Warp         |  ✅   |  ✅   |   ✅    |  ✅  | ✅  |  ✅   |
| Codex CLI    |  ✅   |  ✅   |   ✅    |  ✅  | ✅  |  ✅   |

Notes:
- STDIO tools may require a one-time local install. Alph can handle detection and optional installation.
- Some IDEs manage MCP configuration at project scope; see agent-specific guides in `docs/agents/`.

### Command reference

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
      --agents <list>               Comma-separated agent names to filter
      --dir <path>                  Custom config directory (default: use global agent config locations)
      --dry-run                     Preview changes without writing
      --name <id>                   Name/ID for the MCP server (optional)

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

### Protocol rendering examples

Moved to `docs/agents/protocol-examples.md` for clarity and maintainability.

## Why Alph?
1. **Security**: Local-first design — no network requests and sensitive values are redacted in output.
2. **Simplicity**: One command configures multiple agents; no manual JSON editing.
3. **Reliability**: Atomic writes, validation, and automatic backups mean you can always roll back.

## How It Works

1. **Detection**: Automatically scans for supported AI agent installations
2. **Backup**: Creates timestamped backups of existing configuration files
3. **Configuration**: Safely injects MCP server settings into agent configurations
4. **Validation**: Verifies configuration integrity after modifications
5. **Rollback**: Provides easy recovery if issues occur


## Documentation

- [ARCHITECTURE.md](./ARCHITECTURE.md) - codebase structure and execution flows
- [SECURITY.md](./SECURITY.md) - security model, secret handling, backups/rollback
- [USER_GUIDE.md](./USER_GUIDE.md) - usage examples and command reference
- [TROUBLESHOOTING.md](./TROUBLESHOOTING.md) - common issues and resolutions
- [CONTRIBUTING.md](./CONTRIBUTING.md) - how to contribute
- [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md) - community standards and enforcement
 - [docs/AGENT_HANDOFF.md](./docs/AGENT_HANDOFF.md) - concise, complete brief for agents and contributors
 - [docs/agents](./docs/agents/README.md) - agent-specific configuration guides


## Code of Conduct

We follow the [Contributor Covenant v2.1](./CODE_OF_CONDUCT.md). By participating, you agree to abide by its terms. For any concerns, contact hello@aqualia.ie.

## Feature Requests & Issues

- Open issues: https://github.com/Aqualia/Alph/issues
- New feature request: https://github.com/Aqualia/Alph/issues/new?template=feature_request.yml
- New bug report: https://github.com/Aqualia/Alph/issues/new?template=bug_report.yml

## License

MIT License - see [LICENSE](LICENSE) file for details.
