---
inclusion: always
---

# Project: StockSense — Agentic Rice Inventory Management System

## Hackathon Context
- Event: AWS NUS-ISS SMYA 2026 Hackathon
- Deadlines and deliverable status: `docs/(Stan) 1 Reference/(Stan) SUBMISSION TRACKER.md`
- Submission requires: GitHub repo, YouTube demo video, PDF write-up, deployment URL
- Team: Stan (you) + Taw (second developer) + 2 others
- Stan works independently from Taw to avoid file conflicts

## Business Problem
Rice importer/distributor needs to move from reactive spreadsheet-based inventory management to a proactive, AI-assisted system.
Two competing objectives:
- Customer fulfilment (avoid stockouts)
- Working capital efficiency (avoid excess stock, ageing, storage costs)

## MVP Scope — Currently Building: MVP 1 (Inventory Visibility)
Replace spreadsheet monitoring with a live dashboard. No AI/LLM yet at this stage.

MVP 1 deliverables:
- Central data model (SQLite)
- Inventory balance per SKU
- Historical usage / sales velocity
- Months of stock remaining
- Fast / Normal / Slow / Idle SKU classification
- Ageing report (by batch received date)
- Management dashboard with health status (GREEN / YELLOW / ORANGE / RED)
- Alert engine (stockout risk, overstock, slow-moving, idle, ageing)

After MVP 1 is solid → MVP 2 adds demand forecasting, lead-time intelligence, safety stock, reorder points, projected stock curve.

## LLM / AI Usage Principle
- 90% of logic is deterministic (calculations, rules, thresholds)
- LLM activates ONLY when a human explicitly clicks "Why?" or "What should I do?" on a flagged SKU
- This is intentional: target users are SMEs with limited token budgets
- For the hackathon demo: implement one clear, obvious AI/LLM interaction that wows judges (natural language explanation of a recommendation)
- Judging criteria to optimise for: Architecture & Reasoning Loop, Tool Use & Integration, Autonomy & Human-in-the-Loop, Observability

## Tech Stack
- Frontend: React 18 + Vite (port 5173) + Recharts + Lucide React + React Router v6
- Backend: Node.js + Express (port 4000)
- Database: SQLite (via better-sqlite3) — replaces in-memory store
- LLM: Kiro's built-in model (used sparingly, only on explicit human trigger)
- Styling: Plain CSS variables (no Tailwind, no CSS frameworks)

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
- Triggers: Stockout Risk, Reorder, Overstock, Slow Moving, Idle, Ageing, Quality Risk, Supplier Delay,
  Demand Surge, Demand Collapse.
- What StockSense deliberately does **not** model yet: an immutable movement ledger (balances are a
  mutable snapshot, not rebuildable from history), lot/batch genealogy, blocked/damaged/rejected stock
  statuses, agent execution governance. See the spec's "Explicitly Deferred" section for the full list
  and why — these are scoped-out, not missed.

## Rice SKU Data Model (MVP 1)
Each SKU has: SKU ID, product name, rice variety, grade, country of origin, brand, packaging size, UOM, supplier, min order qty, reorder point policy, min stock, max stock, safety stock %, active status.

## File Structure
```
puenzhiyyy/
├── backend/
│   ├── src/
│   │   ├── data/         # seed data and DB setup
│   │   ├── routes/       # Express routes
│   │   └── index.js
│   └── package.json
├── frontend/
│   ├── src/
│   │   ├── api/          # fetch calls to backend
│   │   ├── components/   # shared UI (Layout, Sidebar, StatCard, Badge)
│   │   ├── pages/        # Dashboard, Inventory, Alerts
│   │   └── App.jsx
│   └── package.json
├── .kiro/
│   ├── hooks/            # auto devlog, lint, commit reminder
│   ├── steering/         # this file — always loaded
│   ├── specs/            # feature specs
│   └── DEVLOG.md         # dated development log
├── docs/
│   ├── (Stan) 1 Reference/  # Stan's tracker, deploy checklist, spend ledger
│   ├── (Stan) 2 To review/  # drafts waiting for Stan's comments
│   └── Submission/          # the judges' write-up and its images
├── CLAUDE.md             # agent onboarding, must stay at the root
└── README.md
```

## Decisions Made
- SQLite chosen over PostgreSQL: zero server setup, single file, easy to hand off
- In-memory store (products.js) to be replaced with SQLite in MVP 1 rebuild
- No Tailwind: plain CSS variables for portability and simplicity
- LLM delayed until explicit user trigger to minimise token costs
- Stan develops independently from Taw until results are proven

## Writing Style (added 2026-09-12, user feedback)
Do not use an em dash or an en dash anywhere in this project: not in UI copy, not in code comments, not
in commit messages, not in this file. The user flagged heavy dash use as an obvious "AI vibes" tell.
Use a plain hyphen, a comma, a colon, parentheses, or split into two sentences instead. This applies to
new writing going forward; it is not a mandate to rewrite every existing comment in one pass.

## Current State
- Boilerplate built: React frontend + Express backend + 10 seeded products
- Pages: Dashboard, Inventory table, Alerts
- GitHub repo: https://github.com/dunstancsr-web/puenzhiyyy
- Next: Replace mock data with SQLite, update data model to rice SKUs, build MVP 1 properly
