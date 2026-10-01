# Window A — Web / Electron convenience

Start prompt for one Cline window. Work in `../rakazo-ux` on branch `sprint/ux`.

## Before you start

```bash
pnpm install --frozen-lockfile     # a fresh worktree has no node_modules yet
```

Running a dev server too? `cp .env.example .env` first. Never commit `.env`.

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
      Link the CI screenshot. No spec covers this yet; `routine-crud`, `approval-resume`,
      `consequential-approval` and `mcp-approval-card` are the patterns to copy.
- [ ] Convenience pass — pick the single highest-friction item and land it: onboarding or
      artifact-preview polish. The library picker already shipped as
      `apps/web/src/pages/BotLibraryOverlay.tsx`; do not rebuild it.
- [ ] Dry-run plan on the approval card: **wait for D's contract.** The cards render from
      `apps/web/src/pages/shell/message-cards.tsx` (`ChoiceCard`, `McpApprovalCard`), and nothing in
      `apps/web/src` receives a dry-run plan today — there is nothing to inline yet.

## Verify before every commit
```bash
pnpm --filter @rakazo/web check
pnpm exec vitest run apps/web/src/pages/ReactiveTriggerSection.test.tsx
pnpm exec biome check <changed files>
```
(The web Playwright suite runs in CI, not locally.)

## Handoff
What changed · exact verify command · observed result · anything another window must do.
