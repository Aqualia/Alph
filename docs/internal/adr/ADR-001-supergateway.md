# ADR-001: Adopt Supergateway as Local MCP Proxy (STDIO ↔ Streamable HTTP/SSE)

- Status: Accepted
- Date: 2025-09-10

## Context

Codex CLI only supports MCP servers launched via STDIO. Many MCP servers are exposed remotely via HTTP transports. The Model Context Protocol now defines two standard transports: stdio and Streamable HTTP (successor to the older HTTP+SSE pattern; SSE remains widely used in practice). To connect Codex (STDIO-only) to remote MCP servers, Alph will configure a local proxy process that bridges STDIO ↔ Streamable HTTP or SSE.

We evaluated building and maintaining a bespoke proxy versus adopting an off‑the‑shelf bridge. Supergateway is a mature, MIT‑licensed proxy that translates between STDIO and HTTP/SSE/WebSocket with simple flags and stable releases. We can pin a known-good version and override when needed.

## Decision

- Adopt Supergateway as the local MCP proxy process, spawned on demand by Codex.
- Prefer Streamable HTTP for remote transport; support SSE for compatibility.
- Pin default proxy version to 3.4.0 (a rollback to 3.2.0 behavior to avoid 3.3.0 regressions per release notes). Allow overrides via CLI/config.
- Alph composes the `npx -y supergateway …` argv (or `docker run …` when requested), writes Codex TOML atomically with backup/rollback, and never persists proxy state.
- Strictly redact secrets in previews and logs (bearer tokens, sensitive headers).

## Rationale

- MCP transport guidance recommends Streamable HTTP as the successor to HTTP+SSE, while maintaining compatibility with SSE in many servers.
- Supergateway already provides the required bridging capabilities with minimal integration effort and broad platform support (Windows/macOS/Linux), reducing maintenance risk.
- Version pinning ensures stability; users may opt-in to newer versions once validated.

## Alternatives

- Build-from-scratch proxy:
  - Pros: Full control, tailored logging and perf.
  - Cons: Higher implementation and maintenance cost, security surface area, and CI burden across OSes.
- Other community proxies:
  - Varying maturity and stability; Supergateway’s CLI and release cadence are a better fit for near-term reliability.

## Consequences

- Alph adds a thin `alph proxy` command (run/health) and a tools catalog entry for Supergateway detection/pre-warm.
- Codex TOML remains STDIO-only; Alph maps remote HTTP/SSE inputs into a local STDIO command using Supergateway args.
- CI adds health checks and optional mock servers to validate Streamable HTTP and SSE.

## Version Pinning Policy

- Default to Supergateway v3.4.0.
- Show pinned version in CLI banners and previews.
- Allow `--proxy-version` override; warn on unpinned usage.
- Periodically revalidate newer releases; promote pins after basic smoke and E2E tests pass.

## Upgrade / Override Steps

- To use a different version: pass `--proxy-version vX.Y.Z` in `alph proxy run` or the configure flow.
- For Docker users: prefer the pinned image tag (`ghcr.io/supercorp-ai/supergateway:3.4.0`).

## References

- Model Context Protocol — transport notes: Streamable HTTP replaces HTTP+SSE; SSE remains viable for streaming.
- Supergateway project (README, releases, npm metadata), with v3.4.0 release notes indicating rollback to stable 3.2.0 behavior.
