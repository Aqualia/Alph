**Phase 1 — high-level checklist (conceptual)**

* Lock the **data-model** (catalog + schemas) for agents, protocol profiles, and STDIO tool registry.
* Implement **atomic I/O** with Windows cross-volume & long-path safeguards.
* Ship **interactive install/remove** (configs only) with **default-enabled STDIO** discover → install → health-check.
* Add **protocol-aware rendering** (HTTP/SSE/STDIO) with concrete header policies & examples per agent.
* Finalize **feature flags & CLI opts** (defaults + opt-outs) and update docs.
* Stand up **cross-OS test matrix** and performance/security checks.

---

# Alph CLI v2.0 — Phase 1 Implementation Task List (with Schemas)

> Grounding references for config locations, transports, and protocol behavior: Cursor’s MCP docs (locations & `mcp.json` shape), Claude Code MCP docs (scopes, transports, JSON shapes), Gemini CLI docs & issues (settings.json with `mcpServers`, transports), SSE header semantics, XDG spec, Windows path/long-path constraints, Node.js FS behavior, and atomic write best practices. ([Cursor][1], [Anthropic][2], [GitHub][3], [security.googlecloudcommunity.com][4], [MDN Web Docs][5], [specifications.freedesktop.org][6], [Microsoft Learn][7], [nodejs.org][8])

---

## EPIC A — Configuration-Driven Core (Single Source of Truth)

**Goal**
Drive all reads/writes from a **central catalog** with per-agent **path templates**, **container keys**, and **protocol profiles** (HTTP/SSE/STDIO), validated by schema.

### A1 — Define catalog & loader (types + validation)

**Deliverables**

1. `catalog/agents.yaml` (data)
2. `schema/agents.schema.json` (JSON Schema)
3. `src/catalog/loader.ts` (parse + validate with Zod/JSON-Schema)

**Agents catalog (copy-pasteable example)**

```yaml
# catalog/agents.yaml
version: 1
defaults:
  containerKey: mcpServers
  # policy for headers if not overridden below
  headerPolicies:
    bearer:
      headerName: Authorization
      format: "Bearer ${TOKEN}"
agents:
  - id: cursor
    displayName: Cursor
    writeMode: file           # file | cli
    scopes:
      project:
        pathTemplate: "${projectDir}/.cursor/mcp.json"
      user:
        pathTemplate: "${home}/.cursor/mcp.json"
    containerKey: mcpServers
    protocolProfiles:
      stdio:
        shape: cursorStdio
        fields:
          command: required
          args: optional
          env: optional
      sse:
        shape: genericSSE
        fields:
          url: required
          headers: optional
        headerPolicyRef: bearer
      http:
        shape: genericHTTP
        fields:
          url: required
          headers: optional
        headerPolicyRef: bearer

  - id: claude
    displayName: Claude Code
    writeMode: file           # project scope file; user scope via CLI is recommended
    scopes:
      project:
        pathTemplate: "${projectDir}/.mcp.json"
      user:
        pathTemplate: null    # managed by `claude mcp --scope user`; Alph prefers CLI for user scope
    containerKey: mcpServers
    protocolProfiles:
      stdio:
        shape: claudeStdio
        fields: { command: required, args: optional, env: optional }
      sse:
        shape: genericSSE
        fields: { url: required, headers: optional }
        headerPolicyRef: bearer
      http:
        shape: genericHTTP
        fields: { url: required, headers: optional }
        headerPolicyRef: bearer

  - id: gemini
    displayName: Gemini CLI
    writeMode: file
    scopes:
      project:
        pathTemplate: "${projectDir}/.gemini/settings.json"
      user:
        pathTemplate: "${home}/.gemini/settings.json"
    containerKey: mcpServers
    protocolProfiles:
      stdio:
        shape: geminiStdio
        fields: { command: required, args: optional, env: optional }
      sse:
        shape: genericSSE
        fields: { url: required, headers: optional }
        headerPolicyRef: bearer     # override allowed per-protocol if Gemini diverges
      http:
        shape: genericHTTP
        fields: { url: required, headers: optional }
        headerPolicyRef: bearer
```

* Cursor locations and `mcp.json` container key are documented in Cursor docs (project `.cursor/mcp.json`, user `~/.cursor/mcp.json`). ([Cursor][1])
* Claude **project** scope uses `.mcp.json` at project root; user scope paths are managed via the `claude mcp` CLI and scopes rather than a documented manual path. We therefore default to **file** writes for project scope and **CLI** for user scope. ([Anthropic][2])
* Gemini CLI uses a `settings.json` that includes `mcpServers`; user path commonly `~/.gemini/settings.json` (community & issue threads); note there’s an open discussion to add XDG locations on Linux. ([security.googlecloudcommunity.com][4], [GitHub][9])

**JSON Schema (agents catalog)**

```json
{
  "$id": "https://aqualia.dev/schemas/alph/agents.schema.json",
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "required": ["version", "agents"],
  "properties": {
    "version": { "type": "integer", "enum": [1] },
    "defaults": {
      "type": "object",
      "properties": {
        "containerKey": { "type": "string" },
        "headerPolicies": {
          "type": "object",
          "additionalProperties": {
            "type": "object",
            "properties": {
              "headerName": { "type": "string" },
              "format": { "type": "string" }
            },
            "required": ["headerName", "format"]
          }
        }
      }
    },
    "agents": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["id", "displayName", "writeMode", "scopes", "containerKey", "protocolProfiles"],
        "properties": {
          "id": { "type": "string" },
          "displayName": { "type": "string" },
          "writeMode": { "type": "string", "enum": ["file", "cli"] },
          "scopes": {
            "type": "object",
            "properties": {
              "project": { "type": ["object", "null"], "properties": { "pathTemplate": { "type": ["string", "null"] } } },
              "user":    { "type": ["object", "null"], "properties": { "pathTemplate": { "type": ["string", "null"] } } }
            }
          },
          "containerKey": { "type": "string" },
          "protocolProfiles": {
            "type": "object",
            "properties": {
              "stdio": { "$ref": "#/definitions/profile" },
              "sse":   { "$ref": "#/definitions/profile" },
              "http":  { "$ref": "#/definitions/profile" }
            }
          }
        }
      }
    }
  },
  "definitions": {
    "profile": {
      "type": "object",
      "properties": {
        "shape": { "type": "string" },
        "fields": {
          "type": "object",
          "properties": {
            "command": { "type": "string", "enum": ["required", "optional"] },
            "args":    { "type": "string", "enum": ["required", "optional"] },
            "env":     { "type": "string", "enum": ["required", "optional"] },
            "url":     { "type": "string", "enum": ["required", "optional"] },
            "headers": { "type": "string", "enum": ["required", "optional"] }
          }
        },
        "headerPolicyRef": { "type": ["string", "null"] }
      }
    }
  }
}
```

**Path template helpers (examples per OS)**

| Token           | Linux                           | macOS                                           | Windows (Roaming)     |
| --------------- | ------------------------------- | ----------------------------------------------- | --------------------- |
| `${home}`       | `/home/<user>`                  | `/Users/<user>`                                 | `C:\Users\<user>`     |
| `${projectDir}` | repo root                       | repo root                                       | repo root             |
| XDG config      | `${XDG_CONFIG_HOME:-~/.config}` | *n/a (use `$HOME/Library/Application Support`)* | `%APPDATA%` (Roaming) |

* XDG base dirs (Linux) define `XDG_CONFIG_HOME` defaults; macOS uses `~/Library/Application Support`; Windows uses `%APPDATA%` for roaming profile data. ([specifications.freedesktop.org][6], [Apple Developer][10], [Microsoft Learn][11])

**DoD**

* Loader validates `agents.yaml` against schema; clear errors on missing fields.
* Path expansion supports `${home}`, `${projectDir}`, and XDG/%APPDATA% where applicable.

---

## EPIC B — Interactive Agent Management (Install/Remove) **\[Critical]**

**Scope confirmation:** Only **server configurations** are installed/removed; the agents themselves remain intact (your clarification). ✅

### B1 — Install (interactive) flow

* Detect agents → choose agent(s)/scope → select transport → prompt for auth/header policy → if STDIO then delegate to EPIC C → **preview redacted diff** → **atomic write**.
* Cursor locations & `mcp.json` are official; Claude scopes via CLI (supports `--scope local/project/user`); Gemini uses `settings.json` with `mcpServers`. ([Cursor][1], [Anthropic][2], [GitHub][3])

### B2 — Remove (interactive) flow

* Present existing server entries; show diff; confirm; remove with backup + rollback.
* UX explicitly states: “Removing **config entries**; agent apps remain.”

### B3 — Docs

* README/USER\_GUIDE emphasize **interactive install/remove** as implemented and critical; sample flows for each agent & transport.

**DoD**

* End-to-end for Cursor/Gemini/Claude across macOS/Windows/Linux with atomic safety.
* Updated docs with screenshots and examples.

---

## EPIC C — STDIO Local MCP Servers (Default-Enabled) **\[Critical]**

**Goal**
Default-enable STDIO discover → install → health-check inside the wizard.

### C1 — Tool registry & schema

**`catalog/tools.yaml` (copy-pasteable example)**

```yaml
# Minimal examples; extend per tool
tools:
  - id: "github-mcp"
    bin: "github-mcp"
    discovery:
      commands: ["github-mcp", "npx -y @modelcontextprotocol/github-mcp"]
    installers:
      macos:
        - type: npm
          command: "npm i -g @modelcontextprotocol/github-mcp"
      linux:
        - type: npm
          command: "npm i -g @modelcontextprotocol/github-mcp"
      windows:
        - type: npm
          command: "npm i -g @modelcontextprotocol/github-mcp"
    health:
      version: { command: "github-mcp --version" }
      probe:   { command: "github-mcp --help" }
```

**`schema/tools.schema.json` (excerpt)**

```json
{
  "$id": "https://aqualia.dev/schemas/alph/tools.schema.json",
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "properties": {
    "tools": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["id", "bin", "installers"],
        "properties": {
          "id": { "type": "string" },
          "bin": { "type": "string" },
          "discovery": {
            "type": "object",
            "properties": {
              "commands": { "type": "array", "items": { "type": "string" } }
            }
          },
          "installers": {
            "type": "object",
            "properties": {
              "macos":   { "type": "array", "items": { "type": "object" } },
              "linux":   { "type": "array", "items": { "type": "object" } },
              "windows": { "type": "array", "items": { "type": "object" } }
            }
          },
          "health": {
            "type": "object",
            "properties": {
              "version": { "type": "object", "properties": { "command": { "type": "string" } } },
              "probe":   { "type": "object", "properties": { "command": { "type": "string" } } }
            }
          }
        }
      }
    }
  }
}
```

### C2 — Default-on install with opt-out

* If the STDIO binary is missing, run installer **by default**; echo commands; support `--no-install` to skip.
* Update positioning: v2 permits network calls **for tool installs** (default-on). ([Anthropic][2])

### C3 — Health checks & abort-on-failure

* After install, run `--version` and a quick command; on failure, abort write & provide remediation.

**DoD**

* Clean machine → STDIO selected → tool installed → health passed → config rendered & written.

---

## EPIC D — Protocol-Aware Rendering (HTTP/SSE/STDIO)

**Goal**
Render the exact, agent-specific shapes with correct fields & headers.

### D1 — Minimal “shape” examples (per agent, per protocol)

**Cursor** (project scope file)
*STDIO*

```json
{
  "mcpServers": {
    "github": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/github-mcp"],
      "env": { "GITHUB_TOKEN": "${GITHUB_TOKEN}" }
    }
  }
}
```

*SSE*

```json
{ "mcpServers": { "linear": { "type": "sse", "url": "https://mcp.linear.app/sse",
  "headers": { "Authorization": "Bearer ${LINEAR_TOKEN}" } } } }
```

*HTTP (streamable)*

```json
{ "mcpServers": { "notion": { "type": "http", "url": "https://mcp.notion.com/mcp",
  "headers": { "Authorization": "Bearer ${NOTION_TOKEN}" } } } }
```

(Transports and configuration locations are documented by Cursor.) ([Cursor][1])

**Claude Code** (project scope `.mcp.json`)
*STDIO*

```json
{
  "mcpServers": {
    "claude-code": { "command": "claude", "args": ["mcp", "serve"], "env": {} }
  }
}
```

*SSE*

```json
{
  "mcpServers": {
    "linear": {
      "type": "sse",
      "url": "https://mcp.linear.app/sse",
      "headers": { "Authorization": "Bearer ${LINEAR_TOKEN}" }
    }
  }
}
```

*HTTP*

```json
{
  "mcpServers": {
    "notion": {
      "type": "http",
      "url": "https://mcp.notion.com/mcp",
      "headers": { "Authorization": "Bearer ${NOTION_TOKEN}" }
    }
  }
}
```

(Shapes & CLI flags per Anthropic docs; scopes supported by `claude mcp --scope …`.) ([Anthropic][2])

**Gemini CLI** (`settings.json`)
*STDIO*

```json
{
  "mcpServers": {
    "github": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/github-mcp"],
      "env": { "GITHUB_TOKEN": "${GITHUB_TOKEN}" }
    }
  }
}
```

*SSE*

```json
{ "mcpServers": { "linear": { "type": "sse", "url": "https://mcp.linear.app/sse",
  "headers": { "Authorization": "Bearer ${LINEAR_TOKEN}" } } } }
```

*HTTP*

```json
{ "mcpServers": { "notion": { "type": "http", "url": "https://mcp.notion.com/mcp",
  "headers": { "Authorization": "Bearer ${NOTION_TOKEN}" } } } }
```

(Gemini reads `mcpServers` from `settings.json`; transports include STDIO/SSE/HTTP per docs/issues.) ([GitHub][3], [gemini-cli.xyz][12])

### D2 — Header policies & SSE notes

* Default **bearer** policy: `Authorization: Bearer ${TOKEN}`; allow per-protocol override if an agent diverges (schema supports `headerPolicyRef`).
* SSE uses `text/event-stream` framing; clients may send `Accept: text/event-stream` and servers respond with the SSE stream. Keep this policy configurable. ([MDN Web Docs][5])

**DoD**

* Snapshot tests assert exact render for each agent × protocol.
* Docs show these minimal shapes verbatim.

---

## EPIC E — Safe, Atomic File I/O (cross-platform)

**Goal**
Guarantee atomic writes with robust Windows behavior (cross-volume rename & long-path).

### E1 — Atomic write strategy

* **Same-dir temp → fs.rename** (atomic on same filesystem).
* If **EXDEV** / cross-device, fall back to **copy + fsync + replace** (or use proven `write-file-atomic`). ([nodejs.org][8], [Stack Overflow][13], [GitHub][14])

### E2 — Windows specifics

* Handle **MAX\_PATH**: support `\\?\` prefix when needed and document enabling **LongPathsEnabled**; detect and warn if disabled. ([Microsoft Learn][7], [GitHub][15])
* Avoid cross-volume temporary files: create temp files **in the target directory** to prevent `EXDEV`. ([Stack Overflow][13])
* Normalize paths via Node’s `path` utilities; avoid manual separators. ([Stack Overflow][16])

**DoD**

* I/O tests for: same-volume atomic rename; simulated EXDEV fallback; long-path (>260) behavior with informative guidance.

---

## Feature Flags & CLI Options (Phase 1)

**Defaults**

* **STDIO installs: ON by default** (in interactive flow).
* Atomic I/O: **auto** (same-dir temp + rename; EXDEV fallback).

**CLI**

* `--no-install` — opt-out of default STDIO installs.
* `--install-manager <npm|brew|pipx|cargo>` — prefer installer.
* `--transport <stdio|sse|http>` — preferred transport.
* `--header "Header: value"` / `--bearer <token>` — inject headers.
* `--scope <project|user>` — target scope (Claude user scope via CLI). ([Anthropic][2])
* `--atomic-mode <auto|copy|rename>` — force strategy.
* `--dry-run` — render & diff only.
* `--no-backup` — disable backup (not recommended).
* `--no-color`, `--json` — output formatting.

**Environment toggles**

* `ALPH_NO_INSTALL=1` — default-install off.
* `ALPH_DEFAULT_SCOPE=project|user` — scope default.
* `ALPH_LONG_PATHS=1` — enable Windows long-path handling hinting.
* `ALPH_BACKUP_DIR=/path` — override backup location.

---

## Testing & NFRs (Phase 1)

* **Performance**: P99 < 250ms for `status` & setup **dry-run** per agent on warm cache (parallel reads, minimal FS ops).
* **Security**: Never store secrets; redact previews; encourage env-vars.
* **Cross-OS matrix**: macOS, Windows, Linux × (Cursor, Gemini, Claude) × (HTTP, SSE, STDIO).
* **Docs**: Update README/USER\_GUIDE to reflect **interactive install/remove (critical)**, **default-enabled STDIO**, and amended v2 positioning. ([Cursor][1], [Anthropic][2], [GitHub][3])

---

## Milestones & Sequencing

1. **M0** — Schemas & loader (EPIC A1) → green unit tests.
2. **M1** — Atomic I/O (EPIC E) and path expansion; perf harness.
3. **M2** — Protocol rendering + snapshots (EPIC D).
4. **M3** — Interactive install/remove (EPIC B).
5. **M4** — STDIO default lifecycle (EPIC C).
6. **M5** — CI matrix + docs + release notes.

---

## Blockers, Dependencies, Proactive Communication

* **Gemini pathing (Linux)**: XDG support is tracked in upstream issues; our catalog uses `~/.gemini/settings.json` with a note to migrate if/when upstream adds XDG. ([GitHub][9])
* **Windows long paths**: Users may need to enable `LongPathsEnabled`; we’ll detect and guide. ([Microsoft Learn][7])
* **SSE subtlety**: Keep header policy configurable; rely on MDN/W3C guidance for `text/event-stream`. ([MDN Web Docs][5], [W3C][17])

---

## Validation vs your feedback (cross-check)

* **Data-model schemas** now included (catalog + tools + JSON Schema). ✅
* **Feature flags** (concrete CLI & env names) added. ✅
* **Windows atomic I/O** (EXDEV, long-path, same-dir temp) explicitly called out. ✅
* **Protocol examples** (HTTP/SSE/STDIO) for Cursor, Claude, Gemini included. ✅
* **Path templates per OS** table provided. ✅
* **Research** backed by current docs & standards; citations added. ✅

If you want, I’ll convert each EPIC task into GitHub issues with labels/milestones and drop the schemas into `schema/` with a `make validate` script (Zod + AJV).

[1]: https://docs.cursor.com/context/model-context-protocol "Cursor – Model Context Protocol (MCP)"
[2]: https://docs.anthropic.com/en/docs/claude-code/mcp "Connect Claude Code to tools via MCP - Anthropic"
[3]: https://github.com/google-gemini/gemini-cli/blob/main/docs/tools/mcp-server.md "gemini-cli/docs/tools/mcp-server.md at main · google-gemini/gemini-cli · GitHub"
[4]: https://security.googlecloudcommunity.com/google-security-operations-2/google-cloud-security-mcp-servers-in-gemini-cli-922?utm_source=chatgpt.com "Google Cloud Security MCP Servers in Gemini CLI | Community"
[5]: https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events/Using_server-sent_events?utm_source=chatgpt.com "Using server-sent events - MDN Web Docs"
[6]: https://specifications.freedesktop.org/basedir-spec/latest/?utm_source=chatgpt.com "XDG Base Directory Specification - freedesktop.org"
[7]: https://learn.microsoft.com/en-us/windows/win32/fileio/maximum-file-path-limitation?utm_source=chatgpt.com "Maximum Path Length Limitation - Win32 apps | Microsoft Learn"
[8]: https://nodejs.org/api/fs.html?utm_source=chatgpt.com "File system | Node.js v24.6.0 Documentation"
[9]: https://github.com/google-gemini/gemini-cli/issues/1825?utm_source=chatgpt.com "respect XDG specs · Issue #1825 · google-gemini/gemini-cli - GitHub"
[10]: https://developer.apple.com/documentation/foundation/url/applicationsupportdirectory?utm_source=chatgpt.com "applicationSupportDirectory | Apple Developer Documentation"
[11]: https://learn.microsoft.com/en-us/windows/deployment/usmt/usmt-recognized-environment-variables?utm_source=chatgpt.com "Recognized environment variables | Microsoft Learn"
[12]: https://gemini-cli.xyz/docs/en/tools/mcp-server?utm_source=chatgpt.com "MCP servers with the Gemini CLI | Gemini CLI Docs"
[13]: https://stackoverflow.com/questions/43206198/what-does-the-exdev-cross-device-link-not-permitted-error-mean?utm_source=chatgpt.com "node.js - What does the \"EXDEV: cross-device link not permitted\" error ..."
[14]: https://github.com/npm/write-file-atomic?utm_source=chatgpt.com "GitHub - npm/write-file-atomic: Write files in an atomic fashion w ..."
[15]: https://github.com/nodejs/node/issues/50753?utm_source=chatgpt.com "Long node_modules paths cannot be found on Windows when"
[16]: https://stackoverflow.com/questions/31847712/node-js-fs-module-and-windows-paths?utm_source=chatgpt.com "Node.js fs module and windows paths - Stack Overflow"
[17]: https://www.w3.org/TR/2012/WD-eventsource-20120426/?utm_source=chatgpt.com "Server-Sent Events - World Wide Web Consortium (W3C)"
