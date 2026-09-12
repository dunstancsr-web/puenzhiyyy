# CLAUDE.md

Read `.kiro/steering/project-context.md` first for project background, domain terms, and tech stack.
Then check `.kiro/specs/mvp1-inventory-visibility/` (`requirements.md`, `design.md`, `tasks.md`) and
`DEVLOG.md` for what has already been built and why, before making changes.

## Writing style (added 2026-09-12, user feedback)

Do not use an em dash or an en dash anywhere in this project. Not in UI copy, not in code comments, not
in commit messages, not in this file. The user flagged heavy dash use as an obvious "AI vibes" tell. Use
a plain hyphen, a comma, a colon, parentheses, or split into two sentences instead. This applies to new
writing going forward. It is not a mandate to rewrite every existing comment in one pass.

## Note on tooling

This project was originally scaffolded with Kiro. `.kiro/hooks/*.json` files (such as
`auto-devlog.json`) are Kiro-specific configuration and do not fire during a Claude Code session. If a
session ends without a `DEVLOG.md` entry, add one by hand in the existing format rather than trying to
make the Kiro hook run.
