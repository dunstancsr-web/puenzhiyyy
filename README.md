# StockSense

**Agentic inventory management for a rice importer/distributor.**
AWS NUS-ISS SMYA 2026 Hackathon.

A rice distributor runs on two objectives that pull against each other: never miss a customer order,
and never tie up cash in stock nobody is buying. Spreadsheets force a manager to hold both in their
head at once, for every SKU, every week. StockSense does the arithmetic continuously, surfaces only
the SKUs that need a decision today, and leaves the decision itself to the human.

---

## The idea in one paragraph

Most "AI inventory" tools put a language model in the critical path and let it do the maths. This one
does not. Ninety percent of StockSense is deterministic: nine analytics engines that compute velocity,
safety stock, reorder points, health status, and financial exposure from the transaction history, the
same way every time, auditable line by line. The language model is invoked only when a manager
explicitly asks "why?" about a specific flagged SKU. That is a deliberate architecture for the target
user, an SME with a real token budget, and it means every number on screen can be traced to a formula
rather than to a generation.

---

## The reasoning loop

This is the cycle the app implements, and the one the audit trail records:

```
   sales, purchase orders, stock positions (SQLite)
                    │
                    ▼
   ┌────────────────────────────────────┐
   │  9 deterministic analytics engines │   velocity, position, safety stock,
   │  (backend/src/engines/)            │   classification, segmentation, health,
   └────────────────────────────────────┘   financials, alerts, projection
                    │
                    ▼
        typed alerts with thresholds        "Japonica 5KG: no sales in 96 days,
        and a recommended action             SGD 250K tied up. Stop replenishment."
                    │
                    ▼
   ┌────────────────────────────────────┐
   │  MANAGER                           │   optionally asks the LLM "why?"
   │  approve / modify / reject         │   nothing is ever auto-executed
   └────────────────────────────────────┘
                    │
                    ▼
         decision recorded, stock and
         policy updated, everything
         written to the audit log ──────────►  /activity
```

Every arrow in that diagram writes a row to `audit_log`. The Activity page renders that table as a
plain-English timeline, with the exact input and output payload of each step one click away.

---

## What it does

**Dashboard.** Portfolio KPIs grouped into the two questions that matter (can we supply what customers
order, and is cash tied up in the right stock), a health-by-value breakdown, the top actions to take
today, an ABC by movement matrix, and an ageing profile.

**Inventory.** Every SKU with a bullet-graph stock gauge showing available stock against its reorder
point and maximum, plus a per-SKU modal with a 90-day projected stock curve and editable policy
thresholds with a live preview of the effect before saving.

**Alerts.** Six alert types (stockout risk, reorder, overstock, slow moving, idle, ageing), each with
the measured value, the threshold it breached, and a recommended action. Approve, modify, or reject
each one, with a reason.

**Activity.** The audit trail. Every alert raised, every policy changed, every decision a manager made
and what the system had proposed instead.

---

## Domain rules that are easy to get wrong

These are the distinctions the engines enforce, drawn from a rice-industry glossary in
`.kiro/specs/mvp1-inventory-visibility/reference/`. They are the difference between a dashboard that
looks right and one that is right.

| Rule | Why it matters |
|---|---|
| On Hand is not Available | Available = On Hand − Reserved − Quality Hold. Promising reserved stock to a second customer is how you miss an order while the warehouse looks full. |
| Purchase orders are never added to stock | Inbound POs are Expected Incoming, a separate figure, until a receipt posts. Adding them hides a stockout that has not happened yet. |
| Two reorder points, shown side by side | `reorder_point_suggested` is what the maths says. `reorder_point_policy` is what the business approved and what alerts actually fire on. Merging them hides every disagreement between the model and the operator. |
| Days of Cover is "Not Applicable" at zero demand | Never infinity, never blank. An idle SKU is a distinct problem from a well-covered one. |
| Movement class and ABC class are separate axes | A SKU can move fast and matter little. Conflating velocity with economic value is the classic ABC mistake. |

---

## Architecture

```
backend/
  src/
    db/
      init.js         schema: skus, inventory_positions, sales_transactions,
                      purchase_orders, alerts_log, decisions, audit_log
      seed.js         deterministic seeded generator, 10 rice SKUs, 241 sales
      audit.js        audit-log write path, best-effort, never breaks a request
    engines/
      velocity.js         rolling 30/60/90/180-day consumption, trend, demand CV
      position.js         available, expected incoming, inventory position
      safetystock.js      statistical safety stock (King's formula) from service level
      classification.js   Fast / Normal / Slow / Idle by throughput
      segmentation.js     ABC by annual consumption value, Pareto
      health.js           RED / ORANGE / YELLOW / GREEN, first match wins
      financials.js       turnover, DIO, GMROI, fill rate, exposure values
      alerts.js           six typed alerts, deduped, with recommended actions
      projection.js       90-day projected stock curve including inbound POs
      index.js            orchestrator, runs the above in dependency order
    routes/
      inventory.js    the real API over the SQLite schema
      products.js     legacy in-memory demo store, superseded, kept for reference

frontend/
  src/
    pages/       Dashboard, Inventory, Alerts, Activity
    components/  StockPositionBar (bullet graph), StatCard, HoverHint, FormField, ...
    api/         fetch client, distinguishes an unreachable backend from an API error
    index.css    the design system, plain CSS custom properties, light and dark
```

**Why SQLite.** One file, no server to provision, and the whole demo state is reproducible with
`npm run seed`. For a hackathon handoff that matters more than horizontal scalability.

**Why no CSS framework.** Plain custom properties. The type scale is deliberately sized up for older
users, and the contrast ratios are checked against WCAG AA rather than inherited from a framework's
defaults.

---

## Running it

Requires Node 18+ and npm 9+.

```bash
npm run install:all      # installs backend and frontend

cd backend && npm run seed    # creates and seeds data/stocksense.db

npm run dev:backend      # terminal 1, http://localhost:4000
npm run dev:frontend     # terminal 2, http://localhost:5173
```

Open http://localhost:5173.

`npm run seed` is safe to rerun at any time. It wipes and regenerates from a fixed random seed, so
everyone sees the same numbers, and it clears the alert and audit tables so the reasoning loop
replays cleanly for a demo.

```bash
cd backend && npm run analytics   # runs every engine against the seeded DB and prints the result
```

---

## API

Base URL `http://localhost:4000/api`.

| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/skus` | every active SKU, fully computed by the engines |
| GET | `/skus/:id` | one SKU |
| GET | `/skus/:id/projection` | 90-day projected stock curve |
| POST | `/skus` | create a SKU |
| PUT | `/skus/:id` | update policy, identity, or stock-adjustment fields |
| POST | `/inventory/restock` | post a receipt, `{ sku_id, quantity }` |
| GET | `/dashboard/stats` | portfolio KPI roll-up |
| GET | `/alerts` | live alerts with persisted lifecycle |
| POST | `/alerts/:id/acknowledge` | dismiss an alert |
| GET | `/decisions` | manager decision log |
| POST | `/decisions` | record an approve / modify / reject |
| GET | `/audit` | audit trail, filter by `event_type`, `sku_id`, `limit` |
| GET | `/health` | liveness check |

Every response is `{ success, data, message? }`.

**Alert content is computed live, lifecycle is persisted.** `alerts_log` stores only whether an alert
is open or acknowledged, keyed on `sku_id:alert_type`. The message and the numbers are recomputed from
current stock on every request, so an alert can never go stale. Acknowledging is one-way: a dismissed
alert stays dismissed even while the condition holds.

---

## Observability

`audit_log` records seven event types, each with the input the system saw and the output it produced:

`ALERT_TRIGGERED` · `DECISION_RECORDED` · `RESTOCK` · `SKU_UPDATED` · `SKU_CREATED` ·
`ALERT_ACKNOWLEDGED` · `LLM_CALL`

`SKU_UPDATED` stores a field-level before/after diff, so "reorder point 280 to 302" is readable
straight off the trail rather than inferred from two snapshots. `DECISION_RECORDED` stores what the
system proposed alongside what the manager did, and the delta between the two quantities, which makes
override rate a query rather than a research project.

Logging is best-effort by design: a failed audit insert is swallowed and reported to the server log.
An audit trail that can fail the restock it is recording is worse than no audit trail.

---

## Status and deliberate omissions

Built: the SQLite data model, all nine engines, the four pages, the alert lifecycle, the decision
trail, and the audit log.

**The LLM layer is not yet wired.** "Ask AI" currently returns a rule-based explanation. The call site,
the `LLM_CALL` audit event, and the UI are all in place; connecting a real model is a change at one
function. This is tracked as TASK-11 and is blocked on an API key, not on design.

Scoped out of MVP 1 on purpose, not missed: an immutable movement ledger (balances are a mutable
snapshot rather than rebuildable from history), lot and batch genealogy, blocked/damaged stock
statuses, and agent execution governance. The full list and the reasoning is in the spec's "Explicitly
Deferred" section.

`compliance_position` is a rice-specific regulatory stockpile buffer. The MVP 1 implementation is
illustrative and is labelled as such everywhere it appears. It is not a governance-approved rule.

---

## Documentation

| File | Contents |
|---|---|
| `.kiro/steering/project-context.md` | domain terms, tech decisions, working agreements |
| `.kiro/specs/mvp1-inventory-visibility/requirements.md` | numbered requirements |
| `.kiro/specs/mvp1-inventory-visibility/design.md` | engine formulas and data model |
| `.kiro/specs/mvp1-inventory-visibility/tasks.md` | task breakdown and status |
| `.kiro/DEVLOG.md` | dated development log |
| `docs/Submission/WRITEUP.md` | the hackathon write-up |
| `.kiro/steering/rules.md` | the rules for AI agents working in this repo (imported by `CLAUDE.md`) |
