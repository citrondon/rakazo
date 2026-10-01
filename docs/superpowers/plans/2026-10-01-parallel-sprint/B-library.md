# Window B — Bot library & content

Start prompt for one Cline window. Work in `../rakazo-library` on branch `sprint/library`.

## Read first
- `docs/superpowers/plans/2026-10-01-parallel-sprint.md` — rules, ownership, merge flow.
- `bot-library/README.md` and `docs/grokbot-features-guide.md` — what already exists.

## You own (edit only these)
`bot-library/**`, `docs/**`, `apps/www/**`

## Do NOT touch
anything under `apps/` except `apps/www/**`, and nothing under `packages/`. Need a change there?
Write it in your handoff; the integrator applies it.

## Tasks
- [ ] Audit the shipped library (bots, `teams/`, `identities/`) against GrokBot's real capabilities
      and fill only genuine gaps. Do not invent capabilities.
- [ ] Keep `bot-library/README.md` and `docs/grokbot-features-guide.md` accurate to what the code
      does today (remove anything that reads as aspirational).
- [ ] Every new or changed manifest must validate against `ExportManifestSchema` (v1).

## Verify before every commit
```bash
pnpm exec vitest run apps/api/src/bot-library.test.ts apps/api/src/bot-library-presets.test.ts \
  packages/contracts/src/openai-compatible-ui.test.ts
pnpm --filter @rakazo/api check
pnpm exec biome check <changed files>
```

## Handoff
What changed · exact verify command · observed result · anything another window must do.
