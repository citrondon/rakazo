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

1. **Phase 4 executor wiring (deferred, needs two prerequisites).**
   Gate the wake path through `planTrustPhases` / `planQuietHours`
   (`packages/adapters/src/executor.ts`). Prerequisites first:
   (a) derive a routine's planned `TrustEffect[]` *before* the run (e.g. from its connected
   tools); (b) persist a `TrustPolicy` (per space or bot). Until then the pure functions stay
   tested but unconnected — don't wire a half path.
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
- Two sandbox tests (`infra/sandboxes/supervisor/src/browser-profile.test.ts`,
  `packages/core/src/node/desktop-runtime.test.ts`) are `spawnSync`-based and can time out under
  a fully parallel run; they pass in isolation and are unrelated to this work.
- Keep providers generic: add a provider by normalizing its webhook to a `TriggerEvent` and
  extending `EVENT_CATALOG`, never with a provider-specific env var.
- Tests are deterministic and offline by default. The desktop Playwright e2e steals focus on
  macOS — let CI run it.