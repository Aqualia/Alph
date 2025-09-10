# Codex CLI — MCP Server Configuration (Exhaustive Reference)

## 1) Where configuration lives

* **Global file:** `~/.codex/config.toml` (single, user-level config). The project README explicitly points to this path and instructs adding an `mcp_servers` section there. ([GitHub][1])
* **Project/workspace files:** Not currently supported; several issues request per-project config, confirming that **all config is read from `~/.codex/config.toml`** today. ([GitHub][2])
* **Windows path example:** `C:\Users\<User>\.codex\config.toml` (from user reports; same file name, user home directory). ([GitHub][3])

> Note: Some users have observed a `config.json` in the directory; the docs and most reports use **`config.toml`** for authoritative configuration. ([GitHub][4])

---

## 2) MCP section: structure & syntax

Add MCP servers under a TOML table named **`mcp_servers`**, with one sub-table per server:

```toml
# ~/.codex/config.toml

[mcp_servers.<server_name>]
command = "<executable or launcher>"
args    = ["<arg1>", "<arg2>", "..."]
env     = { KEY = "value", OTHER = "value" }
startup_timeout_ms = 20000  # optional
```

* This `mcp_servers` schema and field set are the documented way to declare MCP servers for Codex CLI. ([GitHub][1])
* Real-world examples in issues use this exact shape (see samples below). ([GitHub][5])

### 2.1 Required & optional fields

| Key                  | Type           | Required | Purpose                                                                                                                                                                                                  |
| -------------------- | -------------- | -------: | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `command`            | string         |  **Yes** | Program Codex should launch for the MCP server (e.g., `npx`, `node`, `php`, or the server binary). ([GitHub][5])                                                                                         |
| `args`               | array\<string> |   **No** | Arguments passed to `command` (e.g., package name for `npx`, script path for `node`, or server flags). ([GitHub][5])                                                                                     |
| `env`                | table          |   **No** | Environment variables for the launched process (e.g., API keys). ([GitHub][5])                                                                                                                           |
| `startup_timeout_ms` | integer (ms)   |   **No** | How long Codex waits for this MCP server to come up and enumerate tools before treating startup as a timeout. (Default behavior times out fairly quickly; Windows users often raise this.) ([GitHub][6]) |

> Users on Windows frequently report needing a **larger startup timeout** for some servers. ([GitHub][6])

### 2.2 Server name (`<server_name>`) notes

* The section name after `mcp_servers.` is a **logical identifier** picked by you (e.g., `memory`, `playwright`, `laravel-boost`). Examples in issues show alphanumerics, dashes, and underscores. ([GitHub][7])
* **Name length matters indirectly**: Codex prefixes tool names with an MCP marker and server/tool identifiers; very long names can run into a **64-character limit** on tool/function names (tracked in the repo). Keep server names reasonably short. ([GitHub][8])

---

## 3) Supported transports (as they affect config)

* **Supported today:** Codex **launches local MCP servers over STDIO** (i.e., starts a process and communicates via stdin/stdout). The configuration therefore expects a **`command`** (and optional `args`/`env`)—**not** a URL. ([GitHub][9])
* **Not supported in config:** Direct **HTTP/SSE** transport entries (e.g., `url=...`, `transport=http`) are **rejected** by the schema; the CLI expects a local process definition under `mcp_servers`. ([GitHub][10])

---

## 4) Complete examples (from the repo’s issue tracker)

### 4.1 `npx`-based server (Node package)

```toml
[mcp_servers.context7]
command = "npx"
args    = ["-y", "@upstash/context7-mcp"]
```

(Reported by Windows users; note that `node`/`npx` discovery and timeouts can vary by environment.) ([GitHub][3])

### 4.2 Direct Node script (explicit runtime + entry point)

```toml
[mcp_servers.mcp-custom]
command = "node"
args = [
  "/absolute_path/dist/mcp-custom.js",
  "--transport", "stdio"
]
```

(Example pattern for custom scripts.) ([GitHub][5])

### 4.3 PHP artisan-launched server

```toml
[mcp_servers.laravel-boost]
command = "php"
args    = ["artisan", "boost:mcp"]
```

(Shows non-Node servers work the same way: declare the launcher and args.) ([GitHub][7])

---

## 5) CLI overrides that affect configuration

* Codex exposes a **`-c/--config key=value`** flag to override values that would otherwise be read from `~/.codex/config.toml`. The syntax uses **dotted paths** (e.g., `foo.bar.baz`) and parses the right-hand side as JSON if possible. This is general config behavior and applies to keys across the file. ([GitHub][11])

> Example patterns shown in help include `-c model="o3"` and JSON arrays for keys; for MCP, this mechanism can be used to override fields like `startup_timeout_ms` for a given server, if you construct the dotted path appropriately. (Help text excerpt is from Codex’s own CLI usage.) ([GitHub][11])

---

## 6) Known behaviors & caveats (configuration-relevant)

* **Only `config.toml` is authoritative:** Multiple reports confirm Codex reads from `~/.codex/config.toml`; if it appears ignored, check precedence and CLI flags. ([GitHub][12])
* **Debugging MCP startup via config:** When a server fails to start or times out, users often experiment with `command`, `args`, and **larger `startup_timeout_ms`** in the MCP entry (especially on Windows). ([GitHub][3])
* **SSE/HTTP servers & config:** Attempts to configure an HTTP/SSE endpoint directly in `config.toml` are not supported (schema expects a local process under `mcp_servers`). ([GitHub][9])

---

## 7) Minimal template

```toml
# ~/.codex/config.toml

# ... other Codex keys ...

# Declare one or more MCP servers here:
[mcp_servers.example]
command = "npx"
args    = ["-y", "@modelcontextprotocol/server-memory"]
# env   = { API_KEY = "..." }
# startup_timeout_ms = 20000
```

This template mirrors the structure used throughout the repo’s documentation and issue examples. ([GitHub][1])

---

## 8) Quick reference

* **File:** `~/.codex/config.toml` (Windows: `C:\Users\<User>\.codex\config.toml`). ([GitHub][1])
* **Section:** `[mcp_servers.<server_name>]` with `command`, optional `args`, `env`, `startup_timeout_ms`. ([GitHub][1])
* **Transport:** Local **STDIO** only; **no** direct HTTP/SSE in config. ([GitHub][9])
* **Overrides:** `codex ... -c key=value` (dotted paths; JSON parsing). ([GitHub][11])
* **Per-project config:** Not supported (feature requests exist). ([GitHub][2])
* **Name length caution:** Very long server/tool names can exceed 64-char limits. ([GitHub][8])

---

*Sources: Codex README/config docs and configuration-focused issues in the official `openai/codex` repository. See inline citations.*

[1]: https://github.com/openai/codex/blob/main/README.md?plain=1&utm_source=chatgpt.com "codex/README.md at main · openai/codex · GitHub"
[2]: https://github.com/openai/codex/issues/3120?utm_source=chatgpt.com "Per-project config · Issue #3120 · openai/codex - GitHub"
[3]: https://github.com/openai/codex/issues/2555?utm_source=chatgpt.com "Codex CLI on Windows 11: MCP server (Context7) fails with ... - GitHub"
[4]: https://github.com/openai/codex/issues/1894?utm_source=chatgpt.com "`config.toml` missing/not recognized · Issue #1894 · openai/codex"
[5]: https://github.com/openai/codex/issues/1454?utm_source=chatgpt.com "MCP Configuration and debugging · Issue #1454 · openai/codex - GitHub"
[6]: https://github.com/openai/codex/issues/2905?utm_source=chatgpt.com "MCP needs a greater timeout for startup (Windows)"
[7]: https://github.com/openai/codex/issues/3144?utm_source=chatgpt.com "Laravel Boost MCP fail to start in IDE - GitHub"
[8]: https://github.com/openai/codex/issues/1289?utm_source=chatgpt.com "generated MCP tool names are too long · Issue #1289 - GitHub"
[9]: https://github.com/openai/codex/issues/2320?utm_source=chatgpt.com "SSE based MCP servers are non-configurable · Issue #2320 · openai/codex"
[10]: https://github.com/openai/codex/issues/3196?utm_source=chatgpt.com "MCP HTTP/SSE (Rube/Composio) fails to start with 'request ... - GitHub"
[11]: https://github.com/openai/codex/issues/2800?utm_source=chatgpt.com "profiles for \"codex mcp\" mode: enable \"codex mcp --profile= [model ..."
[12]: https://github.com/openai/codex/issues/2760?utm_source=chatgpt.com "Config.toml | Updated Keys · Issue #2760 · openai/codex - GitHub"
