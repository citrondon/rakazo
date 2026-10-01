# Window C — Connectors & reach

Start prompt for one Cline window. Work in `../rakazo-reach` on branch `sprint/reach`.

## Read first
- `docs/superpowers/plans/2026-10-01-parallel-sprint.md` — rules, ownership, merge flow.
- `packages/adapters/src/event-catalog.ts` and `apps/api/src/event-webhook.ts` — the existing
  normalized-event path.

## You own (edit only these)
`packages/adapters/**`, `packages/adapter-kit/**`, `apps/mobile/**`,
`apps/api/src/messaging*.ts`, `apps/api/src/event-webhook*.ts`

## Do NOT touch
`packages/core/**`, `packages/db/**`, `packages/contracts/**`, any `index.ts` barrel,
`apps/api/src/router.ts`. Need a change there? Write it in your handoff; the integrator applies it.

## Tasks
- [ ] HMAC signature adapters for providers that only sign their own raw webhook (Linear, Sentry,
      PagerDuty): verify the signature, then forward a normalized `{ provider, type, payload }` event
      to `/events`. Reuse `EVENT_CATALOG`; never add a provider-specific env var.
- [ ] Confirm the existing `/events` path (`event-webhook.ts`) before writing new code — it may
      already cover part of this.
- [ ] Mobile parity polish for the new trust/trigger surfaces, if anything still diverges.

## Verify before every commit
```bash
pnpm --filter @rakazo/adapters check
pnpm exec vitest run packages/adapters/src/event-catalog.test.ts
pnpm exec biome check <changed files>
```
Add a deterministic offline conformance test for each new adapter.

## Handoff
What changed · exact verify command · observed result · anything another window must do.
