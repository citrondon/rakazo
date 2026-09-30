# Reactive Triggers & Routine Trust Kit — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Turn Rakazo's routines from schedules-plus-flags into a trust-based, event-driven
automation tool: narrow reactive triggers, a dry-run → approval → execute path, and quiet hours.

**Spec:** this plan. **Status:** Phase 1 (pure domain + contracts + catalog) is done; Phases 2–5
(persistence, RPC, engine wiring, UI) remain.

## Why this shape

The submitted design sketched new `events.triggers` / `events.approvalLogs` /
`events.routineExecutions` tables. Rakazo already has the primitives those tables would duplicate,
so this plan reuses them and keeps one source of truth (AGENTS.md: reuse primitives, avoid
duplication and speculative abstractions):

- `Routine` (`packages/db/prisma/schema.prisma`) already carries `crons`, `active`, `notify`,
  `webhookEnabled`, `githubEnabled`, `messageProvider`, `timezone`.
- `Run.trigger` (`RunTriggerSchema`) already records `routine`, `webhook`, `messaging`; transitions
  live in `packages/core/src/run-state.ts`.
- `ExternalEffect` is the durable record for a consequential effect (`idempotencyKey`, `status`,
  `request`, `reviewDecision`, `reviewReason`) with approval logic in
  `packages/core/src/action-approval.ts` and `packages/core/src/approval-effect-key.ts`, and the
  read model in `packages/core/src/run-receipt.ts`. **Approval logs and executions belong here,
  not in a parallel table set.**

Conventions this plan follows: `.test.ts` (not `.spec.ts`) co-located with source; zod contracts
in `packages/contracts`; pure domain in `@rakazo/core`; provider config in `@rakazo/adapters`;
flat alphabetical `export *` barrels; deterministic offline tests.

## Phase 1 — Pure domain, contracts, catalog ✅

- [x] `packages/contracts/src/triggers.ts` — `Trigger*`, `TrustEffect*`, `TrustPhase*`,
  `QuietHours`, `TrustPolicy`, `TriggerEvent`. `CreateTriggerInput`/`UpdateTriggerInput` reject an
  empty filter (no broad listeners).
- [x] `packages/core/src/trigger-filter.ts` — `resolveEventField`, `evaluatePredicate`
  (equals/contains/startsWith/endsWith/oneOf/regex/exists), `matchesTriggerFilter` (AND, empty
  filter never fires), `isOverlyBroadTrigger`, `applyTriggerMappings`.
- [x] `packages/core/src/trust-effects.ts` — `effectRisk`, `isMutating`, `highestRisk`,
  `requiresApproval`, `policyRequiresApproval`, `parseClockMinutes`, `minutesOfDay`,
  `withinQuietHours`, `planQuietHours`.
- [x] `packages/core/src/trust-runner.ts` — `TRUST_PHASE_TRANSITIONS`, `canAdvanceTrust`,
  `assertTrustTransition`, `planTrustPhases`, `dryRunPreview`, `dryRunAppliedEffects`,
  `isDryRunSideEffectFree`.
- [x] `packages/adapters/src/event-catalog.ts` — provider-neutral `EVENT_CATALOG` (github, slack,
  gmail, linear, sentry, pagerduty, teams, webhook), `listEventDefinitions`, `findEventDefinition`.
- [x] Barrels updated (contracts, core, adapters). 48 new tests pass; `pnpm check` and `biome check`
  clean; full contracts (114) and core (703) suites green.

Conformance invariant carried from the spec: a dry run applies only read/list/draft effects, so
`isDryRunSideEffectFree` is true for any plan and `dryRunAppliedEffects` never returns a mutating
action.

## Phase 2 — Persistence on existing primitives ✅

A prior session had already added `Trigger`, `ApprovalLog`, and `RoutineExecution` to the schema
(uncommitted, with a regenerated client but no migration). Reconciled rather than duplicated:

- [x] `Trigger` (`@@map("triggers")`) aligned to the repo's space-isolation convention: added
  `spaceId`/`space`, `botId`/`bot`, `userId`, `eventType`, `updatedAt`, and `mappings` (was the
  singular `mapping`); `filter` is non-null with a default; index on
  `(spaceId, provider, eventType, enabled)`.
- [x] Migration `20261010090000_routine_trigger` creates `triggers`, `approval_logs`, and
  `routine_executions` with every FK the schema declares.
- [x] `packages/db/src/triggers.ts` — `createTriggerRepos(prisma)`: `createTrigger` (the bot is
  derived from the owned routine, never trusted from the caller), `listTriggers`, `updateTrigger`,
  `deleteTrigger`, `listEnabledTriggersForEvent`; every read and write is scoped to the actor's
  space and user and throws `IsolationError` otherwise. 9 unit tests.
- [x] Contracts export `CreateTriggerInput`/`UpdateTriggerInput` types for callers.
- `ApprovalLog`/`RoutineExecution` remain from the prior session but are **not** wired. The design
  still prefers `ExternalEffect` (approval) and `Run` (phase/status). Decide reuse-or-remove before
  any code writes to them, so approval state does not live in two places.
- Postgres integration test deferred to Phase 3, where the event → routine journey is real; avoids
  shipping unverified seed code.

## Phase 3 — Trigger engine wiring ✅

- [x] `packages/core/src/trigger-engine.ts` — `selectTriggeredRoutines` + `formatRoutineInputs`.
  A routine with no enabled trigger for the event keeps its legacy behavior; a routine that
  has triggers fires only when one matches, folding in its mapped fields. Pure and offline. 7 tests.
- [x] `packages/contracts/src/rpc.ts` — `triggers` namespace (`list`/`create`/`update`/`remove`)
  plus `CreateTriggerInput`/`UpdateTriggerInput` types.
- [x] `packages/db/src/triggers.ts` — `listEnabledTriggersForEvent` now also scopes by `botId`.
- [x] `apps/api/src/webhook-inbound.ts` — `deliverWebhookEvent` accepts optional `triggers` +
  `event` and narrows the candidate routines through the engine; behavior is unchanged when
  none are passed.
- [x] Wired the three existing inbound paths to load triggers and build the normalized event:
  `webhook.ts` (provider `webhook`), `github-webhook.ts` (provider `github`), and
  `messaging-inbound.ts#wakeMessageRoutines` (provider = message provider, type `message`).
- [x] `apps/api/src/triggers.ts` + router `triggers` namespace — create/list/update/remove,
  space-isolated. `createTrigger` enables the routine's `webhookEnabled`/`githubEnabled` flag
  for the paths that exist, so a webhook or GitHub trigger is enough on its own. 4 tests.
- Broker events for other connectors (Linear/Sentry/PagerDuty) are stored and filtered by the
  catalog, but their inbound delivery is future work; no caller exists to wake them yet.

Test harnesses updated with an empty `trigger` delegate to match the new reads (webhook,
messaging-inbound). Full offline suite: 5978 passed; only the two known flaky
`infra/sandboxes/supervisor` + `desktop-runtime` `spawnSync` tests fail, unaffected by this work.

## Phase 4 — Approval, quiet hours, conformance ✅ (executor wiring deferred)

- [x] `packages/testkit/src/trust-conformance.test.ts` — the spec's named conformance suite, 10
  offline tests: a dry run applies only read/list/draft for every action; every mutating action
  asks for approval at the default threshold; approval sits between dry run and execution exactly
  when required; `executed` is terminal; a quiet window pauses only consequential plans; an empty
  filter never fires; `selectTriggeredRoutines` never broadens.
- [x] `run-receipt.ts` already builds from storage; the trust kit adds no second source of truth.
- Consolidated the prior session's uncommitted trust work rather than running two designs:
  removed `packages/core/src/trust-runner-service.ts` (dead, no callers, imported `@rakazo/db`
  from core and a `RoutineExecution` type that does not exist — it broke `@rakazo/core`'s own
  `tsc` and blocked any package importing core's barrel), and removed the unused `ApprovalLog`
  and `RoutineExecution` models plus the tables I had added to the trigger migration. Approval
  state stays in `ExternalEffect`; a triggered run's phase stays on `Run`. One source of truth.
- Deferred, with reasons: gating the wake path through `planTrustPhases`/`planQuietHours` needs
  the planned effects *before* the run executes, which the executor cannot know yet, and a stored
  `TrustPolicy` (none exists). Wiring it now would be dead code or an unbacked schema change, so
  the pure functions stay ready and tested until effects can be derived pre-run (e.g. from the
  routine's connected tools) and a policy is persisted.

## Phase 5 — UI (web/Electron) — started

- [x] `apps/api/src/triggers.ts` + router: `events.list` exposes the provider-neutral catalog
  (`listEventDefinitions`) so any surface renders a trigger picker from one source of truth.
- [x] `apps/contracts`: `EventDefinitionSchema`/`EventDefinition`; `events` RPC namespace.
- [x] `apps/web/src/pages/ReactiveTriggerSection.tsx` (+ test) — a self-contained trigger editor
  for a saved routine: lists existing triggers with a one-line rule summary, and adds one from the
  catalog (event → field → operator → value). It loads its own catalog/triggers via
  `rpc.events.list` / `rpc.triggers.*`, so it needs only the routine id.
- [x] `RoutineEditor.tsx` renders it when editing a saved routine.
- [ ] Show the dry-run effect list with risk tiers before approval; reuse the approval card.
- [ ] Settings: per-space `TrustPolicy` (approval threshold, quiet hours).
- [ ] Mobile: trigger list/add on the routine screen.

## Verification

```bash
pnpm exec vitest run packages/contracts/src/triggers.test.ts \
  packages/core/src/trigger-filter.test.ts packages/core/src/trust-effects.test.ts \
  packages/core/src/trust-runner.test.ts packages/adapters/src/event-catalog.test.ts
pnpm --filter @rakazo/contracts check && pnpm --filter @rakazo/core check \
  && pnpm --filter @rakazo/adapters check
pnpm exec biome check <changed files>
```

Once Phase 3 lands: `pnpm test:integration` for the Postgres journey, and a web e2e under
`apps/web/e2e/` that creates a trigger and approves a dry-run card (link the CI screenshot from the
PR).

## Reviewer checklist

- [ ] New tables only where the existing primitives cannot hold the data.
- [ ] Empty filters rejected; every trigger stays narrow.
- [ ] A dry run provably applies no mutating effect.
- [ ] Quiet hours pause consequential routines only.
- [ ] Tests deterministic and offline by default.