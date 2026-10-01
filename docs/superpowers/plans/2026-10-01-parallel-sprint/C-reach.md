# Window C — Connectors & reach

Start prompt for one Cline window. Work in `../rakazo-reach` on branch `sprint/reach`.

## Before you start

```bash
pnpm install --frozen-lockfile     # a fresh worktree has no node_modules yet
```

Running a dev server too? `cp .env.example .env` first. Never commit `.env`.

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
- [ ] Already confirmed, do not re-litigate: `apps/api/src/event-webhook.ts` accepts
      `{ provider, type, payload }` and authenticates with a bearer token only — it verifies no
      provider signature by design, and says so in its doc comment. Your adapters are additive:
      reuse that route, do not change it.
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
