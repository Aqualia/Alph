# MCP Proxy Integration — AI-Executable Tasks Document

```json
{
  "id": "T0",
  "title": "✅ Author Decision Record: Adopt Supergateway + Streamable HTTP Preference",
  "description": "Create ADR-001 documenting the decision to adapt the MIT-licensed Supergateway as the bridging proxy (STDIO↔Streamable HTTP/SSE), pinning default version to 3.4.0 (rollback to stable 3.2.0 per release notes). Capture rationale, alternatives, risks, and upgrade policy. Include links and excerpts to the MCP transport spec indicating Streamable HTTP replaces HTTP+SSE, and to Supergateway releases and npm metadata for versioning and license.\nSources: GitHub README and releases (rollback rationale), npm package info, and MCP transport spec. :contentReference[oaicite:0]{index=0}",
  "dependencies": [],
  "acceptance_criteria": [
    "ADR-001 checked into /docs/adr/ADR-001-supergateway.md with rationale, alternatives (build-from-scratch), risks, and pinning policy.",
    "ADR cites MCP Streamable HTTP spec and Supergateway 3.4.0 release note (rollback reason). :contentReference[oaicite:1]{index=1}",
    "ADR explicitly states default preference: Streamable HTTP; SSE supported for compatibility. :contentReference[oaicite:2]{index=2}"
  ],
  "test_instructions": "Open /docs/adr/ADR-001-supergateway.md; verify presence of sections: Context, Decision, Status, Consequences, Version-Pinning Policy, Upgrade/Override Steps. Confirm all citations resolve.",
  "assigned_agent": "agent_arch",
  "determinism_required": true
}
```

```json
{
  "id": "T1",
  "title": "✅ Define Proxy Interfaces & Contracts (Spec for src/utils/proxy.ts)",
  "description": "Write a mini-spec (SPEC-ProxyArgs.md) defining ProxyOpts, buildSupergatewayArgs(), and redactForLogs() contracts: inputs, outputs, error handling, redaction semantics, and OS-agnostic argv rules. Include mapping for transport=http→--streamableHttp, transport=sse→--sse; bearer→--oauth2Bearer; arbitrary headers→repeated --header 'K: V'. Document that higher layers choose command ('npx' or 'docker'). Reference MCP Streamable HTTP as default and Supergateway CLI flags. :contentReference[oaicite:3]{index=3}",
  "dependencies": ["T0"],
  "acceptance_criteria": [
    "SPEC-ProxyArgs.md exists in /docs/specs/ with complete TS signatures and examples.",
    "Spec includes mapping tables for transport, bearer, and headers, and log redaction rules.",
    "Spec cites Supergateway CLI behavior and MCP Streamable HTTP rationale. :contentReference[oaicite:4]{index=4}"
  ],
  "test_instructions": "Review SPEC-ProxyArgs.md for completeness; check examples compile as TypeScript type stubs; ensure citations present.",
  "assigned_agent": "agent_arch",
  "determinism_required": true
}
```

```json
{
  "id": "T2",
  "title": "✅ Implement Proxy Argument Builder and Redaction Utility",
  "description": "Create src/utils/proxy.ts implementing buildSupergatewayArgs(opts: ProxyOpts): string[] and redactForLogs(x). Ensure no secret material is exposed via logs. Include exhaustive unit tests covering http vs sse, bearer vs headers, ordering, quoting, and redaction edge cases. Reference Alph’s redaction/preview policy from the hand-off brief. :contentReference[oaicite:5]{index=5}",
  "dependencies": ["T1"],
  "acceptance_criteria": [
    "src/utils/proxy.ts added with exported functions and JSDoc.",
    "100% branch coverage on src/utils/proxy.ts tests (transport, bearer, headers, mixed).",
    "All redaction tests confirm tokens/secret header values are masked in log output.",
    "No shell-escaped strings; argv arrays only."
  ],
  "test_instructions": "Run `pnpm test -w utils:proxy` and view coverage report. Inject test secrets and confirm snapshots contain redacted placeholders.",
  "assigned_agent": "agent_utils",
  "determinism_required": true
}
```

```json
{
  "id": "T3",
  "title": "✅ Add Tools Catalog Entry for Supergateway",
  "description": "Update catalog/tools.yaml with id=mcp-proxy-supergateway. Define detect (`npx -y supergateway --version`), preWarm (`npx -y supergateway --help`), and optional health probes. Include version pinning affordance in detection (surface detected version). Ensure catalog entry adheres to the established playbook for STDIO tools (detect/install/health/pre-warm). :contentReference[oaicite:6]{index=6}",
  "dependencies": ["T0"],
  "acceptance_criteria": [
    "catalog/tools.yaml contains mcp-proxy-supergateway with detect/preWarm/health commands and help text.",
    "On Windows/Linux/macOS, `alph tools detect mcp-proxy-supergateway` succeeds when npm is present.",
    "Pre-warm runs once and caches; subsequent runs skip.",
    "Documentation line includes default pin to v3.4.0 with override guidance. :contentReference[oaicite:7]{index=7}"
  ],
  "test_instructions": "Execute `alph tools detect mcp-proxy-supergateway` on each OS runner; confirm version line and successful pre-warm without errors.",
  "assigned_agent": "agent_catalog",
  "determinism_required": true
}
```

```json
{
  "id": "T4",
  "title": "✅ Introduce `alph proxy` Command (run/health) as Thin Wrapper",
  "description": "Create src/commands/proxy.ts with two subcommands: `alph proxy run` to spawn the proxy and stream logs (with redaction) and `alph proxy health` to perform a lightweight connectivity probe (no config writes). Must use argv arrays (no shell) and support `--remote-url`, `--transport (http|sse)`, `--bearer`, repeated `--header`, `--proxy-version`, and optional `--docker`. Reference MCP transport defaults and Supergateway flags. :contentReference[oaicite:8]{index=8}",
  "dependencies": ["T2"],
  "acceptance_criteria": [
    "`alph proxy run` starts a child process and prints a standardized lifecycle banner (PID, pinned version, transport).",
    "`alph proxy health` returns exit code 0 on reachable endpoints and non-zero on clear failures.",
    "Secrets are redacted in all console output per preview policy. :contentReference[oaicite:9]{index=9}",
    "CLI help includes examples for both transports."
  ],
  "test_instructions": "Run `alph proxy run --remote-url https://example.invalid --transport http` and verify standardized error; run against a local test server (see T12) and verify success. Inspect logs for redaction.",
  "assigned_agent": "agent_cli",
  "determinism_required": true
}
```

```json
{
  "id": "T5",
  "title": "Interactive Wizard: Add 'Use local proxy (recommended)' Path for Codex",
  "description": "Modify src/commands/interactive.ts to offer a 'Use local proxy (recommended)' when agent=Codex and the user provides a remote MCP URL. Collect URL, transport, bearer, headers; perform pre-warm for `npx supergateway --help`. Ensure wording matches existing UX tone and previews label the endpoint correctly (Local (STDIO)). :contentReference[oaicite:10]{index=10}",
  "dependencies": ["T3"],
  "acceptance_criteria": [
    "Wizard shows proxy option only for Codex + remote transport selection.",
    "Pre-warm step runs once and reports status.",
    "Preview/summary includes 'Remote via Local Proxy (STDIO)' with secrets redacted and paths shown.",
    "Transcript snapshot tests pass across locales."
  ],
  "test_instructions": "Run `alph configure --interactive` selecting Codex→HTTP/SSE; proceed with proxy; confirm pre-warm message and final preview strings match snapshots.",
  "assigned_agent": "agent_wizard",
  "determinism_required": true
}
```

```json
{
  "id": "T6",
  "title": "✅ Non-Interactive Flags & AgentConfig Transform",
  "description": "Extend src/commands/configure.ts to accept `--proxy-remote-url`, `--proxy-transport`, `--proxy-bearer`, and `--proxy-header`. When agent=Codex and transport is http|sse, transform AgentConfig to STDIO by composing `command='npx'` and args via buildSupergatewayArgs(); apply startup_timeout_ms=60000 for generic runners if not set; proceed through preview→confirm→atomic write + backup→validate/rollback. :contentReference[oaicite:11]{index=11}",
  "dependencies": ["T2"],
  "acceptance_criteria": [
    "Config preview shows STDIO entry with redacted auth and correct args mapping.",
    "On confirm, TOML written atomically with timestamped backup; rollback triggers on parse failure. :contentReference[oaicite:12]{index=12}",
    "startup_timeout_ms=60000 auto-applied when command is `npx` and unset. :contentReference[oaicite:13]{index=13}"
  ],
  "test_instructions": "Run `alph configure --provider codex --proxy-transport http --proxy-remote-url https://example.com/mcp --yes`; inspect ~/.codex/config.toml; corrupt TOML then re-run to verify rollback behavior.",
  "assigned_agent": "agent_config",
  "determinism_required": true
}
```

```json
{
  "id": "T7",
  "title": "✅ Provider Compatibility Verification for Codex (STDIO-only)",
  "description": "Validate that Codex provider behavior remains unchanged: it rejects HTTP/SSE and accepts STDIO entries that spawn Supergateway. Confirm TOML location/shape and heuristic timeout behavior. :contentReference[oaicite:14]{index=14}",
  "dependencies": ["T6"],
  "acceptance_criteria": [
    "Attempting to write HTTP/SSE directly for Codex fails as before (negative test).",
    "STDIO with `command='npx'` and Supergateway args succeeds and is listed by `alph list codex`.",
    "startup_timeout_ms present (60000) when unset and generic runner detected. :contentReference[oaicite:15]{index=15}"
  ],
  "test_instructions": "Create two configs: (A) direct HTTP for Codex → expect error; (B) STDIO via Supergateway → expect success. Use provider list/validate commands to confirm.",
  "assigned_agent": "agent_provider",
  "determinism_required": true
}
```

```json
{
  "id": "T8",
  "title": "✅ Security & Redaction Validation",
  "description": "Systematically verify that tokens and sensitive header values are redacted in previews, logs, and error messages across CLI (`alph proxy`), interactive wizard, and configure flows. Align with brief’s redaction guidance. :contentReference[oaicite:16]{index=16}",
  "dependencies": ["T4", "T5", "T6"],
  "acceptance_criteria": [
    "All console outputs redact Authorization and custom sensitive headers.",
    "Snapshot tests prove consistent redaction across code paths.",
    "No plaintext secrets written to disk outside provider configs."
  ],
  "test_instructions": "Run flows with a known token (e.g., TEST_TOKEN_123); search logs and snapshots for occurrences; only redacted placeholders may appear.",
  "assigned_agent": "agent_sec",
  "determinism_required": true
}
```

```json
{
  "id": "T9",
  "title": "✅ Windows Reliability: Pre-warm & Timeout Heuristic",
  "description": "On Windows runners, validate first-run reliability: ensure `npx supergateway --help` pre-warm occurs in wizard and that codex TOML includes `startup_timeout_ms=60000` when unset. Verify atomic/backup behavior on NTFS. :contentReference[oaicite:17]{index=17}",
  "dependencies": ["T5", "T6"],
  "acceptance_criteria": [
    "Pre-warm step executes and is logged once per environment.",
    "Codex TOML contains startup_timeout_ms=60000 for generic runner entries unless the user sets a custom value. :contentReference[oaicite:18]{index=18}",
    "Atomic write + backup verified by presence of timestamped backup files and successful rollback on forced error. :contentReference[oaicite:19]{index=19}"
  ],
  "test_instructions": "Run the interactive flow on Windows; then inspect TOML and backup directories. Simulate a parse failure to confirm rollback.",
  "assigned_agent": "agent_qe_windows",
  "determinism_required": true
}
```

```json
{
  "id": "T10",
  "title": "✅ Linux Compatibility: Spawn Semantics & File Safety",
  "description": "Verify Linux behavior: argv-only spawn (no shell), correct environment propagation for bearer via args, and atomic writes on ext4. Confirm `alph proxy` run/health behavior and no dependency on TTY. Cite MCP transport notes for expected HTTP behavior. :contentReference[oaicite:20]{index=20}",
  "dependencies": ["T4", "T6"],
  "acceptance_criteria": [
    "`alph proxy run` and `health` succeed against test endpoints (see T12).",
    "No shell quoting required; all spawns use argv arrays.",
    "Atomic write + backup/rollback verified."
  ],
  "test_instructions": "Use Ubuntu CI runner: run `alph proxy health --remote-url http://localhost:PORT --transport http`; validate exit code and logs; verify TOML writes and backups.",
  "assigned_agent": "agent_qe_linux",
  "determinism_required": true
}
```

```json
{
  "id": "T11",
  "title": "macOS Compatibility: Spawn & Filesystem Validation",
  "description": "Confirm macOS behavior mirrors Linux for spawn, logging, and atomic writes on APFS. Ensure no Gatekeeper issues (npx usage avoids binary quarantine).",
  "dependencies": ["T4", "T6"],
  "acceptance_criteria": [
    "`alph proxy run` and `health` behave identically to Linux tests.",
    "Backups created and rollback verified on induced failure.",
    "No unsigned binary prompts observed through npx usage."
  ],
  "test_instructions": "Use macOS CI runner: execute run/health; validate TOML writes and backups; check for quarantine prompts; confirm exit codes and logs match expectations.",
  "assigned_agent": "agent_qe_macos",
  "determinism_required": true
}
```

```json
{
  "id": "T12",
  "title": "Test Servers: Streamable HTTP and SSE Mocks",
  "description": "Provision lightweight mock servers for Streamable HTTP and SSE that adhere to MCP transport semantics for CI and local testing. Use known example implementations/spec guidance for behavior. Confirm cross-language compatibility if applicable. :contentReference[oaicite:21]{index=21}",
  "dependencies": ["T0"],
  "acceptance_criteria": [
    "Mock Streamable HTTP server exposes expected endpoints and streaming behavior per spec. :contentReference[oaicite:22]{index=22}",
    "Mock SSE server opens an event stream and echoes basic MCP frames.",
    "Both mocks run in CI on ephemeral ports with stable startup times (<2s)."
  ],
  "test_instructions": "Start mocks via `pnpm run test:mocks`; run `alph proxy health` against both; verify 0 exit for reachable and non-zero for blocked routes.",
  "assigned_agent": "agent_testinfra",
  "determinism_required": true
}
```

```json
{
  "id": "T13",
  "title": "End-to-End (E2E) Scenarios: Codex → Proxy → Remote MCP",
  "description": "Automate E2E tests that write Codex TOML (atomic + backup) via `alph configure`, then run Codex to ensure it spawns the local STDIO proxy and successfully communicates with the mock Streamable HTTP/SSE servers. Include negative tests for bad URLs/headers. Provider invariants from the brief must hold. :contentReference[oaicite:23]{index=23}",
  "dependencies": ["T6", "T12"],
  "acceptance_criteria": [
    "E2E: successful round-trip for Streamable HTTP and SSE.",
    "Backups created and restorable upon induced parse error.",
    "STDIO-only enforcement for Codex verified via negative tests. :contentReference[oaicite:24]{index=24}"
  ],
  "test_instructions": "Run `pnpm test:e2e`; inspect logs for redaction; confirm success/failure cases match expectations and that backups exist.",
  "assigned_agent": "agent_qe",
  "determinism_required": true
}
```

```json
{
  "id": "T14",
  "title": "CLI Help, UX Copy, and Preview Summaries",
  "description": "Update `alph proxy --help` and `alph configure --help` to document proxy options and pinning. Adjust preview summaries to label 'Remote via Local Proxy (STDIO)'. Ensure copy aligns with brief’s UX tone (e.g., pre-warm messaging). :contentReference[oaicite:25]{index=25}",
  "dependencies": ["T4", "T5", "T6"],
  "acceptance_criteria": [
    "Help text includes examples for both transports and pin override.",
    "Preview/summary strings include correct labels and redaction.",
    "Snapshot tests for help output pass on all OS runners."
  ],
  "test_instructions": "Run `alph proxy --help` and `alph configure --help`; compare to approved snapshots; validate presence of pinning instructions and redaction notes.",
  "assigned_agent": "agent_docs",
  "determinism_required": true
}
```

```json
{
  "id": "T15",
  "title": "Version Pinning & Override Controls",
  "description": "Set default Supergateway version to 3.4.0 (rollback-stable per releases). Introduce `--proxy-version` CLI flag and environment override. Warn when unpinned. Ensure detection surfaces the runtime version. :contentReference[oaicite:26]{index=26}",
  "dependencies": ["T4", "T3"],
  "acceptance_criteria": [
    "Default invocation uses supergateway@3.4.0 unless overridden.",
    "`alph proxy run --proxy-version x.y.z` selects that version.",
    "Help text explains stability rationale and warning for unpinned usage with a release link. :contentReference[oaicite:27]{index=27}"
  ],
  "test_instructions": "Invoke `alph proxy run` without override → check logs for version; then with `--proxy-version 3.2.0` → verify new version reflected; inspect warning messaging.",
  "assigned_agent": "agent_cli",
  "determinism_required": true
}
```

```json
{
  "id": "T16",
  "title": "✅ Atomic Write + Backup + Rollback Drills",
  "description": "Create automated drills verifying that provider writes use temp-file→rename, backups are timestamped, and rollback restores the last good state upon validation failure. Use Codex provider path and induced TOML syntax errors to exercise rollback. :contentReference[oaicite:28]{index=28}",
  "dependencies": ["T6"],
  "acceptance_criteria": [
    "Drill script shows backup created before write and validates rollback on failure.",
    "After rollback, provider validate() returns true and config matches pre-change snapshot.",
    "Artifacts (temp files) are cleaned."
  ],
  "test_instructions": "Run `pnpm run drills:rollback`; inspect logs and resulting TOML; confirm exact match to backup after rollback.",
  "assigned_agent": "agent_qe",
  "determinism_required": true
}
```

```json
{
  "id": "T17",
  "title": "✅ Telemetry (Minimal & Non-PII) for Configure Success/Failure",
  "description": "Add optional, opt-in counters for proxy configuration success/failure. No PII or secret content. Ensure metrics can be disabled via flag/env and default to off.",
  "dependencies": ["T6", "T13"],
  "acceptance_criteria": [
    "Telemetry disabled by default; enabling emits only counts and durations (no content).",
    "Unit tests verify no secrets can be serialized.",
    "Docs updated with privacy stance."
  ],
  "test_instructions": "Enable telemetry via env; run configure success and a forced failure; verify counter increments and absence of sensitive payloads.",
  "assigned_agent": "agent_obs",
  "determinism_required": true
}
```

```json
{
  "id": "T18",
  "title": "✅ Documentation: User Guide & Troubleshooting",
  "description": "Update user docs to include: why a local proxy is needed for Codex (STDIO-only), Streamable HTTP as the recommended transport, SSE fallback, Windows pre-warm guidance, version pinning policy, and rollback troubleshooting. Cite spec and releases. :contentReference[oaicite:29]{index=29} :contentReference[oaicite:30]{index=30}",
  "dependencies": ["T5", "T6", "T15"],
  "acceptance_criteria": [
    "Docs contain end-to-end examples for both transports with redacted tokens.",
    "Troubleshooting covers timeouts, pin overrides, and rollback steps.",
    "All links and citations resolve."
  ],
  "test_instructions": "Build docs; click through all links; run example commands against the mocks (T12) and confirm outcomes.",
  "assigned_agent": "agent_docs",
  "determinism_required": true
}
```

```json
{
  "id": "T19",
  "title": "✅ Release Checklist & Notes",
  "description": "Prepare release notes summarizing new proxy capability, OS coverage, default pin (3.4.0) and override, and guidance to prefer Streamable HTTP. Include links to MCP spec and Supergateway releases. Provide a QA sign-off checklist referencing T13 and T16 outcomes. :contentReference[oaicite:31]{index=31}",
  "dependencies": ["T13", "T15", "T18"],
  "acceptance_criteria": [
    "CHANGELOG entry added with features, flags, version pinning, and risk mitigations.",
    "QA checklist enumerates E2E matrix (OS × transport) and rollback drills.",
    "All acceptance criteria across tasks are green in CI."
  ],
  "test_instructions": "Open CHANGELOG and release notes; verify links; ensure CI status badge green and QA checklist items ticked.",
  "assigned_agent": "agent_release",
  "determinism_required": true
}
```

```json
{
  "id": "T20",
  "title": "✅ Post-Release Monitoring & Support Playbook",
  "description": "Create a support runbook for common issues (first-run latency, wrong transport selection, invalid headers). Include triage steps, known fixes (pre-warm, timeout adjustment), and version override instructions. Reference troubleshooting content and brief heuristics. :contentReference[oaicite:32]{index=32}",
  "dependencies": ["T18", "T19"],
  "acceptance_criteria": [
    "Runbook exists in /docs/runbooks/proxy.md with decision trees for typical failure modes.",
    "Links to config locations, sample corrections, and commands are verified.",
    "Support macros/FAQ snippets extracted for reuse."
  ],
  "test_instructions": "Walk through three simulated tickets (timeout, 401 auth, SSE vs HTTP mismatch) using the runbook and confirm resolutions are deterministic.",
  "assigned_agent": "agent_support",
  "determinism_required": true
}
```


[1]: https://modelcontextprotocol.io/specification/2025-03-26/basic/transports?utm_source=chatgpt.com "Transports - Model Context Protocol"
[2]: https://github.com/supercorp-ai/supergateway/releases?utm_source=chatgpt.com "Releases · supercorp-ai/supergateway - GitHub"
[3]: https://www.npmjs.com/package/supergateway?utm_source=chatgpt.com "supergateway - npm"
