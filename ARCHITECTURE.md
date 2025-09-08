# Alph CLI Architecture

This document describes the structure of the Alph CLI codebase and the primary execution flows. It is intended for contributors and reviewers.

## Repository layout

- `src/`
  - `index.ts`: CLI entrypoint that invokes `executeUnifiedCommand()`.
  - `commands/`
    - `unified.ts`: Commander.js wiring. Subcommands: `setup`, `status`, `remove`. No root-level flags.
    - `configure.ts`: Implements the `setup` flow (agent filtering, dry-run preview, confirmation, safe writes).
    - `status.ts`: Detection and redacted configuration reporting (table or JSON).
    - `interactive.ts`: Interactive wizard; pre-fills values and masks access keys.
  - `agents/`
    - `registry.ts`: Detects available providers; orchestrates configure/validate across providers.
    - `provider.ts`: Shared provider types and interfaces.
    - `gemini.ts`, `cursor.ts`, `claude.ts`, `generic.ts`: Provider implementations.
  - `config/`
    - `validator.ts`: Schema-based validation for agent and unified configs.
    - `unifiedManager.ts`: Optional user/project-level unified config helper.
  - `utils/`
    - `safeEdit.ts`: Backup → validate → atomic write → validate → auto-rollback on failure.
    - `backup.ts`: Timestamped backups (`.bak.YYYYMMDDTHHMMSSZ`) and cleanup/list helpers.
    - `fileOps.ts`: Cross-platform filesystem helpers.
    - `agents.ts`: Agent name parsing, aliasing, validation.
    - `validation.ts`, `help.ts`, `directory.ts`, `errors.ts`, `logger.ts`: Supporting utilities.
  - `types/`
    - `config.ts`: Shared configuration types used by providers and commands.
- `tests/`: Unit and integration tests.
 

## Execution flows

### Unified command (`src/commands/unified.ts`)
- Wires subcommands with Commander.js.
- Subcommands: `setup`, `status`, `remove`.
- No root-level flags; use explicit subcommands only.
- Provides normalization for forwarding options and optional argv fallback (`ALPH_ARGV_FALLBACK=1`).

### Setup (`src/commands/configure.ts`)
1. Validate options; optionally route to interactive wizard if `-i` or no flags.
2. Detect available agents via `defaultRegistry.detectAvailableAgents()` with optional provider filter.
3. Build `AgentConfig` from `MCPServerConfig` (transport defaults to `http`).
4. `--dry-run`: print preview including masked access key and exit.
5. Confirm unless `-y/--yes`.
6. Apply configuration using providers through the registry with automatic rollback on failure.

### Status (`src/commands/status.ts`)
1. Parse filter; detect providers.
2. Read each provider's config; extract `mcpServers` map.
3. Redact sensitive fields (headers, env, common secret keys) using `****last4` masking.
4. Output table (default) or JSON with a summary block.

### Interactive wizard (`src/commands/interactive.ts`)
- Prompts for endpoint, transport (`http|sse`), optional access key (masked input), and agents to configure.
- Shows summary with masked access key before applying.

## Security and privacy

- No telemetry/analytics; no network calls or subprocess execution in CLI code.
- Access keys are masked in all console output.
- Safe file editing and rollback via `safeEdit.ts` and `backup.ts`.
- See `SECURITY.md` for details.

## Environment

- `ALPH_ARGV_FALLBACK=1` enables optional parsing of legacy-style flags directly from `process.argv`. Disabled by default to avoid test interference.

## Coding guidelines

- Keep user-facing output deterministic and redact secrets.
- Prefer pure functions and small modules in `utils/`.
- Ensure tests do not leak async handles (clear timers, close resources).
- Keep docs aligned with `unified.ts`, `configure.ts`, and `status.ts` to avoid drift.
