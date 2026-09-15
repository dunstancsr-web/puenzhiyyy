# CLAUDE.md

Read `.kiro/steering/handoff.md` first: the current state, history, settled decisions and rules in one
page, kept up to date for any agent (Kiro loads it automatically; Claude Code does not, so open it).
It also lists where each fact lives: one owner per fact, linked rather than copied. At the end of a
session follow its "Keeping this in sync" steps.
`.kiro/steering/project-context.md` has the domain terms and original goals. Then check `.kiro/specs/mvp1-inventory-visibility/` (`requirements.md`, `design.md`, `tasks.md`) and
`.kiro/DEVLOG.md` for what has already been built and why, before making changes.

## Writing style (added 2026-09-12, user feedback)

Do not use an em dash or an en dash anywhere in this project. Not in UI copy, not in code comments, not
in commit messages, not in this file. The user flagged heavy dash use as an obvious "AI vibes" tell. Use
a plain hyphen, a comma, a colon, parentheses, or split into two sentences instead. This applies to new
writing going forward. It is not a mandate to rewrite every existing comment in one pass.

## Note on tooling

This project was originally scaffolded with Kiro. `.kiro/hooks/*.json` files (such as
`auto-devlog.json`) are Kiro-specific configuration and do not fire during a Claude Code session. If a
session ends without a `.kiro/DEVLOG.md` entry, add one by hand in the existing format rather than trying to
make the Kiro hook run.

## Onboarding for agents: Stan's preferences and this codebase's quirks

Read this before making UI changes. These are settled preferences, learned from
feedback, not suggestions to re-litigate.

### Design preferences

- **Light is the priority. The default is Auto.** Since TASK-53 a fresh browser
  gets `auto`, which follows the device's own appearance setting, and falls back
  to light when the device cannot say. That is a default, not a change of
  priority: light is still what Stan looks at, demos and judges, and when a
  choice trades one against the other, light wins. Do not reach for a dark, high contrast treatment just
  because a screen is "industrial" or "device-like": make it light first.
- **Apple aesthetics** is the standing direction. Restraint, hierarchy from type
  and spacing rather than boxes, colour reserved for state and meaning.
- **White cards.** Content sits on a `.card` surface, not directly on the page
  background. Alerts once shipped without this and it was flagged immediately.
- **Visibility for older users.** The type scale is deliberately larger than a
  default. Do not shrink it back.
- **Never write a raw font size. Use the scale.** Six steps are defined in
  `frontend/src/index.css` and they are the only sizes this app has:

  | token | px | for |
  | --- | --- | --- |
  | `--text-xs` | 13 | captions, uppercase labels, badges |
  | `--text-sm` | 15 | table rows, dense secondary text |
  | `--text-base` | 17 | body text, nav links, buttons |
  | `--text-lg` | 22 | card and section titles |
  | `--text-xl` | 30 | page titles, big figures |
  | `--text-2xl` | 40 | the one hero number |

  Write `fontSize: "var(--text-sm)"`, never `fontSize: 13`. If a size feels
  wrong, the answer is the neighbouring step or a different `fontWeight`, not a
  number in between: 14px is not a size this app has. `--text-xs` is the floor
  and nothing goes below it, with one carve out, chart axis ticks, which are
  conventionally smaller and sit beside a labelled axis.

  Two consequences worth stating, because both have already bitten. Reaching for
  a size to signal emphasis is what `fontWeight` is for, and a step that
  duplicates a weight is one nobody applies correctly, which is why `--text-md`
  was deleted. And roughly 150 inline sizes predate this rule, so matching the
  surrounding code is the wrong instinct here: match the scale, and migrate the
  literals you touch on the way past.
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
- **`backdrop-filter` does not work inside another `backdrop-filter`.** An
  element with it becomes a *backdrop root*, so a descendant's own
  backdrop-filter can only sample within that root, finds nothing, and silently
  renders with zero blur. It looks like a wrong blur value; it is a wrong DOM
  position. Portal the floating element to `document.body`, which is what
  `HoverHint` does and why the hint panel frosts correctly.
- **`theme` is a preference, `resolved` is an appearance.** `useTheme()` returns
  both. `theme` can be `"auto"`, which is neither `"light"` nor `"dark"`, so a
  test like `theme === "light" ? a : b` silently takes the dark branch while the
  page is painted light. Anything picking a COLOUR reads `resolved`; only the
  settings UI reads `theme`. `StockPositionBar` had exactly this bug the moment
  Auto was added.
- **Never put a `//` comment inside a JSX opening tag.** esbuild tolerates it and
  the build passes, so it does not announce itself, but it is not valid JSX and
  other toolchains reject it. Put the comment above the element as `{/* ... */}`
  or a plain `//` line before the tag. This happened three times in one session.
- **Verify against the real cascade, not a mock of it.** Injecting `!important`
  to force a breakpoint state once produced a green result on broken code.
- **Do not test only for bad things.** A verifier that looks for errors scores an
  empty response as perfect. Check liveness before quality.
- **The seed is deterministic and safe to rerun.** `npm run seed` from `backend/`
  restores a known demo state, and clears alerts and the audit trail so the
  reasoning loop replays cleanly. Rerun it after any test that mutates stock.
- **Servers stay running.** Do not stop them at the end of a task.

### Names we use

- **Home** is the screen at `/` with the three workspace cards.
  `frontend/src/pages/Home.jsx`. It was briefly called the Launchpad; Stan
  renamed it, on the grounds that everyone already knows what Home means.
- **The Control Tower** is the desktop analysis side: Dashboard, Inventory,
  Alerts, Activity. It is the only part that wears the sidebar.
- **Goods In** and **Goods Out** are the handheld warehouse floor flows. Industry
  terms: inbound / goods receipt, and outbound / goods issue.
- **Key Metrics** is the top card on the Dashboard: hero value, baseline
  comparison, and the Service & Availability and Working Capital groups. It
  carries the heading on screen since TASK-67. The Dashboard's
  sections in order are then **Needs Attention** (full width, the only one
  carrying actions rather than analysis), **Cover vs Lead + Safety** beside
  **Inventory Health**, and **Value × Movement** full width.

### Where things live

- **Documents are filed by who reads them** (Stan's decision, 15 Sep). Agent
  material lives in `.kiro/` (steering, specs, hooks, `DEVLOG.md`); only this
  file stays at the root, because Claude Code reads it from there.
  `docs/(Stan) 1 Reference/` holds what Stan looks things up in (the submission
  tracker, deploy checklist, spend ledger). `docs/(Stan) 2 To review/` holds a
  draft waiting for his comments; move it to `Reviewed/` once he has decided.
  `docs/Submission/` holds what judges read (the write-up and its images).
  `README.md` stays at the root for GitHub. A new document for Stan goes in one
  of his two folders with `(Stan)` at the START of its name; a `(Stan)` suffix
  is gitignored and means private.
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
- `frontend/tuners/` holds the design tuners and `brand.html`, the naming,
  logo and pitch sheet for the fictional client 四海米行 / Four Seas Rice
  Trading. See its README. These are how Stan
  settles a visual question precisely: he moves sliders over a preview of the
  real components and pastes back a block of CSS, instead of both sides trading
  adjectives. **When a request is "make it bigger" or "less transparent" or
  anything else that is really a number, offer the matching tuner rather than
  guessing at a value.** Build a new one when a question comes up that neither
  covers, and keep it in that directory beside them.
