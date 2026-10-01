# Parallel Sprint — four windows toward GrokBot parity

> **For agentic workers:** read this file and your window brief in full before touching anything.
> One window = one worktree = one branch. Only the integrator merges to `main`.
> Sub-skills: `superpowers:using-git-worktrees` (setup), `superpowers:executing-plans` (per task),
> `superpowers:verification-before-completion` (before every handoff).

**Goal:** push Rakazo toward GrokBot parity, convenience first (fewer steps, less friction), with
four agents working at once and no merge conflicts.

**Why not one folder:** three agents editing one checkout collide — files change under each other
and untracked work sweeps into the wrong commit. A worktree per window keeps the branches
independent; the integrator owns everything shared.

## Setup (once, serial — integrator only)

```bash
bash scripts/setup-parallel-sprint.sh
```

Creates three worktrees and branches from a clean `main`:

| Branch | Worktree |
| --- | --- |
| `sprint/ux` | `../rakazo-ux` |
| `sprint/library` | `../rakazo-library` |
| `sprint/reach` | `../rakazo-reach` |

The main checkout stays the integrator's.

## Windows and exclusive ownership

| Window | Branch / worktree | Owns exclusively |
| --- | --- | --- |
| A | `sprint/ux` / `../rakazo-ux` | `apps/web/**`, `apps/desktop/**`, `packages/chat-ui/**`, `packages/ui-web/**`, `packages/ui-tokens/**` |
| B | `sprint/library` / `../rakazo-library` | `bot-library/**`, `docs/**`, `apps/www/**` |
| C | `sprint/reach` / `../rakazo-reach` | `packages/adapters/**`, `packages/adapter-kit/**`, `apps/mobile/**`, `apps/api/src/messaging*.ts`, `apps/api/src/event-webhook*.ts` |
| D | `main` / repo root | `packages/core/**`, `packages/db/**` (incl. `prisma/migrations/**`), `packages/contracts/**`, every `index.ts` barrel, `apps/api/src/router.ts` |

A window that needs a change outside its paths **does not edit it**: it records the need in its
handoff and the integrator applies it. That is the whole point of the split.

## Rules (every window)

1. One owner per path. Never edit another window's paths.
2. Migrations, contracts, core, and db belong to D only.
3. Small commits, conventional messages (`feat(scope): …`, `fix(scope): …`).
4. Before every commit: `pnpm --filter <pkg> check`, the targeted `vitest` files, and
   `pnpm exec biome check <changed files>`.
5. Never merge or push to `main` from A/B/C. Only D merges.
6. No secrets. Deterministic offline tests. Minimal UI copy (`AGENTS.md`).

## Seed backlog (verified open — D confirms the final list once `main` freezes)

1. Web e2e that creates a trigger and approves a held dry-run card, under `apps/web/e2e/`
   (link the CI screenshot). — **A**
2. Inline the routine's dry-run plan on the per-tool approval card. — **A** (contract from D)
3. Quiet hours auto-resume when the window closes instead of waiting for a person. — **D**
4. HMAC adapters (Linear/Sentry/PagerDuty) that verify the raw signature and forward a normalized
   event to `/events`. — **C**
5. Convenience pass from the "bequem wie GrokBot" list (artifact-preview polish, team/identity
   picker, onboarding). — **A**

Note: item 4 overlaps work already in the tree (`apps/api/src/event-webhook.ts`). Confirm before
starting.

## Merge and review (D)

1. `git fetch origin`, then merge `sprint/ux`, `sprint/library`, `sprint/reach` in order of least
   entanglement (data/docs before UI).
2. Before each merge: `ocr review --from main --to sprint/<branch>`; address findings.
3. After each merge: `pnpm check && pnpm lint && pnpm test`. Schema changed → `pnpm test:integration`.
4. Update this file's checkboxes and `HANDOFF.md`.

## Done

A window is done when its tasks are checked, its branch is committed, and its handoff states: what
changed, the exact verify command, and the observed result.
