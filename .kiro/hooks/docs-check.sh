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
#
# It also flags any .md or .html document that docs/DIRECTORY.md does not list,
# so the directory cannot silently fall behind.
# ─────────────────────────────────────────────────────────────────────────────

cd "$(git rev-parse --show-toplevel 2>/dev/null)" || exit 0
DEVLOG=".kiro/DEVLOG.md"

if [ "$1" = "--claude" ]; then
  # A stop that this hook already blocked once must be let through, or the
  # agent can never finish a turn in which it is only asking Stan a question.
  if cat | grep -q '"stop_hook_active"[[:space:]]*:[[:space:]]*true'; then exit 0; fi
fi

# Documents the directory does not list. A document counts as listed when its
# file name appears in docs/DIRECTORY.md, or one of its folders has an explicit
# folder row ("every file in `folder/`"). Merely mentioning a folder does not
# count, or nothing under docs/ could ever be flagged.
UNLISTED=""
if [ -f docs/DIRECTORY.md ]; then
  for f in $( { git ls-files; git ls-files --others --exclude-standard; } | grep -E '\.(md|html)$' | grep -v 'node_modules' | sed 's/ /%20/g' | sort -u); do
    f=$(printf '%s' "$f" | sed 's/%20/ /g')
    listed=0
    case "$f" in docs/DIRECTORY.md|frontend/index.html) listed=1 ;; esac
    if [ $listed = 0 ]; then
      grep -qF -- "$(basename "$f")" docs/DIRECTORY.md && listed=1
    fi
    d=$(dirname "$f")
    while [ $listed = 0 ] && [ "$d" != "." ]; do
      grep -qF -- "every file in \`$d/\`" docs/DIRECTORY.md && listed=1
      d=$(dirname "$d")
    done
    [ $listed = 0 ] && UNLISTED="$UNLISTED${UNLISTED:+, }$f"
  done
fi

BASE=$(git log -1 --format=%H -- "$DEVLOG" 2>/dev/null)
DEVLOG_DIRTY=$(git diff --name-only HEAD -- "$DEVLOG")
CHANGED=""
if [ -n "$BASE" ] && [ -z "$DEVLOG_DIRTY" ]; then
  CHANGED=$( { git diff --name-only "$BASE"; git ls-files --others --exclude-standard; } | grep -v "^$DEVLOG\$" | sort -u)
fi

[ -z "$CHANGED" ] && [ -z "$UNLISTED" ] && exit 0

REASON=""
if [ -n "$CHANGED" ]; then
  COUNT=$(printf '%s\n' "$CHANGED" | wc -l | tr -d ' ')
  LIST=$(printf '%s\n' "$CHANGED" | head -8 | tr '\n' ',' | sed 's/,$//; s/,/, /g')
  REASON="$COUNT file(s) changed since the last devlog entry ($LIST). If this work is finished, follow \"Keeping this in sync\" in .kiro/steering/handoff.md: add a .kiro/DEVLOG.md entry, and update the submission tracker or spend ledger if status, decisions or paid calls changed. If you are only pausing to ask Stan something, say so briefly and stop."
fi
if [ -n "$UNLISTED" ]; then
  REASON="${REASON}${REASON:+ }Not listed in docs/DIRECTORY.md: $UNLISTED. Add a row for each (who it is for, what is in it)."
fi

if [ "$1" = "--claude" ]; then
  # JSON-escape backslashes and double quotes for the decision payload.
  ESCAPED=$(printf '%s' "$REASON" | sed 's/\\/\\\\/g; s/"/\\"/g')
  printf '{"decision":"block","reason":"%s"}\n' "$ESCAPED"
else
  printf 'Docs check: %s\n' "$REASON"
fi
exit 0
