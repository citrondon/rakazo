# Fresh-context prompt — Rakazo, 2026-10-01

## You are
Cline at the Rakazo repo root (branch `main`). Read `AGENTS.md` first — it governs UI copy,
shared-first design, provider neutrality, secrets, and verification.

## Repo
Public monorepo: pnpm + TypeScript strict + Biome. Surfaces: `apps/web` (shadcn on Base UI),
`apps/desktop` (Electron), `apps/mobile` (Expo), `apps/api` (Fastify + Drizzle), `apps/www` (astro).
Shared: `packages/{core,contracts,db,adapters,ui-web,ui-tokens,chat-ui}` plus
`bot-library/{bots,teams,identities}`.

## Goal
GrokBot parity on all three surfaces plus one visible convenience, then an opt-in self-hosted AI
code review.

## Done (committed and pushed on main)
- Triggers: normalized event → `EVENT_CATALOG` → dry run → `EVENT_TRIGGERED` hold → approval →
  `executeEvent`.
- Trust kit: per-tool trust policy → `TrustEffect` → tier routing → `TRUST_HOLD` pause; `dryRun`
  preview; `packages/core/src/trust-effects.ts`.
- `.github/workflows/open-code-review.yml` — opt-in, pinned `alibaba/open-code-review@v1.12.11`,
  gated on the variable `OCR_ENABLED`, skips draft PRs, reads `OCR_LLM_{URL,TOKEN,MODEL}` secrets by
  name only. `ocr` installed locally; `ocr llm test` passes; a sample review ran. Config lives in
  `~/.config/open-code-review/config.yaml`.
- The four GrokBot features are live: research→code, avatar studio, artifacts, teams & identities.

## Done (NOT committed — waiting for a clean tree)
- `docs/superpowers/plans/2026-10-01-parallel-sprint.md` — board: roles, path ownership, merge flow.
- `…/A-web.md`, `B-library.md`, `C-reach.md`, `D-integrator.md`, `E-audit.md` — window start prompts.
- `…/backlog-audit.md` — verified open backlog (5 tasks + uncertainties).
- `scripts/setup-parallel-sprint.sh` — creates worktrees `../rakazo-{ux,library,reach}` and branches
  `sprint/{ux,library,reach}`. It refuses a dirty tree.

## Blocked
Other agents still work on `main`: 3 unpushed commits plus active changes
(`apps/api/src/event-webhook*.ts`, `packages/adapters/src/event-catalog*`, `apps/api/src/router.ts`).
Do not commit, create worktrees, or start feature work until the tree is clean.
OCR CI stays inactive until the repo sets variable `OCR_ENABLED=true` and secrets
`OCR_LLM_URL`, `OCR_LLM_MODEL`, `OCR_LLM_TOKEN`.

## Next, in order
1. Wait for the other agents, make `main` clean, push.
2. Commit the sprint prep: `docs(sprint): add four-window parallel sprint plan`.
3. `bash scripts/setup-parallel-sprint.sh`.
4. Open 3 Cline windows (A/B/C briefs, each in its worktree) plus 1 Opus integrator (D, main checkout).
5. Replace the board's seed backlog with the verified tasks from `backlog-audit.md`.

## Rules that matter
- No secrets, personal data, or tool output in commits, PRs, or reviews.
- Minimal UI copy — every visible word is UI.
- Verify locally: `pnpm --filter <pkg> check`, `pnpm exec vitest run <file>`,
  `pnpm exec biome check <file>`. Never run the desktop Playwright suite locally.
- Conventional commits; `pnpm exec biome format --write <file>` before committing;
  never commit `.husky/_`.

## First command
`git log --oneline -5 && git status --short`
