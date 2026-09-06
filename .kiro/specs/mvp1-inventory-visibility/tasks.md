# MVP 1 — Inventory Visibility: Tasks

## Build Order Rationale
Frontend-first approach. Build the UI with hardcoded mock rice data first, validate it looks
and feels right, then wire up the real backend. The one exception is the SQLite schema —
done early to avoid painful restructuring later. Seed data and full backend come after UI is validated.

---

## TASK-01 — SQLite schema only (no seed data yet)
30-minute task. Just the tables. No data, no routes.

- [ ] Install `better-sqlite3` in backend: `npm install better-sqlite3`
- [ ] Create `backend/src/db/init.js` — creates all 7 tables on startup:
  - `skus` (with `strategic_adjustment REAL DEFAULT 0` column for Phase 2)
  - `inventory_positions`
  - `sales_transactions`
  - `purchase_orders`
  - `alerts_log`
  - `decisions`
  - `audit_log`
- [ ] Wire `init.js` into `backend/src/index.js` so DB is created on startup
- [ ] Add `backend/data/stocksense.db` to `.gitignore`
- [ ] Verify: `node src/index.js` starts cleanly and `stocksense.db` file is created
- [ ] Do NOT add seed data yet — that comes in TASK-08

---

## TASK-02 — Build frontend with hardcoded mock rice data
Get the full UI working with realistic rice data before touching the backend.
All data lives in a single mock file — easy to swap out later.

- [ ] Create `frontend/src/mock/riceData.js` — hardcoded array of 10 rice SKUs with all
      computed fields already set (health_status, movement_class, days_of_stock, velocity_trend,
      available_stock, alerts, etc.). Use realistic values:
      - TJ-25KG (Thai Jasmine 25KG) → RED, Fast Moving, 23 days stock
      - VF-10KG (Vietnam Fragrant 10KG) → ORANGE, Normal, overstock
      - BM-5KG (Basmati 5KG) → YELLOW, Slow Moving
      - JP-5KG (Japonica 5KG) → RED, Idle, 0 sales 104 days
      - 6 more with a mix of GREEN and YELLOW statuses
- [ ] Create `frontend/src/mock/alertsData.js` — one alert per type:
      STOCKOUT_RISK, REORDER, OVERSTOCK, SLOW_MOVING, IDLE, AGEING
- [ ] Create `frontend/src/mock/statsData.js` — dashboard KPI summary object

---

## TASK-03 — Rebuild Dashboard page (mock data)
- [ ] 7 KPI stat cards: Total SKUs, Inventory Value, Avg Days of Stock,
      RED count, ORANGE count, Overstocked Value, Slow+Idle Value
- [ ] Health distribution pie chart (GREEN / YELLOW / ORANGE / RED counts)
- [ ] Top 5 stockout risk bar chart (days of stock, sorted ascending, RED bars)
- [ ] Movement class breakdown bar chart (Fast / Normal / Slow / Idle)
- [ ] Top 8 alerts table (severity sorted, critical first)
- [ ] Ageing inventory list (items with ageing_status = Ageing or At Risk)
- [ ] All data sourced from mock files — no API calls yet

---

## TASK-04 — Rebuild Inventory page (mock data)
- [ ] Update table columns: SKU ID, Product, Variety, Origin, Physical Stock (MT),
      Available Stock (MT), Days of Stock, Movement Class, Health Status, Actions
- [ ] Inline stock bar: shows available vs max, colour matches health status
- [ ] Health badge: GREEN / YELLOW / ORANGE / RED with colour coding
- [ ] Search by name, variety, supplier
- [ ] Filter by: movement class, health status, country of origin
- [ ] Sortable columns
- [ ] Restock modal (updates mock data locally for now)
- [ ] Add SKU modal with all rice-specific fields
- [ ] All data from mock files

---

## TASK-05 — Rebuild Alerts page (mock data)
- [ ] Summary count cards per alert type
- [ ] Filter tabs (All / STOCKOUT_RISK / REORDER / OVERSTOCK / SLOW_MOVING / IDLE / AGEING)
- [ ] Alert cards with: left colour border by severity, SKU name, alert type badge,
      triggered value vs threshold, plain-English message, recommended action text
- [ ] Acknowledge button (removes from active list locally for now)
- [ ] Decision row below each ORANGE/RED alert:
      "AI Recommendation: Purchase 300 MT" + Approve / Modify / Reject buttons
      (UI only at this stage — no backend call yet)
- [ ] "Ask AI" button on ORANGE/RED alerts (placeholder — shows mock explanation text for now)

---

## TASK-06 — Validate UI with team
- [ ] Run frontend only: `npm run dev` in frontend folder
- [ ] Check: does the dashboard answer the 4 key questions within 30 seconds?
      1. How much stock do we have?
      2. Which SKUs are moving fast/slow?
      3. How many days of stock remain?
      4. Which SKUs need action today?
- [ ] Check: are the rice SKU names, varieties, and quantities realistic?
- [ ] Check: does the projected inventory concept need a chart on the dashboard or only on SKU detail?
- [ ] Note any missing fields, confusing labels, or layout issues
- [ ] Adjust mock data and UI based on feedback before building backend

---

## TASK-07 — Build projected inventory curve (mock → real)
Best done after UI is validated because the chart shape drives the backend calculation design.

- [ ] Add projection chart to SKU detail view (click a SKU row → opens detail panel/page)
      Line chart showing 90 days: projected stock curve + safety stock line + reorder point line
- [ ] Mock version first: hardcode projection array for TJ-25KG showing a clear RED stockout scenario
- [ ] Validate the chart communicates the risk clearly
- [ ] Then create `backend/src/engines/projection.js`:
      Input: available_stock, avg_daily_demand, confirmed_POs with ETAs
      Output: `[{ date, projected_stock }]` array for 90 days
- [ ] Add `GET /api/skus/:id/projection` endpoint
- [ ] Wire chart to real endpoint

---

## TASK-08 — Build backend engines + seed data
Now that the UI is validated, build the backend to match exactly what the frontend needs.

- [ ] Create `backend/src/db/seed.js` — 10 rice SKUs + 180 days of sales transactions
      Deliberately include: near-stockout, overstock, idle, ageing scenarios
- [ ] Create `backend/src/engines/velocity.js` — rolling sales velocity (30/60/90/180d), trend
- [ ] Create `backend/src/engines/health.js` — GREEN/YELLOW/ORANGE/RED per SKU
- [ ] Create `backend/src/engines/classification.js` — Fast/Normal/Slow/Idle
- [ ] Create `backend/src/engines/alerts.js` — generates typed alerts with messages + recommended actions
- [ ] Unit test each engine with `node -e` before wiring to routes

---

## TASK-09 — Build backend API routes
- [ ] `GET  /api/skus` — all SKUs with all computed fields
- [ ] `GET  /api/skus/:id` — single SKU full detail
- [ ] `POST /api/skus` — create SKU
- [ ] `PUT  /api/skus/:id` — update SKU
- [ ] `GET  /api/dashboard/stats` — KPI summary
- [ ] `GET  /api/alerts` — all unacknowledged alerts
- [ ] `POST /api/alerts/:id/acknowledge` — mark acknowledged
- [ ] `GET  /api/inventory` — inventory positions
- [ ] `POST /api/inventory/restock` — add stock
- [ ] `GET  /api/sales/velocity` — velocity per SKU
- [ ] `GET  /api/skus/:id/projection` — 90-day projected curve
- [ ] `POST /api/decisions` — record manager decision
- [ ] `GET  /api/decisions` — decision audit log
- [ ] Remove old `/api/products` routes

---

## TASK-10 — Wire frontend to real backend
Swap mock data imports for real API calls. The UI should not change — only the data source.

- [ ] Update `frontend/src/api/inventory.js` with all new endpoints
- [ ] Replace mock imports in Dashboard, Inventory, Alerts pages with API calls
- [ ] Add loading states and basic error handling (show "Failed to load" not blank screen)
- [ ] Verify all 10 seeded SKUs appear with correct health statuses
- [ ] Verify all 6 alert types appear from seed data
- [ ] Verify restock modal writes to DB and updates the table

---

## TASK-11 — Build AI explanation layer
LLM activates ONLY when a human explicitly clicks "Ask AI". No automatic calls.

- [ ] Create `backend/src/routes/explain.js`
  - `POST /api/explain/:skuId`
  - Fetches all computed data for that SKU
  - Assembles structured context (no raw numbers passed to LLM — only labelled fields)
  - Calls LLM, returns plain-English explanation + recommended action
  - LLM never performs calculations — it only explains what the engines already computed
- [ ] Replace mock "Ask AI" placeholder (from TASK-05) with real API call
- [ ] Show response in modal: labelled "AI Explanation", with disclaimer "AI-generated — requires manager review"
- [ ] Log every LLM call to `audit_log` table (timestamp, sku_id, input_context, llm_response)
- [ ] "Ask AI" button only visible on ORANGE and RED items — hidden on GREEN

---

## TASK-12 — Wire approval workflow to backend
Replace the UI-only buttons from TASK-05 with real API calls.

- [ ] Wire Approve / Modify / Reject buttons to `POST /api/decisions`
- [ ] Add Decision Log section to Alerts page — shows past decisions from `GET /api/decisions`
- [ ] Each decision row shows: SKU, what AI recommended, what manager decided, reason, timestamp
- [ ] Verify a full loop: alert appears → Ask AI → explanation shown → manager approves → decision logged

---

## TASK-13 — Sidebar badge + final polish
- [ ] Add live unacknowledged alert count badge to Alerts nav item
- [ ] Confirm app title/branding is "StockSense"
- [ ] Remove any leftover generic product references from the original boilerplate

---

## TASK-14 — End-to-end verify + commit
- [ ] Full run: backend + frontend together, no errors in console
- [ ] All 4 health statuses visible across 10 SKUs
- [ ] All 6 alert types present
- [ ] Projection chart renders for at least one SKU
- [ ] "Ask AI" returns a real LLM explanation on a RED SKU
- [ ] Approving a recommendation writes to decisions table
- [ ] `git add . && git commit -m "MVP 1 complete: rice inventory visibility + AI explanation + approval workflow"`
- [ ] Push to GitHub
