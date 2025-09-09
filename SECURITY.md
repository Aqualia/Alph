# Security Overview

This document describes the security model and practices of the Alph CLI. It is intended for users and reviewers who need to understand how the tool handles sensitive data, what it does on your machine, and how to report issues.

## Scope and trust model

- The Alph CLI is a local tool that reads and writes configuration files for supported agents. It does not start servers or daemons.
- The CLI performs local file I/O only. There are no telemetry, analytics, or network calls in the CLI codebase.
- The CLI runs with the privileges of the invoking user and does not escalate privileges.

## Sensitive data handling

- Access keys and similar credentials may be provided to `alph setup` via flags or the interactive wizard.
- When printed to the terminal, sensitive values are redacted to `****last4` (see `src/commands/configure.ts` and `src/commands/status.ts`).
- If you choose to apply a configuration, credentials may be written to the relevant agent configuration file(s). Alph does not encrypt stored credentials; protect your filesystem appropriately (OS file permissions, disk encryption, etc.).
- The `status` command redacts sensitive values from any configuration it prints, including:
  - Common header names (e.g., `authorization`, `access-key`, `api-key`, `token`, `secret`, `password`)
  - Environment variables that look sensitive (e.g., names containing `token`, `secret`, `key`, `password`, `auth`)

## Backups, rollback, and atomic edits

- All file edits use a safe pattern implemented by `src/utils/safeEdit.ts` and `src/utils/backup.ts`:
  1) Optional pre-change backup of the target file
  2) Parse/validate
  3) Atomic write
  4) Post-validate and auto-rollback on failure
- Backups are timestamped with the format `.bak.YYYYMMDDTHHMMSSZ` and are stored alongside the original file.
- On validation or write failure (and when enabled), the CLI attempts automatic rollback to the last backup.

## Network and subprocess behavior

- Core CLI operations (detect, status, configure/remove file edits) perform local file I/O only and do not make network calls.
- Interactive STDIO flow may execute installers as subprocesses to set up local MCP tools (e.g., `npm i -g @modelcontextprotocol/<tool>`). This behavior is:
  - Enabled by default in the wizard for convenience.
  - Fully optional — disable with `--no-install` or `ALPH_NO_INSTALL=1`.
  - Transparent — the exact install command is echoed to the console before execution.
- Health checks for installed tools may spawn short-lived subprocesses (e.g., `<tool> --version`).

## Environment variables

- `ALPH_ARGV_FALLBACK=1` enables optional parsing of legacy-style flags from `process.argv` to ease transitions. It is disabled by default.
- No other environment variables are required by the CLI. Status output will redact values of environment variables that look sensitive when printing configurations.

## Permissions and filesystem considerations

- Alph operates on files that the current user can read/write. It does not escalate privileges.
- Ensure configuration files containing credentials are protected with appropriate OS permissions. Consider full-disk encryption on laptops/desktops.
- If your security policy requires it, avoid storing long-lived tokens. Prefer short-lived or scoped tokens and rotate regularly.

## Threat model (summary)

- In-scope threats: accidental credential exposure via logs; partial writes; configuration corruption; rollback failure; storing secrets in plaintext configuration files.
- Out-of-scope: OS-level compromise; malicious dependencies outside this repo; threats arising from the external agents/tools that consume the written configuration.

## Dependency audits

- Use npm audit scripts to scan dependencies locally:
  - `npm run audit` — basic security audit
  - `npm run audit:fix` — attempt automatic fixes
  - `npm run audit:ci` — audit with a moderate severity threshold
 - There is no telemetry or automated CI notification in this project; audits are developer-initiated.

## Reporting security issues

- Please open an issue using the Bug Report template (`.github/ISSUE_TEMPLATE/bug_report.md`) with clear reproduction steps and mark it as a security-related report. Avoid pasting unredacted secrets.
- If your report contains sensitive information, share minimal details in the public issue and indicate that additional details can be provided privately to maintainers.
