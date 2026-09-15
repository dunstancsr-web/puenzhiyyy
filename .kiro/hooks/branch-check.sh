#!/bin/sh
# ─────────────────────────────────────────────────────────────────────────────
# BRANCH AND PULL REMINDER, shared by Claude Code and Kiro
#
# Reminds whoever is driving the agent to follow the branch workflow in
# .kiro/steering/rules.md, "Working rules": work on a feature branch, keep it
# up to date with origin/main, never commit straight to main. This is a
# reminder layer only; the actual enforcement is the pre-commit/pre-push
# hooks in .githooks/ (fire for plain git use too) and GitHub branch
# protection on main (fires for anyone, any tool).
#
# Same script, same plain stdout output, for both triggers:
#   Claude Code SessionStart hook (.claude/settings.json): stdout becomes
#     context the agent sees at the start of a session.
#   Kiro PostTaskExecution hook (.kiro/hooks/branch-check.json): runs after
#     each spec task, prints a reminder.
#
# Silent when there is nothing to say. Never blocks: a stale reminder is a
# nuisance, a blocked session or task is worse.
# ─────────────────────────────────────────────────────────────────────────────

cd "$(git rev-parse --show-toplevel 2>/dev/null)" || exit 0

BRANCH=$(git symbolic-ref --short HEAD 2>/dev/null || echo "")
[ -z "$BRANCH" ] && exit 0

git fetch origin main --quiet 2>/dev/null

MSG=""
if [ "$BRANCH" = "main" ] || [ "$BRANCH" = "master" ]; then
  MSG="You are on '$BRANCH'. Start new work on a feature branch: git checkout -b <name>."
fi

if git rev-parse --verify origin/main >/dev/null 2>&1; then
  BEHIND=$(git rev-list --count HEAD..origin/main 2>/dev/null || echo 0)
  if [ "$BEHIND" -gt 0 ]; then
    MSG="${MSG}${MSG:+ }origin/main is $BEHIND commit(s) ahead of this branch. Pull or rebase before pushing."
  fi
fi

[ -z "$MSG" ] && exit 0

printf 'Branch check: %s\n' "$MSG"
exit 0
