# Window E — Backlog audit (read-only)

> **Read-only. This window never commits.** No `git add`, no `git commit`, no `git push`, no
> worktrees, and no edits to source, plans, or `bot-library/**`. The only file you may write is the
> one output file named below. Start with `git status --short`: if it is not empty, you are too
> early — stop and say so instead of working around it. Another window sweeping your half-finished
> reads into its own commit is exactly the failure this rule prevents.

Start prompt for a spare Cline window. Do not edit, create, or commit anything except the single
output file named below. Editing source, plans, or `bot-library/**` collides with the windows that
own those paths.

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

## Do NOT — read-only, re-checked before every step
- Edit any source, plan, or `bot-library/**` file.
- Commit, push, or create worktrees. Nothing you produce enters git except the one output file below.
- Start feature work — another window may own those paths right now.

Run `git status --short` first. If it prints anything, another window is mid-edit: keep reading,
write nothing, and say so in your handoff. Committing now would sweep that window's unfinished work
into your commit.

## Write only this file
`docs/superpowers/plans/2026-10-01-parallel-sprint/backlog-audit.md`, as a table:

| # | task | window | owned paths | evidence (file:line) | verify command | size |
| --- | --- | --- | --- | --- | --- | --- |

End with a short "uncertain / needs a human call" list.
