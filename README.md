# StockSense

**Agentic inventory management for a rice importer/distributor.**
AWS NUS-ISS SMYA 2026 Hackathon, Team Puenzhiyyy. The demo client is a fictional Singapore rice
importer, 四海米行 / Four Seas Rice Trading.

A rice distributor runs on two objectives that pull against each other: never miss a customer order,
and never tie up cash in stock nobody is buying. Spreadsheets force a manager to hold both in their
head at once, for every SKU, every week. StockSense does the arithmetic continuously, surfaces only
the SKUs that need a decision today, and leaves the decision itself to the human.

---

## The idea in one paragraph

Most "AI inventory" tools put a language model in the critical path and let it do the maths. This one
does not. Every figure, status and alert comes from nine deterministic analytics engines that compute
velocity, safety stock, reorder points, health status and financial exposure from the transaction
history, the same way every time, each formula documented and checked against the code in CI. A
language model is invoked only when a manager presses **Why?** on an alert, and even then it
narrates: it never handles a number and never takes an action. That is a deliberate architecture for
the target user, an SME with a real token budget, and it means every number on screen can be traced
to a formula rather than to a generation.

---

## The reasoning loop

This is the cycle the app implements, and the one the audit trail records:

```
   sales, purchase orders, sales orders, stock movements (SQLite)
                    │
                    ▼
   ┌────────────────────────────────────┐
   │  9 deterministic analytics engines │   velocity, position, safety stock,
   │  (backend/src/engines/)            │   classification, segmentation, health,
   └────────────────────────────────────┘   financials, alerts, projection
                    │
                    ▼
        typed alerts with thresholds        e.g. idle stock: no sales in 90+ days,
        and a recommended action             cash tied up, stop replenishment
                    │
                    ▼
   ┌────────────────────────────────────┐
   │  MANAGER                           │   presses Why? for the reasoning, and
   │  approve / modify / reject         │   optionally a model's plain-English summary
   └────────────────────────────────────┘   nothing is ever auto-executed
                    │
                    ▼
         decision recorded, stock and
         policy updated, everything
         written to the audit log ──────────►  Activity page
```

Every arrow in that diagram writes a row to `audit_log`. The Activity page renders that table as a
plain-English timeline, with the exact input and output of each step one click away.

---

## What it does

Three workspaces share one database, because the people doing the work are in different places:

- **Goods In** (handheld, at the dock). Receive against a purchase order in four steps: pick the
  delivery, verify the SKU, count it, confirm. A quantity different from the one expected is allowed
  but must carry a reason.
- **Goods Out** (handheld, on the floor). Pick against an open sales order; stock that is not
  physically there cannot be shipped. Operators sign in with a four digit PIN, so every movement is
  attributed to a person.
- **The Control Tower** (desktop, for the manager):
  - **Dashboard.** Key Metrics (inventory value over time split into new and carried stock, plus the
    two questions that matter: can we supply what customers order, and is cash tied up in the right
    stock), Needs Attention, cover against lead time, health by value, and value by movement.
  - **Inventory.** Every SKU with a bullet-graph stock gauge, a 90-day projected stock curve, editable
    policy thresholds with a live preview before saving, and bulk edit by CSV.
  - **Alerts.** Six alert types (stockout risk, reorder, overstock, slow moving, idle, ageing), each with
    the measured value, the threshold it breached and a recommended action. Approve, modify or reject,
    with a reason. **Why?** shows the reasoning.
  - **Activity.** The audit trail: every alert raised, policy changed, stock movement, model call and
    manager decision, with what the system had proposed.

---

## The model layer: narrates, never computes

Why? first shows a rule-based explanation, built from the SKU's live figures, that needs no model.
A model summary can be requested on top, from one of three tiers: rule-based (free), a local llama3
(development), or Claude Sonnet 4.5 on Amazon Bedrock (paid, behind a demo PIN on a public server).

The model never handles a figure. It writes placeholders that the system fills with the engines'
values, the system writes the sentence stating why the alert fired, and every answer is checked for
figures that did not come from the engines and for real figures put in false relationships. A failed
answer is retried, then replaced by the rule-based explanation, so a wrong figure is never shown.
Details: [design.md, "Explanation Layer"](.kiro/specs/mvp1-inventory-visibility/design.md).

---

## Domain rules that are easy to get wrong

These are the distinctions the engines enforce, drawn from rice-industry reference documents in
`.kiro/specs/mvp1-inventory-visibility/reference/`. They are the difference between a dashboard that
looks right and one that is right.

| Rule | Why it matters |
|---|---|
| On Hand is not Available | Available = On Hand − Reserved − Quality Hold. Promising reserved stock to a second customer is how you miss an order while the warehouse looks full. |
| Purchase orders are never added to stock | Inbound POs are Expected Incoming, a separate figure, until goods are received. Adding them hides a stockout that has not happened yet. |
| Two reorder points, shown side by side | `reorder_point_suggested` is what the maths says. `reorder_point_policy` is what the business approved and what alerts actually fire on. Merging them hides every disagreement between the model and the operator. |
| Days of Cover is "Not Applicable" at zero demand | Never infinity, never blank. An idle SKU is a distinct problem from a well-covered one. |
| Movement class and ABC class are separate axes | A SKU can move fast and matter little. Conflating velocity with economic value is the classic ABC mistake. |
| Lost sales are not sales | An order that could not be filled counts against fill rate, never as demand, or the SKUs that ran short would look busier than they are. |

---

## Architecture

```
backend/src/
  engines/    the nine deterministic engines; index.js runs them in dependency order
  llm/        the explanation layer: placeholders, checks, tiers, the demo PIN gate, spend
  routes/     inventory.js for the Control Tower, warehouse.js for the handheld floor
  db/         schema, deterministic seed, audit log
backend/scripts/   formula check, demo reset, deploy rehearsal and check, model benchmark
frontend/src/
  pages/      Home, Dashboard, Inventory, Alerts, Activity
  warehouse/  Goods In, Goods Out, operator sign-in
  index.css   the design system: plain CSS custom properties, a six step type scale, light and dark
```

File by file, with every formula and the schema: [design.md](.kiro/specs/mvp1-inventory-visibility/design.md).

**Why SQLite.** One file, no server to provision, and the whole demo state is reproducible from a fixed
seed. For a hackathon handoff that matters more than horizontal scalability.

**Why no CSS framework.** The type scale is deliberately sized up for older users, and contrast is
checked against WCAG AA rather than inherited from a framework's defaults.

---

## Running it

Requires **Node 22** or later.

```bash
npm run install:all      # installs backend and frontend
npm run dev:backend      # terminal 1, http://localhost:4000 (seeds itself on first start)
npm run dev:frontend     # terminal 2, http://localhost:5173
```

Open http://localhost:5173.

```bash
cd backend && npm run seed         # reset to the known demo state at any time
cd backend && npm run analytics    # run every engine against the database and print the result
```

The app runs fully without any API key: explanations are rule-based. Model settings (a local Ollama
model, or the Bedrock gateway and demo PIN) go in `backend/.env`, which is never committed; every
setting the server reads is in `backend/src/llm/provider.js` and `backend/src/llm/demoAccess.js`.

---

## Deployment

One container serves the API and the built site from one origin. GitHub Actions checks every formula
against the spec, builds the image for linux/amd64, starts it with production settings, smoke tests
it, scans it for anything shaped like a credential, and only then publishes it. AWS Lightsail runs that
exact image; secrets exist only in its environment settings. The server seeds itself on an empty
database, so a restart returns the demo to a known state.

---

## API

Base URL `/api`. Two route files with opposite shapes: `backend/src/routes/inventory.js` answers "what
should we do about this SKU", `backend/src/routes/warehouse.js` answers "this pallet is in front of me,
what do I press". The full endpoint list is in
[requirements.md, REQ-13](.kiro/specs/mvp1-inventory-visibility/requirements.md); the route files are
the source of truth.

Every response is `{ success, data, message? }`.

**Alert content is computed live, lifecycle is persisted.** `alerts_log` stores only whether an alert
is open or acknowledged, keyed on `sku_id:alert_type`. The message and the numbers are recomputed from
current stock on every request, so an alert can never go stale. Acknowledging is one-way: a dismissed
alert stays dismissed even while the condition holds.

---

## Observability

`audit_log` records every event with the input the system saw and the output it produced; the event
types are the `EVENTS` map in `backend/src/db/audit.js`. Three details make it an audit trail rather
than a log file:

- **Field-level diffs.** A policy change stores before and after for each field, so "reorder point
  280 to 302" is readable straight off the trail.
- **Proposal beside decision.** A manager decision stores what the system proposed, what the manager
  did, and the difference, which makes override rate a query rather than a research project.
- **What the AI cost.** Every model call is recorded with its tokens, failed attempts included, so
  paid spend is read from the trail rather than estimated.

Logging is best-effort by design: a failed audit insert is reported to the server log and never breaks
the request it records.

---

## Deliberate omissions

Scoped out on purpose, not missed: an immutable movement ledger (balances are a mutable snapshot
rather than rebuildable from history), lot and batch genealogy, blocked and damaged stock statuses,
statistically backtested forecasting, and giving the model the ability to act (which would first
need execution governance). The full list and the reasoning is in
[requirements.md, "Explicitly Deferred"](.kiro/specs/mvp1-inventory-visibility/requirements.md).

`compliance_position` is a rice-specific regulatory stockpile buffer. The implementation is
illustrative and labelled as such everywhere it appears. It is not a governance-approved rule.

---

## Documentation

Every document in the repository, who it is for and what is in it: [`docs/DIRECTORY.md`](docs/DIRECTORY.md).
The write-up is [`docs/Submission/WRITEUP.md`](docs/Submission/WRITEUP.md); the formulas and data model are in
[`design.md`](.kiro/specs/mvp1-inventory-visibility/design.md).
