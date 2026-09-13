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

## Onboarding for agents: Stan's preferences and this codebase's quirks

Read this before making UI changes. These are settled preferences, learned from
feedback, not suggestions to re-litigate.

### Design preferences

- **Light theme is the default and the priority.** Dark mode must work, but light
  is what Stan looks at, demos and judges. When a choice trades one against the
  other, light wins. Do not reach for a dark, high contrast treatment just
  because a screen is "industrial" or "device-like": make it light first.
- **Apple aesthetics** is the standing direction. Restraint, hierarchy from type
  and spacing rather than boxes, colour reserved for state and meaning.
- **White cards.** Content sits on a `.card` surface, not directly on the page
  background. Alerts once shipped without this and it was flagged immediately.
- **Visibility for older users.** The type scale is deliberately larger than a
  default. Do not shrink it back.
- **One primary action per surface.** Four differently coloured buttons in a row
  is a rainbow, not a hierarchy.

### Writing style

- No em dashes or en dashes, anywhere. See the section above.
- Do not call the rule-based explanation layer "hard-coded answers". It is
  **rule-based**: computed from live figures by documented rules. "Hard-coded"
  implies static strings and undersells it.

### Quirks worth knowing before you get bitten

- **Inline styles beat media queries.** An inline `display` or
  `gridTemplateColumns` prop overrides any stylesheet rule lacking `!important`,
  so a breakpoint can never reach it. This shipped as a real bug (both navs
  rendering at once on a phone). Anything a breakpoint must change belongs in a
  class.
- **`Number(null)` is `0`, and `0` is finite.** A bare `Number.isFinite` guard
  turns a MISSING value into a confident zero. This has caused three separate
  bugs in this repo: "0 MT" for absent stock, "0 days" for an idle SKU with no
  days of cover, and a silently wrong benchmark. Guard for presence separately.
- **Derived values computed twice eventually disagree.** The suggested order
  quantity was calculated two ways and differed by 257 MT; months of cover was
  computed two ways and differed by 0.2. Read the engine's own field rather than
  re-deriving it. `engines/duration.js` and `suggested_order_qty` exist for this.
- **Verify against the real cascade, not a mock of it.** Injecting `!important`
  to force a breakpoint state once produced a green result on broken code.
- **Do not test only for bad things.** A verifier that looks for errors scores an
  empty response as perfect. Check liveness before quality.
- **The seed is deterministic and safe to rerun.** `npm run seed` from `backend/`
  restores a known demo state, and clears alerts and the audit trail so the
  reasoning loop replays cleanly. Rerun it after any test that mutates stock.
- **Servers stay running.** Do not stop them at the end of a task.

### Names we use

- **The Launchpad** is the screen at `/` with the three workspace cards. Use this
  name in conversation; "home" and "the menu" are ambiguous when three separate
  workspaces exist. `frontend/src/pages/Launchpad.jsx`.
- **The Control Tower** is the desktop analysis side: Dashboard, Inventory,
  Alerts, Activity. It is the only part that wears the sidebar.
- **Goods In** and **Goods Out** are the handheld warehouse floor flows. Industry
  terms: inbound / goods receipt, and outbound / goods issue.

### Where things live

- `backend/src/engines/` deterministic analytics, the source of truth for every
  figure. `index.js` orchestrates; nothing else should recompute what it emits.
- `backend/src/llm/` the explanation layer. The model narrates and never
  computes; `slots.js` makes writing an unapproved figure structurally
  impossible.
- `backend/src/routes/inventory.js` the Control Tower API.
  `backend/src/routes/warehouse.js` the handheld floor API. They have opposite
  shapes on purpose.
- `backend/scripts/bench-models.js` measures model drift. Re-run it after
  changing a prompt rather than guessing whether the change helped.
