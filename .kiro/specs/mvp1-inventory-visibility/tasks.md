# MVP 1 — Inventory Visibility: Tasks

Work through these in order. Each task is self-contained and testable before moving on.

---

## TASK-01 — Install SQLite and set up database layer
- [ ] Install `better-sqlite3` in backend
- [ ] Create `backend/src/db/init.js` — creates all 5 tables on startup
- [ ] Create `backend/src/db/seed.js` — seeds 10 rice SKUs, inventory positions, 180 days of sales data
- [ ] Wire `init.js` and `seed.js` into `backend/src/index.js`
- [ ] Verify: `node src/index.js` starts cleanly and `stocksense.db` is created
- [ ] Add `backend/data/stocksense.db` to `.gitignore`

---

## TASK-02 — Build calculation engines
- [ ] Create `backend/src/engines/velocity.js` — sales velocity for all windows (30/60/90d), velocity trend
- [ ] Create `backend/src/engines/health.js` — GREEN/YELLOW/ORANGE/RED per SKU using design rules
- [ ] Create `backend/src/engines/classification.js` — Fast/Normal/Slow/Idle per SKU
- [ ] Create `backend/src/engines/alerts.js` — generates typed alerts with messages and recommended actions
- [ ] Unit test each engine with console.log before wiring to routes

---

## TASK-03 — Build backend API routes
- [ ] `GET /api/skus` — returns all SKUs with computed fields (available_stock, days_of_stock, health_status, movement_class, velocity_trend)
- [ ] `GET /api/skus/:id` — single SKU with full detail
- [ ] `POST /api/skus` — create new SKU
- [ ] `PUT /api/skus/:id` — update SKU
- [ ] `GET /api/dashboard/stats` — KPI summary object
- [ ] `GET /api/alerts` — all active (unacknowledged) alerts
- [ ] `POST /api/alerts/:id/acknowledge` — mark alert acknowledged
- [ ] `GET /api/inventory` — inventory positions
- [ ] `POST /api/inventory/restock` — add stock to a SKU
- [ ] `GET /api/sales/velocity` — velocity per SKU
- [ ] Remove old `/api/products` routes

---

## TASK-04 — Update frontend API client
- [ ] Replace `frontend/src/api/inventory.js` with new endpoints matching TASK-03
- [ ] Add: `getSkus()`, `getSku(id)`, `getDashboardStats()`, `getAlerts()`, `acknowledgeAlert(id)`, `restockSku(id, qty)`, `createSku(data)`

---

## TASK-05 — Rebuild Dashboard page
- [ ] 7 KPI stat cards using real data from `/api/dashboard/stats`
- [ ] Health distribution pie chart (GREEN/YELLOW/ORANGE/RED counts)
- [ ] Top 5 stockout risk bar chart (days of stock, sorted ascending)
- [ ] Movement class breakdown bar chart
- [ ] Top 8 alerts table (severity sorted)
- [ ] Ageing inventory list (At Risk and Ageing status items)

---

## TASK-06 — Rebuild Inventory page
- [ ] Update table columns: SKU ID, Product, Variety, Origin, Physical Stock, Available Stock, Days of Stock, Movement Class, Health Status, Actions
- [ ] Search by name/variety/supplier
- [ ] Filter by movement class, health status, country of origin
- [ ] Sortable columns
- [ ] Inline stock bar (available vs max)
- [ ] Health badge (GREEN/YELLOW/ORANGE/RED colour coded)
- [ ] Restock modal
- [ ] Add SKU modal with rice-specific fields

---

## TASK-07 — Rebuild Alerts page
- [ ] Summary count cards per alert type (STOCKOUT_RISK, REORDER, OVERSTOCK, SLOW_MOVING, IDLE, AGEING)
- [ ] Filter tabs
- [ ] Alert cards with: SKU name, alert type, severity badge, triggered value vs threshold, plain-English message, recommended action, Acknowledge button
- [ ] Acknowledge removes alert from active list

---

## TASK-08 — Update Sidebar navigation
- [ ] Add alert count badge on Alerts nav item (live count of unacknowledged alerts)
- [ ] Update app title/branding if needed

---

## TASK-09 — Verify end-to-end and commit
- [ ] Start backend: `npm run dev` — confirm DB loads, seed runs, all routes return data
- [ ] Start frontend: `npm run dev` — confirm dashboard loads with real rice data
- [ ] Confirm all 4 health statuses appear across the 10 seeded SKUs
- [ ] Confirm alerts page shows at least one of each alert type from seed data
- [ ] Run `git add . && git commit -m "MVP 1: SQLite + rice inventory visibility"` 
- [ ] Push to GitHub
