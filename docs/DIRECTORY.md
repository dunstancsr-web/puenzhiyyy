# Directory: every document in this repository

The one list of every document: who it is for, what is in it, and when to open it. If a document is
not listed here, it should be, and adding a row is part of creating or moving one (see
`.kiro/steering/rules.md`, "Documents").

Paths are from the repository root. A row reading "every file in `folder/`" covers everything in that folder;
any other document needs its own row. Status, figures and decisions are never written here, only where
to find them.

## For Stan

### `docs/(Stan) 1 Reference/`: things to look up

| Document | What is in it | Open it when |
|---|---|---|
| [(Stan) SUBMISSION TRACKER.md](<(Stan) 1 Reference/(Stan) SUBMISSION TRACKER.md>) | The four deliverables and their status, the order of steps before submitting, decisions already made with reasons, judging criteria, the demo video script, and the recording checklist | You want to know what is left, what was decided, or you are about to record |
| [(Stan) DEPLOY-LIGHTSAIL.md](<(Stan) 1 Reference/(Stan) DEPLOY-LIGHTSAIL.md>) | Step by step deployment to AWS Lightsail: the lease, the container service, environment settings, verification, and shutting down afterwards | The organizers have answered and you are deploying |
| [(Stan) MODEL SPEND.md](<(Stan) 1 Reference/(Stan) MODEL SPEND.md>) | The sponsored budget, the cost of one paid explanation, and the ledger of every paid model call with the running total | Before and after any paid model call, or to see how much credit is used |
| `CLAUDE_CLI_GUIDE (Stan).md` (private, not on GitHub) | How to use Claude Code, how to hand over to Kiro when Claude credits run out, and the few private items | You are switching tools or starting a new session |

### `docs/(Stan) 2 To review/`: drafts waiting for your comment

Anything directly in this folder is waiting for you. Decided documents move to `Reviewed/`.

| Document | What is in it | Status |
|---|---|---|
| [Reviewed/(Stan) ELI18 EXPLANATIONS DRAFT.md](<(Stan) 2 To review/Reviewed/(Stan) ELI18 EXPLANATIONS DRAFT.md>) | Old and new wording of the rule-based Why? explanation for all six alert types | Reviewed; applied to the app |
| [Reviewed/(Stan) FORMULA MISMATCHES.md](<(Stan) 2 To review/Reviewed/(Stan) FORMULA MISMATCHES.md>) | Generated report: each design.md formula checked against the code, with any disagreements | Reviewed; your decisions are recorded in design.md, "Formula decisions" |

## For anyone new to the app

| Document | What is in it | Open it when |
|---|---|---|
| [Guide/FEATURES GUIDE.md](<Guide/FEATURES GUIDE.md>) | Every screen with screenshots, by role and task: Home, the receiver's Goods In flow, Goods Out, the manager's Dashboard, Actions Needed, Next Steps (incl. Market signals and requests waiting for the buyer), Inventory (incl. its two charts), settings, Forecast, Onboarding, and how the roles connect | You want to see what the app does, or show someone |
| every file in `docs/Guide/images/` | The guide's screenshots | Recapturing a screen after the app changes |
| `docs/Guide/build-pdf.py` | Rebuilds the guide's PDF into `~/Downloads` (`python3 docs/Guide/build-pdf.py`). The PDF is a copy and is never committed | After editing the guide or recapturing a screenshot |
| [claude.ai artifact copy](https://claude.ai/artifact/VtbeekJo3tW9xaMuN1FfSp) | A third copy of the same guide, the one Stan reads it from day to day | Republish it from the current `.md` whenever the `.md` or its screenshots change - see rules.md, "Tooling" |

## For the judges

| Document | What is in it | Open it when |
|---|---|---|
| [`README.md`](../README.md) | GitHub's front page: what StockSense is, the reasoning loop, domain rules, architecture, how to run it, the API | Anyone visits the repository |
| [Submission/WRITEUP.md](<Submission/WRITEUP.md>) | The source of the PDF write-up: problem, architecture, what sits beyond the alerts (forecasting, market signals, order requests, Ask about your data), why deterministic first, the model layer and its safeguards, human in the loop, observability, deployment, roadmap. A snapshot for export; its figures are refreshed before each export | Before exporting the PDF |
| every file in `docs/Submission/images/` | The write-up's five screenshots | Recapturing a screenshot |

## For AI agents (Kiro and Claude Code)

| Document | What is in it | Open it when |
|---|---|---|
| [`CLAUDE.md`](../CLAUDE.md) | No content of its own: imports the three steering files below so Claude Code reads what Kiro reads | Never edit rules here |
| [`.kiro/steering/handoff.md`](../.kiro/steering/handoff.md) | Start here. What the project is, reading order, where each changeable fact lives, architecture, the model layer, history in phases, commands, how to keep documents in sync | Starting any session |
| [`.kiro/steering/rules.md`](../.kiro/steering/rules.md) | The one rulebook: working rules, one source of truth, writing, design preferences, code quirks, names, document filing, tooling | Before any change |
| [`.kiro/steering/project-context.md`](../.kiro/steering/project-context.md) | The business problem and the inventory domain concepts (on hand versus available, two reorder points, and so on) | Working on anything that touches stock logic |
| [`.kiro/DEVLOG.md`](../.kiro/DEVLOG.md) | Every session: what changed, and why. Newest at the bottom | You need the reason behind something |
| [`.kiro/specs/.../requirements.md`](../.kiro/specs/mvp1-inventory-visibility/requirements.md) | What the system must do, REQ-01 to REQ-24, and what was deliberately deferred | Checking whether something is in scope |
| [`.kiro/specs/.../design.md`](../.kiro/specs/mvp1-inventory-visibility/design.md) | How it works: every formula, the schema, page designs, the explanation layer, deployment, and the log of formula decisions | Changing or explaining any figure |
| [`.kiro/specs/.../tasks.md`](../.kiro/specs/mvp1-inventory-visibility/tasks.md) | Task write-ups to TASK-52 and an index of TASK-46 and 53 to 99 | Looking up a task number |
| every file in `.kiro/specs/mvp1-inventory-visibility/reference/` | The rice industry source documents: the technical specification, the terms glossary, and the map from old field names to the canonical ones | Checking a term or formula against the industry source |
| every file in `.kiro/hooks/` | Kiro hooks: the docs sync reminder (and `docs-check.sh`, shared with Claude Code), commit reminder, lint on save | A hook misbehaves |
| `.claude/settings.json` | Claude Code's hook: the docs sync reminder | A hook misbehaves |
| every file in `.claude/skills/ui-ux-audit/` | The UI/UX audit skill: the procedure (`SKILL.md`), a checklist template, a catalogue of root causes, the in-page detector and the headless runner, and a generic example config | Testing or fixing UI/UX, before a demo or release |
| [`.kiro/steering/ui-ux-audit.md`](../.kiro/steering/ui-ux-audit.md) | Kiro's pointer to that same skill (loaded on request, holds no copy) | Kiro is asked to test the UI |
| `frontend/ux-audit.config.json` | This project's audit setup: routes, scripted states, themes, modes, thresholds and the recorded exceptions with their reasons | You change a route or a rule, or add an exception |

## Scripts (each file's header explains its use)

| Script | What it does |
|---|---|
| `backend/scripts/demo-reset.js` (`npm run demo:reset`) | Reseeds and checks the running app is ready for the demo video |
| `backend/scripts/check-formulas.js` | Checks every design.md formula against the engines; runs in CI |
| `backend/scripts/test-tone.js` | Checks the model wording clean-up (`backend/src/llm/tone.js`) changes what it should and nothing else |
| `backend/scripts/formula-decisions.json` | Known formula disagreements waiting for Stan's decision (empty when none) |
| `backend/scripts/bench-models.js` | Measures the explanation pipeline on free local llama3 |
| `backend/scripts/sonnet-check.js` | The one paid model check; spends nothing without `--confirm-spend` |
| `backend/scripts/spend.js` | Lists paid model calls from the audit trail, for the spend ledger |
| `backend/scripts/check-deploy.js` | Checks a live deployment without calling the model |
| `backend/scripts/test-signals.js` | Checks the market signal engine against figures worked out by hand |
| `backend/scripts/test-signal-reader.js` | Checks the headline reader (feed parsing, keyword filter, strict validator, paid tier unreachable) with no network and no model |
| `backend/scripts/bench-signal-reader.js` | Measures the headline reader's model stage on labelled headlines, on local llama3.1 only |
| `.claude/skills/ui-ux-audit/scripts/run-audit.mjs` (`npm run ux:audit`) | Headless UI/UX audit across routes, widths, themes and modes, with a real keyboard test; `npm run ux:selftest` proves each check can fail |
| `backend/scripts/rehearse-deploy.sh` | Runs the app on this Mac the way the Lightsail container will, then checks it |

## Design tools and build

| Document | What is in it |
|---|---|
| every file in `frontend/tuners/` | The design tuners (sliders over real components that output CSS) and the brand sheet; [its README](../frontend/tuners/README.md) lists each one |
| every file in `frontend/mockups/` | An early stock position concept study, kept for history |
| `.github/workflows/container.yml` | CI: formula check, container build, smoke tests, secret scan, publish |
| `Dockerfile`, `.dockerignore` | The production container |
| `.gitignore` | What never goes to GitHub, including `.env` and private `(Stan)` notes |

## Private, never on GitHub

| File | What it is |
|---|---|
| `backend/.env` | API keys and the demo PIN. Never paste its contents anywhere |
| `backend/.env.example` | A local template of the same settings |
| `CLAUDE_CLI_GUIDE (Stan).md` | Stan's private guide (above) |
| `.git/hooks/pre-commit` | The local secret check that stops a key being committed |
