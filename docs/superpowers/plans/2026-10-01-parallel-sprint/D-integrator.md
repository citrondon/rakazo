# Window D — Integrator (the hardest cross-cutting work + merge)

Start prompt for the Claude Opus window. Work in the main repo checkout on branch `main`.

## Read first
- `docs/superpowers/plans/2026-10-01-parallel-sprint.md` — the board you own.

## You own
`packages/core/**`, `packages/db/**` (incl. `prisma/migrations/**`), `packages/contracts/**`,
every `index.ts` barrel, `apps/api/src/router.ts`, and `main` itself.

## Tasks (in order)
- [x] **Freeze first.** Done: the in-flight agents finished, `main` is clean and pushed. Remaining:
      run `bash scripts/setup-parallel-sprint.sh` and confirm the three worktrees exist.
- [x] **Finalize the backlog.** Done — the board now carries the backlog verified against the code,
      with two wrong evidence lines corrected (the dry-run plan is not in the web UI at all, and the
      library picker already shipped). Announce it; the other windows read the board.
- [ ] Quiet hours auto-resume when the window closes instead of waiting for a person
      (`packages/core` planning + whatever the executor needs).
- [ ] Apply any contract/barrel change a window requests, in one small commit.
- [ ] **Merge & review** each completed branch:
      `ocr review --from main --to sprint/<branch>`, address findings, then
      `pnpm check && pnpm lint && pnpm test` (schema changed → `pnpm test:integration`).
- [ ] Keep the board checkboxes and `HANDOFF.md` current.

## Rules
Conventional commits · no secrets · deterministic offline tests · minimal UI copy (`AGENTS.md`).
Never merge a red branch. Unfinished work stays on its branch.
