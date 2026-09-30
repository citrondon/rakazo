# Continue: Reactive Triggers & Routine Trust Kit

## Current State (2026-10-10)

### ✅ Completed

**Core Primitives** (`packages/core/src/`):
- `trigger-engine.ts` — Event→Routine matching via stored triggers
- `trigger-filter.ts` — Predicate evaluation (exists, contains, oneOf, startsWith, endsWith, regex, caseSensitive)
- `trust-runner.ts` — Phase machine: planned → dryRun → approval → executed (with rejection/pause transitions)
- `trust-effects.ts` — Risk tiers: low (read/list/draft), medium (create/update/notify), high (delete/transfer/publish)

**Database** (`packages/db/prisma/schema.prisma`):
- `Trigger` model (source, provider, eventType, filter, mappings, enabled)
- `ApprovalLog` model (triggerId, executionId, step, actor, reason)
- `RoutineExecution` model (routineId, triggerId, status, effectPreview, logs)

**API Layer** (`apps/api/src/`):
- `triggers.ts` — RPC: list/create/update/delete triggers
- `webhook.ts` + `github-webhook.ts` — HTTP endpoints with signature validation
- `webhook-inbound.ts` — Integrates `selectTriggeredRoutines` from trigger-engine

**Contracts** (`packages/contracts/src/triggers.ts`):
- Zod schemas for Trigger, TriggerFilter, TriggerMapping, TriggerPredicate
- TrustEffect, TrustPhase, TrustPolicy, TriggerEvent
- RPC contracts under `appContract.triggers.*`

**Tests**: All passing (32 tests: trigger-filter, trust-runner, trigger-engine, triggers API)

### 🔧 Integration Points

Webhook delivery flow:
1. Inbound event → parse payload → normalize to `TriggerEvent`
2. `createTriggerRepos.listEnabledTriggersForEvent` fetches matching triggers
3. `selectTriggeredRoutines` filters routines by trigger predicates
4. Mapped fields folded into routine prompt as "Routine inputs:" block
5. Routine queued for execution via existing job system

### 📋 Next Steps (Priority Order)

1. **Trigger Configuration UI** — Add "Triggers" tab to `RoutineEditor.tsx`:
   - Source selector (webhook/github/messaging/cron)
   - Provider picker (from existing connections)
   - Filter builder (visual predicate editor)
   - Mapping table (event field → routine input)
   - Trust policy (approval threshold, quiet hours)

2. **Approval Dashboard** — Thread UI component for approval cards:
   - Show risk level, planned effects, phase status
   - Approve/Reject buttons calling `triggers.advanceExecutionPhase`

3. **Worker Integration** — Execute trust phases in `apps/worker/src/index.ts`:
   - On run start: evaluate trust policy, enter dryRun
   - On approval: advance to executed phase
   - Log all phase transitions to `RoutineExecution`

4. **Extend Event Sources** — Wire messaging-inbound, cron scheduler to trigger engine

### Key Files to Touch

| Task | Files |
|------|-------|
| Trigger UI | `apps/web/src/pages/RoutineEditor.tsx` |
| Approval UI | `apps/web/src/components/ApprovalCard.tsx` (new) |
| Worker | `apps/worker/src/index.ts` (add trust runner job handler) |
| Messaging | `apps/api/src/messaging-inbound.ts` (already imports trigger-engine) |
| Cron | `packages/core/src/cron.ts` (add trigger evaluation on schedule) |

### Commands

```bash
# Type check
pnpm check

# Run trigger-related tests
pnpm test apps/api/src/triggers.test.ts packages/core/src/trigger-filter.test.ts packages/core/src/trust-runner.test.ts packages/core/src/trigger-engine.test.ts

# Generate Prisma client after schema changes
pnpm --filter @rakazo/db generate
```

### Architecture Notes

- **Provider-neutral**: Triggers store source/provider/eventType; engine evaluates without vendor logic
- **Deterministic offline**: `trigger-filter` and `trust-runner` are pure functions — fully testable without network
- **Backward compatible**: Existing `webhookEnabled`/`githubEnabled` flags still work; triggers are additive
- **Security**: Empty filter rejected on create (prevents broad listeners); webhook/GitHub signature validation unchanged