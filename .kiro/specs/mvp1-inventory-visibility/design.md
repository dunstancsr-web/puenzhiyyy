# MVP 1 — Inventory Visibility: Design

> **2026-09-12 domain-alignment pass**: schema columns and formulas below are updated to the canonical
> names/definitions from `reference/rice-inventory-terms-glossary.md`, per
> `reference/terminology-map.md`. Old names are struck through inline where it helps orient anyone
> reading the git history; the authoritative current names are what's in the SQL/code blocks.

> **2026-09-15 update**: architecture, file structure, the four tables added since 13 Sep, page
> designs, and new sections for the explanation layer and deployment are brought up to date with the
> code. Requirements for each are REQ-19 to REQ-24 in `requirements.md`. Where this document and the
> code disagree, the code is right and this document is the bug.

## Architecture Overview

```
                SQLite (backend/data/stocksense.db, WAL mode)
                               |
              nine deterministic engines (engines/index.js)
                               |
          Express, port 4000 in development, one origin in production
      /api/... Control Tower (routes/inventory.js)
      /api/warehouse/... handheld floor (routes/warehouse.js)
      /api/alerts/explain -> explanation layer (llm/) -> rules | Ollama | Bedrock gateway
                               |
             React + Vite, port 5173 in development (proxy to /api)
      Home          three workspaces
      Goods In/Out  handheld flows (frontend/src/warehouse/)
      Control Tower Dashboard, Inventory, Alerts, Activity
```

All computation happens in the backend engines. The frontend renders, and never recomputes a figure
an engine emits. In production the backend also serves the built frontend.

---

## Database Schema

**`backend/src/db/init.js` is the source of truth for exact columns.** The blocks below show each
table's design intent. Columns added later by `ensureColumn` migrations, and so missing from some
blocks: on `skus`, `lead_time_std_days`, `target_service_level`, `demand_cv`, `unit_price_sgd`,
`annual_carrying_rate_pct`, `obsolescence_risk_pct`, `abc_class`, `xyz_class`, `warehouse`; on
`inventory_positions`, `last_received_date`, `last_updated`; on `purchase_orders`, `actual_arrival`;
on `alerts_log`, `dedupe_key`, `status`, `owner`, `resolved_at`. Audit event types are the frozen
`EVENTS` map in `backend/src/db/audit.js`.

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

### Table: operators (TASK-46)
```sql
CREATE TABLE operators (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,
  pin         TEXT NOT NULL,
  role        TEXT NOT NULL DEFAULT 'both',   -- receiving | dispatch | both
  active      INTEGER DEFAULT 1
);
```
Demo PINs are stored in plain text and printed on the sign-in screen. A real deployment needs hashed
PINs, sessions and device enrolment.

### Table: sales_orders (TASK-46)
```sql
CREATE TABLE sales_orders (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  so_number     TEXT UNIQUE,
  sku_id        TEXT NOT NULL REFERENCES skus(sku_id),
  customer      TEXT,
  ordered_qty   REAL NOT NULL,
  required_date TEXT,
  status        TEXT DEFAULT 'open',        -- open | picked | cancelled
  picked_qty    REAL,
  picked_by     TEXT,
  picked_at     TEXT
);
```

### Table: goods_movements (TASK-46)
```sql
CREATE TABLE goods_movements (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  movement_no     TEXT UNIQUE,              -- GRN-0001 / DN-0001
  movement_type   TEXT NOT NULL,            -- RECEIPT | ISSUE
  reference       TEXT,                     -- po_number or so_number
  sku_id          TEXT NOT NULL REFERENCES skus(sku_id),
  expected_qty    REAL,
  actual_qty      REAL NOT NULL,
  variance_qty    REAL DEFAULT 0,
  variance_reason TEXT,
  operator_id     INTEGER,
  operator_name   TEXT,
  created_at      TEXT DEFAULT (datetime('now'))
);
```
A receipt adds `actual_qty` to `on_hand_qty` and closes the purchase order. An issue subtracts it
from `on_hand_qty` and from `reserved_qty` (floored at zero), refuses more than is physically on hand,
and marks the sales order picked. A variance must carry a reason. Not an immutable ledger: balances
remain a mutable snapshot (see requirements.md, Explicitly Deferred).

### Table: inventory_history (TASK-85)
```sql
CREATE TABLE inventory_history (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  sku_id        TEXT NOT NULL REFERENCES skus(sku_id),
  period        TEXT NOT NULL,              -- 'YYYY-MM'
  opening_qty   REAL NOT NULL DEFAULT 0,
  receipts_qty  REAL NOT NULL DEFAULT 0,
  issues_qty    REAL NOT NULL DEFAULT 0,
  closing_qty   REAL NOT NULL DEFAULT 0,
  unit_cost_sgd REAL NOT NULL DEFAULT 0,
  UNIQUE (sku_id, period)
);
```
Long format, one row per SKU per month. The seed verifies every period balances
(`opening + receipts - issues = closing`) and that the newest closing equals today's on-hand.
The hero chart's split is derived, not stored: `arrived = MIN(receipts_qty, closing_qty)` per row
(FIFO), summed at cost; `carried = closing - arrived`.

---

## Backend File Structure

```
backend/src/
├── index.js            # loads backend/.env, Express, serves the built frontend in production
├── db/
│   ├── init.js         # schema, runs on startup
│   ├── seed.js         # deterministic: 10 SKUs, sales, POs, sales orders, operators, 24 months history
│   ├── audit.js        # the closed set of audit event types and the write path
│   └── csv.js          # CSV parse and serialise for bulk edit
├── engines/            # index.js runs them in dependency order into one enriched SKU record
│   ├── velocity.js  position.js  safetystock.js  classification.js  segmentation.js
│   ├── health.js  financials.js  alerts.js  projection.js
│   ├── duration.js     # readable durations, computed once ("1 month and 22 days")
│   └── smoke.js        # npm run analytics
├── llm/                # the explanation layer, see "Explanation Layer" below
│   ├── explain.js  slots.js  semantic.js  provider.js  demoAccess.js  spend.js
├── routes/
│   ├── inventory.js    # Control Tower API
│   ├── warehouse.js    # handheld floor API
│   └── products.js     # legacy in-memory demo store, unrelated to the schema
└── data/products.js    # data for the legacy store
backend/scripts/        # bench-models.js, sonnet-check.js, spend.js, check-deploy.js
```

---

## Key Computation Logic

> **Checked by code.** `backend/scripts/check-formulas.js` recalculates each formula below from the raw
> data and compares it with the engines, in CI on every push. Known disagreements waiting for Stan's
> decision, with their impact, are in `backend/scripts/formula-decisions.json`.

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
`reorder_point_suggested` is shown alongside `reorder_point_policy` for comparison. The REORDER alert,
the Dashboard's REORDER rows and the projection chart's reorder line all key off the **policy** value
(the approved operating level), matching the source spec's raw-vs-approved pattern (Step 11). Health
status does not use a reorder point at all; it works from days of cover. (Clarified 15 Sep 2026,
TASK-95: the alert code had drifted to the suggested value, and requirements.md said so too.)

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

Seed data includes (deterministic, safe to rerun with `npm run seed`):
- about 180 days of sales transactions (varying volumes to create velocity patterns), open purchase
  orders, open sales orders, the four operators, and 24 months of balanced inventory history
- Deliberate scenarios, as the alerts actually fire after a seed: TJ-25KG stockout risk, VF-10KG
  overstock, JP-5KG idle and ageing, BM-5KG, BM-25KG and BR-10KG slow moving. No REORDER fires on the
  seed; `bench-models.js --scenario reorder` raises one on a temporary copy

---

## Frontend Page Designs

Screen names and Stan's design preferences are in `.kiro/steering/rules.md` ("Names we use", "Design
preferences"); this section records structure only.

### Home
The first screen: three workspaces on one centre axis, grouped by device. Goods In and Goods Out
(handheld), the Control Tower (desktop). The client identity leads; StockSense signs the foot.

### Goods In and Goods Out (handheld)
Operator PIN sign-in, then one action per screen with large targets. Goods In: pick the delivery,
verify the SKU, count, confirm with any variance reason. Goods Out: pick against an open sales order.

### Dashboard
In order: **Key Metrics** (hero inventory value with the new versus carried chart, baseline comparison,
then the Service & availability and Working capital groups, each label in plain English with the
industry term in its tooltip), **Needs Attention** (full width, the only section carrying actions, with
a Show all scope), **Cover vs Lead + Safety** beside **Inventory Health** (clicking a band filters
Needs Attention), **Value × Movement** (full width).

### Inventory Page
Every SKU with a bullet-graph stock gauge (available against reorder point and maximum), search and
filters, a per-SKU modal with the 90-day projection and editable policy thresholds with a live
preview, Add SKU, and bulk edit by CSV.

### Alerts Page
Summary count per alert type; alert cards on white, severity as the left stripe, type as icon and chip;
each card states measured value and threshold, the recommended action, and Approve (with the quantity),
Modify, Reject, Why? and Dismiss.

### Activity Page
The audit trail in plain-English sentences, filterable by event type, each with the stored input and
output one click away.

---

## Explanation Layer (TASK-11, 42 to 45, 89 to 99)

Requirements: REQ-21 and REQ-22. The model narrates; it never computes and never acts.

### Flow
1. The frontend shows the rule-based trace from `frontend/src/lib/explain.js` immediately.
2. It calls `POST /api/alerts/explain` with the visitor's tier and, for the paid tier, the demo pass
   in the `X-Demo-Unlock` header. Without a valid pass the paid request returns `locked: true`.
3. `explainAlert` (`llm/explain.js`) checks the cache (key: tier, SKU, alert type, severity, and the
   stock figures rounded), then runs `runExplanation`.

### runExplanation, the protection layers
- **Slots** (`slots.js`): the prompt lists placeholders with descriptions, not values. The raw answer
  is rejected if it contains a digit (product name pack sizes excepted) or a placeholder that does not
  exist. Values are substituted afterwards.
- **Trigger sentence**: for each alert type a `TRIGGERS` entry writes the opening sentence from engine
  figures, and a `withhold` list removes those figures from the slots the model may use, so it cannot
  re-pair them. The model is told the opening is already written. The model's own "was flagged"
  sentence is dropped and the system opening is prepended.
- **Approved action**: if the answer does not contain `alert.recommended_action`, it is appended.
- **Checks on the rendered text**: `verifyExplanation` traces every figure to the known facts, the
  opening and the slot values; `semanticIssues` (`semantic.js`) flags false arithmetic, a figure
  attached to the wrong named quantity, an order quantity other than the recommended one, direction
  errors (a low-stock alert described as full, ordering advised on too much stock), and claims that an
  action was already taken. A semantic issue counts as dangerous.
- **Retries**: up to two attempts in slot mode, then one free-text attempt whose figures are verified,
  each retry told the reasons the last one failed. If all fail, `LlmUnavailable` is thrown and the
  frontend keeps the rule-based trace.
- **Prompt rules** (`SYSTEM`, `ALERT_BRIEF`): copy never compute, never convert units, never rename
  what a figure measures, no invented costs, deadlines or urgency, and a per-alert brief stating what
  the alert means and which direction the advice must point.

### Tiers (`provider.js`)
`chat({ system, user, tier })` resolves the tier per request: `rules` (no call), `local` (Ollama,
available in development or when `OLLAMA_URL` is set), `cloud` (the Bedrock gateway when
`LLM_GATEWAY_*` is set, else the Anthropic API). The default tier is never `cloud`. A daily cap
(`LLM_DAILY_CALL_LIMIT`) counts every cloud attempt.

### Access (`demoAccess.js`)
`POST /api/llm/unlock` checks `DEMO_PIN` (at least 6 characters in production). Five wrong tries lock
a client for 15 minutes; 30 wrong in total pause unlocking for everyone. Success returns a pass signed
with HMAC (`DEMO_TOKEN_SECRET`, or a random per-boot secret) valid for 2 hours, kept in
sessionStorage. Audit events: `LLM_UNLOCKED`, `LLM_UNLOCK_LOCKED_OUT`.

### Audit and spend
Each explanation writes one `LLM_CALL` row with tier, provider, model, tokens in and out, the number of
model calls and the issues found, failed explanations included. `llm/spend.js` prices paid rows at
list price; `backend/scripts/spend.js` prints them for the spend ledger.

### Measuring changes
`backend/scripts/bench-models.js` runs `runExplanation` with only the model call swapped for local
Ollama: first-try acceptance, calls per explanation, contradictions, and each attempt's rejection
reasons. Results are recorded in `.kiro/DEVLOG.md`, not here.

---

## Deployment (TASK-33, 34, 91, 92)

- `Dockerfile`: one image; Express serves `/api` and `frontend/dist`, with an `index.html` fallback
  for client routes. `NODE_ENV`, `PORT` and `DATA_DIR` are set in the image; the database lives under
  `/data` and seeds itself when empty. `trust proxy` is on in production for correct client IPs
  behind the load balancer.
- `.github/workflows/container.yml`: builds linux/amd64, boots the container with production settings,
  smoke tests it, scans the image for anything shaped like a credential, then publishes
  `ghcr.io/...:sha-<commit>` and `latest`.
- Host: AWS Lightsail container service pulling the published image. Secrets (`LLM_GATEWAY_*`,
  `DEMO_PIN`, `DEMO_TOKEN_SECRET`) only in the service's environment settings.
- `backend/scripts/check-deploy.js <url>` verifies a live deployment without calling the model.
- The step by step procedure: `docs/(Stan) 1 Reference/(Stan) DEPLOY-LIGHTSAIL.md`. Live status: the
  submission tracker.

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
| Done | Explanation layer (TASK-11 and TASK-42 to TASK-99): narrates only, no tools, cannot act; see "Explanation Layer" | - | ✅ |
| Done | Handheld Goods In and Goods Out against POs and sales orders (TASK-46, TASK-47) | - | ✅ |
| Done | 24 months of inventory history and real trend arrows (TASK-85) | - | ✅ |
| Next | Any agent that can ACT (raise a PO, move stock) must first follow the spec's Step 14/15 permission model | Stan's decision; the decisions table as evidence of trust | - |
| Then | Append-only movement ledger (spec Step 2) — replaces the mutable `inventory_positions` snapshot | Real usage/demand for audit trail | — |
| Then | Lot/batch tracking, full stock-status taxonomy (blocked/damaged/rejected) | Movement ledger | — |
| Then | Governance-approved Compliance Position rule (replaces REQ-16's placeholder) | A compliance owner, not a technical blocker | — |
| Then | Statistically backtested demand forecasting — replaces the flat blended-rate demand input the projection curve (REQ-18) currently uses | A model-building effort of its own | — |
