---
inclusion: always
---

# Project: StockSense — Agentic Rice Inventory Management System

## Hackathon Context
- Event: AWS NUS-ISS SMYA 2026 Hackathon
- Submission deadline: 28 September 2026
- Submission requires: GitHub repo, YouTube demo video, PDF write-up, deployment URL
- Team: Stan (you) + Tawmo (second developer) + 2 others
- Stan works independently from Tawmo to avoid file conflicts

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
- Available stock ≠ physical stock. Available = Physical − Reserved − Quality Hold
- Days of inventory = Available stock / Forecast daily demand
- Reorder Point = Lead-Time Demand + Safety Stock
- Inventory Position = Available + Incoming − Committed demand
- Health statuses: GREEN (healthy), YELLOW (watch), ORANGE (action required), RED (critical)
- SKU movement classes: Fast Moving, Normal, Slow Moving, Idle/Non-Moving
- Triggers: Stockout Risk, Reorder, Excess Stock, Slow Moving, Idle, Ageing, Quality Risk, Supplier Delay, Demand Surge, Demand Collapse

## Rice SKU Data Model (MVP 1)
Each SKU has: SKU ID, product name, rice variety, grade, country of origin, brand, packaging size, UOM, supplier, min order qty, reorder point, min stock, max stock, safety stock %, active status.

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
│   └── specs/            # feature specs
├── DEVLOG.md             # auto-updated by hook on session end
└── README.md
```

## Decisions Made
- SQLite chosen over PostgreSQL: zero server setup, single file, easy to hand off
- In-memory store (products.js) to be replaced with SQLite in MVP 1 rebuild
- No Tailwind: plain CSS variables for portability and simplicity
- LLM delayed until explicit user trigger to minimise token costs
- Stan develops independently from Tawmo until results are proven

## Current State
- Boilerplate built: React frontend + Express backend + 10 seeded products
- Pages: Dashboard, Inventory table, Alerts
- GitHub repo: https://github.com/dunstancsr-web/puenzhiyyy
- Next: Replace mock data with SQLite, update data model to rice SKUs, build MVP 1 properly
