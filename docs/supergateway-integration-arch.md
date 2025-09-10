# Architecture Addendum: Local MCP Proxy for Codex via Alph (STDIO ↔ HTTP/SSE Bridge)

## 1. Background & Rationale

Alph’s role is to **configure** agent tools to use MCP servers, performing **atomic, rollback-safe writes**, with a provider abstraction and a tools catalog for STDIO servers. Codex is **STDIO-only**; it rejects HTTP/SSE entries. Alph already **pre-warms** generic runners (e.g., `npx`) and, when those runners are used for Codex, sets `startup_timeout_ms = 60000` unless explicitly overridden.&#x20;

MCP now defines **two standard transports**: **stdio** and **Streamable HTTP** (which replaced the prior HTTP+SSE mode; SSE can still be used in practice for streaming). This plan bridges Codex’s local **stdio** to remote **Streamable HTTP or SSE** via a small, external proxy process. ([Model Context Protocol][1])

We will adapt the MIT-licensed **Supergateway** as the proxy (run on demand by Codex), because it **converts between stdio and SSE/Streamable HTTP/WS** with simple flags and has a stable release we can **pin** (3.4.0 is a rollback to 3.2.0 behavior to avoid 3.3.0 regressions). ([GitHub][2], [npm][3])

---

## 2. System Architecture

### 2.1 High-Level Flow

```
Codex CLI (client)
  └─ spawns local STDIO process from ~/.codex/config.toml
        ↳ npx -y supergateway … [stdio <-> http/streamable | sse]
            └─ connects to Remote MCP server over Streamable HTTP (preferred) or SSE
```

* **Alph’s responsibilities:** compose the proxy command, pre-warm when appropriate, then write Codex TOML **atomically** with a backup and rollback on failure. No daemon; Codex owns the proxy lifecycle.&#x20;
* **Proxy capabilities (Supergateway):** bridges **STDIO ↔ SSE** and **STDIO ↔ Streamable HTTP/WS**, with flags such as `--sse`, `--streamableHttp`, `--header`, `--oauth2Bearer`. ([GitHub][2], [LobeHub][4])
* **Transport rationale:** MCP recommends **Streamable HTTP** as the successor to HTTP+SSE (spec update 2025-03-26), while many servers still expose SSE; support both. ([Model Context Protocol][1])

### 2.2 CLI Integration (`alph proxy`)

We introduce a **thin** top-level command for validation and ergonomics; it does **not** become a persistent service.

**Commands**

* `alph proxy run --remote-url <URL> --transport sse|http [--bearer <token>] [--header "K: V"] [--proxy-version vX.Y.Z] [--docker]`
* `alph proxy health --remote-url <URL> --transport sse|http [--header "K: V"] [--bearer <token>]`

**Behavior**

* `run` composes and spawns `npx -y supergateway …` (or `docker run …` when requested), streams logs with **redaction** (see [§2.5 Security & Redaction](#25-security--redaction)).  ([GitHub][2])
* `health` performs a lightweight probe (connect/handshake) against the remote transport and prints a concise status; it does **not** modify configs.
* The CLI is **optional** for users; the canonical path remains `alph configure`, which writes Codex TOML directly (see [§2.3 Provider/Configure Integration](#23-providerconfigure-integration)).&#x20;

### 2.3 Provider/Configure Integration

#### 2.3.1 Interactive flow

* When the user chooses **Codex** and provides a **remote** MCP URL with **HTTP/Streamable HTTP** or **SSE** intent, the wizard offers **“Use local proxy (recommended)”** and collects:

  * `remote-url` (required),
  * `transport` (`http` = Streamable HTTP, `sse`),
  * optional `bearer` (for `Authorization: Bearer`),
  * optional additional headers (`K: V`).
* Alph **pre-warms** `npx supergateway --help` during setup to avoid first-run latency, consistent with existing heuristics.&#x20;

#### 2.3.2 Non-interactive flow

* Flags like `--proxy-transport`, `--proxy-remote-url`, `--proxy-bearer`, `--proxy-header "K: V"` cause Alph to **transform** the in-memory `AgentConfig` into a **STDIO** invocation via Supergateway for Codex (see mapping in [§2.4 Config Mapping](#24-configuration-mapping)).
* Alph then follows its standard **preview → confirm → atomic write + backup → validate/rollback** pipeline.&#x20;

### 2.4 Configuration Mapping

#### 2.4.1 Command composition

Alph constructs a Supergateway argv from minimal inputs:

* For **Streamable HTTP**: `["-y", "supergateway", "--streamableHttp", "<URL>", ...auth/headers]`
* For **SSE**: `["-y", "supergateway", "--sse", "<URL>", ...auth/headers]`
* **Bearer token:** prefer `--oauth2Bearer <TOKEN>` which sets `Authorization: Bearer …` (or emit `--header "Authorization: Bearer …"` if explicitly requested). ([GitHub][2])

**Example (HTTP/Streamable HTTP):**

```bash
npx -y supergateway --streamableHttp https://mcp.example.com/mcp \
  --oauth2Bearer "$TOKEN" \
  --header "X-Org: aqualia"
```

**Example (SSE):**

```bash
npx -y supergateway --sse https://mcp.example.com/sse \
  --oauth2Bearer "$TOKEN"
```

#### 2.4.2 Codex TOML (written by Alph)

```toml
# ~/.codex/config.toml
[mcp_servers.remote-service]
command = "npx"
args = ["-y", "supergateway", "--streamableHttp", "https://mcp.example.com/mcp", "--oauth2Bearer", "${TOKEN}", "--header", "X-Org: aqualia"]
# Heuristic for generic runners:
startup_timeout_ms = 60_000
```

* Codex remains **STDIO-only**; Alph writes a STDIO entry that **spawns the proxy** with the correct transport flags.&#x20;
* The `startup_timeout_ms` heuristic applies automatically for `npx`/`dlx` unless overridden by the user.&#x20;

#### 2.4.3 AgentConfig transform (in-memory)

If `transport` = `http` or `sse` **and** `agent` = `codex`, Alph rewrites the `AgentConfig`:

* `transport: 'stdio'`
* `command: 'npx'`
* `args: buildSupergatewayArgs({ transport, url, headers, bearer })`
* if `command` ∈ {`npx`, `pnpm dlx`, `yarn dlx`} and `timeout` unset → apply `startup_timeout_ms = 60000`.&#x20;

### 2.5 Security & Redaction

* **Header mapping:** `--bearer` maps to `Authorization: Bearer …` using Supergateway’s `--oauth2Bearer`; arbitrary headers use repeated `--header "K: V"`. ([GitHub][2])
* **Redaction policy:** Alph’s previews and logs **never print secrets**. Tokens and sensitive header values are **redacted** in all CLI summaries and stderr streams. Preserve Alph’s existing preview redaction behavior.&#x20;
* **Spec alignment:** Streamable HTTP supports standard HTTP auth (bearer/API keys/custom headers); this mapping is faithful to the transport spec. ([Model Context Protocol][5])

> **Version Pinning:** Default to `supergateway@3.4.0` (rollback to stable 3.2.0 behavior after 3.3.0 issues). Allow an override flag but warn when unpinned. ([GitHub][6])

> **Note on Transport Choice:** Prefer **Streamable HTTP** where available; support **SSE** for backward compatibility per the spec’s transition notes. ([Model Context Protocol][1])

### 2.6 *(Intentionally omitted)*

> **Note: Section 2.6 (Air-Gapped Mode) is intentionally excluded as per requirements.**

### 2.7 Platform Compatibility

Provide equal depth for each OS; behavior is consistent unless specified.

#### 2.7.1 Windows

* **Shell & quoting:** Use `spawn` with argv arrays to avoid quoting pitfalls. Do not rely on shell interpolation.
* **First-run latency:** Always **pre-warm** `npx -y supergateway --help` in the wizard; Codex TOML uses `startup_timeout_ms = 60000` for generic runners when unspecified. These align with Alph’s existing heuristics.&#x20;
* **Path length/atomic writes:** Rely on Alph’s `fileOps.ts` which already handles long-path and atomic rename/copy semantics on Windows; no new persistence is introduced.&#x20;
* **Docker optionality:** When `--docker` is used, prefer `--network host` equivalents are **not** available on Windows; not required for stdio-bridged local process since Codex spawns the proxy locally.

#### 2.7.2 Linux

* **Process model:** Use `spawn` of `npx` (or `docker run`) with no TTY requirement. Ensure environment propagation for tokens when the user opts for env-vars (still redacted in summaries).
* **File permissions:** Respect user home ownership for `~/.codex/config.toml`; atomic write via temp-file + rename.&#x20;
* **Networking:** No special kernel tuning required; Streamable HTTP/SSE uses standard HTTP semantics. ([Model Context Protocol][5])

#### 2.7.3 macOS

* **Gatekeeper/Quarantine:** Using `npx` avoids quarantine issues typical of custom binaries; no codesign changes needed.
* **Resource limits:** Defaults suffice; the proxy is ephemeral and spawned by Codex.
* **File ops:** Same atomic write and backup semantics as Linux/macOS per Alph’s primitives.&#x20;

---

## 3. Interfaces & Contracts

### 3.1 Proxy Command Composer (`src/utils/proxy.ts`)

```ts
export interface ProxyOpts {
  transport: 'http' | 'sse';          // 'http' => --streamableHttp, 'sse' => --sse
  url: string;
  headers?: Record<string, string>;
  bearer?: string;                     // maps to --oauth2Bearer
  useDocker?: boolean;
  proxyVersion?: string;               // default pinned 3.4.0
}

export function buildSupergatewayArgs(opts: ProxyOpts): string[];  // argv only
export function redactForLogs<T extends string | string[] | object>(x: T): T;
```

* `buildSupergatewayArgs` returns **argv only**; higher layers decide `command = 'npx' | 'docker'`.
* **No secrets** should appear in returned arrays unless required for execution; any summaries must pass through `redactForLogs`.

### 3.2 Provider Mapping (Codex)

```ts
// In-memory AgentConfig → provider-specific TOML (Codex)
if (agent === 'codex' && (transport === 'http' || transport === 'sse')) {
  config.transport = 'stdio';
  config.command = useDocker ? 'docker' : 'npx';
  config.args = buildSupergatewayArgs(opts);
  // Heuristic for generic runners:
  if (!config.timeout && (config.command === 'npx')) setStartupTimeoutMs(60000);
}
```

* Codex **TOML shape**: `[mcp_servers.<id>]` with `command`, `args`, optional `env`, and `startup_timeout_ms`. **HTTP/SSE are invalid** for Codex.&#x20;

### 3.3 Tools Catalog (`catalog/tools.yaml`)

* **id:** `mcp-proxy-supergateway`
* **detect:** `npx -y supergateway --version` (or `docker run --rm ghcr.io/supercorp-ai/supergateway:3.4.0 --help`) ([GitHub][7])
* **preWarm:** `npx -y supergateway --help` (primes cache; aligns with Alph heuristics).&#x20;
* **health (optional):** invoke a short remote handshake with `--streamableHttp <URL>` or `--sse <URL>` and expect a ready/handshake signal (implementation depends on upstream semantics). ([GitHub][2])

### 3.4 Safety Primitives (Invariants)

* **Atomic write + backup + rollback** on any provider file change; if post-write validation fails, automatically roll back to the previous backup.&#x20;
* **No persistent state** for the proxy within Alph; Codex owns runtime lifecycle.

---

## 4. Dependencies & Versions

* **Proxy:** `supergateway` (default **pinned** to `3.4.0`), install via `npx -y supergateway` or run via `docker` image. Pin because 3.4.0 is a **rollback** to the stable 3.2.0 logic after 3.3.0 concurrency regressions. ([GitHub][6])
* **Transports:** Align with MCP’s **Streamable HTTP**; keep **SSE** support for compatibility. ([Model Context Protocol][1])

---

## 5. Validation & Health

* **`alph proxy health`**: attempt connection to `<URL>` using the selected transport. For Streamable HTTP, expect an MCP endpoint to accept POST and optionally provide SSE for streaming per spec. For SSE, expect an event stream to open. ([Model Context Protocol][1])
* **Post-configure validation (Codex):** after atomic write, optionally prompt to run a **trial request** through Codex to the remote server and report success/failure.&#x20;

---

## 6. Logging, Telemetry & Redaction

* **Redaction:** Tokens and sensitive headers are always redacted in logs and previews. Reuse Alph’s existing **preview** machinery for summaries.&#x20;
* **Proxy stderr/stdout:** Streamed to the console with redaction filters; include process PID and a minimal lifecycle banner (start/stop/exit code).
* **Optional lightweight metrics:** counts of configure success/failure; **no PII**.

---

## 7. Failure Modes & Mitigations

* **First-run timeouts** (slow `npx`): mitigated by **pre-warm** + `startup_timeout_ms = 60000` for Codex’s `npx`-based entries.&#x20;
* **Remote transport mismatch** (server only supports Streamable HTTP but user selects SSE, or vice versa): clearly error with remediation (“Use `--transport http`” / “Use `--transport sse`”). (Spec recommends Streamable HTTP going forward.) ([Model Context Protocol][1])
* **Proxy regressions:** minimized via **version pinning**; surface pinned version in summaries and allow override flags with warnings. ([GitHub][6])
* **Invalid TOML/parse errors:** caught by provider validation; auto **rollback** to backup.&#x20;

---

## 8. Security Considerations

* **Auth handling:** Prefer `--oauth2Bearer` for Authorization (or `--header` explicitly). Never echo raw tokens in terminals, previews, or logs. ([GitHub][2])
* **Spec guidance:** Streamable HTTP servers should validate `Origin` and bind to localhost when local; these are server-side best practices but inform user documentation. ([Model Context Protocol][1])

---

## 9. Documentation Artifacts

* **User Guide updates:**

  * New section “Remote MCP via Local Proxy (Codex)” with examples for Streamable HTTP and SSE.
  * Troubleshooting: timeouts, version pinning, choosing transports.
* **CLI help:** `alph proxy --help` and `alph configure --help` updated with proxy options and redaction notes.&#x20;

---

## 10. Readiness Criteria (for Release & QA)

* **Config safety:** 100% of writes create a backup; simulated parse/rollback succeeds.&#x20;
* **E2E smoke:** `alph proxy run` connects to a known demo Streamable HTTP endpoint and SSE endpoint (test double); Codex can enumerate the configured MCP server post-write.
* **Windows/Linux/macOS**: identical functional outcomes; Windows pre-warm verified.&#x20;
* **Pinned version surfaced** in `alph proxy run` startup banner and in configure previews. ([GitHub][6])

---

## 11. References

* **Alph CLI — Agent Hand-off Brief** (provider abstraction, atomic writes, Codex STDIO-only, pre-warm & startup timeout):&#x20;
* **MCP Transports (Spec 2025-03-26)** — stdio & Streamable HTTP; Streamable HTTP replaces HTTP+SSE: ([Model Context Protocol][1])
* **MCP Architecture Overview** — transport descriptions and auth patterns: ([Model Context Protocol][5])
* **Supergateway (README/NPM/Releases)** — stdio↔SSE/Streamable HTTP/WS bridging, MIT license, v3.4.0 rollback: ([GitHub][2], [npm][3])

---


[1]: https://modelcontextprotocol.io/specification/2025-03-26/basic/transports?utm_source=chatgpt.com "Transports - Model Context Protocol"
[2]: https://github.com/supercorp-ai/supergateway/blob/main/README.md?utm_source=chatgpt.com "supergateway/README.md at main · supercorp-ai/supergateway · GitHub"
[3]: https://www.npmjs.com/package/supergateway?utm_source=chatgpt.com "supergateway - npm"
[4]: https://lobehub.com/mcp/supercorp-ai-supergateway?utm_source=chatgpt.com "Supergateway | MCP Servers · LobeHub"
[5]: https://modelcontextprotocol.io/docs/learn/architecture?utm_source=chatgpt.com "Architecture overview - Model Context Protocol"
[6]: https://github.com/supercorp-ai/supergateway/releases?utm_source=chatgpt.com "Releases · supercorp-ai/supergateway - GitHub"
[7]: https://github.com/supercorp-ai/supergateway/pkgs/container/supergateway?utm_source=chatgpt.com "Package supergateway · GitHub"
