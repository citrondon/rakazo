# Fresh-context prompt — BobBot, 2026-10-01

## You are
Cline at the BobBot repo root (branch `main`). Read `AGENTS.md` first — it governs UI copy,
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
- Triggers: normalized event → `EVENT_CATALOG` (`packages/adapters/src/event-catalog.ts`) →
  `selectTriggeredRoutines` (`packages/core/src/trigger-engine.ts`) → `deliverWebhookEvent`
  (`apps/api/src/webhook-inbound.ts`) → `holdRunForChoice` (`packages/db/src/events.ts`).
- Trust kit: `TrustPolicy` → `TrustEffect` → `TrustPhase`
  (`planned | dryRun | approval | executed | paused | rejected`). `dryRunPreview` and
  `planQuietHours` live in `packages/core/src/trust-runner.ts`; policy and quiet-hours helpers in
  `packages/core/src/trust-effects.ts`. The pause is the `paused` phase — there is no `TRUST_HOLD`,
  no `EVENT_TRIGGERED` and no `executeEvent` in the code, so do not grep for them.
- `.github/workflows/open-code-review.yml` — opt-in, pinned `alibaba/open-code-review@v1.12.11`,
  gated on the variable `OCR_ENABLED`, skips draft PRs, reads `OCR_LLM_{URL,TOKEN,MODEL}` secrets by
  name only. `ocr` installed locally; `ocr llm test` passes; a sample review ran. Config lives in
  `~/.config/open-code-review/config.yaml`.
- The four GrokBot features are live: research→code, avatar studio, artifacts, teams & identities.

## Done (committed and pushed on `main`)
- `aef87e2b docs(sprint): add the four-window parallel sprint plan` — the board, the five window
  briefs, `backlog-audit.md`, and `scripts/setup-parallel-sprint.sh` in one commit.
- The backlog was then frozen and the audit's two wrong evidence rows were corrected; `main` is
  clean and nothing is unpushed.

## Unblocked
The in-flight agents finished, their work is committed and pushed, and the tree is clean. The sprint
prep is committed — **do not re-commit it.** OCR CI stays inactive until the repository sets the
variable `OCR_ENABLED=true` and the secrets `OCR_LLM_URL`, `OCR_LLM_MODEL`, `OCR_LLM_TOKEN`
(optionally `OCR_USE_ANTHROPIC=true` for the Anthropic protocol). That is a repository-settings
action, not a repo change.

## Next, in order
1. `bash scripts/setup-parallel-sprint.sh` — creates `../rakazo-{ux,library,reach}` on the branches
   `sprint/{ux,library,reach}` from a clean `main`.
2. Open 3 Cline windows (A/B/C briefs, each in its worktree) plus 1 Opus integrator (D, main checkout).
3. Nothing else: the board's backlog is already the verified list.

## Rules that matter
- No secrets, personal data, or tool output in commits, PRs, or reviews.
- Minimal UI copy — every visible word is UI.
- Verify locally: `pnpm --filter <pkg> check`, `pnpm exec vitest run <file>`,
  `pnpm exec biome check <file>`. Never run the desktop Playwright suite locally.
- Conventional commits; `pnpm exec biome format --write <file>` before committing;
  never commit `.husky/_`.

## First command
`git log --oneline -5 && git status --short`
