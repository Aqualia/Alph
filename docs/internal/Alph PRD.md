# **Alph CLI v2.0 — Product Requirements Document (PRD)**

**Status:** Draft v2.0 (updated per directives) • **Owner:** Principal PM / Lead Solutions Architect • **Audience:** Maintainer & Core Devs
**Repo (current):** Aqualia/Alph — Universal MCP Server Configuration Manager. Alph today ships an interactive wizard (`alph` / `alph setup`), safe atomic writes with backups, and an interactive removal wizard (`alph remove -i`). It is local-first and manipulates agent config files for Cursor, Gemini, and Claude. ([GitHub][1])

---

## 1) Introduction & Vision

### Vision Statement

**Alph CLI v2.0** becomes the **definitive, community-driven standard** for managing MCP server configurations across AI agents. It provides a **single, interactive** experience that detects agents, **installs and manages local STDIO servers by default**, and safely writes correct, protocol-aware entries to each client’s canonical config—reliably, fast, and with zero manual JSON editing. (Current agents supported include Cursor, Gemini CLI, and Claude Code.) ([GitHub][1], [Cursor][2], [Anthropic][3])

### Background (why v2.0)

* The ecosystem has **agent-specific quirks** (paths, keys, protocols HTTP/SSE/STDIO) that need to be captured as data, not code, while maintaining **atomic writes/rollback** and local-first security posture already present in Alph. ([GitHub][1])
* Users want a **guided, interactive workflow** to **install/remove agent configurations** and to **auto-manage local STDIO MCP tools**, reducing setup friction. (v1 already ships interactive setup and removal wizards; v2 formalizes and expands them.) ([GitHub][1])

### The “Seamless Evolution” Mandate

* **No migration flows in scope.** Automatic updates will cover the current small user base; v2 focuses on core UX and robustness.
* Preserve v1 strengths: interactive wizard, safe local file edits, and redaction of sensitive values in outputs. ([GitHub][1])

---

## 2) Guiding Principles (Non-Negotiable)

1. **Holistic System Thinking**
2. **User Experience Drives Architecture**
3. **Pragmatic Technology Selection**
4. **Progressive Complexity**
5. **Cross-Stack Performance Focus**
6. **Developer Experience as a First-Class Concern**
7. **Security at Every Layer**
8. **Data-Centric Design**
9. **Cost-Conscious Engineering**
10. **Living Architecture**

---

## 3) User Persona & Journeys

### Persona — **End-User Developer (“Dev”)**

* **Profile:** Individual developer integrating MCP tools into Cursor, Gemini CLI, or Claude Code.
* **Goals:** Fast first-run experience, robust safety (backups/rollback), and **interactive install/remove** of agent configurations plus **default-enabled STDIO tool management**.

**Critical Journeys**

1. **First-Time Setup (Interactive)**
   *As a Dev, I want Alph to detect my installed agents, install any needed local STDIO MCP tools, and safely write correct entries, so I can use MCP tools immediately.*
   **Acceptance:** `alph` wizard performs detect → (STDIO) discover/install/health-check → render protocol-aware config → atomic write with backup. Current v1 interactive wizard patterns are retained and expanded. ([GitHub][1])

2. **Install/Enable an Agent Configuration**
   *As a Dev, I want to add an agent’s MCP configuration interactively, so I don’t hand-edit JSON.*
   **Acceptance:** `alph setup` (no args) launches the wizard; the user selects agent(s), protocol (HTTP/SSE/STDIO), and (if STDIO) the tool is auto-installed and verified before writing. ([GitHub][1])

3. **Remove/Disable an Agent Configuration**
   *As a Dev, I want to remove an agent’s MCP configuration interactively with preview and backups.*
   **Acceptance:** `alph remove -i` wizard lists installed servers per agent; selection removes entries with atomic safety and timestamped backups. (This exists today and remains critical.) ([GitHub][1])

---

## 4) Features & Requirements

> **Phaseing note:** This PRD is split into **Phase 1 (core)** and **Phase 2 (deferred)**. Items explicitly marked “Phase 2” are **not essential** for Phase 1.

### EPIC 1 — **Configuration-Driven Core (SSOT)** *(Phase 1)*

**Goal:** All behavior is data-driven via a central catalog (e.g., `agents.yaml`) with per-agent paths, scopes, and **protocol profiles**.

**Requirements**

* **R1.1 – Central Catalog:** Declare scopes/locations (user vs project) and keys (default `mcpServers`) for Cursor, Gemini, and Claude. (Each uses a canonical `mcpServers` entry in their config patterns.) ([Cursor][2], [GitHub][4], [Anthropic][3])
* **R1.2 – Protocol Profiles:** Map **HTTP/SSE/STDIO** to the exact field names and header policies each client expects (e.g., SSE requires correct handling and often `text/event-stream` semantics). ([MDN Web Docs][5], [HTML Living Standard][6])
* **R1.3 – Schema Validation:** Validate catalog & rendered output before write.
* **R1.4 – Atomic Ops:** Backups and rollback remain mandatory for all writes (v1 behavior). ([GitHub][1])

**User Story**
*As a Dev, I want Alph to “know” each client’s shape so I just choose a transport and the correct config is written automatically.*

---

### EPIC 2 — **Enhanced Developer & Contributor Experience** *(Phase 2 — deprioritized)*

**Rationale:** Useful, but **non-essential** for Phase 1 delivery. (Docs & CONTRIBUTING exist today.) ([GitHub][1])

---

### EPIC 3 — **Interactive Agent Management (Install/Remove)** *(Phase 1, critical)*

**Goal:** Make interactive **installation and removal** of agent configurations a first-class, robust feature.

**Requirements**

* **R3.1 – Install Wizard:** `alph` / `alph setup` runs a guided flow that:
  a) Detects agents; b) Prompts for protocol and auth headers; c) For STDIO, **performs default-enabled tool discovery → install → health check**; d) Writes config atomically with backup; e) Shows a redacted preview prior to write. (Build on v1 interactive flow.) ([GitHub][1])
* **R3.2 – Remove Wizard:** `alph remove -i` lists configured servers per agent with search/filter, previews diffs, and rolls back on failure. (Strengthen tests and UX affordances.) ([GitHub][1])
* **R3.3 – Status Dashboard:** `alph status` shows detected agents, destinations, and configured servers. (Retain v1 behavior.) ([GitHub][1])

**Acceptance Tests**

* AT-I: Full interactive install from zero to working config for each agent on macOS/Windows/Linux.
* AT-R: Interactive removal restores prior state; backups present and timestamped.
* AT-S: Status reflects accurate per-agent server lists.

---

### EPIC 4 — **STDIO Local MCP Servers: Default-Enabled Management** *(Phase 1, critical)*

**Goal:** When users choose STDIO, Alph **by default** manages local tool installation and readiness inside the interactive flow.

**Requirements**

* **R4.1 – Discovery & Install (Default ON):** Resolve tool binary via PATH; if missing, **perform installation by default** (brew/pipx/npm/cargo as declared in a `tools.yaml` registry).
* **R4.2 – Health Checks:** After install, run `--version` and a lightweight self-check; surface actionable guidance on failure.
* **R4.3 – Safety & Transparency:** Show the exact command(s) to be executed; allow `--no-install` to skip (opt-out).
* **R4.4 – Render STDIO Entries:** Write `command/args/env` correctly for each client’s expected shape.
* **R4.5 – No Secrets at Rest:** Encourage env-var references; redact any supplied tokens in output (preserves current model). ([GitHub][1])

**Acceptance Tests**

* AT-D: On a clean machine, selecting STDIO installs the tool(s) and produces a working configuration end-to-end.
* AT-H: Health check failures provide remediation instructions; the write is aborted safely.
* AT-E: Environment variables are referenced, not persisted as literals.

---

### EPIC 5 — **Protocol-Aware Rendering & Headers** *(Phase 1)*

**Requirements**

* **R5.1 – Per-Protocol Field Maps:** Correct fields for HTTP/SSE/STDIO per agent.
* **R5.2 – Header Policies:** `authorizationBearer`, `apiKey(name=…)`, `none`; SSE semantics comply with standards (`text/event-stream`). ([HTML Living Standard][6])

---

### EPIC 6 — **Packaging, Distribution & Catalog Updates** *(Phase 2 — deprioritized)*

* Overlay catalogs, remote signed catalogs, and “catalog packs” are deferred until after Phase 1.

---

## 5) Non-Functional Requirements (NFRs)

**Performance (Cross-Stack)**

* **NFR-P1 (Phase 1):** *P99 < 250ms* for `status` and setup dry-run per agent on a warm cache.
* **NFR-P2 (Phase 1):** Minimize fs calls; single atomic write per target file.

**Extensibility**

* **NFR-E1 (Phase 2 — deprioritized):** Add a new agent without shipping a new CLI binary (catalog overlays/packs).

**Security**

* **NFR-S1 (Phase 1):** Alph **never stores secrets**; render env-var references; redact output. (Matches current docs.) ([GitHub][1])
* **NFR-S2 (Phase 1):** Defense-in-depth: atomic writes, backups, strict perms warnings on configs. (Matches current model.) ([GitHub][1])

**Reliability & Cost**

* **NFR-C1 (Phase 1):** Keep deps minimal (Node 18+, yaml, jsonpath, zod).
* **NFR-C2 (Phase 1):** Global NPM install path maintained (`npm i -g @aqualia/alph-cli`). ([GitHub][1])

---

## 6) Technology Choices (Pragmatic)

* **Runtime:** Node.js ≥ 18, TypeScript (unchanged).
* **Core libs:** `yaml`, `jsonc-parser`, `jsonpath-plus`, `zod`.
* **I/O:** `fs/promises` with temp files + atomic replace; platform path helpers.
* **Distribution:** NPM global install (existing). ([GitHub][1])

---

## 7) CLI/UX & Documentation (Phase-tagged)

**Phase 1 (ship now)**

* **Commands:** `alph` (wizard), `alph setup`, `alph status`, `alph remove -i`. (All exist today; v2 hardens/extends behavior.) ([GitHub][1])
* **Flags:** `--transport`, `--mcp-server-endpoint`, `--headers`, `--bearer`, `--env`, `--command/--args/--cwd` (STDIO), `--agents`, `--dir`, `--dry-run`, plus **new** `--no-install` (opt-out of default installs).
* **Docs:** Update `USER_GUIDE.md` to emphasize **interactive install/remove** and **default-enabled STDIO management**. (Existing docs will be revised.) ([GitHub][1])

**Phase 2 (defer)**

* Contributor DX deep-dive, overlay catalogs, catalog packs, signed catalog fetch, and related docs.

---

## 8) Phased Delivery Plan

**Phase 1 — Core (this release)**

* EPICs: **1, 3, 4, 5**
* NFRs: **P1, P2, S1, S2, C1, C2**
* Docs: README/USER\_GUIDE/TROUBLESHOOTING refreshed to center interactive install/remove and STDIO default management. ([GitHub][1])

**Phase 2 — Deferred**

* EPICs: **2, 6**
* NFRs: **E1**
* Additional catalog distribution mechanics & contributor DX enhancements.

---

## 9) Acceptance Criteria & Milestones

* **M1 (Phase 1):** Interactive install wizard implements default STDIO discovery→install→health; removal wizard strengthened; status reliable (Win/macOS/Linux).
* **M2 (Phase 1):** Protocol profiles verified against Cursor, Gemini, and Claude config behaviors; SSE semantics correct (`text/event-stream`). ([Cursor][2], [GitHub][4], [Anthropic][3], [HTML Living Standard][6])
* **M3 (Phase 1):** P99 latency targets met; atomic write tests pass; docs updated. ([GitHub][1])

---

## 10) Risks & Mitigations

* **Risk:** Default STDIO install may contradict prior “no network calls” posture.
  **Mitigation:** Provide explicit UI/CLI messaging and a `--no-install` opt-out; log exact commands; keep all writes local and safe.

* **Risk:** Divergent client configs (paths/keys) can drift.
  **Mitigation:** Central catalog + automated tests against real sample configs; small data-only updates.

---

## 11) Validation & Crosswalk to Feedback

1. **Remove migration:** All migration text and commands removed. ✅
2. **Interactive install/remove:** Elevated to **EPIC 3 (Phase 1, critical)** with acceptance tests; current interactive commands cited from README. ✅ ([GitHub][1])
3. **STDIO default management:** **EPIC 4** makes discovery→install→health default-enabled (opt-out via `--no-install`). ✅
4. **Two-phase scope:** Phase 1 = core; Phase 2 = deferred features (EPIC 2, EPIC 6, NFR-E1). ✅
5. **Remove Persona B:** Only the End-User Developer persona remains. ✅
6. **Deprioritize EPIC 2, EPIC 6, NFR-E1 for Phase 1:** Marked as Phase 2. ✅

---

