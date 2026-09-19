---
inclusion: manual
---

# UI/UX audit (a shared skill)

Invoke this steering file (`#ui-ux-audit`) when asked to test, check or QA the UI or UX, when anything
overlaps other content, when a layout breaks on a phone, or before a demo or release.

The skill lives once, for both tools, in **`.claude/skills/ui-ux-audit/`**. Read `SKILL.md` there and follow
its procedure. Nothing is copied here, so it cannot drift.

The short version: write a designer's checklist first (`checklist.md`), run the headless audit across
routes x widths x themes x modes, fix root causes using `pitfalls.md`, re-run until clean, then look at real
screenshots, and report what you did not cover.

```bash
npm run ux:audit                    # this repo: the dev servers must be running (:5173 and :4000)
npm run ux:audit -- --only /dashboard --shots all
```

This project's routes, states, thresholds and recorded exceptions: `frontend/ux-audit.config.json`. The
audit drives a real Chrome through `playwright-core`; state-changing steps run against demo mode's sandbox
where they must, and the main database is re-seeded afterwards (`cd backend && npm run seed`).
