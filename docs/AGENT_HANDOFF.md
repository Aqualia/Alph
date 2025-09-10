# Alph CLI — Agent Hand‑off Brief (MCP Configuration Orchestrator)

Audience: engineers and agent frameworks integrating Alph, or agents reasoning about Alph’s behavior. This brief provides a complete functional and technical understanding with minimal tokens while leaving no gaps.

--------------------------------------------------------------------------------

## 1) Executive Summary

Alph CLI configures AI development tools ("agents") to use Model Context Protocol (MCP) servers. It supports interactive and non‑interactive flows, performs atomic, rollback‑safe configuration writes, and validates results. Alph abstracts provider‑specific formats and locations, turning a single MCP intent (HTTP/SSE/STDIO) into the right config entry for each agent.

- Supported agents (providers): Gemini CLI, Cursor, Claude Code, Windsurf, Warp, Codex CLI.
- Transports: HTTP, SSE, STDIO (Codex CLI supports STDIO only).
- Atomic writes + backups: All modifications are written safely with optional backups and rollback.
- Tools catalog: For STDIO flows, Alph can detect, install, and pre‑warm local MCP tools (e.g., Playwright MCP, Filesystem MCP, Memory MCP).

Key defaults and recent improvements:
- For `npx` / `yarn dlx` / `pnpm dlx`, Alph pre‑warms the first run and sets a safer default startup timeout for Codex.
- Codex TOML entries now default to `startup_timeout_ms = 60000` when invoking via generic runners (unless you set a custom timeout).
- Wizard and non‑interactive summaries label STDIO endpoints as “Local (STDIO)”.

--------------------------------------------------------------------------------

## 2) Core Concepts

- Provider abstraction: One provider per agent encapsulates discovery (config path), read/merge/write, validation, and rollback.
- AgentConfig: A transport‑agnostic config structure Alph turns into provider‑specific output.
- Transports:
  - HTTP: `httpUrl` with headers.
  - SSE: `url` with headers.
  - STDIO: `command`, `args`, `cwd`, `env`.
- Atomic writes: Edits are applied with a temp file + rename/copy; backups are timestamped and restorable.
- STDIO tooling: Catalog lists local MCP tools with detection, installers, and health checks; Alph can install and “pre‑warm” them.

--------------------------------------------------------------------------------

## 3) Configuration Shapes (copy‑pasteable)

### Codex CLI (TOML at `~/.codex/config.toml`)

Notes: Codex only supports STDIO. Top‑level key is `mcp_servers` (not `mcpServers`).

```toml
# Example: Playwright MCP via npx
[mcp_servers.playwright]
command = "npx"
args = ["-y", "@playwright/mcp"]
# Alph sets a safer default for generic runners; customize if needed
startup_timeout_ms = 60_000

# Example: dedicated binary (faster startup)
[mcp_servers.playwright]
command = "playwright-mcp"
startup_timeout_ms = 20_000
```

### Gemini CLI (JSON at `~/.gemini/settings.json`)

Shape is flexible; transport inferred from presence of fields. Typical examples:

```json
{
  "mcpServers": {
    "notion": {
      "transport": "http",
      "httpUrl": "https://mcp.notion.com/mcp",
      "headers": { "Authorization": "Bearer ***" }
    },
    "linear": {
      "transport": "sse",
      "url": "https://mcp.linear.app/sse",
      "headers": { "Authorization": "Bearer ***" }
    },
    "github-local": {
      "transport": "stdio",
      "command": "github-mcp",
      "args": [],
      "env": { "GITHUB_TOKEN": "***" }
    }
  }
}
```

### Cursor (JSON; prefers `~/.cursor/mcp.json`; also supports IDE user settings)

Minimal, transport‑agnostic shape under `mcpServers`:

```json
{
  "mcpServers": {
    "my-http": {
      "transport": "http",
      "httpUrl": "https://example.com/mcp",
      "headers": { "Authorization": "Bearer ***" }
    },
    "my-stdio": {
      "transport": "stdio",
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem"],
      "env": { "ROOT": "/workspace" }
    }
  }
}
```

### Claude Code (JSON; global `~/.claude.json` plus optional per‑project mapping)

Global config and per‑project activation both use `mcpServers` shape:

```json
{
  "mcpServers": {
    "linear": {
      "transport": "sse",
      "url": "https://mcp.linear.app/sse",
      "headers": { "Authorization": "Bearer ***" }
    },
    "local-github": {
      "transport": "stdio",
      "command": "github-mcp"
    }
  },
  "projects": {
    "/abs/path/to/project": {
      "mcpServers": {
        "local-github": { "transport": "stdio", "command": "github-mcp" }
      }
    }
  }
}
```

--------------------------------------------------------------------------------

## 4) Architecture & Key Flows

High‑level modules of interest:
- `src/commands/configure.ts` — Non‑interactive flow (detect → build → preview → confirm → apply with rollback). Also prints summaries.
- `src/commands/interactive.ts` — Interactive wizard (agent selection, transport/tool prompts, install + pre‑warm, confirm, apply).
- `src/agents/*` — Providers per agent (e.g., `codex.ts`, `gemini.ts`, `cursor.ts`, `claude.ts`). Handle path discovery and file formats.
- `src/utils/fileOps.ts` — Atomic writes, directory ensure, timeouts, long‑path handling.
- `src/utils/backup.ts` — Timestamped backups and restore.
- `src/utils/tools.ts` — STDIO tool detection, installation, health checks, default invocation selection.
- `src/utils/preview.ts` — Redacted previews for JSON‑based agents.

Non‑interactive configure (essentials):
1. Detect providers (optionally filtered), creating new files if needed.
2. Build `AgentConfig` from CLI options (transport, URL, bearer→headers, stdio command).
3. Dry‑run preview (optional), then confirm (unless `--yes`).
4. Apply configuration across selected providers with rollback on failure.
5. Summarize paths and backups.

Interactive wizard (essentials):
1. Detect agents → select agents.
2. Choose transport.
   - STDIO: select tool (catalog), ensure installed, health check.
   - Pre‑warm generic runners (`npx`/`dlx`) once to prime caches.
3. Confirm summary (STDIO displays “Endpoint: Local (STDIO)”).
4. Apply configuration using the same underlying logic as non‑interactive.

Codex provider specifics (`src/agents/codex.ts`):
- Writes TOML at `~/.codex/config.toml` using `@iarna/toml`.
- Enforces STDIO only (errors on HTTP/SSE).
- Merges under `[mcp_servers.<name>]` with `command`, `args`, `env`, `startup_timeout_ms`.
- Heuristic: if `command` is a generic runner (`npx`, `yarn dlx`, `pnpm dlx`) and no timeout provided, set `startup_timeout_ms = 60000`.
- Atomic write + parse/validate + rollback on failure.

--------------------------------------------------------------------------------

## 5) Contracts (TypeScript signatures)

`src/agents/provider.ts` — Core contracts. These are copied verbatim for accuracy.

```ts
export interface AgentConfig {
  mcpServerId: string;
  mcpServerUrl?: string;
  mcpAccessKey?: string;
  transport?: 'http' | 'sse' | 'stdio';
  headers?: Record<string, string>;
  env?: Record<string, string>;
  command?: string;
  args?: string[];
  cwd?: string;
  timeout?: number;
  configDir?: string;
}

export interface RemovalConfig {
  mcpServerId: string;
  configDir?: string;
  backup?: boolean;
}

export interface AgentProvider {
  readonly name: string;
  detect(configDir?: string): Promise<string | null>;
  configure(config: AgentConfig, backup: boolean): Promise<string | undefined>;
  remove(config: RemovalConfig, backup: boolean): Promise<string | undefined>;
  listMCPServers(configDir?: string): Promise<string[]>;
  hasMCPServer(serverId: string, configDir?: string): Promise<boolean>;
  validate?(): Promise<boolean>;
  rollback?(): Promise<string | null>;
}
```

--------------------------------------------------------------------------------

## 6) Heuristics, Constraints, and Gotchas

- Codex CLI:
  - STDIO only; HTTP/SSE entries are invalid and rejected.
  - First‑run of generic runners (`npx`, `yarn dlx`, `pnpm dlx`) can exceed Codex’s default 10s startup window due to dependency download.
  - Alph mitigations:
    - Pre‑warm during interactive setup by running `--help` once.
    - If not explicitly set, write `startup_timeout_ms = 60000` in TOML for generic runners.
  - Top‑level TOML key must be `mcp_servers` (not `mcpServers`).

- HTTP/SSE flows:
  - `--bearer` becomes `Authorization: Bearer <token>` unless overridden.
  - Timeout (`timeout`) applies to network‑based transports.

- Atomic + backup:
  - Writes are done via temp file → rename/copy; backups are timestamped and restorable.
  - On parse/validation failure post‑write, Alph attempts rollback to the previous backup.

- Lazy server startup and caching:
  - Agents may cache/resolve MCP tools lazily. Triggering a tool forces server spawn; restarting the agent reloads config.

--------------------------------------------------------------------------------

## 7) Extending Alph (Playbook)

Add a new agent provider:
1. Implement `AgentProvider` (detect/configure/remove/list/has/validate) for the agent’s storage and format.
2. Map `AgentConfig` → provider format (JSON/TOML/etc.), including transport‑specific fields.
3. Use `FileOperations.atomicWrite` and `BackupManager.createBackup/restoreBackup`.
4. Register in `src/agents/registry.ts`.

Add a new STDIO tool:
1. Update `catalog/tools.yaml` with:
   - `id`, `bin`, discovery `commands`, per‑OS installers, health checks.
2. Wizard will detect/install; Alph can pre‑warm generic runners.

--------------------------------------------------------------------------------

## 8) Troubleshooting (Fast Index)

- MCP server not showing up:
  - Verify config path and shape for the agent (see section 3).
  - For Codex, check `[mcp_servers]` TOML and `startup_timeout_ms`.

- Timeouts with npx/dlx:
  - Ensure first‑run pre‑warm happened (re‑run wizard or run `npx <pkg> --help`).
  - Raise `startup_timeout_ms` (e.g., 60000) in Codex TOML if needed.

- Install failures for STDIO tools:
  - Re‑run without `--no-install`; ensure PATH includes the binary for dedicated tools.

- Invalid JSON/TOML:
  - Alph performs validation and attempts rollback. Fix the syntax and re‑run.

--------------------------------------------------------------------------------

## 9) Practical Examples

Configure Codex CLI with Playwright MCP (via npx):

```toml
[mcp_servers.playwright]
command = "npx"
args = ["-y", "@playwright/mcp"]
startup_timeout_ms = 60_000
```

Configure Gemini CLI with a remote HTTP MCP:

```json
{
  "mcpServers": {
    "notion": {
      "transport": "http",
      "httpUrl": "https://mcp.notion.com/mcp",
      "headers": { "Authorization": "Bearer ****" }
    }
  }
}
```

--------------------------------------------------------------------------------

## 10) Change Highlights (Context for recent fixes)

- Interactive pre‑warm message is user‑friendly: “Preparing the tool for first use. This first run can take a minute.”
- Wizard and non‑interactive summaries display “Endpoint: Local (STDIO)” for STDIO flows.
- Codex heuristic for generic runners sets `startup_timeout_ms = 60000` by default, preventing first-run timeouts.

--------------------------------------------------------------------------------

## 11) Deep‑Dive Pointers (when more detail is needed)

- Non‑interactive command: `src/commands/configure.ts` (build AgentConfig, preview, confirm, apply, rollback)
- Interactive wizard: `src/commands/interactive.ts` (agent selection, transport/tool prompts, pre‑warm)
- Providers:
  - Codex: `src/agents/codex.ts` (TOML, STDIO only)
  - Gemini: `src/agents/gemini.ts` (JSON `~/.gemini/settings.json`)
  - Cursor: `src/agents/cursor.ts` (prefers `~/.cursor/mcp.json`)
  - Claude: `src/agents/claude.ts` (global plus project‑level mapping)
- Safety primitives: `src/utils/fileOps.ts`, `src/utils/backup.ts`
- STDIO tools: `src/utils/tools.ts`, catalog in `catalog/tools.yaml`

--------------------------------------------------------------------------------

End of brief.

