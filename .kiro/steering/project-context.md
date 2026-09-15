---
inclusion: always
---

# Project: StockSense, agentic rice inventory management

## About this file
The domain background: the business problem and the inventory concepts every change must respect.
It is loaded into every Kiro chat. **Start with `handoff.md` in this folder** for the current state,
architecture, rules and where each fact lives; this file does not repeat them.

## Hackathon Context
- Event: AWS NUS-ISS SMYA 2026 Hackathon. Team Puenzhiyyy; Stan leads and decides.
- Deadlines, deliverables, judging criteria and status: `docs/(Stan) 1 Reference/(Stan) SUBMISSION TRACKER.md`

## Business Problem
Rice importer/distributor needs to move from reactive spreadsheet-based inventory management to a proactive, AI-assisted system.
Two competing objectives:
- Customer fulfilment (avoid stockouts)
- Working capital efficiency (avoid excess stock, ageing, storage costs)

## Scope
What began as MVP 1 (inventory visibility) now also includes safety stock and reorder points, the
projected stock curve, handheld goods receipt and issue, 24 months of history, and a model layer that
explains alerts. The authoritative scope is `requirements.md` (REQ-01 to REQ-24) and its "Explicitly
Deferred" section; forecasting with backtesting and lead-time intelligence remain MVP 2.

## LLM / AI Usage Principle
- Every figure, status and alert is deterministic. The model is invoked only when a person presses
  **Why?** on an alert, and it narrates: it never computes a figure and never takes an action.
- This is intentional: trust, correctness, and SME token budgets.
- How that is enforced: `design.md`, "Explanation Layer".

## Tech Stack
- Frontend: React 18 + Vite (port 5173) + Recharts + Lucide React + React Router v6
- Backend: Node.js 22+ + Express (port 4000)
- Database: SQLite via better-sqlite3
- Explanations in the app: Claude Sonnet 4.5 on Amazon Bedrock through the hackathon gateway (paid,
  PIN gated), llama3 via Ollama in development (free), or rule-based (no model)
- Styling: plain CSS custom properties, no framework; the six step type scale in `CLAUDE.md`
- Hosting: AWS Lightsail container service, image built by GitHub Actions

## Inventory Hierarchy (analysis level)
Company → Warehouse → Product Category → SKU → Supplier/Origin → Batch/Lot

For MVP 1: track at SKU level. Batch-level tracking added in MVP 2+.

## Key Domain Concepts (always keep in mind)
> Corrected 2026-09-12 against real-world domain docs — see
> `.kiro/specs/mvp1-inventory-visibility/reference/rice-inventory-terms-glossary.md` (canonical
> definitions) and `.../reference/terminology-map.md` (exact field renames). **Use these field names in
> new code**, not the old ones (`physical_stock`, `available_stock`, `days_of_stock`, `reorder_point`,
> `on_order`/`incoming_stock` are all superseded).

- On Hand (`on_hand_qty`) ≠ Available (`available_qty`). Available = On Hand − Reserved − Quality Hold.
- Purchase orders and forecasts are never added to current on-hand stock — they're Expected Incoming
  (`expected_incoming_qty`), a separate figure, until an accepted receipt posts.
- Days of Cover (`days_of_cover`) = Available / Average Daily Demand. Show **"Not Applicable"** when
  demand is zero — never infinity, never a blank.
- Reorder Point Suggested (`reorder_point_suggested`) = Lead-Time Demand + Safety Stock — a
  system calculation. Reorder Point Policy (`reorder_point_policy`) is the approved, editable
  operating value alerts/health actually key off. They're shown side by side, not merged.
- Inventory Position (`inventory_position`) = Available + Expected Incoming − Unreserved Outstanding
  Demand. MVP1 has no separate outstanding-demand tracking beyond reservation, so that term is always
  zero — a documented simplification, not a bug.
- Suggested Order Quantity (`suggested_order_qty`) = max(0, Target Stock − Inventory Position). A
  recommendation requiring manager approval — never auto-executed.
- Health statuses: GREEN (healthy), YELLOW (watch), ORANGE (action required), RED (critical) — one
  reconciled rule set shared by the backend engine and the frontend mock (they used to silently
  diverge; see terminology-map.md item 1).
- SKU movement classes (velocity): Fast Moving, Normal, Slow Moving, Idle/Non-Moving — kept as a
  **separate axis** from ABC value classification (A/B/C by annual consumption value); never conflate
  "moves fast" with "matters economically."
- Compliance Position (`compliance_position`) — a rice-specific regulatory stockpile buffer, distinct
  from operational Safety Stock. MVP1's version is illustrative/placeholder, not a governance-approved
  rule; always label it as such.
- Triggers in the domain: Stockout Risk, Reorder, Overstock, Slow Moving, Idle, Ageing, Quality Risk,
  Supplier Delay, Demand Surge, Demand Collapse. The first six are implemented (REQ-09); the rest are not.
- What StockSense deliberately does **not** model yet: an immutable movement ledger (balances are a
  mutable snapshot, not rebuildable from history), lot/batch genealogy, blocked/damaged/rejected stock
  statuses, agent execution governance. See the spec's "Explicitly Deferred" section for the full list
  and why — these are scoped-out, not missed.

## Rice SKU Data Model (MVP 1)
Each SKU has: SKU ID, product name, rice variety, grade, country of origin, brand, packaging size, UOM, supplier, min order qty, reorder point policy, min stock, max stock, safety stock %, active status.

## File Structure
See `handoff.md`, "How it fits together", and `design.md`, "Backend File Structure".

## Decisions Made
The current list, with reasons, is in the submission tracker ("Decisions already made"). Settled early
and still true: SQLite over PostgreSQL (one file, no server, easy handoff); no CSS framework; the model
only on an explicit human trigger.

## Writing Style
No em dashes or en dashes anywhere. The full rule and the other writing rules: `CLAUDE.md` and the
rules in `handoff.md`.

## Current State
Not recorded here, so it cannot go stale here: see the submission tracker for status and next steps,
and `.kiro/DEVLOG.md` for the latest work. Repository: https://github.com/dunstancsr-web/puenzhiyyy
