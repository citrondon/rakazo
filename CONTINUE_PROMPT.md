# Continue: Reactive Triggers & Routine Trust Kit

## Current State

All phases shipped. The authoritative checklist lives in
`docs/superpowers/plans/2026-10-10-reactive-triggers-and-trust-kit.md`; this is the short version.

### Pure domain (`packages/core/src/`)

- `trigger-filter.ts` — predicate evaluation (equals/contains/startsWith/endsWith/oneOf/regex/exists),
  `matchesTriggerFilter` (AND, an empty filter never fires), `applyTriggerMappings`.
- `trigger-engine.ts` — `selectTriggeredRoutines` + `formatRoutineInputs`; a trigger refines the
  routines an event may wake, never broadens them.
- `trust-effects.ts` — risk tiers, `highestRisk`, `requiresApproval`, `policyRequiresApproval`,
  quiet-hour arithmetic, and `DEFAULT_TRUST_POLICY`/`resolveTrustPolicy`.
- `trust-runner.ts` — phase machine plus `planTrustPhases` and `planRunTrust`.
- `routine-effects.ts` — `planRoutineEffects`/`toolTrustAction`: the effects a routine may reach,
  derived from the tools its bot can call (builtins such as `shell` count as writes).

### Persistence (`packages/db/`)

- `Trigger` model + migration `20261010090000_routine_trigger`.
- `TrustPolicy` model + migration `20261010110000_space_trust_policy` (per space: approval
  threshold, quiet hours).
- `Run.trustPhase` + migration `20261010120000_run_trust_phase`.
- `triggers.ts` (`createTriggerRepos`), `trust-policy.ts` (`createTrustPolicyRepos`),
  `routine-tools.ts` (`createRoutineToolRepos.listBotToolDescriptors`); all space-isolated.
- Approval state stays in `ExternalEffect`; a triggered run's phase stays on `Run`. There is no
  `ApprovalLog` or `RoutineExecution` table.

### API (`apps/api/src/`)

- `triggers.ts` — `triggers.list/create/update/remove` and `triggers.previewEffects`; `events.list`
  exposes the catalog.
- `trust-policy.ts` — `trust.get` / `trust.set`.
- `webhook.ts` (generic bearer webhook), `github-webhook.ts`, `messaging-inbound.ts` — load stored
  triggers and narrow the routines they wake via `webhook-inbound.ts#deliverWebhookEvent`.
- `event-webhook.ts` — `POST /api/v1/bots/:botId/events`: a normalized `{ provider, type, payload }`
  event for connectors without a dedicated route (Linear/Sentry/PagerDuty/...).
- `trigger-trust.ts` — `createWebhookTrustPlanner`, resolving a wake's plan from the bot's tools and
  the space policy. A consequential wake inside quiet hours is held on an ask card that shows the
  dry-run plan (`holdRunForChoice` in `packages/db/src/events.ts`).
- Executor (`packages/adapters/src/executor.ts`) narrows the unattended boundary through the space's
  `approvalThreshold`.

### UI

- Web: `apps/web/src/pages/ReactiveTriggerSection.tsx` (trigger editor + planned-effect list with
  risk badges), `apps/web/src/components/TrustPolicySettings.tsx` (approval threshold, quiet hours).
- Mobile: `apps/mobile/app/routine.tsx` lists/adds/removes triggers with native action sheets.

### Event catalog

`packages/adapters/src/event-catalog.ts` — provider-neutral data (github, slack, gmail, linear,
sentry, pagerduty, teams, webhook).

## Verify

```bash
pnpm exec vitest run packages/contracts/src/triggers.test.ts \
  packages/core/src/{trigger-filter,trigger-engine,trust-effects,trust-runner,routine-effects}.test.ts \
  packages/adapters/src/{event-catalog,executor-readonly-approval}.test.ts \
  packages/db/src/{triggers,trust-policy,routine-tools}.test.ts \
  apps/api/src/{triggers,trust-policy,webhook-inbound,event-webhook}.test.ts \
  packages/testkit/src/trust-conformance.test.ts \
  apps/web/src/pages/ReactiveTriggerSection.test.tsx \
  apps/web/src/components/TrustPolicySettings.test.tsx
pnpm --filter @bobbot/contracts check && pnpm --filter @bobbot/core check \
  && pnpm --filter @bobbot/adapters check && pnpm --filter @bobbot/db check \
  && pnpm --filter @bobbot/api check && pnpm --filter @bobbot/web check
pnpm db:migrate            # if the database is behind
VERIFY_DATABASE=1 pnpm test:integration   # Postgres trigger journey
```

## Notes

- Provider-neutral: triggers store source/provider/eventType; the engine evaluates without vendor
  logic, and a provider is added by normalizing its webhook to a `TriggerEvent` and extending
  `EVENT_CATALOG`, never with a provider-specific env var.
- Deterministic and offline by default: the domain and trust kit are pure functions.
- Backward compatible: the `webhookEnabled`/`githubEnabled` flags still work; triggers are
  additive. The generic webhook and GitHub signature validation are unchanged.

## Follow-ups

- A provider that only signs its own raw webhook needs an adapter that verifies the signature and
  forwards a normalized event to `/events`.
- A web e2e that creates a trigger and approves a held dry-run card (link the CI screenshot).
- Extend quiet hours to auto-resume when the window closes.
