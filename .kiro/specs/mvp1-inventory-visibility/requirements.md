# MVP 1 — Inventory Visibility: Requirements

## Overview
Replace spreadsheet-based rice inventory monitoring with a live dashboard.
The system must give management a real-time view of inventory health across all rice SKUs. Every
figure, status and alert is deterministic.

> **2026-09-15 scope update**: the build grew past visibility. REQ-19 to REQ-24 at the end cover what
> was added between 13 and 15 Sep: warehouse floor movements, inventory history, bulk edit, the
> explanation layer, paid model access, and deployment. The original "no LLM" rule is replaced by
> REQ-21: a model may explain an alert, and may never compute a figure or take an action. Detailed
> design for each lives in `design.md`; the reasoning behind each change is in `.kiro/DEVLOG.md`.

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

Derived: a daily demand rate per window, and a velocity trend (accelerating, stable, decelerating).
Only fulfilled sales count; lost sales feed fill rate. The 30 day average is the one demand rate every
other requirement uses.

**Formulas: design.md, "Sales Velocity".**

---

### REQ-05 — Days / Months of Cover
Calculate how long current available stock will last.

(Renamed from "Months/Days of Stock" to match glossary term #22, Days of Cover — see
`reference/terminology-map.md`.)

**Formulas: design.md, "Days / Months of Cover".**

Acceptance: when there is no demand, days of cover displays as **"Not Applicable"** (glossary term #22,
"when demand is zero, show Not Applicable rather than infinity"), never a blank, zero or infinity.
Internally the field may be `null`; the UI must render "Not Applicable". (An earlier line here also
said zero 30 day demand means Idle; it contradicted REQ-06 and was removed on 15 Sep. Idle is defined
by REQ-06 alone.)

---

### REQ-06 — SKU Movement Classification
Every SKU must be automatically assigned a movement class.

Four classes, Idle, Slow Moving, Fast Moving and Normal, where Slow Moving means too much stock for
the SKU's own demand. **Rules: design.md, "Movement Classification"** (decision history in "Formula
decisions").

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

Four statuses, RED (critical), ORANGE (action required), YELLOW (watch), GREEN (healthy), evaluated
in order, first match wins. Idle stock sitting on hand must count as a risk, not a pass, and an inbound
purchase order that lands before stock runs out must soften the stockout triggers so a covered gap
does not over-alarm. **Rules: design.md, "Health Status"; `covered_by_po` in "Supporting Formulas".**

---

### REQ-08 — Ageing Report
Track how long inventory has been held.

Per SKU (MVP 1 — no batch granularity yet):
- last_received_date
- inventory_age_days = today − last_received_date
- ageing_status: Fresh (0–90d) | Normal (91–180d) | Ageing (181–270d) | At Risk (271d+)

Thresholds are configurable per SKU; defaults above apply if not set.

**Open decision (15 Sep):** the code instead scales the bands to each SKU's holding limit (design.md,
"Supporting Formulas"), which starts At Risk at 243 days for a 270 day limit. When Stan decides, the
losing definition is removed and only design.md keeps the formula.

---

### REQ-09 — Alert Engine
The system must generate typed alerts automatically.

Alert types:
- STOCKOUT_RISK:   days_of_cover < lead_time_days, UNLESS covered_by_po
- REORDER:         inventory_position <= reorder_point_policy, AND movement_class != "Idle",
                    AND the SKU has no STOCKOUT_RISK alert (stockout is the more urgent form of the
                    same problem, so one SKU never carries both)
                    (compares the *inventory position*, meaning available stock plus expected incoming,
                    so an already-adequate inbound PO doesn't also fire this alert; and compares it
                    against the APPROVED reorder point a manager sets, not the calculated
                    reorder_point_suggested, which is shown as advice. Changed 15 Sep 2026, TASK-95:
                    this line previously said suggested, contradicting design.md, the explanation
                    trace and the editable Reorder point field.)
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
- Request-order modal (raise a request to the buyer; records intent, never changes stock — Reorder
  Loop step 7. Replaced the earlier Restock modal, which added stock from the office and was removed
  when the warehouse-write vs Control-Tower-read duties were separated)
- Add new SKU form

---

### REQ-12 — Alerts Page
Dedicated page showing all active alerts.

Features:
- Filter tabs by alert type
- Sort by severity (critical first)
- Each alert card shows: SKU name, alert type, severity badge, triggered value, threshold, plain-English message, recommended action
- Manual dismiss (marks alert as acknowledged, does not delete)
- Approve, Modify (quantity and reason) or Reject each recommendation; the decision is stored beside
  what the system proposed (see `decisions` in design.md)
- **Why?** on each alert opens the explanation described in REQ-21

---

### REQ-13 — API Structure
All data served via REST API from Express backend.

Two route files with opposite shapes: `backend/src/routes/inventory.js` serves the Control Tower,
`backend/src/routes/warehouse.js` the handheld floor. **The route files are the source of truth for the
endpoint list**; this is the shape as of 15 Sep.

- SKUs: `GET /api/skus`, `GET /api/skus/:id`, `GET /api/skus/:id/projection`, `POST /api/skus`,
  `PUT /api/skus/:id`, CSV `GET /api/skus/export` and `POST /api/skus/import`, history CSV
  `GET /api/skus/history/export` and `POST /api/skus/history/import`
- Dashboard: `GET /api/dashboard/stats`, `GET /api/dashboard/history`
- Alerts and decisions: `GET /api/alerts`, `POST /api/alerts/:id/acknowledge`, `GET /api/decisions`,
  `POST /api/decisions`
- Order requests (Reorder Loop step 7, the Control Tower's one write, no stock change):
  `POST /api/order-requests`, `GET /api/order-requests`. (`POST /api/inventory/restock` was removed
  here when the duties were separated: the office no longer writes stock; stock moves only on the
  warehouse floor.)
- Explanations: `POST /api/alerts/explain`, `GET /api/llm/mode`, `POST /api/llm/unlock`
- Audit: `GET /api/audit`
- Warehouse floor: `POST /api/warehouse/login`, `GET /api/warehouse/operators`,
  `GET /api/warehouse/inbound`, `POST /api/warehouse/inbound/receive`, `GET /api/warehouse/outbound`,
  `POST /api/warehouse/outbound/pick`, `GET /api/warehouse/movements`
- `GET /api/health`. (`/api/products` is a legacy in-memory demo store, unrelated to the schema.)

---

### REQ-14 — ABC Value Classification
Every active SKU must also receive an **economic-value** classification, independent of the
Fast/Normal/Slow/Idle **velocity** classification in REQ-06 (spec Step 8A: "the two dimensions must
remain separate"). Already implemented in code (`segmentation.js`, `abc_class`/`xyz_class` columns) but
missing from this document until now.

A, B or C by each SKU's share of annual consumption value (a Pareto split), plus the XYZ
demand-predictability axis. **Formulas: design.md, "ABC Value Classification" and "Supporting
Formulas".**

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

The glossary's actual formula, not a proxy: it tops stock back up to target as projected at the
moment a new order would arrive, so it accounts for sales during the wait and any purchase order
landing before then. **Formula: design.md, "Reorder Point and Suggested Order Quantity".** Must be clearly labelled as a
recommendation requiring manager approval, never auto-executed (spec Step 15 / glossary term #42).

---

### REQ-16 — Compliance Position (rice stockpile, simplified)
Rice importers are commonly subject to a regulatory minimum-stockpile requirement (spec Step 11A). MVP1
adds a **simplified, illustrative, portfolio-level** version — not the formally governance-approved rule
the real spec requires — to demonstrate the concept. It's portfolio-level (summed across all active
SKUs) because the real scheme is a company-wide requirement, not a per-SKU one.

Eligible stock minus a placeholder requirement that uses portfolio demand as a stand-in for real
import history. **Formula: design.md, "Compliance Position".**

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

Run out 90 days from today at a flat demand rate with open purchase orders landing on their ETA
(no seasonality, a documented simplification). **Formula: design.md, "Projected Inventory".**

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

### REQ-19 - Warehouse Floor Movements (handheld) ✅ 2026-09-13 (TASK-46, TASK-47)
Receiving and picking on a handheld, attributed to a named operator.

- Operators sign in with a four digit PIN (shared rugged device; demo PINs shown on screen, labelled
  as a prototype affordance)
- **Goods In**: receive against an open purchase order in four steps (pick the delivery, verify the
  SKU, count, confirm). Adds to `on_hand_qty` and closes the PO
- **Goods Out** (API built; handheld screens not yet, shown as "Coming soon" on Home): pick against
  an open sales order. Removes from `on_hand_qty` and `reserved_qty`;
  cannot ship more than is physically on hand
- A quantity different from the expected one is allowed (short and over deliveries happen) but must
  carry a variance reason
- Every movement gets a sequential document number (GRN-0001, DN-0001), a `goods_movements` row, and a
  GOODS_RECEIVED or GOODS_ISSUED audit event with operator and variance

---

### REQ-20 - Inventory History and Trends ✅ 2026-09-14 (TASK-85, TASK-86)
- 24 months of monthly balances per SKU (opening, receipts, issues, closing, unit cost), seeded so
  every period balances and the newest closing equals today's on-hand
- The Dashboard hero chart shows closing inventory value per month, split into stock that arrived that
  month and stock carried over (FIFO), with 6M, YTD, 12M and ALL windows
- Trend arrows on Key Metrics come from stored history, never from hand-set prior values
- History can be exported and re-imported as CSV

---

### REQ-21 - Alert Explanations ("Why?") ✅ 2026-09-15 (TASK-11, 42 to 45, 89, 95 to 99)
- **Why?** on any alert shows a rule-based explanation at once: four plain-English steps (what we see,
  how we worked it out, if we do nothing, what to do), built from the SKU's live figures. It needs no
  model and is always available
- A model summary may be requested in addition. Three tiers, chosen per visitor: Rule-based, Local
  model (Ollama, development only), AWS Bedrock (paid, REQ-22)
- **The model never computes and never acts.** It must not be able to state a figure the engines did
  not produce; it must not re-pair figures into a false statement of why the alert fired; it must
  state the approved action and never claim an action was already taken; it must not invent costs or
  urgency no figure supports
- Any answer failing those checks is retried, then replaced by the rule-based explanation. A wrong
  figure is never shown
- Each explanation is cached per alert and figures, and every model call, failed attempts included,
  is written to the audit trail with its tokens

---

### REQ-22 - Paid Model Access and Spend ✅ 2026-09-15 (TASK-90, TASK-93)
- On a public server, the paid tier requires a demo PIN checked server side. Wrong guesses lock the
  client out, and repeated failures pause unlocking for everyone. A correct PIN grants a time-limited
  pass for that browser tab only
- One visitor's tier choice never changes another visitor's
- A daily cap bounds paid calls across all visitors
- Paid spend is computed from the audit trail (`backend/scripts/spend.js`) and recorded in the spend
  ledger; no paid call is made for testing without Stan's approval

---

### REQ-23 - Bulk Edit by CSV ✅ 2026-09-14 (TASK-60)
- Export every SKU's editable fields to CSV, edit in a spreadsheet, import back
- Computed columns in the export are for context and ignored on import
- An import is validated before anything is written, and changes are audited

---

### REQ-24 - Deployment ✅ image ready 2026-09-15 (TASK-33, 34, 91, 92)
- One container serves the API and the built frontend from one origin
- GitHub Actions builds it for linux/amd64, starts it with production settings, smoke tests it, scans
  it for credentials, and only then publishes it; the host runs that exact image
- Hosted on AWS Lightsail (container service). Secrets exist only in the host's environment settings
- The instance seeds itself when the database is empty
- Status of the live service: the submission tracker, not this document

---

## Explicitly Deferred (Phase 2/3)

The source technical spec (`reference/rice-inventory-technical-spec.md`) describes a mature enterprise
WMS. The following are real, correct, and **consciously out of scope** for this hackathon MVP — not
overlooked. Each links to the spec step it comes from.

| Deferred capability | Spec step | Why deferred now |
|---|---|---|
| Append-only movement ledger (immutable, rebuildable balances) | Step 2 | `inventory_positions` stays a mutable snapshot table; a real ledger is a schema/engine rewrite, not a naming pass, and isn't demo-visible |
| Lot/batch genealogy, FEFO allocation | Steps 1, 6 | No lot concept anywhere in the current schema; rice repacking mass-balance and lot tracking are a substantial data-model addition |
| Barcode scanning and offline sync for the floor | Step 4B | Handheld receiving and picking against a PO or sales order are BUILT (REQ-19); scanning hardware and offline sync are not |
| Import clearance & customs milestones | Step 4A | Depends on external document/permit integrations out of this project's control |
| Full quality/stock-status taxonomy (blocked, damaged, rejected, in eligible/ineligible splits) | Step 3 | MVP1 models only reserved + quality-hold; the rest needs workflow screens to actually move stock between statuses |
| Statistically backtested demand forecasting (vs. today's flat 30-day moving average) | Step 10 | Needs a forecasting service with backtest harness — a model-building project of its own; the projection curve (REQ-18) still uses this flat 30-day average as its demand input |
| Governance-approved compliance rule (vs. REQ-16's illustrative placeholder) | Step 11A | Requires an actual compliance owner to approve the real formula, scope, and effective date — not a technical decision |
| Agent execution governance (tool-permission tiers, idempotent execution, approval-token workflow) | Steps 14-15 | The model layer (REQ-21) only explains; it has no tools and cannot act, so there is nothing to govern yet. Giving it the ability to act would require this governance first |
| Freshness state machine (current/delayed/stale/unreconciled/unavailable) | Step 18A | REQ-17 above ships only the as-of *timestamp*; the full staleness-detection behaviour needs monitoring infrastructure this project doesn't have |
| Full audit/reconciliation controls (daily opening=closing checks, idempotency keys, duplicate-replay protection) | Steps 2, 7, 18 | No ledger to reconcile yet (see row 1); `audit_log` exists but isn't schema-validated per event type |

---

### Non-Functional Requirements
- Every figure, status and alert is computed deterministically. A model may only narrate (REQ-21).
- Locally the SQLite file persists across restarts. On the deployed container, a restart without a
  mounted disk reseeds the demo from the deterministic seed, which is a supported mode (REQ-24).
- No secret (API key, demo PIN) in the repository or the image.
- Seed data must use realistic rice SKU names, suppliers, and quantities.
- All monetary values in SGD.
- UOM: metric tonnes (MT) for bulk rice, KG for retail packs.
