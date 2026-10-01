#!/usr/bin/env bash
# Create the four sprint worktrees from a clean main. Run once, from anywhere in the repo.
# Usage: bash scripts/setup-parallel-sprint.sh [base-dir]   (default base-dir: $HOME)
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root"
base="${1:-$HOME}"

if [ -n "$(git status --porcelain)" ]; then
    echo "Working tree is not clean. Finish and commit the in-flight work, then re-run." >&2
    git status --short >&2
    exit 1
fi

git fetch origin main
git checkout main
git merge --ff-only origin/main

add_worktree() {
    local branch="$1" dir="$2"
    if git show-ref --verify --quiet "refs/heads/$branch"; then
        echo "Branch $branch already exists — skipped."
        return 0
    fi
    git worktree add -b "$branch" "$base/$dir" main
}

add_worktree sprint/ux rakazo-ux
add_worktree sprint/library rakazo-library
add_worktree sprint/reach rakazo-reach

echo
git worktree list
echo
echo "Done. Each window: cd <worktree>, then read its brief in"
echo "docs/superpowers/plans/2026-10-01-parallel-sprint/."
