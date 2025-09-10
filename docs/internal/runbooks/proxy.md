# Proxy Integration Runbook

This runbook helps triage and resolve common issues when using Alph’s local proxy to connect Codex (STDIO-only) to remote MCP servers.

## First-Run Latency (Timeout)
- Symptom: Proxy fails to start on first run; Codex times out.
- Likely cause: `npx` downloads dependencies.
- Steps:
  - Verify pre-warm: run `npx -y supergateway --help` once.
  - Ensure Codex TOML has `startup_timeout_ms = 60000` for generic runners.
  - Re-run: `alph proxy health --remote-url <URL> --transport http`.

## Wrong Transport (SSE vs HTTP)
- Symptom: Connection opens but streaming fails/hangs.
- Steps:
  - Prefer Streamable HTTP per spec: `--proxy-transport http`.
  - Use SSE only if server exposes SSE endpoint.
  - Validate with `alph proxy health` against the chosen URL.

## 401 Unauthorized / Invalid Headers
- Symptom: Health fails with 401 or server rejects requests.
- Steps:
  - Add bearer: `--proxy-bearer <TOKEN>` (redacted in logs).
  - Add headers: `--proxy-header "K: V"` (repeatable).
  - Confirm no plaintext secrets appear in logs; redaction should mask values.

## Version Pinning & Overrides
- Default pin: `supergateway@3.4.0`.
- Override:
  - Environment: `ALPH_PROXY_VERSION=3.2.0`
  - CLI: `alph proxy run --proxy-version 3.2.0`
- Rollback if regressions: pin a known-good version and retry.

## Rollback & Backups
- Alph writes atomically and creates timestamped backups.
- On validation failure, Alph auto-restores the last good backup.
- Drill reference: `npm run drills:rollback`.

## File Locations & Commands
- Codex TOML: `~/.codex/config.toml`.
- Configure via proxy (HTTP):
  - `alph setup --agents Codex --proxy-transport http --proxy-remote-url https://mcp.example.com/mcp --yes`
- Health check:
  - `alph proxy health --remote-url <URL> --transport http|sse`

## Decision Trees
- If Codex ignores server → Is entry STDIO? If not, run `alph setup` with proxy flags.
- If timeout → Pre-warm `npx`, increase timeout; verify network.
- If 401 → Add bearer/header; validate via `proxy health`.
- If regression post-update → Pin older version; re-validate.
