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
  safety_stock_pct     REAL DEFAULT 20,  -- legacy flat buffer; superseded by the statistical safety stock below
  lead_time_days       INTEGER DEFAULT 45,
  lead_time_std_days   REAL DEFAULT 0,   -- supplier lead-time variability (1 sigma); used by Safety Stock below
  target_service_level REAL DEFAULT 0.95,  -- e.g. 0.95; used by Safety Stock below
  demand_cv            REAL DEFAULT 0.3, -- fallback when velocity.js's own weekly-sales CV is 0 (see Demand variability)
  unit_cost_sgd        REAL DEFAULT 0,
  max_holding_days     INTEGER DEFAULT 270,
  active               INTEGER DEFAULT 1,
  strategic_adjustment REAL DEFAULT 0,  -- MVP2: repurposed as the risk-buffer contribution (MT), see Risk Buffer below;
                                        -- was a Phase 2 placeholder, column unchanged, comment updated
  compliance_required_qty REAL,  -- cached on refresh: 2x trailing-3mo avg monthly receipts (REQ-16, illustrative rule)
  forecast_model       TEXT,  -- MVP2: naive_seasonal | linear_trend | holt_winters | auto | NULL (not forecast-enabled)
  use_forecast         INTEGER DEFAULT 0,  -- MVP2: opt-in switch, decoupled from forecast_model on purpose
                                        -- (picking a model must not silently activate it) — see Forecast-Driven
                                        -- Demand & Risk Buffer below
  created_at           TEXT DEFAULT (datetime('now'))
);
```

### Table: forecasts (MVP2)
```sql
CREATE TABLE forecasts (
  id                        INTEGER PRIMARY KEY AUTOINCREMENT,
  sku_id                    TEXT NOT NULL,
  model                     TEXT NOT NULL,   -- naive_seasonal | linear_trend | holt_winters
  generated_at              TEXT DEFAULT (datetime('now')),
  horizon_months            INTEGER NOT NULL,
  avg_daily_demand_forecast REAL NOT NULL,  -- the only two fields engines/index.js reads (see below)
  demand_cv_forecast        REAL NOT NULL,
  monthly_forecast_json     TEXT NOT NULL,  -- [{period, qty}, ...], for the forecast panel's chart
  backtest_metric           TEXT,           -- 'WMAPE'
  backtest_score            REAL,           -- the ACTIVE model's own score
  candidate_scores_json     TEXT,           -- {model_id: wmape, ...} for every model auto-mode tried
  low_confidence            INTEGER DEFAULT 0,  -- 1 when the backtest had < 6 scored folds (sparse history)
  is_active                 INTEGER DEFAULT 0,  -- one active row per sku_id; older rows kept as history
  FOREIGN KEY (sku_id) REFERENCES skus(sku_id)
);
```
One row per generation, not per SKU — `is_active=1` marks the row currently in force; earlier ones stay
for future forecast-vs-actual comparison, never deleted. Written only by `POST /api/forecast/recompute`
(no scheduler — see "Recompute" below); read only by `getActiveForecast()`, never recomputed inline.

### Table: risk_events (MVP2)
```sql
CREATE TABLE risk_events (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  label             TEXT NOT NULL,
  country_of_origin TEXT,
  supplier          TEXT,
  severity          TEXT NOT NULL,   -- low | medium | high
  buffer_days_add   REAL NOT NULL,
  active            INTEGER DEFAULT 1,
  is_illustrative   INTEGER DEFAULT 1,  -- always 1 today; see Risk Buffer below
  notes             TEXT,
  created_at        TEXT DEFAULT (datetime('now'))
);
```
Seeded, not live: 4 entries (an India non-basmati export-ban analog, Thailand logistics, Vietnam quota,
one deliberately supplier-keyed rather than country-keyed so both match paths get exercised). Real
USDA GAIN/AMIS integration is roadmap, not this build — see "Formula decisions" for the honesty label
this carries, the same pattern `compliance_position` already uses.

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
│   ├── forecast.js     # MVP2: 3 Node-only demand models + the deterministic backtest/auto-mode selector
│   ├── riskbuffer.js   # MVP2: deterministic risk_events match, illustrative (see Formula decisions)
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
> decision, with their impact, are in `backend/scripts/formula-decisions.json`; decided ones are
> recorded in "Formula decisions" at the end of this section.

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
sales_30d = SUM(quantity_mt) WHERE status = 'fulfilled' AND sale_date >= today - 30
            (lost sales, orders that could not be filled, are excluded: they feed fill rate)
avg_daily_30d = sales_30d / 30         (60, 90 and 180 day windows follow the same rule)

Rates (avg_daily_30d and the others) and demand_cv are held to 2 decimal places before use.

avg_daily_30d is THE demand rate: every formula in this document that needs a daily demand rate
(cover, projection, suggested order, safety stock, ABC, compliance, financials) uses it and nothing
else. Stored on each SKU as avg_daily_usage_30d.

velocity_trend:
  if avg_daily_30d > avg_daily_90d * 1.10 → "accelerating"
  if avg_daily_30d < avg_daily_90d * 0.90 → "decelerating"
  else → "stable"
```

### Days / Months of Cover (glossary #22 — renamed from "Days/Months of Stock")
```
days_of_cover = available_qty / avg_daily_30d, rounded to whole days
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
projected_available(day) = available_qty - (avg_daily_30d * day)
                            + Σ open-PO qty landing on or before that day
```
Run flat-rate 90 days out (`backend/src/engines/projection.js`), exposed at
`GET /api/skus/:id/projection`; also run out to just `lead_time_days` to produce
`suggested_order_qty` above — same function, two callers (`engines/index.js` and the route). Surfaced
as a line chart with reference lines (safety stock, reorder point, max stock) in the SKU edit modal.
(MVP2, Day 5: one exception now exists — a dedicated per-SKU Forecast Detail page, see below — because
the model picker, reasoning chain, what-if sandbox and reorder-cycle simulation together are dense
enough to fight the modal's own layout. Every other per-SKU view stays in the modal.)

### Forecast-Driven Demand & Risk Buffer (MVP2, Days 1–5)

Deferred out of MVP1 explicitly ("Explicitly Deferred" in requirements.md: "a model-building effort of
its own"). Built to the same architectural rule as the rest of this app: **deterministic engines compute
every figure, a human approves every action, a language model narrates and never computes.** No LLM call
anywhere in this section.

**The four forecast models** (`engines/forecast.js`), over the monthly-bucketed sales history
(`sales_transactions`, `status='fulfilled'`, same filter `velocity.js` already uses):
```
naive_seasonal        forecast(month) = average of that same calendar month across every prior year
                                         in history — zero parameters, the floor every other model must beat
linear_trend          deseasonalize each month by its own seasonal-naive baseline, fit OLS on the
                       deseasonalized series, project forward, reseasonalize
holt_winters           additive triple exponential smoothing, 12-month season; alpha/beta/gamma fit by grid
                       search minimizing in-sample SSE (never hand-set); degrades to naive_seasonal below two
                       full seasonal cycles of history rather than fit unstable parameters on too little data
holt_damped_seasonal   damped Holt level+trend (fixed alpha/beta/phi — ~24 points would overfit a fitted
                       3-parameter model) blended 50/50 with a seasonal-naive term scaled to the current
                       level. Ported from a teammate's independent branch (Tawmo,
                       feature/demand-forecast-engine), credited in forecast.js's comments; adapted to
                       read this same monthly series (their original read inventory_history.issues_qty
                       directly) so all four models compare on one definition of demand
avg_daily_demand_forecast = mean(next horizon_months' forecast qty) / 30   -- /30, not calendar-exact,
                                                                            to stay comparable with
                                                                            avg_daily_30d (velocity.js)
demand_cv_forecast        = coefficient of variation of the forecast month values
```

**Auto-mode model selection** (`backtest()`, `engines/forecast.js`) — a rolling-origin (walk-forward)
holdout, never a single split, scored by WMAPE (not plain MAPE, which blows up on an Idle SKU's
near-zero months):
```
WMAPE = Σ|actual - forecast| / Σ actual,  across every scored fold
origin starts at month 12 (Holt-Winters needs one full season), rolls forward one month at a time
winner = the candidate model with the lowest WMAPE
low_confidence = true if fewer than 6 folds were scored (usually an Idle SKU's long zero-sales run)
```
Deterministic: `backtest_determinism` in `check-formulas.js` runs it twice on identical data and
requires byte-identical WMAPE, guarding the "deterministic, not agentic" property this whole feature's
legitimacy rests on.

**Safety stock's forecast-aware branch** (`engines/index.js`, feeding the unmodified King's formula in
`safetystock.js` above) — for a `use_forecast=1` SKU with an active `forecasts` row:
```
avgDailyDemand (into King's formula) = avg_daily_demand_forecast   (falls back to avg_daily_30d if
demandCv       (into King's formula) = demand_cv_forecast           use_forecast=1 but no forecast
                                                                      row exists yet — ?? not ||, so
                                                                      a genuine 0 MT/day forecast is
                                                                      not treated as absent)
```
This substitution happens **only inside this one call**. `avg_daily_30d` itself, and its seven other
consumers (cover, projection, suggested order, ABC, financials, compliance), are untouched — the "one
demand rate" decision above is about operational reality today, a different question from expected
future demand. `demand_source` on the SKU record is `"velocity_30d"` or the active model's name,
whichever is actually in force, so nothing has to be inferred from `use_forecast` alone.

**Risk buffer** (`riskbuffer.js`) — a separate additive term after King's formula runs, not folded into
the variance math, so the safety-stock formula itself stays provably unchanged and the buffer's own
contribution stays separately explainable:
```
matching_events   = risk_events WHERE active=1 AND (country_of_origin = sku's OR supplier = sku's)
risk_buffer_days  = min(30, Σ matching_events.buffer_days_add)
risk_buffer_mt    = risk_buffer_days * (avg_daily_demand_forecast if use_forecast else avg_daily_30d)
risk_buffer_reason = the highest-severity matching event's label
```
`strategic_adjustment` (the documented Phase 2 placeholder column) is the analytics-output field
`risk_buffer_mt` lands in — a computed figure overriding the raw stored column, never written back to it.
**Must always render with an "illustrative" label** (`risk_events.is_illustrative` is always 1 today) —
the same honesty pattern `compliance_position` above already carries; real supply-chain risk feeds are
roadmap, not this build.

```
reorder_point_suggested_with_risk = reorder_point_suggested + risk_buffer_mt
```
Left as a second field beside `reorder_point_suggested` — nothing currently consuming the un-risked
figure starts silently including an unexplained addend.

**Recompute** (`POST /api/forecast/recompute`, optional `?sku_id=`) — the lazy-cache write side. No
scheduler, no job queue: `forecasts` rows are the cache, `engines/index.js` does one indexed read of the
active row per SKU and never recomputes inline. `forecast_model='auto'` runs the real backtest above and
writes its winner; a pinned model runs `runForecast()` directly without one. At this data scale (10 SKUs
x 3 models x rolling folds) this is comfortably synchronous within one request.

**What-if preview** (`POST /api/skus/:id/forecast/preview`, MVP2 Day 5) — the Forecast Detail page's
sandbox recomputes King's formula live as a manager drags a lead-time/service-level/target-stock slider,
by calling `computeSafetyStock()` and `computeRiskBuffer()` directly with the hypothetical inputs and the
SKU's real active forecast demand. Nothing is written; this is a preview, not a save, and it is the
**only** place outside `safetystock.js` itself allowed to call that formula — the alternative (the
sandbox recomputing the formula in the frontend) would have been exactly the "derived value computed
twice" bug class already documented twice in this repo's own history (`rules.md`).
```
target_stock_suggested = avg_daily_demand_forecast * (review_period_days + lead_time_days)
                          + safety_stock_mt
                          -- review_period_days = 30, an assumed periodic review cycle; this app does
                          -- not yet track an actual per-SKU review cadence, so this is a stated
                          -- assumption, not a derived number
```

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
`covered_by_po` softens the RED and ORANGE triggers when supply is already inbound, so a real but
non-emergency gap does not over-alarm. Its exact definition is in "Supporting Formulas" below.

### Movement Classification (velocity — kept separate from the ABC value classification below)
```
Evaluated in this order, first match wins (engines/classification.js):
Idle        if no fulfilled sales in 90 days
Slow Moving if avg_daily_30d > 0 AND days_of_cover > 120
Fast Moving if avg_daily_30d >= p75 of avg_daily_30d across SKUs that are selling
Normal      otherwise
```

### ABC Value Classification (spec Step 8A)
```
annual_consumption_value = avg_daily_30d * 365 * unit_cost_sgd
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

### Supporting Formulas (written down 15 Sep 2026; until then these existed only in code)

The formulas above lean on these. All use the one demand rate, `avg_daily_30d` (Sales Velocity).

**Demand variability and XYZ** (`velocity.js`, `segmentation.js`)
```
weekly_sales[w]  = fulfilled sales in week w, for the last 12 weeks
demand_cv        = population standard deviation(weekly_sales) / mean(weekly_sales)   (0 when mean is 0)
                   if demand_cv is 0, the SKU record's configured demand_cv is used instead
xyz_class        = X if demand_cv < 0.25, Y if <= 0.5, else Z
```

**Safety stock and lead-time demand** (`safetystock.js`; King's formula)
```
z                    = service-level z-score, from the step table: the value for the highest listed
                       level not above target_service_level (0.90 -> 1.28, 0.95 -> 1.65, 0.99 -> 2.33, ...)
daily_demand_sd      = demand_cv * avg_daily_30d
safety_stock_mt      = z * sqrt( lead_time_days * daily_demand_sd^2
                                 + avg_daily_30d^2 * lead_time_std_days^2 )
safety_stock_days    = round(safety_stock_mt / avg_daily_30d)                          (0 with no demand)
lead_time_demand_mt  = avg_daily_30d * lead_time_days
```
This formula itself is unmodified by MVP2. What changed: `avg_daily_30d` and `demand_cv` above are the
values fed in for a SKU with `use_forecast=0` (the default); a `use_forecast=1` SKU feeds the active
forecast's own demand rate and CV instead — see "Forecast-Driven Demand & Risk Buffer" below for the
substitution, and `check-formulas.js`'s `safety_stock_mt` check is forecast-aware for the same reason
(Formula decisions, 17 Sep).

**Target cover and coverage band** (`engines/index.js`)
```
target_days_of_cover = round(target_stock / avg_daily_30d)                           (null with no demand)
coverage_band        = idle   if days_of_cover is null
                       below  if days_of_cover < lead_time_days + safety_stock_days
                       above  if days_of_cover > target_days_of_cover
                       in     otherwise
```

**Covered by a purchase order** (`engines/index.js`)
```
incoming_eta_days = days until the EARLIEST open PO's ETA (0 if already due)
covered_by_po     = expected_incoming_qty > 0
                    AND incoming_eta_days <= days_of_cover     (the order lands before stock runs out)
```

**Stock age and ageing status** (`position.js`, `engines/index.js`)
```
inventory_age_days = whole days since last_received_date
holding_limit      = max_holding_days, or 270 if not set
ageing_status      = Fresh    if inventory_age_days / holding_limit < 0.34   (or no receipt date)
                     Normal   if < 0.67
                     Ageing   if < 0.90
                     At Risk  otherwise
```
**Open decision:** requirements.md REQ-08 gives fixed day bands instead (Fresh 0 to 90, Normal 91 to
180, Ageing 181 to 270, At Risk 271+). At the default 270 day limit the two agree except that the code
starts At Risk at 243 days, not 271. See `backend/scripts/formula-decisions.json`.

**Per-SKU financials** (`financials.js`)
```
inventory_value        = on_hand_qty * unit_cost_sgd
margin_per_mt          = unit_price_sgd - unit_cost_sgd
annual_cogs            = avg_daily_30d * 365 * unit_cost_sgd
annual_gross_margin    = avg_daily_30d * 365 * margin_per_mt
overstock_qty          = max(0, on_hand_qty - max_stock)
overstock_value        = overstock_qty * unit_cost_sgd
overstock_carrying_cost = overstock_value * annual_carrying_rate_pct / 100
eo_value               = available_qty * unit_cost_sgd   if movement_class is Slow Moving or Idle, else 0
eo_value_risk_adjusted = eo_value * obsolescence_risk_pct / 100
stockout_gap_days      = max(0, lead_time_days - days_of_cover)   unless covered_by_po or no cover (then 0)
lost_units_risk        = stockout_gap_days * avg_daily_30d
lost_margin_risk       = lost_units_risk * margin_per_mt
```

**Portfolio KPIs** (`financials.js`, across active SKUs)
```
turnover   = SUM(annual_cogs) / SUM(inventory_value)
dio        = 365 / turnover                                 (days inventory outstanding)
gmroi      = SUM(annual_gross_margin) / SUM(inventory_value)
fill_rate  = (demand_30d - lost_30d) / demand_30d * 100,  where demand_30d = fulfilled + lost sales, 30 days
```

### Compliance Position (glossary #38 / spec Step 11A — new, simplified & illustrative)

A **portfolio-level** figure (the real Singapore rice-stockpile scheme is a company-wide requirement
across all SKUs, not a per-SKU one — spec Step 11A: "compliance applicability by SKU/grade/importer
licence/warehouse/ownership" describes the *scope* a real rule can narrow to, but the pitch-deck-level
"two months of import volume" description is inherently an aggregate figure).

```
compliance_eligible_qty = Σ on_hand_qty across all active SKUs
                           (MVP1 has no blocked/damaged/rejected statuses to exclude yet)
compliance_required_qty = 2 * Σ(avg_daily_30d across active SKUs) * 30
                           -- placeholder rule; substitutes portfolio demand throughput for real import-
                           -- receipt history, which this project doesn't have. Honestly labelled below.
compliance_position     = compliance_eligible_qty - compliance_required_qty
```
Must always render with an **"illustrative — pending governance approval of the actual rule, using
demand as a stand-in for import history"** label (spec Step 11A requires a formally approved rule
before any real compliance figure is presented as authoritative).

---

### Formula decisions

Where this document and the code disagreed, found by `check-formulas.js`. Each entry records the
conflict, what Stan chose and why, and the definition now in force above. Newest first.

**2026-09-17, Safety Stock: the formula check had a real blind spot once `use_forecast` became live.**
- Conflict: `check-formulas.js`'s `safety_stock_mt` check only ever re-derived the non-forecast path
  (`avg_daily_30d`/its own `demand_cv`). This was a deliberate Day 3 decision, reasoned at the time as
  "the regression that matters" since `use_forecast` was default-off everywhere and nothing exercised
  the other branch. Day 5 built a real, live-toggleable `use_forecast` checkbox on the Forecast Detail
  page, so the gap started to matter for real: flipping it on for BM-5KG during testing made the check
  fail (spec 4.95, code 4.52) — a real discrepancy the check was never asked to catch, not a code bug.
- Chosen: extend the check, not the code. `safety_stock_mt` in the engine was already correct (matches
  `engines/index.js`'s own resolution exactly); the check's spec-side re-derivation was the stale half.
- Why: the code's behavior — forecast demand/CV feeding King's formula only when `use_forecast=1` — was
  the intended design from Day 3, documented and unchanged. Re-ran the check against the unfixed spec
  logic to confirm it still fails, then against the fix to confirm it passes, before trusting it (this
  repo's own "prove a new check can fail" rule).
- Effect: no figure on screen changed — this was a test-coverage gap, not a formula disagreement. All 30
  checks pass on the current seed with `safety_stock_mt` now correctly forecast-aware.

**2026-09-15, Movement Classification: what makes a SKU Slow Moving.**
- Conflict: this document and requirements.md REQ-06 said Slow Moving means selling AND more than 120
  days of cover. The code ranked SKUs and called the slowest quarter by blended rate Slow Moving,
  whatever their stock. The ranking always labels some SKU slow, and it disagreed with the SLOW_MOVING
  alert, which already required cover over 120 days.
- Chosen: the spec. The code was changed.
- Why: Stan judged the spec more correct. Slow Moving should mean too much stock for the SKU's own
  demand, which is what a manager acts on. Trade-off accepted: a fast seller holding over 120 days of
  stock is now Slow Moving rather than Fast, because the rules are ordered and Slow is tested first.
  Fast Moving also now ranks by the 30 day average, as written, rather than the blended rate.
- Effect on the 15 Sep seed: VF-10KG moved from Normal to Slow Moving, adding a SLOW_MOVING alert,
  and Stock That Is Not Selling rose from about SGD 1.36M (36.7% of inventory) to 1.93M (52%). No health
  status changed; no other SKU changed class.

**2026-09-15, Sales Velocity: which sales count.**
- Conflict: this document said sales windows sum every sale; the code summed only fulfilled sales.
- Chosen: the code. This document was corrected.
- Why: a lost sale is an order that could not be filled, not consumption. Counting it would inflate
  demand for exactly the SKUs that ran short, and count the same order again against fill rate, which
  already uses lost sales. No figure on screen changed.

**2026-09-15, Sales Velocity: one demand rate for the whole app.**
- Conflict: this document said days of cover divides by the 30 day average. The code divided it, and
  also projection, suggested order, safety stock, target cover, ABC, compliance and the financials, by a
  blended rate: half the 30 day average plus half the 90 day average. Its only recorded reason was a
  code comment ("smooths a noisy 30d window"); the 50/50 weighting was never tested.
- Chosen: the spec's 30 day average (a 30 day simple moving average: the last 30 days counted back from
  today, divided by 30), applied EVERYWHERE rather than only to cover, so no two figures use different
  rates. The blended field was deleted rather than kept under a misleading name, and the Inventory
  page's live preview (`frontend/src/mock/analytics.js`), which had used the 30 day average for cover but
  the blend for everything else, now uses it throughout.
- Why: Stan chose to follow the spec and keep the app consistent. The trade-off accepted: figures react
  faster to a real change in demand, and also move more after one unusually busy or quiet month.
- Effect on the 15 Sep seed: no alert, movement class, ABC class, health status or coverage band
  changed. Figures moved modestly, for example TJ-25KG cover 28 to 29 days, suggested order 597 to 591
  MT and stockout gap 17 to 16 days; BM-5KG cover 292 to 312; portfolio turnover 3.4 to 3.5, GMROI 0.68
  to 0.70, compliance position 1,058 to 994 MT. All 14 formula checks pass.

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
  overstock and slow moving, JP-5KG idle and ageing, BM-5KG, BM-25KG and BR-10KG slow moving. No REORDER fires on the
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
verify the SKU, count, confirm with any variance reason. Goods Out: pick the open sales order,
verify the SKU, count, confirm with a short pick reason. An over pick is refused, not recorded.

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

### Forecast Detail Page (MVP2 Day 5, Data Story added 17 Sep)
`frontend/src/pages/ForecastDetail.jsx`, at `/inventory/:skuId/forecast` — the one exception to "no
separate SKU detail page" (see Projected Inventory above). A plain-English "What your data tells us"
panel opens the page (Stan's ask, 17 Sep): what the forecast found, what's suggested, and how that
compares to what's approved, built from the exact same `preview` object every section below it reads,
never a second telling of the same numbers, with three buttons scrolling to the sections that back
each claim. Below it: the model picker (Auto/Manual, WMAPE per model, real backtest on pick), the sales
history + forecast chart, the what-if sandbox (four sliders, debounced live calls to
`POST .../forecast/preview`, never a client-side formula: each slider now carries a ColHint explaining
what it feeds and whether it's "your input" or something the formula suggests), the reasoning chain
(forecast demand × lead time + safety stock + risk buffer = suggested), a reorder-cycle simulation
(client-side geometry over the preview's real numbers, not a second formula), and the monthly
inflows/outflows chart. A recompute-freshness nudge (Day 6) turns the Recompute button's border yellow
past 14 days since the active forecast's `generated_at`.

Two of the sandbox's four inputs, lead time and its variability (σ), are supplier characteristics
this app has no way to derive from sales data (no closed purchase-order history to measure a real
average or spread from); the Data Story panel and the sandbox's own notes say so plainly rather than
implying a formula behind numbers that are really just what's saved for the SKU. Lead time itself was
always editable (`PUT /api/skus/:id`); its variability was not: set only at seed time, with no save
path anywhere in the app, until 17 Sep added `lead_time_std_days` to `SkuEditForm`'s Policy tab and
the same route's field whitelist, closing that gap so the Data Story's claim about it is actually
something a real user supplied, not always the column's `0` default.

Nothing on this page is generative AI, and the reasoning chain says so explicitly now (18 Sep): a
ColHint on its header names the three honest categories a figure can fall into, and `ChainStep`'s three
tags carry the same distinction visually. YOUR INPUT is something a person (or their supplier) told the
system. STATISTICAL FORECAST is Naive seasonal, Linear trend, Holt-Winters or Holt damped + seasonal
output, backtested against real sales history: a model in the statistics sense, not a generative one.
No tag means fixed arithmetic (King's formula) applied on top of those two. Stan's original ask was to
label the page's suggestions as "AI generated"; the correction, and what shipped instead, is recorded in
the submission tracker's decisions table.

### Forecast Overview Page (MVP2 Day 6, promoted to permanent nav 17 Sep)
`frontend/src/pages/ForecastList.jsx`, at `/forecast` — a portfolio-wide table (every SKU, forecast
status, active model + WMAPE, Approved → Suggested with the gap %, last-recomputed freshness), sortable,
linking into each SKU's Forecast Detail page. Held link-only from Inventory's header for months while
MVP2 was a feature branch; Stan promoted it to `Sidebar.jsx`'s permanent nav (between Dashboard and
Inventory) on 17 Sep, alongside confirming the accept/modify/reject decision for a suggested reorder
point stays on Alerts only: Forecast explains and simulates, it does not also duplicate the decision.
Still also reachable from the Inventory header link. A one-time nudge on Dashboard (`lib/forecastNudge.js`,
armed by `Onboarding.jsx` and "Try with sample data") points a manager here right after real data goes
in, then never reappears once dismissed or followed.

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
- **Tone** (`tone.js`), by rule rather than retry: on every alert except STOCKOUT_RISK, urgency words
  are removed ("take immediate action" becomes "take action"; descriptions such as "not selling
  quickly enough" are kept); placeholder names leaked as bare words become plain words, never values;
  and "I recommend that" in front of the engine's capitalised action is dropped. It never edits a
  sentence containing the approved action, and runs before the opening sentence is added.
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
| Done | Handheld Goods In against purchase orders (TASK-47), and the Goods Out API against sales orders (TASK-46) | - | ✅ |
| Done | Goods Out handheld screens, on the existing API (19 Sep) | - | ✅ |
| Done | 24 months of inventory history and real trend arrows (TASK-85) | - | ✅ |
| Next | Any agent that can ACT (raise a PO, move stock) must first follow the spec's Step 14/15 permission model | Stan's decision; the decisions table as evidence of trust | - |
| Then | Append-only movement ledger (spec Step 2) — replaces the mutable `inventory_positions` snapshot | Real usage/demand for audit trail | — |
| Then | Lot/batch tracking, full stock-status taxonomy (blocked/damaged/rejected) | Movement ledger | — |
| Then | Governance-approved Compliance Position rule (replaces REQ-16's placeholder) | A compliance owner, not a technical blocker | — |
| Then | Statistically backtested demand forecasting — replaces the flat 30 day average demand input the projection curve (REQ-18) currently uses | A model-building effort of its own | — |
