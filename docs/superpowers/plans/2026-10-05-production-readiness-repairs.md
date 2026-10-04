# Private production readiness repairs

## Scope

Repair the confirmed findings from the independent code review for local and private remote operation across web, Electron and mobile. Preserve the existing uncommitted preset-boundaries changes. Do not deploy, commit, configure host firewalls, enable paid providers or upload backups.

## Acceptance and sequence

- [x] R01–R03: restore typed bot RPC handlers, reuse the existing intro/model check, wire archive/delete/restore to shared lifecycle functions. Existing router and lifecycle assertions must pass unchanged; add missing RPC regressions. Preserve contracts and preset boundaries.
- [x] R10: file imports must not silently report full success after write failures or touch unrelated shared-computer files. Test failure and successful artifact reads through RPC.
- [~] R04–R05/R08: private backup permissions and a format-compatible production restore are implemented and verified with synthetic snapshots only. Encrypted off-host copies and independent key recovery are documented as operator steps with a rehearsal checklist; no destination was configured. For migration safety, every deploy now snapshots and verifies the live database first and refuses the update when it cannot, and a failed rollback reports the snapshot path and restore step instead of claiming recovery (verified with synthetic fixtures; no live migration was run).
- [x] R06–R07: exact tested revision, explicit Compose file/project selection, private revision/readiness checks, bounded worker readiness and honest recovery. Test moving main, failures and overlays with isolated fixtures.
- [x] R09: forward the existing egress flag to the production Docker supervisor and verify Compose parity. Host rule installation remains an operator action.
- [x] R12: per-installation notification tokens and registration diagnostics, retaining safe legacy compatibility. Test independent logout and refreshed-token handling.
- [ ] R11: fresh typecheck, lint, relevant unit tests, Postgres journeys, web E2E and separate worker topology where practical. Record limitations rather than claiming native-device, paid-model, CVE or production-host verification. Fresh typecheck, lint and the Postgres integration harness have run green in this working tree; the full unit suite, web E2E, the separate worker topology pass and any native-device acceptance have not.

## Verified checkpoint

- Shared bot lifecycle RPC wiring, intro/model check and typed handlers repaired.
- File imports use a new private computer; failure compensates the bot and only skills created by that import. No shared team files are overwritten.
- Local backup output is owner-only, unsafe names are refused and existing snapshots are not overwritten. Development restore rejects missing SQL/corrupt archives before DB work and bounds readiness waits.
- Production Docker overlay forwards the existing egress flag; static parity regression passes. Host firewall enforcement has NOT been installed or live-tested.
- Latest focused run: 154 tests across six files passed. Fresh uncached workspace typecheck: 22/22 tasks passed; script typecheck passed. Workspace lint passed with 38 warnings and 5 informational diagnostics. The existing MCP preset file received formatting only to resolve its formatter error.
- Postgres integration harness rerun after the notification contract change: all 19 configured suites completed successfully (exit 0). Focused RPC regressions cover skill compensation and device-scoped push registration.
- Latest focused run: 315 tests across 11 files passed (router, bots, backup scripts, production restore, compose parity, deploy script, expo push, mobile push/installation, mobile api, contracts). Workspace lint still passes with the same 38 warnings and 5 informational diagnostics; the fresh uncached workspace typecheck is 22/22.
- Earlier full unit run was interrupted without a completion marker; not a pass.
- Deployment now deploys exactly the tested commit, uses the configured Compose file list, runs `up --wait`, and only records success after the new API revision, a ready worker and public liveness are confirmed; failures roll back. A synthetic job round-trip is not wired in; the readiness signal is the worker's own `worker ready` log, as the topology harness already uses.
- Push tokens are per installation with a legacy fallback; real registration failures now surface. Receipts are still not tracked.
- Production restore now exists for the real snapshot format (dump + appdata + checksums), refuses corrupt artifacts, dirty checkouts and reachable databases, and requires the original encryption key. Verified with synthetic snapshots in an isolated fixture; no live database was touched. Off-host encryption and key recovery are operator checklists, not implemented tooling. Migration recovery remains open.
- Full web/native acceptance remains open.

## Decisions

No community skill installation is needed initially. Existing repository test harnesses are authoritative. Optional PR monitoring uses the existing pr-watch skill only if a PR is requested. Prefer existing shared primitives over new services or independent validation/auth layers.

Native release/device acceptance and the actual off-host backup destination require access and operator choices not present in this checkout. Write an actionable checklist; do not claim these checks have run.
