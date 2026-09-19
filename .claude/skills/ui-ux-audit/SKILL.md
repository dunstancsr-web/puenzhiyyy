---
name: ui-ux-audit
description: Strict, repeatable UI/UX testing of any web app. Use when asked to test, check, audit or QA the UI or UX; when banners, toasts, sticky bars or floating buttons overlap content; when a layout breaks on phones or narrow windows; when text is hard to read, buttons are hard to tap, or dark mode looks wrong; and before a demo or release or after any UI change. Builds a designer's checklist, runs it across routes x widths x themes x modes with real viewports, touch emulation and a real keyboard, finds root causes, fixes them, and re-runs until clean.
---

# UI/UX audit

A loop, not a one-off: **checklist, measure, triage, fix the root cause, re-measure, look with your own eyes, report.** The measuring is automated and generic; the judgement is yours. Written after a real session in which "banners overlapping content" turned out to have three separate causes, none of which a single-width look at one page would have found.

## What it catches

The script reads the rendered page (geometry and computed style), so it knows nothing about any framework. Every issue has a stable id:

| id | Finds | Severity |
|---|---|---|
| L1 | page scrolls sideways | error |
| L2 | a fixed or sticky element covers content (banner over nav, floating button over a toolbar) | error |
| L3 | two fixed elements overlap each other | error |
| L4 | a fixed element's own text is bigger than its box (wrapped or overflowed) | error |
| L5 | an `overflow:hidden` container clips something that grew | warn |
| L6 | something extends past the viewport edge outside a scroller | error |
| T1 | text below a minimum size, or off the project's type scale | warn |
| T2 | text contrast below WCAG AA (4.5:1, 3:1 for large text) | error |
| T3 | text matching a forbidden pattern (for example dashes if a project bans them) | warn |
| I1 | touch or pointer targets too small (44px on phones, 24px with a mouse) | warn |
| I2 | a control or image with no accessible name | error |
| I3 | a broken image | error |
| X1 / X2 | duplicate ids; missing `lang`, `<title>` or viewport meta | warn |
| K1 | a focusable control with no visible focus indicator (real Tab key) | error |
| K2 | a focused control that is covered or off screen | error / warn |
| K3 | keyboard focus stuck on one control (a trap) | error |

## What it cannot judge (you must look)

Visual hierarchy, alignment and rhythm, whether copy makes sense, whether an interaction feels right, brand fit, motion. So the procedure below ends with **looking at real screenshots**. A clean report is a floor, not proof of good design.

## The procedure

1. **Write the checklist first.** Copy `checklist.md`, add items specific to this product (its new features, its riskiest screens), and decide thresholds. Do this before running anything, so "done" is defined up front, not after seeing the results.
2. **Inventory what to test.** Routes, and the *states* that matter: logged in, a modal open, a multi-step flow at each step, empty and error and loading states, seeded data, each theme, each mode (for example demo vs live). Most glitches live in states nobody thought to open.
3. **Configure.** Copy `examples/ux-audit.config.example.json` to the project and fill it in (schema below).
4. **Run** (see "Running"). Prefer the headless runner: it has real viewport sizes, touch emulation and a real keyboard.
5. **Triage.** Errors first. For each: is it real, or a known artifact (list under "Traps in the tool itself")? Reproduce it with a screenshot before believing it.
6. **Fix the root cause, once, at the source.** Read `pitfalls.md`: most glitches are one of a dozen patterns, and the fix belongs in a shared token, class or layout rule, not on the one page you noticed. Prefer changing the thing that is wrong over adding an exception.
7. **Re-run until clean.** Re-run the whole matrix, not just the page you touched: a fix in a shared rule can break another page (a global size rule once undid another rule by coming later in the file).
8. **Look.** Screenshot at least: the narrowest width, one wide width, each theme, and each state you added. Zoom into the area you changed. This is the step that catches ugliness the audit cannot measure.
9. **Record exceptions with reasons.** An `ignore` rule in the config needs a `reason`, and the report lists every exception hit. Never ignore something just to turn the run green. Legitimate examples: disabled controls (WCAG exempts them), chart axis labels, a deliberate transient toast.
10. **Report** the matrix result, what you fixed and why, the exceptions, and, honestly, what you did **not** cover.

## Running

**Headless (preferred).** Needs `playwright-core` (`npm i -D playwright-core`; it drives your installed Chrome and downloads no browser).

```bash
node .claude/skills/ui-ux-audit/scripts/run-audit.mjs --config ux-audit.config.json
# options: --out dir  --only text  --shots failures|all|none  --fail-on error|warn|none  --no-keyboard  --headed
```

It writes `report.md`, `report.json` and screenshots with the offending boxes outlined in red, and exits 1 if errors remain (usable in CI). Use `--only <text>` to iterate on one route quickly.

**In-page (when you can only drive an existing browser, for example an extension-driven Chrome that cannot resize).** Copy `scripts/ux-audit.js` into the app's static folder as `__ux-audit.js` (it is gitignored by convention), load it in the page, then:

```js
(0, eval)(await fetch('/__ux-audit.js').then(r => r.text()));
const m = await __uxMatrix(['/', '/dashboard'], [1440, 1024, 768, 390], { /* options */ });
console.log(__uxBrief(m));                // one line per route
JSON.stringify(m[0].results[3].issues)   // detail for one route at one width
```

`__uxMatrix` audits same-origin routes inside iframes of exact width, so no window resizing is needed. Delete the file when done. Limits: same origin only, no real keyboard, and a hidden tab freezes transitions (the script disables them for you).

## Config schema

| key | meaning |
|---|---|
| `baseUrl` | where the app runs |
| `widths` | viewport widths; default `[1440,1024,768,390]`. Widths at or below `mobileMaxWidth` (default 768) get touch emulation |
| `themes` | `[{name, colorScheme:'light'\|'dark', localStorage:{k:v}}]`; set whatever the app reads to pick a theme |
| `modes` | `[{name, requests:[{method,url,data}], localStorage}]`; run before the pages load, cookies persist (login, demo mode, seeded data) |
| `routes` | plain URLs, each audited in every mode, theme and width |
| `states` | scripted states: `{name, route, modes?, themes?, widths?, keyboard?, setupRequests?, steps:[...]}` |
| steps | `{click:sel}` `{clickEach:[sel...]}` `{fill:{selector,value}}` `{press:key}` `{wait:ms}` `{waitFor:sel}` `{scroll:sel}` `{scrollY:n}` `{eval:js}` `{request:{url,method,data}}` (Playwright selectors, so `text=Save` works) |
| `audit` | thresholds passed to the in-page audit: `typeScale`, `minFontPx`, `contrastMin`, `touchMinPx`, `pointerMinPx`, `forbidText`, `relaxedTargetSelector`, `hitAreaSelector`, `baseBg` |
| `keyboard` | `{enabled, widths, maxTabs}`; presses Tab through the page and checks focus visibility |
| `ignore` | `[{check, match (regex on the message), state?, reason}]`; every entry needs a reason |
| `screenshots`, `failOn`, `settleMs` | reporting and timing |

A scripted state is how you reach the screens a plain URL cannot: step 3 of a wizard, an open dialog, the page after a "Save".

## Trusting the tool

`node .claude/skills/ui-ux-audit/scripts/selftest.mjs` (`npm run ux:selftest` here) loads a deliberately broken page and its clean twin, and fails if any check stops catching the defect planted for it. Run it after editing `ux-audit.js` or `run-audit.mjs`. It exists because a checker that only ever says "clean" is worse than none, and because it caught five silent failures while this skill was being built.

## Traps in the tool itself

Each of these produced a false alarm once. Check for them before believing a result.

- **A hidden or background tab freezes CSS transitions.** A colour inherited from `body` looks mid-fade, so contrast fails on text that is fine. The audit disables transitions; if you screenshot by hand, do the same.
- **Text over images or gradients** has an unknown background, so contrast is skipped rather than guessed.
- **A control that grows its tap area with a pseudo-element** measures small. Give it a class matching `hitAreaSelector`.
- **A disabled control** with faint text is exempt from contrast (WCAG 1.4.3); the audit skips it.
- **Programmatic `element.focus()` does not trigger `:focus-visible`.** Only a real Tab press tests focus rings, which is why the headless runner presses the key.
- **A test that starts state-changing requests** (a confirm button, a receive endpoint) alters your data. Point such states at a sandbox mode, and re-seed afterwards.
- **A checker that only looks for bad things scores an empty page as perfect.** Before trusting a new check, give it a case it must catch (break something on purpose, confirm it fails, restore).

## Adapting to a new project (10 minutes)

1. Install `playwright-core`; copy the config example; set `baseUrl` and `routes`.
2. Run once with defaults and read the report. Expect noise: decide, per finding, *fix* or *exception with a reason*.
3. Add `themes` and `modes` for whatever the app has. Add a `states` entry for every multi-step flow and every dialog.
4. Set `typeScale` if the project has one, and `forbidText` for any writing rule you want enforced.
5. Add the run to CI or a pre-release checklist. `--fail-on warn` for strict.

Keep project-specific facts in the project's own config and docs; keep this skill generic.
