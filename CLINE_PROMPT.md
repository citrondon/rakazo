# Cline CLI Prompt — Rakazo Project Setup

Use this prompt to configure the `cline` CLI for the Rakazo monorepo.
Verified against `cline` CLI **v3.0.67**.

> **CLI facts (v3.0.67)** — the commands below match the real CLI surface:
> - `cline mcp install|add <name> [targetArgs...]` opens an **interactive wizard**;
>   pass `--yes` for non-interactive use. Transports: `stdio`, `sse`, `http`,
>   `streamable-http`, `streamableHttp`. For `stdio`, put the command after `--`.
> - There is **no** `cline mcp list`. List servers with **`cline config mcp`**.
> - There is **no** `cline plugin list`. Plugins are installed with
>   `cline plugin install <source>` (file URL, git repo, npm package, or local path).
> - **Skills** are managed with `cline skill add <owner/repo>` (forwards to `npx skills`,
>   defaults to `--agent cline`), **not** with `cline plugin install`.

---

## 0. Authenticate

```bash
cline auth
```

## 1. MCP servers

Configured on this machine (`~/.cline/data/settings/cline_mcp_settings.json`):
`context7` [stdio], `playwright` [stdio], `hindsight` [http], `supabase` [http].
Only add what is missing — do not re-install a name that already exists.

Correct, verified commands:

```bash
# Context7 — current library docs (official remote endpoint)
cline mcp install context7 --transport http --yes https://mcp.context7.com/mcp

# Filesystem — repo-scoped file access (official reference server)
cline mcp install filesystem --transport stdio --yes -- \
  npx -y @modelcontextprotocol/server-filesystem "$PWD"

# Supabase — official remote MCP (OAuth login on first use; no secret in config)
cline mcp install supabase --transport http --yes https://mcp.supabase.com/mcp

# Supabase (alternative): local stdio server with a self-managed PAT
# cline mcp install supabase --transport stdio --yes -- \
#   npx -y @supabase/mcp-server-supabase@latest --read-only
#   # requires SUPABASE_ACCESS_TOKEN (PAT) in the environment

# GitHub — use the official Go/Docker server (a PAT is required)
cline mcp install github --transport stdio --yes -- \
  docker run -i --rm -e GITHUB_PERSONAL_ACCESS_TOKEN ghcr.io/github/github-mcp-server
```

Do **not** install these (wrong name or archived):

| Bad package | Why |
| --- | --- |
| `@supabase/mcp-server` | Does not exist — the package is `@supabase/mcp-server-supabase`. |
| `@modelcontextprotocol/server-github` | Archived (`servers-archived`). Use `github/github-mcp-server`. |
| `@modelcontextprotocol/server-playwright` | Does not exist. Use `@playwright/mcp` or `@executeautomation/playwright-mcp-server`. |
| `@modelcontextprotocol/server-postgres` | Archived. |
| `@modelcontextprotocol/server-docker` | No official server — unvetted third party (supply-chain risk). |

`AGENTS.md` keeps the core product vendor-free and treats third-party package
sources as a supply-chain risk, so prefer official servers and skip the rest.

## 2. Skills

```bash
cline skill add <owner/repo>   # installs into ~/.cline/skills, defaults to --agent cline
cline skill list
cline skill remove
```

Already present here (Superpowers set): `test-driven-development`,
`systematic-debugging`, `brainstorming`, `writing-plans`,
`verification-before-completion`, …

```bash
cline skill add ayghri/i-have-adhd --yes --global
```

Do **not** use `cline plugin install @cline/skill-*` — those npm packages do not
exist, and plugins are not skills. `@cline/*` packages are host-provided
dependencies of plugins, not installable skills.

## 3. Verify

```bash
cline config mcp     # list configured MCP servers
cline config         # full config (includes the plugins tab)
cline skill list     # list installed skills
cline doctor         # hub/daemon health
```

## 4. Quick task prompts

| Task | Prompt |
|------|--------|
| DB schema change | `cline "Add a migration for X in packages/db and update the schema contract"` |
| API route | `cline "Add a GET /health route to apps/api with zod validation and a unit test"` |
| Mobile UI | `cline "Add a native picker to apps/mobile using Expo UI and shared tokens"` |
| E2E test | `cline "Write a Playwright test for the login flow in apps/web"` |
| PR review | `cline --kanban` then `cline "Review open PRs and triage them"` |
