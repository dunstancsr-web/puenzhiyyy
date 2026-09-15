---
inclusion: always
---

# Rules: the one rulebook for every agent

Every rule and standing preference for working on this repo, in one place. **Kiro** loads this file
into every chat automatically. **Claude Code** loads it through an import in `CLAUDE.md`. So a rule
changed here changes for every tool and every model at once. **Add or change rules only in this
file**; anywhere else that needs one links here.

These are settled preferences learned from Stan's feedback, not suggestions to re-litigate.

## 1. Working rules

- **Never call the paid model** (the gateway, Bedrock, or the Anthropic API) for testing unless Stan
  approves that specific run in the current conversation. Test on local llama3 or a fake model. The
  key draws on the AWS credit that also pays for hosting.
- **Never read out, paste or commit a secret.** Keys and the demo PIN live only in `backend/.env`
  (gitignored) and the host's environment settings. To check one exists, print its length, never its
  value.
- **Commit only when Stan asks.** End commits with the attribution your tool requires.
- **Keep the documents in sync** at the end of a session that changed the project, following
  "Keeping this in sync" in `handoff.md`. Devlog entries are written by hand, in the existing format.
- **After any approved paid call**, add it to the spend ledger (see "Where each fact lives" in
  `handoff.md`) before running `npm run seed`, which erases the audit trail it comes from, and tell
  Stan the new grand total. Treat anything that can spend credit as a competition risk, not just a
  cost (see the ledger's budget section).
- **`npm run seed`** (from `backend/`) restores a known demo state and clears alerts and the audit
  trail. Rerun it after anything that changes stock.
- **Servers stay running.** Do not stop them at the end of a task.
- **Measure, don't guess.** After changing a prompt, brief or check in `backend/src/llm/`, re-run the
  benchmark. After changing anything in `backend/src/engines/` or a formula in `design.md`, run
  `check-formulas.js` (commands in `handoff.md`); CI runs it too and blocks publishing on a new
  disagreement. Never add an entry to `formula-decisions.json` to make a failure pass: only Stan's
  decision puts one there. Before committing frontend changes, the build must pass.

## 2. One source of truth

Every fact that can change lives in exactly one document, and everywhere else LINKS to it instead of
repeating it. Stan asked for this on 15 Sep after a paid spend total was copied into the handoff: a
copied figure goes stale silently, and nobody knows which copy is right. It applies to docs, comments,
code and rules (this file is the rules' one home).

- Before writing a figure, date, status, count or decision into a document, check its owner in
  "Where each fact lives" in `handoff.md`. If it has one, link to it. If it is new, give it one owner
  and add it to that table.
- Good: "Paid spend so far: see the spend ledger." Bad: "Paid spend so far: USD x.xx." (a number
  typed in by hand)
- In code: read the engine's field rather than re-deriving it (see "Derived values computed twice").
- The one deliberate exception is `docs/Submission/WRITEUP.md`, an export snapshot whose copies are
  refreshed before each export.
- When you find a duplicate, remove it in the same change and say so.

## 3. Writing

- **No em dashes or en dashes, anywhere**: UI copy, code comments, commit messages, documents. Stan
  flagged heavy dash use as an obvious "AI vibes" tell. Use a hyphen, a comma, a colon, parentheses,
  or two sentences. This applies to new writing; it is not a mandate to rewrite every old comment.
- **Say "rule-based"**, never "hard-coded", for the explanation layer. It is computed from live figures
  by documented rules; "hard-coded" implies static strings and undersells it.

## 4. Design preferences

Read before making UI changes.

- **Light is the priority. The default is Auto.** Since TASK-53 a fresh browser gets `auto`, which
  follows the device's appearance setting and falls back to light. That is a default, not a change of
  priority: light is what Stan looks at, demos and judges, and when a choice trades one against the
  other, light wins. Do not reach for a dark, high contrast treatment just because a screen is
  "industrial" or "device-like".
- **Apple aesthetics** is the standing direction. Restraint, hierarchy from type and spacing rather
  than boxes, colour reserved for state and meaning.
- **White cards.** Content sits on a `.card` surface, not directly on the page background. Alerts once
  shipped without this and it was flagged immediately.
- **Visibility for older users.** The type scale is deliberately larger than a default. Do not shrink
  it back.
- **Never write a raw font size. Use the scale.** Six steps are defined in `frontend/src/index.css`
  and they are the only sizes this app has:

  | token | px | for |
  | --- | --- | --- |
  | `--text-xs` | 13 | captions, uppercase labels, badges |
  | `--text-sm` | 15 | table rows, dense secondary text |
  | `--text-base` | 17 | body text, nav links, buttons |
  | `--text-lg` | 22 | card and section titles |
  | `--text-xl` | 30 | page titles, big figures |
  | `--text-2xl` | 40 | the one hero number |

  Write `fontSize: "var(--text-sm)"`, never `fontSize: 13`. If a size feels wrong, the answer is the
  neighbouring step or a different `fontWeight`, not a number in between: 14px is not a size this app
  has. `--text-xs` is the floor, with one carve out: chart axis ticks, which sit beside a labelled
  axis. Emphasis is what `fontWeight` is for, which is why `--text-md` was deleted. Some inline sizes
  predate this rule, so matching the surrounding code is the wrong instinct: match the scale, and
  migrate the literals you touch.
- **One primary action per surface.** Four differently coloured buttons in a row is a rainbow, not a
  hierarchy.
- **When a request is really a number** ("bigger", "less transparent"), offer the matching tuner in
  `frontend/tuners/` rather than guessing a value. Stan moves sliders over the real components and
  pastes back CSS. Build a new tuner when no existing one covers the question, and keep it beside the
  others.

## 5. Code quirks that have already caused bugs

- **Inline styles beat media queries.** An inline `display` or `gridTemplateColumns` prop overrides
  any stylesheet rule lacking `!important`, so a breakpoint can never reach it. This shipped as a real
  bug (both navs rendering at once on a phone). Anything a breakpoint must change belongs in a class.
- **`Number(null)` is `0`, and `0` is finite.** A bare `Number.isFinite` guard turns a MISSING value
  into a confident zero. Three bugs so far: "0 MT" for absent stock, "0 days" for an idle SKU, and a
  silently wrong benchmark. Guard for presence separately.
- **Derived values computed twice eventually disagree.** The suggested order quantity was calculated
  two ways and differed by 257 MT; months of cover differed by 0.2. Read the engine's own field.
  `engines/duration.js` and `suggested_order_qty` exist for this.
- **`backdrop-filter` does not work inside another `backdrop-filter`.** The outer element becomes a
  backdrop root, so the inner blur samples nothing and silently renders unblurred. It looks like a
  wrong blur value; it is a wrong DOM position. Portal the floating element to `document.body`, as
  `HoverHint` does.
- **`theme` is a preference, `resolved` is an appearance.** `useTheme()` returns both. `theme` can be
  `"auto"`, so `theme === "light" ? a : b` silently takes the dark branch on a light page. Anything
  picking a COLOUR reads `resolved`; only the settings UI reads `theme`.
- **Never put a `//` comment inside a JSX opening tag.** esbuild tolerates it and the build passes,
  but it is not valid JSX and other toolchains reject it. Put `{/* ... */}` above the element.
- **Verify against the real cascade, not a mock of it.** Injecting `!important` to force a breakpoint
  state once produced a green result on broken code.
- **Do not test only for bad things.** A verifier that looks for errors scores an empty response as
  perfect. Check liveness before quality.

## 6. Names we use

- **Home**: the screen at `/` with the three workspaces (`frontend/src/pages/Home.jsx`). Briefly
  called the Launchpad; Stan renamed it because everyone already knows what Home means.
- **The Control Tower**: the desktop side, Dashboard, Inventory, Alerts, Activity. The only part with
  the sidebar.
- **Goods In** and **Goods Out**: the handheld warehouse floor flows. Industry terms: inbound / goods
  receipt, outbound / goods issue.
- **Key Metrics**: the top card on the Dashboard (hero value, baseline comparison, the Service &
  availability and Working capital groups). The Dashboard's sections after it, in order: **Needs
  Attention** (full width, the only one carrying actions), **Cover vs Lead + Safety** beside
  **Inventory Health**, and **Value × Movement** (full width).
- **四海米行 / Four Seas Rice Trading**: the fictional client, sheet at `frontend/tuners/brand.html`.

## 7. Documents

- **Filed by who reads them.** Agents: `.kiro/` (steering, specs, hooks, `DEVLOG.md`), plus
  `CLAUDE.md` at the root because Claude Code looks for it there. Stan: `docs/(Stan) 1 Reference/`
  (things he looks up) and `docs/(Stan) 2 To review/` (drafts waiting for his comment; move to
  `Reviewed/` once he decides). Judges: `docs/Submission/` and `README.md`.
- **A document for Stan** gets `(Stan)` at the START of its name and goes in one of his two folders.
  A `(Stan)` SUFFIX is gitignored and means private, so a name ending in `(Stan).md` never reaches git.
- **Stan's personal instructions** (where to find documents, using Claude Code and Kiro) live in his
  one private guide, `docs/(Stan) 1 Reference/CLAUDE_CLI_GUIDE (Stan).md`. When a key document moves
  or a new one appears, update its "Where to find things" table.

## 8. Tooling

- `.kiro/hooks/*.json` fire only in Kiro; `.claude/settings.json` fires only in Claude Code. Kiro
  trigger names are PascalCase (`AgentStop`, `PostTaskExecution`).
- The one check both share is `.kiro/hooks/docs-check.sh`: when an agent finishes responding with
  files changed since the last devlog entry, it asks for the entry. Claude Code blocks the stop once;
  Kiro, which cannot block, prints a reminder. If you are only pausing to ask Stan a question, say so
  and stop.
