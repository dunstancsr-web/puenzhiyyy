---
inclusion: always
---

# Handoff: read this first

For any AI agent, in Kiro, Claude Code or anything else, starting cold on this repo. It is the
shortest path to working context.

**This file holds only what changes rarely**: what the project is, how it is built, the rules. Anything
that changes week to week (status, next steps, spend, decisions) lives in exactly one other document,
and this file links to it instead of copying it. See "Where each fact lives" below, and keep it that
way: a copied figure is a figure that goes stale without anyone noticing.

## What this is

**StockSense**, an inventory decision system for a Singapore rice importer, built for the **AWS NUS-ISS
SMYA 2026 hackathon** by Team Puenzhiyyy. The demo client is fictional: **四海米行 / Four Seas Rice
Trading**. Stan leads the team and makes every product and design decision.

- Deliverables: GitHub repo, live URL on AWS Lightsail, YouTube demo video, PDF write-up.
- Deadlines, judging criteria and where each deliverable stands: the submission tracker (below).

The idea in one line: **deterministic engines compute every figure, a human approves every action,
and a language model only explains, never computes.**

## Reading order

1. **This file.**
2. **`CLAUDE.md`** at the root. Despite the name it applies to every agent: Stan's design
   preferences, the type scale, the writing rules, and quirks that have already caused real bugs.
   Read it before any UI change.
3. **`.kiro/specs/mvp1-inventory-visibility/design.md`** for the formulas and data model.
4. **`.kiro/DEVLOG.md`**, newest entries at the bottom, for why recent things are the way they are.
5. **`tasks.md`** in the same spec folder has full write-ups to TASK-52 and a one-line index for
   TASK-46 and TASK-53 to TASK-99, whose detail is in the devlog.

`.kiro/steering/project-context.md` holds the business problem and the domain concepts (on hand
versus available, the two reorder points, and so on). Kiro loads it with this file.

## Where each fact lives

One owner per fact. Read it there, change it there, and link to it from anywhere else.

| Fact | The one place it lives |
|---|---|
| Deadlines, deliverable status, next steps and their order, decisions already made, video script | `docs/(Stan) 1 Reference/(Stan) SUBMISSION TRACKER.md` |
| Paid model spend, the ledger of every paid call, cost per call | `docs/(Stan) 1 Reference/(Stan) MODEL SPEND.md` |
| How to deploy | `docs/(Stan) 1 Reference/(Stan) DEPLOY-LIGHTSAIL.md` |
| What was done in each session, and why | `.kiro/DEVLOG.md` |
| Requirements, formulas, schema, alert rules | `.kiro/specs/mvp1-inventory-visibility/requirements.md` and `design.md` |
| Stan's design preferences, writing rules, code quirks | `CLAUDE.md` |
| Latest benchmark results | the newest benchmark entry in `.kiro/DEVLOG.md`; re-run rather than trust an old number |
| Every setting the server reads | `backend/src/llm/provider.js` and `grep -rn process.env backend/src` |
| The judges' write-up | `docs/Submission/WRITEUP.md`. A deliberate snapshot for export: its figures are allowed to be copies, and are refreshed before each export |

## How it fits together

```
backend/src/
  engines/     nine deterministic engines, index.js orchestrates. The source of truth for EVERY
               figure. Never recompute what they emit elsewhere.
  llm/         the explanation layer (see "The model layer" below)
  routes/      inventory.js is the Control Tower API, warehouse.js the handheld floor API
  db/          SQLite schema, deterministic seed, audit log
backend/scripts/
  bench-models.js   measures the explanation pipeline on free local llama3
  sonnet-check.js   the ONE paid check, refuses to spend without --confirm-spend
  spend.js          paid spend from the audit trail
  check-deploy.js   checks a live deployment, never calls the model
frontend/src/
  pages/       Home, Dashboard, Inventory, Alerts, Activity (the Control Tower)
  warehouse/   Goods In, Goods Out, operator PIN sign-in (the handheld)
  lib/explain.js    the rule-based Why? explanation, four plain-English steps
frontend/tuners/    Stan's design tuners: sliders over real components, he pastes back CSS
.github/workflows/container.yml   build, smoke test, secret scan, publish
```

Three workspaces share one database: **Goods In** and **Goods Out** on a handheld, the **Control
Tower** on a desktop. The Dashboard's sections, in order: Key Metrics, Needs Attention, Cover vs Lead
+ Safety beside Inventory Health, Value × Movement.

## The model layer, because it is where most recent work went

When a manager presses **Why?** on an alert, the rule-based explanation shows at once, and a model
summary is requested in the background. Three tiers, chosen per visitor: **Rule-based** (free),
**Local model** (llama3 via Ollama, dev only), **AWS Bedrock** (Claude Sonnet 4.5 through the
organizers' gateway, paid, gated by a demo PIN on a public server).

The model never handles a figure: it writes placeholders, the system writes the opening sentence and
guarantees the approved action, and every answer is checked before it is shown, with the rule-based
explanation as the fallback. **The full design, file by file, is `design.md`, "Explanation Layer".**

**If you change a prompt, a brief or a check, re-run
`node backend/scripts/bench-models.js llama3 --repeat 4 --scenario reorder` and compare.** One run of
16 is noise; four passes is the number to trust. Record the result in the devlog entry.

## History, in phases

| Dates | Tasks | What happened |
|---|---|---|
| 6 to 12 Sep | 01 to 14 | Schema, mock UI, nine engines, API, approval workflow, projection curve |
| 12 Sep | 15 to 26 | Domain terminology aligned with a rice industry spec; visual overhaul; five bug-finding passes; em dashes removed app-wide |
| 13 Sep | 27 to 41 | Responsive nav, audit log wired and shown on Activity, README, deployment prep, write-up draft, one order quantity instead of two |
| 13 Sep | 11, 42 to 45 | Model layer switched on: three tiers, drift benchmark, placeholders |
| 13 to 14 Sep | 47 to 84 | Home and the handheld Goods In/Out flows; the six step type scale; Dashboard restructure (Key Metrics, Needs Attention); CSV bulk edit; client brand and logo; sidebar restraint |
| 14 Sep | 85 to 87 | 24 months of inventory history; trend arrows from real data; plain-English metric names; hero chart split into new vs carried stock |
| 14 to 15 Sep | 88 to 94 | Going live: `.env` loading, secret hygiene and pre-commit check, per-visitor tiers, demo PIN, GitHub Actions container, paid spend tracking |
| 15 Sep | 95 to 99 | REORDER unified on the approved reorder point; wrong explanations made unwritable; plain-English rule-based explanations; no invented urgency |
| 15 Sep | none | Write-up and tracker refreshed; documents organised by reader |

## Decisions already made

Listed with their reasons in the submission tracker, "Decisions already made". Do not reopen them
without Stan. The ones that most shape code: REORDER fires on the **approved** (policy) reorder point;
the model narrates and never computes or acts; light theme first.

## Rules that apply to every agent

- **No em dashes or en dashes, anywhere**: code, comments, copy, commits. Use a hyphen, comma, colon
  or a new sentence.
- **One source of truth.** Never copy a figure, date, status or decision that already lives somewhere
  else: link to its owner in "Where each fact lives". A new fact gets one owner, added to that table.
  Stan's standing preference; details in `CLAUDE.md`, "One source of truth".
- **Never call the paid model** (gateway, Bedrock, Anthropic API) for testing unless Stan approves
  that specific run in the current conversation. Test on llama3 or a fake model. After any approved
  paid call, add it to `docs/(Stan) 1 Reference/(Stan) MODEL SPEND.md`.
- **Never read out, paste or commit a secret.** Keys and the demo PIN live only in `backend/.env`
  (gitignored) and in Lightsail's environment settings. To check one exists, print its length.
- **Commit only when Stan asks.** End commits with the attribution your tool requires.
- **Add a devlog entry by hand** at the end of a session in the existing format (see "Keeping this in
  sync").
- **Say "rule-based"**, never "hard-coded", for the explanation layer.
- **Font sizes come from the six step scale** in `frontend/src/index.css`, never a raw number.
- **`npm run seed`** (from `backend/`) after anything that changes stock. It erases the audit trail,
  so copy any new paid calls into the spend ledger first; the seed prints a warning.
- **Leave the dev servers running.**
- **Documents for Stan** go in `docs/(Stan) 1 Reference/` (to look things up) or
  `docs/(Stan) 2 To review/` (to comment on), with `(Stan)` at the START of the name. A `(Stan)`
  suffix is gitignored and means private.
- When a request is really a number ("bigger", "less transparent"), offer a tuner in
  `frontend/tuners/` rather than guessing.

## Running and verifying

```bash
npm run install:all                  # once
npm run dev:backend                  # http://localhost:4000
npm run dev:frontend                 # http://localhost:5173
cd backend && npm run seed           # reset demo data
cd frontend && npx vite build        # the build must pass before committing
node backend/scripts/bench-models.js llama3 --repeat 4 --scenario reorder   # after LLM changes
node backend/scripts/sonnet-check.js # plan and cost only; PAID with --confirm-spend
```

Check UI changes in a real browser against the real stylesheet, in light theme first.

## Open work

The ordered list is "Before submitting" in the submission tracker, and paid spend so far is in the
spend ledger. Check both before starting; do not rely on a summary of them.

## Keeping this in sync

At the end of a session in which you changed the project:

1. Add a `.kiro/DEVLOG.md` entry in the existing format.
2. If status, next steps or a decision changed, update the **submission tracker**, not this file.
3. If a paid model call was made, add it to the **spend ledger**.
4. Update this file only if something it describes changed: the architecture, a rule, the reading
   order, or where a fact lives.

`.kiro/hooks/docs-check.sh` checks step 1 automatically whenever an agent finishes responding with
files changed since the last entry: Claude Code runs it from `.claude/settings.json` and pauses once to
ask for the entry; Kiro runs it from `.kiro/hooks/docs-sync.json` and prints a reminder. If you are
only pausing to ask Stan a question, say so and stop.
