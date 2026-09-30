# GrokBot Parity: Autonomous Research-to-Code Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Establish full GrokBot parity by adding a Terminal/Command-Execution MCP Server (`workspace-exec`) to GrokCoder and executing an autonomous "Research ➔ Code" workflow where OpenResearch specifies a tool and GrokCoder builds, executes, and verifies it in the shared workspace.

**Architecture:**
1. **MCP Command Execution (`workspace-exec`):** Enable `mcp-server-commands` as an in-stack MCP preset allowing GrokCoder to run shell, python, and node commands directly in `/home/rakazo/shared` with full stdout/stderr capture.
2. **Autonomous Multi-Bot Pipeline:** In group chat, OpenResearch investigates trending tech/AI tools, extracts real-world API data via `web-fetch`, and drafts a tool spec. GrokCoder reads the spec via `workspace-files`, writes the code, runs and verifies the tool with `workspace-exec`, and Chief reviews the completed artifact.
3. **Host Workspace Mirroring:** The script, spec, and verification output are live-synced to Windows `workspace/`.

**Tech Stack:** TypeScript, React 19, Node.js 22, Python 3, Model Context Protocol (`mcp-server-commands`, `mcp-fetch-server`, `@modelcontextprotocol/server-filesystem`), PostgreSQL 16, Graphile Worker, SpooK API.

**Spec Reference:** `bot-library/grok-coder.v1.json`, `bot-library/openresearch.v1.json`, `docs/superpowers/plans/2026-09-27-grokbot-parity-and-bot-library.md`.

---

## Global Constraints
- Strictly preserve SECRETS-POLICY (never read or log `.env` values or API tokens).
- Maintain Lingui i18n parity for all new user-facing strings in `apps/web`.
- Evidence before assertions: GrokCoder must execute the generated script and confirm zero errors before marking complete.
- Keep `workspace/` mirrored live to Windows host via `scripts/sync-workspace.ps1`.

---

### Task 1: Add `workspace-exec` & `sqlite-explorer` MCP Presets and Stdio Configuration

**Files:**
- Modify: `apps/web/src/pages/mcp-presets.ts`
- Modify: `infra/compose/docker-compose.images.yml`
- Modify: `apps/web/src/locales/de/messages.po`
- Database: Insert `workspace-exec` into `mcp_servers` table and bind to GrokCoder (`cmujukxsm00053ppc24k2f7u6`).

**Interfaces:**
- Consumes: MCP Stdio runner in `packages/adapters/src/executor.ts`
- Produces: `workspace-exec` preset providing `run_process` tool (`command_line`, `argv`, `cwd`) to bots.

- [x] **Step 1: Update `mcp-presets.ts` with `workspace-exec` and `sqlite-explorer`**
Add presets with icons and parameters targeting `/home/rakazo/shared`.

- [x] **Step 2: Update `MCP_STDIO_ALLOWED_COMMANDS` in `docker-compose.images.yml`**
Add `mcp-server-commands,python3,bash,/usr/local/bin/mcp-server-commands` to the allowed whitelist for API and Worker containers.

- [x] **Step 3: Register `workspace-exec` in PostgreSQL Database**
Insert the server definition into `mcp_servers` and associate it with GrokCoder and Chief.

- [x] **Step 4: Typecheck, i18n extract & check**
Run: `pnpm --filter @rakazo/web check` and `pnpm --filter @rakazo/web intl:check`

---

### Task 2: Execute Autonomous Research ➔ Code Pilot Run

**Files:**
- Database: Create run in `runs` / Graphile worker queue for Group "Research & Intelligence" or GrokCoder.
- Target Output: `/home/rakazo/shared/research/trending-agent-spec.md` (OpenResearch)
- Target Output: `/home/rakazo/shared/tools/trending_monitor.py` (GrokCoder)
- Target Output: `/home/rakazo/shared/tools/trending_monitor.log` (GrokCoder execution verification)
- Host mirror: the same file under the synced host workspace folder (`pnpm workspace:pull`) for inspection in the editor

- [x] **Step 1: Trigger OpenResearch Trend Investigation**
Prompt OpenResearch to inspect trending tech/AI tools and produce the specification `research/trending-agent-spec.md`.

- [x] **Step 2: Trigger GrokCoder Implementation & Self-Verification**
Prompt GrokCoder to read `research/trending-agent-spec.md`, write `tools/trending_monitor.py`, run `python3 /home/rakazo/shared/tools/trending_monitor.py` via `run_process`, and verify clean exit code 0.

- [x] **Step 3: Trigger Chief Review & Summary**
Chief reviews the code quality, tests, and outputs a concise German summary into the thread.

- [x] **Step 4: Verify Host Workspace Sync**
Run `scripts/sync-workspace.ps1 -Action pull` and confirm that `workspace/tools/trending_monitor.py` and `workspace/research/trending-agent-spec.md` exist on the host with full contents.

---

## Verification Checklist
- [x] `mcp-server-commands` responds to `run_process` calls inside the worker container.
- [x] GrokCoder successfully creates and executes `trending_monitor.py`.
- [x] Script runs cleanly and produces formatted trending tech data.
- [x] Windows host workspace reflects all generated research and code files.
