# Backlog audit — verified open work (2026-10-01)

Read-only audit against the code, not against the older plans (those list work that already
shipped, e.g. `fetch-tech-trends.py`, `telegram-setup.md`, `SandboxedHtmlViewer.tsx`,
`TeamTemplateOverlay.tsx`, triggers + trust kit). `main` is in flight, so re-confirm each row after
it freezes.

| # | task | window | owned paths | evidence (file:line) | verify command | size |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | Web e2e: create a trigger and approve a held dry-run card | A | `apps/web/e2e/**` | `apps/web/e2e/` has `routine-crud`, `approval-resume`, `consequential-approval`, `mcp-approval-card` — no trigger/dry-run spec | `pnpm exec playwright test apps/web/e2e/<new>.spec.ts` (CI) | M |
| 2 | Inline the routine's dry-run plan on the per-tool approval card | A (+ D) | `apps/web/**`, `packages/chat-ui/**` | dry-run preview exists only in `apps/web/src/pages/ReactiveTriggerSection.tsx`; `grep dryRun\|plannedEffect` in `apps/web/src/components` and `packages/chat-ui/src` = none | `pnpm --filter @rakazo/web check` + a component test | M |
| 3 | Quiet hours auto-resume when the window closes | D | `packages/core/**`, `packages/db/**` | `holdRunForChoice` exists (`packages/db/src/events.ts:873`) but nothing schedules a resume; no `autoResume`/`resumeAt` anywhere | `pnpm exec vitest run packages/core/src/trust-runner.test.ts` | M/L |
| 4 | HMAC adapters (Linear/Sentry/PagerDuty) that verify the raw signature and forward a normalized event to `/events` | C | `packages/adapters/**`, `apps/api/src/event-webhook*.ts` | GitHub HMAC lives in `apps/api/src/github-webhook.ts`; `apps/api/src/event-webhook.ts` exists but verifies no provider signature | `pnpm exec vitest run packages/adapters/src/event-catalog.test.ts` + a new offline conformance test | M |
| 5 | Team/identity picker completeness in the web UI | A | `apps/web/**` | `apps/web/src/pages/TeamTemplateOverlay.tsx` exists; `docs/grokbot-features-guide.md` still says "Die Auswahl im UI fehlt noch" (text may be stale) | `pnpm --filter @rakazo/web check` | S/M |

## Uncertain / needs a human call

- **#4 overlaps in-flight work.** `apps/api/src/event-webhook.ts` + `.test.ts` appeared in the tree
  at 03:11 while the other agent ran. Confirm the split before C starts.
- **#5 may already be done.** The guide line predates `TeamTemplateOverlay`. Verify in the running UI
  before spending a window on it.
- **The per-tool approval card's location is unclear.** No approval-card component matched
  `dryRun`/`plannedEffect` under `apps/web/src/components` or `packages/chat-ui/src`; find where the
  card renders (possibly from a run receipt) before writing #2.
- **Not verified for parity:** whether GrokBot has capabilities with no Rakazo counterpart at all
  (the reverse gap). The four shipped features cover the ones the plans named.
