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

Two windows touch the bot-library picker, on different halves. A owns the code
(`apps/web/src/pages/BotLibraryOverlay.tsx`, `apps/web/src/pages/shell/bot-picker.tsx`). B owns the
prose about it (`docs/grokbot-features-guide.md`). Neither edits the other's half: B fixes the
sentence, not the overlay.

## Rules (every window)

1. One owner per path. Never edit another window's paths.
2. Migrations, contracts, core, and db belong to D only.
3. Small commits, conventional messages (`feat(scope): …`, `fix(scope): …`).
4. Before every commit: `pnpm --filter <pkg> check`, the targeted `vitest` files, and
   `pnpm exec biome check <changed files>`.
5. Never merge or push to `main` from A/B/C. Only D merges.
6. No secrets. Deterministic offline tests. Minimal UI copy (`AGENTS.md`).

## Backlog (verified against the code; `main` is frozen and clean)

Every row was re-checked in the source after `main` froze. The tree moves — re-confirm the file and
line before you start.

1. **A —** web e2e: create a trigger, then approve a held dry-run card, under `apps/web/e2e/`
   (link the CI screenshot).
   *Open:* 78 specs live in `apps/web/e2e/`; `routine-crud`, `routine-execution`, `approval-resume`,
   `consequential-approval`, `mcp-approval-card` are the nearest — none does both.
   *Verify:* `pnpm exec playwright test apps/web/e2e/<new>.spec.ts` (CI, never locally).

2. **D, then A —** reveal the routine's dry-run plan on the per-tool approval card.
   *Open:* no `dryRun` or `plannedEffect` reference exists anywhere in `apps/web/src` or
   `packages/chat-ui/src`. The plan is computed in `packages/core/src/trust-runner.ts` and typed in
   `packages/contracts/src/triggers.ts`.
   *Why D first:* there is no client-visible shape for the plan, so A cannot render what it cannot
   receive. D adds the contract; A does the card. Do not start A's half before D's lands.
   *Verify:* `pnpm --filter @rakazo/contracts check`, then the component test.

3. **D —** auto-resume after quiet hours instead of waiting for a person.
   *Open:* `holdRunForChoice` exists at `packages/db/src/events.ts:873`, but `autoResume`/`resumeAt`
   appear nowhere in `packages/core`, `packages/db`, or `apps/api`. `quietHours` already exists in
   `packages/contracts/src/triggers.ts`, `packages/core/src/trust-effects.ts`, and the `TrustPolicy`
   model — the data is there, the scheduler is not.
   *Verify:* `pnpm exec vitest run packages/core/src/trust-runner.test.ts`.

4. **C —** HMAC adapters for providers that sign their own raw webhook (Linear, Sentry, PagerDuty):
   verify the signature, then forward a normalized `{ provider, type, payload }` to `/events`.
   *Open:* `apps/api/src/github-webhook.ts` verifies HMAC, but `apps/api/src/event-webhook.ts`
   authenticates with a bearer token only and states that signature translation belongs to the
   provider's adapter. The `/events` shape already exists, so this is additive.
   *Verify:* `pnpm exec vitest run packages/adapters/src/event-catalog.test.ts`, plus one offline
   conformance test per new adapter.

5. **B —** make the library docs say what the code does.
   *Open:* `docs/grokbot-features-guide.md:46` still reads "Die Auswahl im UI fehlt noch", but
   `17bed838` shipped `apps/web/src/pages/BotLibraryOverlay.tsx` and its
   `apps/web/e2e/bot-library.spec.ts`. The same line says "zehn Teams"; `bot-library/teams/` holds
   nine. The "64 Presets" and the eight identities are accurate.
   *Verify:* read the corrected sentence against `ls bot-library/teams` and the overlay's entry point.

**Resolved:** the old warning that item 4 overlapped in-flight work is obsolete — `/events` landed
with bearer auth by design, so C adds adapters rather than reworking the path.

## Merge and review (D)

1. `git fetch origin`, then merge `sprint/ux`, `sprint/library`, `sprint/reach` in order of least
   entanglement (data/docs before UI).
2. Before each merge: `ocr review --from main --to sprint/<branch>`; address findings.
3. After each merge: `pnpm check && pnpm lint && pnpm test`. Schema changed → `pnpm test:integration`.
4. Update this file's checkboxes and `HANDOFF.md`.

## Done

A window is done when its tasks are checked, its branch is committed, and its handoff states: what
changed, the exact verify command, and the observed result.
