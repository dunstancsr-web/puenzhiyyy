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

## For the judges

| Document | What is in it | Open it when |
|---|---|---|
| [`README.md`](../README.md) | GitHub's front page: what StockSense is, the reasoning loop, domain rules, architecture, how to run it, the API | Anyone visits the repository |
| [Submission/WRITEUP.md](<Submission/WRITEUP.md>) | The source of the PDF write-up: problem, architecture, why deterministic first, the model layer and its safeguards, human in the loop, observability, deployment, roadmap. A snapshot for export; its figures are refreshed before each export | Before exporting the PDF |
| every file in `docs/Submission/images/` | The write-up's three screenshots | Recapturing a screenshot |

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

## Scripts (each file's header explains its use)

| Script | What it does |
|---|---|
| `backend/scripts/demo-reset.js` (`npm run demo:reset`) | Reseeds and checks the running app is ready for the demo video |
| `backend/scripts/check-formulas.js` | Checks every design.md formula against the engines; runs in CI |
| `backend/scripts/formula-decisions.json` | Known formula disagreements waiting for Stan's decision (empty when none) |
| `backend/scripts/bench-models.js` | Measures the explanation pipeline on free local llama3 |
| `backend/scripts/sonnet-check.js` | The one paid model check; spends nothing without `--confirm-spend` |
| `backend/scripts/spend.js` | Lists paid model calls from the audit trail, for the spend ledger |
| `backend/scripts/check-deploy.js` | Checks a live deployment without calling the model |
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
