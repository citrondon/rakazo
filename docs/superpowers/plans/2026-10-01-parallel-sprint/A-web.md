# Window A — Web / Electron convenience

Start prompt for one Cline window. Work in `../rakazo-ux` on branch `sprint/ux`.

## Read first
- `docs/superpowers/plans/2026-10-01-parallel-sprint.md` — rules, ownership, merge flow.
- `AGENTS.md` — UI system: shadcn on Base UI, semantic tokens, minimal copy.

## You own (edit only these)
`apps/web/**`, `apps/desktop/**`, `packages/chat-ui/**`, `packages/ui-web/**`, `packages/ui-tokens/**`

## Do NOT touch
`packages/core/**`, `packages/db/**`, `packages/contracts/**`, any `index.ts` barrel,
`apps/api/src/router.ts`. Need a change there? Write it in your handoff; the integrator applies it.

## Tasks
- [ ] Web e2e: a trigger is created and a held dry-run card is approved, under `apps/web/e2e/`.
      Link the CI screenshot.
- [ ] Convenience pass — pick the single highest-friction item and land it: team/identity picker
      completeness, onboarding, or artifact-preview polish.
- [ ] Hand to D: the contract change needed to inline the routine's dry-run plan on the per-tool
      approval card.

## Verify before every commit
```bash
pnpm --filter @rakazo/web check
pnpm exec vitest run apps/web/src/pages/ReactiveTriggerSection.test.tsx
pnpm exec biome check <changed files>
```
(The web Playwright suite runs in CI, not locally.)

## Handoff
What changed · exact verify command · observed result · anything another window must do.
