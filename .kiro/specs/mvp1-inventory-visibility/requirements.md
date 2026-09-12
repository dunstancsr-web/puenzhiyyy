# MVP 1 — Inventory Visibility: Requirements

## Overview
Replace spreadsheet-based rice inventory monitoring with a live dashboard.
The system must give management a real-time view of inventory health across all rice SKUs —
without requiring any AI/LLM. All logic is deterministic.

> **2026-09-12 domain-alignment pass**: a teammate supplied two real-world rice-inventory operations
> documents (see `reference/rice-inventory-technical-spec.md` and
> `reference/rice-inventory-terms-glossary.md`). This requirements doc has been amended to use their
> canonical terminology and fix formula gaps they exposed — see `reference/terminology-map.md` for the
> exact field-by-field diff. REQ-01 through REQ-14 below are updated in place; REQ-15/16/17 are new; the
> "Explicitly Deferred" section at the bottom lists what the source spec covers that MVP1 deliberately
> does not build, and why.

---

## Requirements

### REQ-01 — SQLite Data Layer
The system must store all inventory data in a SQLite database (via better-sqlite3).
The in-memory product store must be replaced entirely.

Acceptance criteria:
- Database file created at `backend/data/stocksense.db` on first run
- Schema covers: SKUs, inventory_batches, sales_transactions, purchase_orders
- Seed script populates at least 10 rice SKUs with realistic data
- Backend restarts without data loss

---

### REQ-02 — Rice SKU Master
Each SKU must capture rice-specific attributes.

Required fields:
- sku_id (unique)
- product_name
- rice_variety (e.g. Thai Hom Mali, Vietnamese Fragrant, Basmati)
- grade
- country_of_origin
- brand
- packaging_size (e.g. 5KG, 10KG, 25KG)
- uom (MT or KG)
- supplier
- min_order_qty
- reorder_point_policy (MT) — the approved/editable operating reorder point (renamed from `reorder_point`; see `reference/terminology-map.md`)
- min_stock (MT)
- target_stock (MT)
- max_stock (MT)
- safety_stock_pct (%)
- lead_time_days (supplier stated)
- active (boolean)

---

### REQ-03 — Inventory Balance
The system must calculate available stock correctly, using the canonical terms from
`reference/rice-inventory-terms-glossary.md` (#4 On Hand, #7 Available Stock).

Formula:
  available_qty = on_hand_qty − reserved_qty − quality_hold_qty

(`on_hand_qty` was `physical_stock`; `available_qty` was `available_stock` — renamed to match the
glossary. `quality_hold_qty` is documented as the one modelled component of the glossary's broader
"Unavailable" bucket — `blocked`/`damaged`/`rejected` statuses are not modelled in MVP1; see "Explicitly
Deferred" below.)

The API must return all three figures plus the derived available figure.

---

### REQ-04 — Sales Velocity
For every SKU, calculate rolling consumption over multiple windows.

Required windows:
- Last 30 days
- Last 60 days
- Last 90 days

Derived metrics:
- avg_daily_usage_30d = sales_30d / 30
- avg_daily_usage_90d = sales_90d / 90
- velocity_trend: "accelerating" | "stable" | "decelerating"
  (accelerating if 30d rate > 90d rate by >10%, decelerating if <10% below)

---

### REQ-05 — Days / Months of Cover
Calculate how long current available stock will last.

(Renamed from "Months/Days of Stock" to match glossary term #22, Days of Cover — see
`reference/terminology-map.md`.)

Formula:
  days_of_cover = available_qty / avg_daily_usage_30d
  months_of_cover = days_of_cover / 30

Edge case: if avg_daily_usage_30d = 0, classify as Idle and display days_of_cover as **"Not
Applicable"** (per glossary term #22 — "when demand is zero, show Not Applicable rather than
infinity"), not a blank or null value. Internally the field may still be `null`; the UI is what must
render "Not Applicable."

---

### REQ-06 — SKU Movement Classification
Every SKU must be automatically assigned a movement class.

Rules (configurable thresholds):
- Fast Moving:   avg_daily_usage_30d >= fast_threshold (default: top 25% of all SKUs)
- Normal:        between slow and fast thresholds
- Slow Moving:   avg_daily_usage_30d > 0 AND days_of_cover > 120
- Idle:          no sales in last 90 days

Note: this is a **velocity** classification, deliberately kept separate from the **economic-value**
ABC classification (new REQ-14 below) — spec Step 8A is explicit that "the two dimensions must remain
separate." The code already computes ABC (`segmentation.js`, `abc_class` column) but this requirement
was missing from this document until now.

Movement class must update on every data refresh.

---

### REQ-07 — Inventory Health Status
Every SKU must receive a health status based on its stock position.

> **2026-09-12 correction**: the backend engine (`health.js`) and the frontend mock
> (`analytics.js: deriveHealthStatus`) had silently diverged — different rule structure, and the mock
> was missing the `max_holding_days` RED trigger entirely. The backend's rule set (below) is now
> canonical; both layers implement it identically. See `reference/terminology-map.md` item 1.

Rules (evaluated top to bottom, first match wins):
- RED:    days_of_cover < lead_time_days, UNLESS an open PO already covers the gap (`covered_by_po`)
          OR inventory_age_days > max_holding_days
          OR movement_class = "Idle" AND available_qty > 0  (idle stock sitting on hand is a risk, not a pass)
- ORANGE: days_of_cover < (lead_time_days + safety_stock_days), UNLESS covered_by_po
          OR on_hand_qty > max_stock
- YELLOW: movement_class = "Slow Moving"
          OR days_of_cover > target_days_of_cover
- GREEN:  everything else

`covered_by_po` = true when there is on-order quantity whose ETA arrives no later than the projected
stockout date — i.e. an inbound PO already resolves what would otherwise be a RED/ORANGE trigger. This
is a deliberate, documented softening of the raw days-of-cover rule (a real but non-emergency gap
shouldn't cry wolf when supply is already inbound).

---

### REQ-08 — Ageing Report
Track how long inventory has been held.

Per SKU (MVP 1 — no batch granularity yet):
- last_received_date
- inventory_age_days = today − last_received_date
- ageing_status: Fresh (0–90d) | Normal (91–180d) | Ageing (181–270d) | At Risk (271d+)

Thresholds are configurable per SKU; defaults above apply if not set.

---

### REQ-09 — Alert Engine
The system must generate typed alerts automatically.

Alert types:
- STOCKOUT_RISK:   days_of_cover < lead_time_days, UNLESS covered_by_po
- REORDER:         inventory_position <= reorder_point_suggested, AND movement_class != "Idle"
                    (compares against the *inventory position* — on-hand + expected incoming — not raw
                    available, so an already-adequate inbound PO doesn't also fire this alert)
- OVERSTOCK:       overstock_qty > 0, AND movement_class != "Idle" (Idle overstock is covered by the
                    IDLE alert instead, to avoid double-alerting the same SKU)
- SLOW_MOVING:     movement_class = "Slow Moving" AND days_of_cover > 120
- IDLE:            movement_class = "Idle" AND available_qty > 0
- AGEING:          ageing_status = "Ageing" or "At Risk"

Each alert must include:
- alert_type
- severity (critical | warning | info)
- sku_id, sku_name
- current value that triggered it
- threshold that was breached
- plain-English message
- recommended_action (short text, rule-based — no LLM)
- triggered_at timestamp

---

### REQ-10 — Management Dashboard
The dashboard must answer key questions within 30 seconds of opening.

Required KPI cards:
- Total active SKUs
- Total inventory value (MT × unit cost)
- Average days of cover (portfolio)
- SKUs at RED status (count)
- SKUs at ORANGE status (count)
- Overstock value ($) — renamed from "Overstocked value" for consistency with `overstock_value`
- Excess & Obsolete inventory value ($) — renamed from "Slow-moving + idle inventory value" to match
  the `eo_value` field it actually reads
- Data Status (as-of timestamp + freshness) — **new**, see REQ-17

See `reference/rice-inventory-terms-glossary.md` Appendix A for the full canonical dashboard-label
reference these are drawn from.

Required charts:
- Inventory health distribution (pie: GREEN / YELLOW / ORANGE / RED counts)
- Top 5 stockout risk SKUs (bar: days of stock remaining)
- Movement classification breakdown (bar: Fast / Normal / Slow / Idle counts)

Required tables:
- Top alerts (most critical first, max 8 rows on dashboard)
- Ageing inventory summary (SKUs with ageing_status = Ageing or At Risk)

---

### REQ-11 — Inventory Table Page
Full product list with filtering, sorting, and inline health indicators.

Features:
- Search by SKU name, variety, supplier
- Filter by: movement class, health status, country of origin
- Sort by: any column
- Inline stock bar showing on-hand vs max stock
- Health status badge (colour-coded)
- Restock modal (add quantity)
- Add new SKU form

---

### REQ-12 — Alerts Page
Dedicated page showing all active alerts.

Features:
- Filter tabs by alert type
- Sort by severity (critical first)
- Each alert card shows: SKU name, alert type, severity badge, triggered value, threshold, plain-English message, recommended action
- Manual dismiss (marks alert as acknowledged, does not delete)

---

### REQ-13 — API Structure
All data served via REST API from Express backend.

Required endpoints:
- GET  /api/skus                  — list all SKUs with computed fields
- GET  /api/skus/:id              — single SKU detail
- POST /api/skus                  — create SKU
- PUT  /api/skus/:id              — update SKU
- GET  /api/dashboard/stats       — KPI summary
- GET  /api/alerts                — all active alerts
- POST /api/alerts/:id/acknowledge — dismiss alert
- GET  /api/inventory             — inventory positions
- POST /api/inventory/restock     — add stock
- GET  /api/sales/velocity        — sales velocity per SKU

---

### REQ-14 — ABC Value Classification
Every active SKU must also receive an **economic-value** classification, independent of the
Fast/Normal/Slow/Idle **velocity** classification in REQ-06 (spec Step 8A: "the two dimensions must
remain separate"). Already implemented in code (`segmentation.js`, `abc_class`/`xyz_class` columns) but
missing from this document until now.

Formula:
  annual_consumption_value = blended_daily_usage × 365 × unit_cost_sgd
  Sort SKUs descending by annual_consumption_value; assign by cumulative % of portfolio total:
    A: cumulative <= 80%   B: cumulative <= 95%   C: remainder

XYZ (demand-predictability) axis, by coefficient of variation of demand: X < 0.25, Y 0.25–0.5, Z > 0.5.

⚠️ **XYZ has no source-document backing** (noted 2026-09-13). It appears in no part of the technical
spec, the glossary or the terminology map; it was implemented in `segmentation.js` first and written
into this requirement afterwards. It is retained only because `xyz_class` is already stored and shown
on the Inventory table. **The management matrix on the dashboard pairs ABC with movement class**, which
is what spec Step 8A item 7 actually prescribes ("Combine ABC class with Fast/Normal/Slow/Idle for
management action"). Do not reintroduce ABC × XYZ without a source-doc basis for the XYZ axis.

---

### REQ-15 — Suggested Order Quantity ✅ 2026-09-12: upgraded to the real formula (TASK-07)
The system must calculate a suggested replenishment quantity per SKU (glossary term #30), not just flag
that reorder is needed.

Formula (the glossary's actual formula, not a proxy — TASK-07's projection engine made this possible):
  suggested_order_qty = max(0, target_stock − projected_available_at_lead_time)

`projected_available_at_lead_time` runs the same projection curve used for REQ-18's chart
(`backend/src/engines/projection.js`) out to `lead_time_days`, so the suggestion already accounts for
any open PO arriving before then — not just today's snapshot. Must be clearly labelled as a
recommendation requiring manager approval, never auto-executed (spec Step 15 / glossary term #42).

---

### REQ-16 — Compliance Position (rice stockpile, simplified)
Rice importers are commonly subject to a regulatory minimum-stockpile requirement (spec Step 11A). MVP1
adds a **simplified, illustrative, portfolio-level** version — not the formally governance-approved rule
the real spec requires — to demonstrate the concept. It's portfolio-level (summed across all active
SKUs) because the real scheme is a company-wide requirement, not a per-SKU one.

Formula:
  compliance_eligible_qty = Σ on_hand_qty across all active SKUs (MVP1 has no blocked/damaged/rejected
                            statuses to exclude — see "Explicitly Deferred" below)
  compliance_required_qty = 2 × Σ(blended_daily_usage across active SKUs) × 30 (placeholder rule —
                            substitutes portfolio demand throughput for real import-receipt history,
                            which this project doesn't have)
  compliance_position      = compliance_eligible_qty − compliance_required_qty

Acceptance criteria:
- Must be visibly labelled "illustrative — pending governance approval of the actual rule, using demand
  as a stand-in for import history" wherever shown, per spec Step 11A's explicit governance requirement.
- Dashboard KPI card, RED if `compliance_position < 0`.

---

### REQ-17 — Data Freshness Indicator
The dashboard must show when its data was last computed (glossary term #39, "Data Status" label in
Appendix A).

Acceptance criteria:
- Every dashboard load surfaces an `as_of` timestamp already computed by the backend
  (`engines/index.js`'s `asOf` field) or, on the frontend-mock path, an equivalent mock timestamp.
- Displayed as a small "Data as of {time}" label — this MVP has no live staleness detection (that needs
  the freshness-state machine from spec Step 18A, deferred — see below), so the label is informational
  only, not a status/health indicator.

---

### REQ-18 — Projected Inventory Curve ✅ 2026-09-12 (TASK-07)
The system must show a dated projection, not one net number (spec Step 12 / glossary term #29), so a
manager can see the first future risk, its size, and its expected recovery — not just today's snapshot.

Formula: `projected_available(day) = available_qty − (blended_daily_usage × day) + Σ open-PO qty
landing on or before that day`, run out 90 days from today. Flat-rate demand, no seasonality — matches
every other engine's demand model in this MVP (documented simplification, not a bug).

Acceptance criteria:
- `GET /api/skus/:id/projection` returns the 90-day curve plus `first_stockout_date`,
  `first_safety_breach_date`, `lowest_position`/`lowest_date`, and `recovery_date`.
- Rendered as a line chart on the SKU detail view (the existing Edit modal — this app has no separate
  detail page, and that modal already carries the SKU's read-only current-position context) with
  reference lines for safety stock, reorder point, and max stock.
- A summary line states the first stockout date in red, or "No stockout projected within 90 days" in
  green when none is projected within the window.
- Feeds REQ-15's `suggested_order_qty` (see above) — same engine function, run to `lead_time_days`
  instead of 90.

---

## Explicitly Deferred (Phase 2/3)

The source technical spec (`reference/rice-inventory-technical-spec.md`) describes a mature enterprise
WMS. The following are real, correct, and **consciously out of scope** for this hackathon MVP — not
overlooked. Each links to the spec step it comes from.

| Deferred capability | Spec step | Why deferred now |
|---|---|---|
| Append-only movement ledger (immutable, rebuildable balances) | Step 2 | `inventory_positions` stays a mutable snapshot table; a real ledger is a schema/engine rewrite, not a naming pass, and isn't demo-visible |
| Lot/batch genealogy, FEFO allocation | Steps 1, 6 | No lot concept anywhere in the current schema; rice repacking mass-balance and lot tracking are a substantial data-model addition |
| Mobile receiving / barcode workflow | Step 4B | Needs a device-facing workflow and offline sync — a separate app surface |
| Import clearance & customs milestones | Step 4A | Depends on external document/permit integrations out of this project's control |
| Full quality/stock-status taxonomy (blocked, damaged, rejected, in eligible/ineligible splits) | Step 3 | MVP1 models only reserved + quality-hold; the rest needs workflow screens to actually move stock between statuses |
| Statistically backtested demand forecasting (vs. today's blended 30/90-day average) | Step 10 | Needs a forecasting service with backtest harness — a model-building project of its own; the projection curve (REQ-18) still uses this flat blended rate as its demand input |
| Governance-approved compliance rule (vs. REQ-16's illustrative placeholder) | Step 11A | Requires an actual compliance owner to approve the real formula, scope, and effective date — not a technical decision |
| Agent execution governance (tool-permission tiers, idempotent execution, approval-token workflow) | Steps 14-15 | No agent exists yet in this codebase (TASK-11 "Ask AI" is still open); when it's built it must follow this spec's permitted/prohibited list and approval contract, but there's nothing to govern yet |
| Freshness state machine (current/delayed/stale/unreconciled/unavailable) | Step 18A | REQ-17 above ships only the as-of *timestamp*; the full staleness-detection behaviour needs monitoring infrastructure this project doesn't have |
| Full audit/reconciliation controls (daily opening=closing checks, idempotency keys, duplicate-replay protection) | Steps 2, 7, 18 | No ledger to reconcile yet (see row 1); `audit_log` exists but isn't schema-validated per event type |

---

### Non-Functional Requirements
- No LLM calls in MVP 1. All logic is rules-based and deterministic.
- Backend must restart cleanly without data loss (SQLite file persists).
- Seed data must use realistic rice SKU names, suppliers, and quantities.
- All monetary values in SGD.
- UOM: metric tonnes (MT) for bulk rice, KG for retail packs.
