# MVP 1 — Inventory Visibility: Design

> **2026-09-12 domain-alignment pass**: schema columns and formulas below are updated to the canonical
> names/definitions from `reference/rice-inventory-terms-glossary.md`, per
> `reference/terminology-map.md`. Old names are struck through inline where it helps orient anyone
> reading the git history; the authoritative current names are what's in the SQL/code blocks.

## Architecture Overview

```
SQLite DB (stocksense.db)
       ↓
Express API (port 4000)
  ├── /api/skus
  ├── /api/dashboard/stats
  ├── /api/alerts
  ├── /api/inventory
  └── /api/sales/velocity
       ↓
React Frontend (port 5173)
  ├── Dashboard page
  ├── Inventory page
  └── Alerts page
```

All computation happens in the backend. The frontend only renders.

---

## Database Schema

### Table: skus
```sql
CREATE TABLE skus (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  sku_id           TEXT UNIQUE NOT NULL,
  product_name     TEXT NOT NULL,
  rice_variety     TEXT,
  grade            TEXT,
  country_of_origin TEXT,
  brand            TEXT,
  packaging_size   TEXT,
  uom              TEXT DEFAULT 'MT',
  supplier         TEXT,
  min_order_qty        REAL DEFAULT 0,
  reorder_point_policy REAL DEFAULT 0,  -- was `reorder_point`; the approved/editable operating value (glossary #28)
  min_stock            REAL DEFAULT 0,
  target_stock         REAL DEFAULT 0,
  max_stock            REAL DEFAULT 0,
  safety_stock_pct     REAL DEFAULT 20,
  lead_time_days       INTEGER DEFAULT 45,
  unit_cost_sgd        REAL DEFAULT 0,
  max_holding_days     INTEGER DEFAULT 270,
  active               INTEGER DEFAULT 1,
  strategic_adjustment REAL DEFAULT 0,  -- Phase 2 placeholder: price intelligence adjustment (MT)
  compliance_required_qty REAL,  -- cached on refresh: 2x trailing-3mo avg monthly receipts (REQ-16, illustrative rule)
  created_at           TEXT DEFAULT (datetime('now'))
);
```

### Table: inventory_positions
```sql
CREATE TABLE inventory_positions (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  sku_id           TEXT NOT NULL,
  on_hand_qty      REAL DEFAULT 0,  -- was `physical_stock` (glossary #4, On Hand)
  reserved_qty     REAL DEFAULT 0,
  quality_hold_qty REAL DEFAULT 0,  -- one modelled component of glossary's broader "Unavailable" (#6); blocked/damaged/rejected are Phase 2
  last_received_date TEXT,
  last_updated     TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (sku_id) REFERENCES skus(sku_id)
);
```

### Table: sales_transactions
```sql
CREATE TABLE sales_transactions (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  sku_id       TEXT NOT NULL,
  quantity_mt  REAL NOT NULL,
  sale_date    TEXT NOT NULL,
  customer     TEXT,
  channel      TEXT,
  status       TEXT DEFAULT 'fulfilled',
  FOREIGN KEY (sku_id) REFERENCES skus(sku_id)
);
```

### Table: purchase_orders
```sql
CREATE TABLE purchase_orders (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  po_number        TEXT UNIQUE,
  sku_id           TEXT NOT NULL,
  ordered_qty      REAL,
  order_date       TEXT,
  eta              TEXT,
  status           TEXT DEFAULT 'open',
  FOREIGN KEY (sku_id) REFERENCES skus(sku_id)
);
```

### Table: decisions
```sql
CREATE TABLE decisions (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  sku_id            TEXT NOT NULL,
  trigger_type      TEXT,
  ai_recommendation TEXT,
  ai_quantity       REAL,
  manager_action    TEXT,    -- approved / modified / rejected
  manager_quantity  REAL,
  manager_reason    TEXT,
  decided_by        TEXT,
  decided_at        TEXT DEFAULT (datetime('now')),
  outcome_notes     TEXT,
  strategic_adjustment REAL DEFAULT 0  -- Phase 2 placeholder, always 0 in MVP 1
);
```

### Table: audit_log
```sql
CREATE TABLE audit_log (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  event_type   TEXT NOT NULL,   -- e.g. LLM_CALL, ALERT_TRIGGERED, RESTOCK
  sku_id       TEXT,
  input_data   TEXT,            -- JSON string of inputs used
  output_data  TEXT,            -- JSON string of result/response
  created_at   TEXT DEFAULT (datetime('now'))
);
```

### Table: alerts_log
```sql
CREATE TABLE alerts_log (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  sku_id            TEXT NOT NULL,
  alert_type        TEXT NOT NULL,
  severity          TEXT NOT NULL,
  message           TEXT,
  recommended_action TEXT,
  triggered_value   REAL,
  threshold_value   REAL,
  acknowledged      INTEGER DEFAULT 0,
  triggered_at      TEXT DEFAULT (datetime('now'))
);
```

---

## Backend File Structure

```
backend/src/
├── db/
│   ├── init.js          # creates tables, runs on startup
│   └── seed.js          # inserts 10 rice SKUs + 6 months of mock sales
├── engines/
│   ├── velocity.js      # calculates sales velocity per SKU
│   ├── health.js        # assigns GREEN/YELLOW/ORANGE/RED per SKU
│   ├── classification.js # assigns Fast/Normal/Slow/Idle per SKU
│   └── alerts.js        # generates alerts from health + classification
├── routes/
│   ├── skus.js
│   ├── inventory.js
│   ├── alerts.js
│   ├── sales.js
│   └── dashboard.js
└── index.js
```

---

## Key Computation Logic

> Field names and formulas below match `reference/rice-inventory-terms-glossary.md`; see
> `reference/terminology-map.md` for the full rename diff and the reasoning behind each one.

### Available Stock (glossary #7)
```
available_qty = on_hand_qty - reserved_qty - quality_hold_qty
```

### Inventory Position (glossary #18) and Expected Incoming (glossary #15)
```
expected_incoming_qty = SUM(ordered_qty) WHERE purchase_orders.status = 'open'   -- was two separate
                                                                                   aliases: `on_order`
                                                                                   and `incoming_stock`
inventory_position = available_qty + expected_incoming_qty
```
Simplification, documented: the glossary's full formula subtracts "unreserved outstanding demand" too
— MVP1 has no separate confirmed-order tracking distinct from `reserved_qty`, so that term is always
zero here. Not a bug; a scoped-out capability (see requirements.md "Explicitly Deferred").

### Sales Velocity
```
sales_30d = SUM(quantity) WHERE sale_date >= today - 30
avg_daily_30d = sales_30d / 30

velocity_trend:
  if avg_daily_30d > avg_daily_90d * 1.10 → "accelerating"
  if avg_daily_30d < avg_daily_90d * 0.90 → "decelerating"
  else → "stable"
```

### Days / Months of Cover (glossary #22 — renamed from "Days/Months of Stock")
```
days_of_cover = available_qty / avg_daily_30d
(displayed as "Not Applicable" in the UI if avg_daily_30d = 0, per glossary #22 — not left blank/null)
months_of_cover = days_of_cover / 30
```

### Reorder Point (glossary #28) and Suggested Order Quantity (glossary #30)
```
reorder_point_suggested = lead_time_demand_mt + safety_stock_mt     -- system-calculated (was `reorder_point_calc`)
reorder_point_policy    = the approved, editable value on the SKU record (was the `reorder_point` column)
suggested_order_qty     = max(0, target_stock - projected_available_at_lead_time)  -- glossary's full formula
                                                                       (see Projected Inventory below; upgraded
                                                                       2026-09-12 from a snapshot-based proxy)
```
`reorder_point_suggested` is shown alongside `reorder_point_policy` for comparison — alerts and health
status key off the **policy** value (the approved operating level), matching the source spec's
raw-vs-approved pattern (Step 11).

### Projected Inventory (glossary #29 / spec Step 12 — REQ-18, TASK-07)
```
projected_available(day) = available_qty - (blended_daily_usage * day)
                            + Σ open-PO qty landing on or before that day
```
Run flat-rate 90 days out (`backend/src/engines/projection.js`), exposed at
`GET /api/skus/:id/projection`; also run out to just `lead_time_days` to produce
`suggested_order_qty` above — same function, two callers (`engines/index.js` and the route). Surfaced
as a line chart with reference lines (safety stock, reorder point, max stock) in the SKU edit modal —
this app has no separate SKU detail page, so the existing edit modal (which already carries read-only
current-position context) doubles as the detail view.

### Health Status (glossary Appendix A / spec Step 13 triggers; evaluated top to bottom, first match wins)

> **2026-09-12 correction**: the backend engine and the frontend mock had silently diverged. This is
> now the single reconciled rule set both layers implement — see `reference/terminology-map.md` item 1.

```
RED    if days_of_cover < lead_time_days, UNLESS covered_by_po
       OR inventory_age_days > max_holding_days
       OR movement_class = "Idle" AND available_qty > 0
ORANGE if days_of_cover < (lead_time_days + safety_stock_days), UNLESS covered_by_po
       OR on_hand_qty > max_stock
YELLOW if movement_class = "Slow Moving"
       OR days_of_cover > target_days_of_cover
GREEN  otherwise
```
`covered_by_po` = an open PO's ETA arrives no later than the projected stockout date — softens the RED/
ORANGE triggers when supply is already inbound, so a real-but-non-emergency gap doesn't over-alarm.

### Movement Classification (velocity — kept separate from the ABC value classification below)
```
Idle        if no sales in 90 days
Slow Moving if avg_daily_30d > 0 AND days_of_cover > 120
Fast Moving if avg_daily_30d >= p75 of all active SKUs
Normal      otherwise
```

### ABC Value Classification (spec Step 8A)
```
annual_consumption_value = blended_daily_usage * 365 * unit_cost_sgd
ABC: sort descending by annual_consumption_value, assign by cumulative % of portfolio total
     A <= 80%   B <= 95%   C remainder
```

**Management matrix: ABC × movement class.** Per spec Step 8A item 7 — "Combine ABC class with
Fast/Normal/Slow/Idle for management action" — and its interpretation table (A+fast: frequent review and
strong availability control; A+idle: immediate purchasing stop and disposition review; C+fast: simple
efficient replenishment; C+idle: low-priority discontinuation/clearance). Built by
`segmentation.js → buildMatrix`, surfaced as `stats.abcMovementMatrix`.

> **Provenance correction, 2026-09-13.** Until this date the dashboard showed an **ABC × XYZ** matrix,
> and this section described it as if specified. It was not. XYZ (demand predictability by coefficient
> of variation) appears nowhere in the technical spec, the glossary or the terminology map — it was
> written in `segmentation.js` first and back-filled into REQ-14 afterwards, under a heading about ABC.
> On the 10-SKU portfolio it also left 5 of 9 cells empty, including both AZ and BZ, the cells the
> widget's own caption told the reader to act on. The matrix now uses the axis the spec actually asks
> for. `xyz_class` is still computed and still shown on the Inventory table (REQ-14 documents it); it
> simply no longer drives this matrix.

### Compliance Position (glossary #38 / spec Step 11A — new, simplified & illustrative)

A **portfolio-level** figure (the real Singapore rice-stockpile scheme is a company-wide requirement
across all SKUs, not a per-SKU one — spec Step 11A: "compliance applicability by SKU/grade/importer
licence/warehouse/ownership" describes the *scope* a real rule can narrow to, but the pitch-deck-level
"two months of import volume" description is inherently an aggregate figure).

```
compliance_eligible_qty = Σ on_hand_qty across all active SKUs
                           (MVP1 has no blocked/damaged/rejected statuses to exclude yet)
compliance_required_qty = 2 * Σ(blended_daily_usage across active SKUs) * 30
                           -- placeholder rule; substitutes portfolio demand throughput for real import-
                           -- receipt history, which this project doesn't have. Honestly labelled below.
compliance_position     = compliance_eligible_qty - compliance_required_qty
```
Must always render with an **"illustrative — pending governance approval of the actual rule, using
demand as a stand-in for import history"** label (spec Step 11A requires a formally approved rule
before any real compliance figure is presented as authoritative).

---

## Seed Data Plan (10 Rice SKUs)

| SKU ID     | Product                  | Variety           | Origin    | Supplier          |
|------------|--------------------------|-------------------|-----------|-------------------|
| TJ-25KG    | Thai Jasmine 25KG        | Thai Hom Mali     | Thailand  | Supplier ABC TH   |
| TJ-10KG    | Thai Jasmine 10KG        | Thai Hom Mali     | Thailand  | Supplier ABC TH   |
| VF-25KG    | Vietnam Fragrant 25KG    | Vietnamese Fragrant | Vietnam | Supplier DEF VN   |
| VF-10KG    | Vietnam Fragrant 10KG    | Vietnamese Fragrant | Vietnam | Supplier DEF VN   |
| BM-5KG     | Basmati Premium 5KG      | Basmati           | India     | Supplier GHI IN   |
| BM-25KG    | Basmati Bulk 25KG        | Basmati           | India     | Supplier GHI IN   |
| JP-5KG     | Japonica Short Grain 5KG | Japonica          | Japan     | Supplier JKL JP   |
| TW-25KG    | Thai White Rice 25KG     | Thai White        | Thailand  | Supplier ABC TH   |
| PH-25KG    | Philippine Sinandomeng   | Sinandomeng       | Philippines | Supplier MNO PH |
| BR-10KG    | Brown Rice Organic 10KG  | Brown             | Thailand  | Supplier ABC TH   |

Seed data should include:
- 180 days of sales transactions per SKU (varying volumes to create velocity patterns)
- Deliberate scenarios: TJ-25KG near stockout, VF-10KG overstocked, JP-5KG idle >90 days, BM-5KG ageing

---

## Frontend Page Designs

### Dashboard
- Top: 7 KPI stat cards in a responsive grid
- Middle: 2 charts side by side (health pie + stockout risk bar)
- Bottom left: Top 8 alerts table
- Bottom right: Ageing inventory list

### Inventory Page
- Header with search + filters
- Full SKU table with: name, variety, origin, physical stock, available stock, days of stock, movement class, health badge, actions
- Restock modal
- Add SKU modal

### Alerts Page
- Summary count cards (one per alert type)
- Filter tabs
- Alert cards with left colour border by severity
- Acknowledge button per alert

---

## Appendix D — Canonical Dashboard Labels

From `reference/rice-inventory-terms-glossary.md` Appendix A — the label a user reads on screen, mapped
to the field it must never be confused with.

| Dashboard label | Field | Never combine with |
|---|---|---|
| On Hand | `on_hand_qty` | Expected Incoming (current physical vs. future supply) |
| Available | `available_qty` | Projected Stock (current usable vs. future-date estimate) |
| Reserved | `reserved_qty` | Actual Stock Out (reservation ≠ dispatch) |
| Expected Incoming | `expected_incoming_qty` | On Hand |
| Days of Cover | `days_of_cover` | — |
| Suggested Order | `suggested_order_qty` | An already-approved action — this is a recommendation |
| Compliance Position | `compliance_position` | Safety Stock (regulatory buffer ≠ operating buffer) |
| Data Status | `as_of` timestamp | A live freshness/health indicator (MVP1 shows the timestamp only — see requirements.md REQ-17) |

## Appendix E — Roadmap Beyond This Pass

Mirrors the source spec's own delivery roadmap (`reference/rice-inventory-technical-spec.md` Appendix
C), scoped to what's realistic after the hackathon rather than the full enterprise sequence:

| Phase | Scope | Depends on | Status |
|---|---|---|---|
| Done | Canonical terminology, formula reconciliation, Suggested Order Qty (proxy), illustrative Compliance Position, Data Status timestamp | — | ✅ |
| Done | Wire frontend to the real backend (TASK-09/10) | Terminology pass | ✅ |
| Done | Approval workflow persistence (TASK-12) — decisions durably recorded, independent of the AI layer | Backend wiring | ✅ |
| Done | Real projected-inventory curve (TASK-07) — `suggested_order_qty` now exact, not a proxy | Backend wiring | ✅ |
| Next | Agent layer (TASK-11 "Ask AI") built to the spec's Step 14/15 permission model | An LLM API key (blocked — see `tasks.md` TASK-11) | ⏸ |
| Then | Append-only movement ledger (spec Step 2) — replaces the mutable `inventory_positions` snapshot | Real usage/demand for audit trail | — |
| Then | Lot/batch tracking, full stock-status taxonomy (blocked/damaged/rejected) | Movement ledger | — |
| Then | Governance-approved Compliance Position rule (replaces REQ-16's placeholder) | A compliance owner, not a technical blocker | — |
| Then | Statistically backtested demand forecasting — replaces the flat blended-rate demand input the projection curve (REQ-18) currently uses | A model-building effort of its own | — |
