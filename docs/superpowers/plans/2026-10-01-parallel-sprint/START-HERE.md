# Start here — 2026-10-01 parallel sprint

One window = one folder = one branch. Read this, then your brief. The board
`../2026-10-01-parallel-sprint.md` holds the rules, the path ownership, and the verified backlog.

## Already set up

- The worktrees exist and their dependencies are installed. There is no setup step.
- Before you start: `git status --short` must be empty, and `git log --oneline -1` tells you the head
  you are on. If the tree is not clean, stop and say so instead of working around it.

## Your brief

| Window | Folder | Branch | Brief |
| --- | --- | --- | --- |
| A — web / Electron | `../rakazo-ux` | `sprint/ux` | `A-web.md` |
| B — bot library / docs | `../rakazo-library` | `sprint/library` | `B-library.md` |
| C — connectors / reach | `../rakazo-reach` | `sprint/reach` | `C-reach.md` |
| D — integrator | this checkout | `main` | `D-integrator.md` |
| E — backlog audit | anywhere | none | `E-audit.md` |

## If your brief says read-only

No `git add`, no `git commit`, no `git push`, no worktrees, and no edits to source, plans, or
`bot-library/**`. The single output file named in your brief is the only thing you may write.
