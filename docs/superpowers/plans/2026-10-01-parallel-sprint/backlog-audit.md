# Backlog audit — verified open work (2026-10-01)

Read-only audit against the code, not against the older plans (those list work that already
shipped, e.g. `fetch-tech-trends.py`, `telegram-setup.md`, `SandboxedHtmlViewer.tsx`,
`TeamTemplateOverlay.tsx`, triggers + trust kit). `main` froze at `91e6ecef`; D re-checked every row
against that commit and corrected #2 and #5 (marked below). Re-confirm the file and line before you
start — the tree moves.

| # | task | window | owned paths | evidence (file:line) | verify command | size |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | Web e2e: create a trigger and approve a held dry-run card | A | `apps/web/e2e/**` | 78 specs in `apps/web/e2e/`; `routine-crud`, `routine-execution`, `approval-resume`, `consequential-approval`, `mcp-approval-card` are the nearest — none does both | `pnpm exec playwright test apps/web/e2e/<new>.spec.ts` (CI) | M |
| 2 | Reveal the routine's dry-run plan on the per-tool approval card | D, then A | `packages/contracts/**` + `packages/core/**` (D), `apps/web/**` + `packages/chat-ui/**` (A) | **corrected:** no `dryRun`/`plannedEffect` reference exists anywhere in `apps/web/src` or `packages/chat-ui/src`, `ReactiveTriggerSection.tsx` included; the plan is computed in `packages/core/src/trust-runner.ts` and typed in `packages/contracts/src/triggers.ts` | `pnpm --filter @rakazo/contracts check`, then `pnpm --filter @rakazo/web check` | M+ |
| 3 | Quiet hours auto-resume when the window closes | D | `packages/core/**`, `packages/db/**` | `holdRunForChoice` exists (`packages/db/src/events.ts:873`) but nothing schedules a resume; `autoResume`/`resumeAt` appear nowhere in `packages/core`, `packages/db`, `apps/api`. `quietHours` already exists in `contracts/triggers.ts`, `core/trust-effects.ts`, the `TrustPolicy` model | `pnpm exec vitest run packages/core/src/trust-runner.test.ts` | M/L |
| 4 | HMAC adapters (Linear/Sentry/PagerDuty) that verify the raw signature and forward a normalized event to `/events` | C | `packages/adapters/**`, `apps/api/src/event-webhook*.ts` | GitHub HMAC lives in `apps/api/src/github-webhook.ts`; `apps/api/src/event-webhook.ts` is now committed and authenticates with a bearer token only, stating signature translation belongs to the provider adapter | `pnpm exec vitest run packages/adapters/src/event-catalog.test.ts` + one offline conformance test per adapter | M |
| 5 | Make the library docs say what the code does | B | `docs/**` | **corrected:** `17bed838` shipped `apps/web/src/pages/BotLibraryOverlay.tsx` (344 lines) and `apps/web/e2e/bot-library.spec.ts`, so `docs/grokbot-features-guide.md:46` "Die Auswahl im UI fehlt noch" is false; the same line says "zehn Teams" while `bot-library/teams/` holds nine. "64 Presets" and the eight identities are correct | read the sentence against `ls bot-library/teams` and the overlay's entry point | S |

## Uncertain / needs a human call

- **Resolved after the freeze — #4.** `apps/api/src/event-webhook.ts` and its test are committed
  (`ff8fb99c`) and authenticate with a bearer token on purpose, so C adds adapters rather than
  reworking the path.
- **Resolved after the freeze — #5.** The stale claim was the guide's, not the UI's; only the
  sentence needs fixing (owner: B).
- **Still open — where the per-tool approval card renders.** Nothing under `apps/web/src/components`
  or `packages/chat-ui/src` references `dryRun`/`plannedEffect`, so D must first decide where the
  plan becomes client-visible before A can render it.
- **Not verified for parity:** whether GrokBot has capabilities with no Rakazo counterpart at all
  (the reverse gap). The four shipped features cover the ones the plans named.
