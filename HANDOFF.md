# Handoff — Reactive Triggers & Routine Trust Kit

Continue from a fresh checkout. Everything below is on `main` and pushed.

## 1. Get running on the new machine

```bash
git clone <your-repo-url> && cd rakazo      # or: git pull  (branch: main)
pnpm install
cp .env.example .env
# set in .env: POSTGRES_PASSWORD (same value in DATABASE_URL), BETTER_AUTH_SECRET,
# ENCRYPTION_KEY, SCREEN_PROXY_SECRET, SANDBOX_SUPERVISOR_TOKEN
pnpm db:generate
pnpm db:migrate
pnpm dev        # web http://127.0.0.1:5173, api, worker, sandbox-supervisor
```

Requirements: Node 22.22.2 (or 24.x / 26+), pnpm 9, Docker. Node 23.x / 25.x are not
supported.

## 1b. Windows laptop (recommended: WSL2 + Docker Desktop)

Source development for the computer/sandbox path expects a Linux filesystem, so run the
checkout inside WSL2. This mirrors `docs/self-host.md` (WSL note + Docker Desktop mount notes).

1. Install **WSL2** with an Ubuntu distro, then **Docker Desktop** and enable
   *Settings → Resources → WSL integration* for that distro.
2. Install Node + pnpm **inside WSL** (not on Windows):
   ```bash
   # in WSL:  nvm install 22 && nvm use 22   &&   corepack enable && corepack prepare pnpm@9.15.0 --activate
   ```
3. Clone into the **WSL Linux filesystem**, not `/mnt/c/...`:
   ```bash
   cd ~ && git clone <your-repo-url> rakazo && cd rakazo   # relative to /home/<you>, NOT /mnt/c
   git pull origin main                                     # the pushed commits land here
   ```
   A native Windows checkout (`C:\...`) makes the daemon mount and file-watching paths fragile;
   keep the checkout and its `data` directory in `~/rakazo`.
4. Same setup as above (`pnpm install`, `.env`, `pnpm db:generate`, `pnpm db:migrate`, `pnpm dev`),
   all from the WSL shell.
5. If the web UI loads but the bot's computer stays unreachable (Docker Desktop container IPs are
   not routable from WSL), add to `.env`:
   ```
   SANDBOX_CONTROL_VIA_LOOPBACK=true
   ```
   Leave it unset when using the Compose-hosted supervisor.

Windows-specific fixes, if needed:

- **Line endings from an older Windows clone** (`bash\r` in sandbox logs, computer pane hangs on
  boot): from a clean worktree —
  `git config core.autocrlf false && git add --renormalize . && git checkout -- . && pnpm sandbox:build`.
- **Workspace mirror** is now cross-platform: `pnpm workspace:pull|push|watch`
  (`scripts/sync-workspace.mjs`). The old `sync-workspace.ps1` is gone — no PowerShell needed; run
  it from WSL.

Alternative (no WSL): build the desktop app on Windows (`pnpm --filter @rakazo/desktop dev`) and
pick **This computer**, which runs the published images via Docker Compose itself
(`docs/desktop-release.md`); or connect it to a server with **Existing instance**. Use this to
*use* Rakazo on Windows; for *source development* prefer WSL.

## 2. What shipped

A trust-based, event-driven routine system, provider-neutral (no vendor env vars).

- **Phase 1 — pure domain.** `packages/core/src/trigger-filter.ts` (predicates + mappings),
  `trust-effects.ts` (risk tiers, quiet hours), `trust-runner.ts` (phase machine, dry run),
  `trigger-engine.ts` (event → routine narrowing). Contracts in
  `packages/contracts/src/triggers.ts`.
- **Phase 2 — persistence.** `Trigger` model (`packages/db/prisma/schema.prisma`), migration
  `packages/db/prisma/migrations/20261010090000_routine_trigger/`, and
  `packages/db/src/triggers.ts` (`createTriggerRepos`, space-isolated). Approval state stays in
  `ExternalEffect`; a triggered run's phase stays on `Run` — deliberately no `ApprovalLog` /
  `RoutineExecution` tables.
- **Phase 3 — engine wiring.** `apps/api/src/triggers.ts` + `triggers`/`events` RPC in
  `router.ts`; `webhook.ts`, `github-webhook.ts`, `messaging-inbound.ts` load stored triggers and
  narrow the routines they wake via `deliverWebhookEvent`. A trigger refines, never broadens.
- **Phase 4 — conformance.** `packages/testkit/src/trust-conformance.test.ts` (offline).
- **Phase 5 — UI (web).** `events.list` exposes the catalog; `apps/web/src/pages/
  ReactiveTriggerSection.tsx` (list/add triggers, mounted in `RoutineEditor.tsx`).

Event catalog (data, provider-neutral): `packages/adapters/src/event-catalog.ts`.

## 3. Continue here (in order)

1. **Phase 4 executor wiring (quiet hours landed, phase machine open).**
   Quiet hours are connected: the wake path plans through `planRunTrust` → `planQuietHours`
   (`packages/core/src/trust-runner.ts`), called by `createWebhookTrustPlanner`
   (`apps/api/src/trigger-trust.ts`) and applied in `apps/api/src/webhook-inbound.ts`; the
   per-space `TrustPolicy` is persisted through `trust/set`. Answering a held wake releases it
   — `commitAnswerRunInput` (`packages/db/src/events.ts`) clears the paused phase and leaves the
   routine's wake instruction on the task, so the resumed run reaches the approval gate instead
   of treating the release text as the whole request. Open: the phase machine `planTrustPhases`
   (`packages/core/src/trust-runner.ts`) is tested but has no production caller.
2. **Phase 5 remaining.**
   - Dry-run effect list with risk tiers before approval; reuse the existing approval card.
   - Per-space `TrustPolicy` settings (approval threshold, quiet hours) + migration.
   - Mobile: trigger list/add on the routine screen
     (`apps/mobile/app/routine.tsx`).
3. **Postgres journey test** for triggers (create → event → routine): guard with
   `process.env.VERIFY_DATABASE` like `packages/db/src/messaging.postgres.test.ts`.
4. **Broker events** for other connectors (Linear/Sentry/PagerDuty) are in the catalog and
   filtered, but have no inbound delivery path yet.

Full plan with checkboxes: `docs/superpowers/plans/2026-10-10-reactive-triggers-and-trust-kit.md`.

## 4. Where things live

| Area | Path |
| --- | --- |
| Core domain | `packages/core/src/{trigger-filter,trigger-engine,trust-effects,trust-runner}.ts` |
| Contracts | `packages/contracts/src/triggers.ts`, `rpc.ts` (`triggers`, `events`) |
| Persistence | `packages/db/src/triggers.ts`, `schema.prisma` (`model Trigger`) |
| API | `apps/api/src/{triggers,webhook,github-webhook,messaging-inbound,router}.ts` |
| Web UI | `apps/web/src/pages/{ReactiveTriggerSection,RoutineEditor}.tsx` |
| Catalog | `packages/adapters/src/event-catalog.ts` |

## 5. Verify

```bash
pnpm exec vitest run packages/contracts/src/triggers.test.ts \
  packages/core/src/{trigger-filter,trigger-engine,trust-effects,trust-runner}.test.ts \
  packages/adapters/src/event-catalog.test.ts packages/db/src/triggers.test.ts \
  apps/api/src/triggers.test.ts packages/testkit/src/trust-conformance.test.ts \
  apps/web/src/pages/ReactiveTriggerSection.test.tsx
pnpm --filter @rakazo/contracts check && pnpm --filter @rakazo/core check \
  && pnpm --filter @rakazo/adapters check && pnpm --filter @rakazo/db check \
  && pnpm --filter @rakazo/api check && pnpm --filter @rakazo/web check
pnpm lint
```

## 6. Gotchas

- `pnpm check` (Turbo) hashes tracked files only, so it can report success while an **untracked**
  file is broken. Prefer the per-package `pnpm --filter <pkg> check` calls above after adding
  files.
- Two `spawnSync`-based tests (`infra/sandboxes/supervisor/src/browser-profile.test.ts`,
  `packages/core/src/node/desktop-runtime.test.ts`) used to time out under a fully parallel run.
  Fixed by `d96eabd2` (child timeouts 25 s / 45 s, per-test 60 s / 90 s) and `a8ca34e1`
  (`maxWorkers: 8` in `vitest.config.ts`). The worker cap is the load-bearing half: with one worker
  per core the quiesce script needed over 45 s for what takes 11 s idle, so the fix is less
  contention, not bigger timeouts. Full run since then: 78 s, both files green.
- `pnpm lint` is `biome check .` over the working tree, so it reports any window's uncommitted
  edits as errors. Judge it against committed content, not against another window's live files.
  The long-standing `.vscode/settings.json` newline error is fixed (`4d0f4228`).
- After any `packages/db/prisma/schema.prisma` change, **every worktree needs `pnpm db:generate`**.
  Generated output is gitignored (`.gitignore:34`), so the branch merges the new schema but keeps the
  old client, and the symptom is a confusing `error TS2339` on the new field (it bit `sprint/ux` and
  `sprint/reach` after `995a4485` added `Run.resumeAt`: `events.ts(891,12) Property 'resumeAt' does
  not exist on type 'RunUpdateInput'`). `pnpm db:generate` in that worktree is the whole fix.
- Sprint branch state, integrator support, 2026-10-01 04:47 — `sprint/library` merged to `main`
  and clean at origin. `sprint/reach` and `sprint/ux` were both aligned with `main`, merge commits
  `3fd09505` and `e87b2fd1` (revert points `496b25c5` and `8aca4ee1`), each verified green in its own
  worktree: `sprint/reach` with `pnpm --filter @rakazo/adapters check`, `pnpm lint`, and three
  adapter test files (35 tests); `sprint/ux` with `pnpm --filter @rakazo/web check`, `pnpm lint`, and
  three test files (8 tests). Both are now `behind=0`, so neither merge into `main` needs conflict
  work. Neither is fully pushed: `sprint/reach` sits 12 commits ahead of `origin/sprint/reach`, and
  `sprint/ux` has no `origin` tracking at all — A and C should push their own branches.
- Keep providers generic: add a provider by normalizing its webhook to a `TriggerEvent` and
  extending `EVENT_CATALOG`, never with a provider-specific env var.
- Tests are deterministic and offline by default. The desktop Playwright e2e steals focus on
  macOS — let CI run it.