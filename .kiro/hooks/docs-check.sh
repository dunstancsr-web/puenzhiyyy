#!/bin/sh
# ─────────────────────────────────────────────────────────────────────────────
# END OF SESSION DOCS CHECK, shared by Claude Code and Kiro
#
# Runs when an agent finishes responding. If project files changed since the
# devlog was last written, it reminds the agent to follow "Keeping this in sync"
# in .kiro/steering/handoff.md. Silent otherwise, and it spends no tokens.
#
#   docs-check.sh --claude   Claude Code Stop hook (.claude/settings.json). Blocks
#                            the stop ONCE with the reason; the agent then either
#                            writes the entry or says it is pausing mid-task, and
#                            the second stop goes through (stop_hook_active).
#   docs-check.sh            Kiro AgentStop hook (.kiro/hooks/docs-sync.json).
#                            Kiro hooks cannot block, so this prints a reminder.
#
# "Changed" means anything differing from the last commit that touched the
# devlog, committed or not, plus new untracked files. A devlog edit sitting
# uncommitted in the working tree counts as done.
# ─────────────────────────────────────────────────────────────────────────────

cd "$(git rev-parse --show-toplevel 2>/dev/null)" || exit 0
DEVLOG=".kiro/DEVLOG.md"

if [ "$1" = "--claude" ]; then
  # A stop that this hook already blocked once must be let through, or the
  # agent can never finish a turn in which it is only asking Stan a question.
  if cat | grep -q '"stop_hook_active"[[:space:]]*:[[:space:]]*true'; then exit 0; fi
fi

BASE=$(git log -1 --format=%H -- "$DEVLOG" 2>/dev/null)
[ -z "$BASE" ] && exit 0

# The devlog is already being written: nothing to remind.
if [ -n "$(git diff --name-only HEAD -- "$DEVLOG")" ]; then exit 0; fi

CHANGED=$( { git diff --name-only "$BASE"; git ls-files --others --exclude-standard; } | grep -v "^$DEVLOG\$" | sort -u)
[ -z "$CHANGED" ] && exit 0

COUNT=$(printf '%s\n' "$CHANGED" | wc -l | tr -d ' ')
LIST=$(printf '%s\n' "$CHANGED" | head -8 | tr '\n' ',' | sed 's/,$//; s/,/, /g')
REASON="$COUNT file(s) changed since the last devlog entry ($LIST). If this work is finished, follow \"Keeping this in sync\" in .kiro/steering/handoff.md: add a .kiro/DEVLOG.md entry, and update the submission tracker or spend ledger if status, decisions or paid calls changed. If you are only pausing to ask Stan something, say so briefly and stop."

if [ "$1" = "--claude" ]; then
  # JSON-escape backslashes and double quotes for the decision payload.
  ESCAPED=$(printf '%s' "$REASON" | sed 's/\\/\\\\/g; s/"/\\"/g')
  printf '{"decision":"block","reason":"%s"}\n' "$ESCAPED"
else
  printf 'Docs check: %s\n' "$REASON"
fi
exit 0
