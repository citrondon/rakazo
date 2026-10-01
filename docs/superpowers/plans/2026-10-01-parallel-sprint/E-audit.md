# Window E — Backlog audit (read-only, runs while others work)

Start prompt for a spare Cline window. **Read-only.** Do not edit, create, or commit anything
except the single output file named below. Editing source, plans, or `bot-library/**` now would
collide with the agents still working.

## Model suggestion
`claude-sonnet-4-6` (strong + cheap) or `claude-opus-4-8` for the sharpest judgment. Do not use a
small fast model here — this is reasoning, not throughput.

## Do
1. Read `docs/superpowers/plans/2026-10-01-parallel-sprint.md` and every plan in
   `docs/superpowers/plans/`.
2. For each candidate task, **verify it against the code**: does the file/function/test already
   exist? The old plans list work that is already shipped. Only keep genuinely open items.
3. Classify each by the window that owns the paths: A (web), B (library/docs), C (adapters/mobile),
   D (core/db/contracts).
4. Give each: exact file path(s), the evidence that it is open, the verify command, and a size
   (S/M/L).

## Do NOT
- Edit any source, plan, or `bot-library/**` file.
- Commit, push, or create worktrees.
- Start feature work — the running agents own those paths right now.

## Write only this file
`docs/superpowers/plans/2026-10-01-parallel-sprint/backlog-audit.md`, as a table:

| # | task | window | owned paths | evidence (file:line) | verify command | size |
| --- | --- | --- | --- | --- | --- | --- |

End with a short "uncertain / needs a human call" list.
