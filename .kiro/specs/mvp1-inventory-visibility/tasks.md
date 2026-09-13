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

## TASK-07 — Build projected inventory curve ✅ 2026-09-12
Original plan was mock-first ("best done after UI is validated"); skipped straight to the real backend
instead, consistent with how TASK-09/10/12 were done this session — the real backend already existed
by this point, so there was nothing left to validate a mock against.

- [x] Created `backend/src/engines/projection.js`:
      `projectInventory({ availableQty, dailyDemand, openPos, safetyStockMt, reorderPoint, days })` →
      `{ curve, first_stockout_date, first_safety_breach_date, lowest_position, lowest_date, recovery_date }`.
      Flat daily-demand depletion, stepped up by open POs on their ETA day. Reused two ways: full
      90-day run for the chart; a `days: lead_time_days` run to feed `suggested_order_qty` (REQ-15),
      retiring the old snapshot-based proxy — same function, both callers, no duplicate logic.
- [x] Added `GET /api/skus/:id/projection` to `backend/src/routes/inventory.js`
- [x] Added the projection chart to the SKU detail view — **design decision**: this app has no
      separate detail page, so it's a new "Projected Inventory (90 Days)" read-only section inside the
      existing `SkuEditForm` modal (`frontend/src/pages/Inventory.jsx`), which already carries the
      SKU's other read-only current-position context. Line chart (recharts, already a dependency) with
      reference lines for safety stock, reorder point, and max stock; summary line states the first
      stockout date in red or "No stockout projected within 90 days" in green.
- [x] Verified via `curl` against the seeded stockout-risk SKU (TJ-25KG, no open PO): curve declines at
      its exact blended daily rate, `first_stockout_date` lands within its lead time, matching its
      existing `STOCKOUT_RISK` alert; verified an overstocked SKU with an inbound PO (VF-10KG) shows
      the correct step-up on the PO's ETA day and "No stockout projected"
- [x] Verified `suggested_order_qty` changed sensibly across all 10 seeded SKUs after the formula swap
- [x] Browser-verified the chart renders correctly across Light / Dark / Glass themes

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

## TASK-09 — Build backend API routes ✅ 2026-09-12
Real routes over the SQLite schema + analytics engine, `backend/src/routes/inventory.js` (new file,
mounted at `/api` alongside the untouched legacy `/api/products`).

- [x] `GET  /api/skus` — all SKUs with all computed fields
- [x] `GET  /api/skus/:id` — single SKU full detail
- [x] `POST /api/skus` — create SKU
- [x] `PUT  /api/skus/:id` — update SKU
- [x] `GET  /api/dashboard/stats` — KPI summary (`{ ...portfolioStats, asOf, primaryExceptions }`)
- [x] `GET  /api/alerts` — live alerts materialized against `alerts_log` (dedupe_key-keyed; acknowledged ones suppressed)
- [x] `POST /api/alerts/:id/acknowledge` — mark acknowledged
- [x] `POST /api/inventory/restock` — add stock
- [ ] `GET  /api/inventory`, `GET  /api/sales/velocity` — **not built as separate endpoints**; `/api/skus` already carries position + velocity fields merged in via `buildAnalytics`, so a redundant endpoint would just duplicate it
- [x] `GET  /api/skus/:id/projection` — added with TASK-07; returns the projection curve plus
      `{safety_stock_mt, reorder_point_suggested, reorder_point_policy, target_stock, max_stock}`
      reference thresholds for chart annotation
- [ ] `POST /api/decisions`, `GET  /api/decisions` — deferred to TASK-11/12 (Ask AI + approval persistence), so as not to half-build the same surface twice
- [ ] Remove old `/api/products` routes — left in place; separate legacy in-memory demo store, doesn't conflict

---

## TASK-10 — Wire frontend to real backend ✅ 2026-09-12
Swapped mock data imports for real API calls in Dashboard, Inventory, and Alerts. Also fixed a
pre-existing crash bug found in scope: `Alerts.jsx`'s Approve/Modify/Reject buttons referenced an
out-of-scope `setApprovalModal` identifier and threw `ReferenceError` on click — now correctly call the
`onApprove` prop. `Ask AI` and decision-recording stay local-only/mock — explicitly deferred to TASK-11/12.

- [x] Rewrote `frontend/src/api/inventory.js` with all new endpoints (`getSkus`, `getSku`, `createSku`,
      `updateSku`, `restockSku`, `getDashboardStats`, `getAlerts`, `acknowledgeAlert`)
- [x] New `LoadingState`/`ErrorState` shared components; replaced mock imports in Dashboard, Inventory,
      Alerts with live `useEffect` fetches
- [x] Loading states and error handling — "Failed to load" + Retry, never a blank screen
- [x] Verified all 10 seeded SKUs appear with correct health statuses (live, via browser pass)
- [x] Verified all 6 alert types appear from seed data
- [x] Verified restock, SKU edit, and Add SKU all persist to SQLite — confirmed via hard page refresh
- [x] Verified alert Dismiss persists across refresh; Approve/Modify/Reject no longer crash
- [x] Fixed a real shape mismatch found in verification: `stats.coverage` nests `pct` under
      `above`/`below` in the backend (`{above:{value,pct}}`), unlike the old mock's flat
      `abovePct`/`belowPct` — `Dashboard.jsx` now reads the correct nested shape
- [x] Fixed a real unit-label bug found in verification: `Alerts.jsx` labelled REORDER's `triggered_value`
      (an MT quantity) as "days" and SLOW_MOVING's (a day count) as "MT" — swapped to match
      `backend/src/engines/alerts.js`'s actual units

---

## TASK-11 — Build AI explanation layer ⏸ blocked 2026-09-12
LLM activates ONLY when a human explicitly clicks "Ask AI". No automatic calls.

**Provider decided, not yet started**: Anthropic Claude API (`@anthropic-ai/sdk`, `ANTHROPIC_API_KEY`) —
chosen over AWS Bedrock (more setup) and OpenAI. Blocked on the user having an API key available; they
were away from their setup when this came up, so TASK-12 (below, no external dependency) was done
instead in the meantime. Pick this back up once the key is available — nothing else about the plan
changes.

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

## TASK-12 — Wire approval workflow to backend ✅ 2026-09-12
Replace the UI-only buttons from TASK-05 with real API calls. Done ahead of TASK-11 since it has no
external dependency (LLM key) — a manager can approve/modify/reject the rule-based
`recommended_action` without "Ask AI" being wired yet.

- [x] `GET /api/decisions` / `POST /api/decisions` added to `backend/src/routes/inventory.js`
      (LEFT JOIN to `skus` for `sku_name`, since `decisions` only stores `sku_id`)
- [x] Wired Approve / Modify / Reject buttons to `POST /api/decisions` (`Alerts.jsx: handleDecision`,
      now async; still calls `acknowledge(alert.id)` after a successful decision, same as before)
- [x] Decision Log section now loads from `GET /api/decisions` (fetched alongside alerts on page load)
- [x] Each decision row shows: SKU, trigger type, AI-recommended qty, manager decision, qty approved,
      reason, timestamp
- [x] Verified the full loop via browser: alert → Approve (with quantity + reason) → row appears in
      Decision Log with correct SKU name → **hard refresh** → row still there, alert stays dismissed
- [x] Fixed a bug hit during verification: the `POST /api/decisions` response didn't include `sku_name`
      (only `GET` had the join), so the row briefly showed a blank SKU column until refresh — added the
      same join to the POST handler's return query
- [ ] Full loop including "Ask AI" itself — waiting on TASK-11's API key; `handleAskAI` /
      `MOCK_AI_EXPLANATIONS` are untouched placeholders in the meantime

---

## TASK-13 — Sidebar badge + final polish ✅ 2026-09-12
- [x] Add live unacknowledged alert count badge to Alerts nav item — `Sidebar.jsx` was still importing
      the static `mock/alertsData.js` and computing the count once at module load (never updated); now
      fetches `api.getAlerts()` and refetches on every route change (`useLocation().pathname` as the
      effect dependency), since the sidebar persists across navigation rather than remounting per page.
      Verified: dismissed an alert on `/alerts` (7→6), badge stayed 7 until navigating to `/dashboard`,
      then updated to 6 — confirms the refetch-on-navigate design works as intended.
- [x] App title/branding is "StockSense" throughout — already correct, no change needed
- [x] No leftover generic product references from the original boilerplate — the only "product" hits in
      the codebase are natural-language uses (e.g. "click a product to open its full record"), not stale
      boilerplate; nothing to fix

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

---

## TASK-15 — Domain terminology & formula alignment (2026-09-12)
Triggered by two real-world rice-inventory-operations documents a teammate supplied. See
`reference/rice-inventory-technical-spec.md`, `reference/rice-inventory-terms-glossary.md`, and
`reference/terminology-map.md` (the master rename spec this task executes against) plus the amended
`requirements.md` / `design.md`. **Scope: naming + formula correctness only** — no movement ledger, no
lot/batch, no backend wiring. See requirements.md "Explicitly Deferred" for what's consciously
out of scope.

- [x] Write `reference/rice-inventory-technical-spec.md`, `reference/rice-inventory-terms-glossary.md`, `reference/terminology-map.md`
- [x] Amend `requirements.md`, `design.md` with renamed fields/formulas, REQ-14/15/16/17, "Explicitly Deferred" section
- [x] Amend `.kiro/steering/project-context.md` "Key Domain Concepts" with the corrected canonical definitions
- [x] Backend rename + formula fixes (`backend/src/db/init.js`, `seed.js`, `engines/*.js`) — applied every row of `terminology-map.md`; `health.js` is the canonical rule set; Compliance Position added to `financials.js: portfolioStats` (portfolio-level, not per-SKU)
- [x] Verify backend: `cd backend && npm run seed && npm run analytics` — passes, all 10 SKUs + alerts + compliancePosition compute correctly
- [x] Frontend mock rename + formula fixes (`mock/analytics.js`, `mock/riceData.js`, `mock/statsData.js`, `mock/alertsData.js`) — ported the reconciled health-status rules into `deriveHealthStatus`; de-duplicated `on_order`/`incoming_stock` → `expected_incoming_qty`; removed the stale hand-set `inventory_position` from all 10 mock rows (now always computed); added `suggested_order_qty` and `inventory_position` to `computeSkuAnalytics`; dropped the `overstockedValue`/`slowIdleValue` legacy aliases
- [x] Frontend component call-site updates (`Dashboard.jsx`, `Inventory.jsx`) — grepped every old identifier, updated. Rename only, no logic changes.
- [x] "Not Applicable" rendering for zero-demand Days of Cover — existing "No demand"/"Idle — no recent demand" copy already satisfies this (non-blank, non-infinite); no change needed
- [x] Compliance Position KPI card added to the Dashboard (illustrative label present)
- [x] Data Status (`as_of`) timestamp label added to the Dashboard header
- [x] `cd frontend && npx vite build` passes
- [x] Browser smoke test across Light / Dark / Glass themes: Dashboard (incl. new Compliance + Data Status), Inventory table + Edit SKU modal + hover tooltips, Alerts page — all verified via claude-in-chrome
- [x] `grep` every old identifier from `terminology-map.md` across backend/src and frontend/src — zero hits outside reference docs and historical comments

## TASK-16 — Visual design overhaul: foundation + Dashboard + Inventory (2026-09-12)
Triggered by direct user feedback that the app "looks AI-generated," feels "clunky and cluttered,"
and overwhelms with "so much text and toggles." Researched current industry-standard minimalist/
progressive-disclosure patterns (Linear, Stripe, Notion, Vercel, Mercury, Apple HIG) before making
changes. **Direction: Linear-style** — near-zero chrome, hairline dividers instead of boxed/shadowed
cards, monochrome-first with color reserved for state/severity only. **Scope**: design-system
foundation + Dashboard rebuild + Inventory's `SkuEditForm` restructuring; Alerts got a token/color
pass only (no structural change), which also fixed a real bug (see below).

- [x] `frontend/src/index.css` — added an 8px spacing scale (`--space-1`…`--space-8`) and a type
      scale (`--text-xs`…`--text-2xl`); added `.surface-flat` / `.divider` (hairline `border-bottom`)
      to replace boxed-and-shadowed cards as the default in-page separator; `--shadow`/`--shadow-md`
      kept, now reserved for things that should genuinely float (modals/popovers)
- [x] `StatCard.jsx` rewritten: dropped the old per-metric decorative icon-background `color` prop;
      new `status: "ok" | "warn" | "bad"` (default `"ok"`) is the only source of color, applied only
      when a metric is actually a problem — icon renders muted otherwise
- [x] `Dashboard.jsx` rebuilt: Total Inventory Value promoted to a large hero number with a hairline
      divider beneath; the other 6 core KPIs demoted into a tighter unboxed `StatCard` strip (still
      all visible without a click — dense B2B ops tools demote, they don't hide); added one real
      disclosure toggle ("Show more metrics") for the two genuinely situational numbers (Compliance
      Position, Coverage-in-Target-Band); `Card` renamed to `Section`, stripped of
      border/shadow/accent-stripe; Health-by-Value bar, Exception rows, Top Actions re-skinned to
      hairline accents + token spacing
- [x] `Inventory.jsx`'s `SkuEditForm` restructured into 3 tabs — the direct fix for "bunch of text
      box fields": **Overview** (default; StockPositionBar, current position, the new projection
      chart, recommended action — zero editable fields), **Policy** (the Inventory Policy sliders,
      live preview, warnings), **Details** (Identity/Costs/Stock Adjustments). One persistent
      Save/Cancel footer beneath regardless of active tab — single form state underneath, only the
      visible section changes
- [x] `Alerts.jsx` — replaced every hardcoded `#fff`/hex color with the matching CSS variable
      (`var(--card-bg)`, `var(--modal-bg)`, `var(--surface)`, `var(--text-*)`, severity colors);
      fixes a real pre-existing bug where the page never picked up the theme system and stayed
      light-only regardless of Dark/Glass. Structure/buttons intentionally unchanged this pass.
- [x] Fixed a real, pre-existing functional bug found during save-flow verification: `SkuEditForm`'s
      "Save changes" produced **zero visible effect** for TJ-25KG (no network call, no error, modal
      stayed open). Root cause: `FormField.jsx`'s `SliderField` paired number `<input>` shared its
      `step` attribute with the range slider; TJ-25KG's seeded `reorder_point_policy = 302` isn't a
      multiple of the Policy slider's `step={5}`, so the browser's native HTML5 constraint validation
      silently blocked the entire form's submit event before React ever ran. Fixed by hardcoding that
      input's `step="any"`, decoupled from the slider's own `step` (which stays as-is for dragging).
      Checked all 10 seeded SKUs' policy values — TJ-25KG was the only one not a multiple of 5, so
      this was a narrow but real landmine; the fix is general and covers any future non-round value.
- [x] `npx vite build` clean
- [x] Browser-verified across Light/Dark/Glass: Dashboard (hero, demoted strip, toggle, no stray
      shadows/boxes), Inventory table, SKU edit modal (opens on Overview with no fields shown,
      Policy/Details reachable), Alerts (now correctly themed in Dark/Glass)
- [x] Verified the `step="any"` fix end-to-end: `PUT /api/skus/TJ-25KG` now fires on Save, modal
      closes, and the saved `reorder_point_policy` value survives a hard refresh

---

## TASK-17 — Bug-finding & improvement pass (2026-09-12)
Post-commit reiteration: exploratory testing (zero-value SKU, Add SKU, Approve/Reject flow) plus a
code audit, looking for both functional and visual defects across the now-committed overhaul.

- [x] Fixed `backend/src/engines/projection.js`: `lowest_date` rendered blank whenever day 0 was the
      curve's actual lowest point (e.g. a flat zero-demand curve) — the tracking variable was seeded
      with `date: null` instead of day 0's own date, and the loop only overwrites it on a *strictly
      lower* value, so that seed was never replaced. Seeded with the real day-0 date instead.
- [x] Fixed `ProjectionChart` (Inventory.jsx): a SKU already at/below zero stock showed "⚠ Stockout
      projected {today's date}" — technically true but reads as a forecast for something that isn't
      a future event. Now shows "⚠ Already out of stock" when the stockout date is day 0, and the
      normal "Stockout projected {date}" copy only for an actual future date.
- [x] Fixed a real cross-engine inconsistency found via a deliberately empty test SKU (0 on-hand,
      0 demand, Idle): `Dashboard.jsx`'s `buildTodayActions` re-implements "is this SKU idle" locally
      instead of consuming the backend's `alerts`, and its filter (`movement_class === "Idle"`) was
      missing the `available_qty > 0` guard that both `health.js`'s RED rule and `alerts.js`'s IDLE
      alert already have — so a SKU the edit modal correctly called "Healthy, no action required"
      simultaneously showed up in the Dashboard's "Today's Top Actions" as a critical "Initiate
      disposition review". Added the matching guard. Longer-term, `buildTodayActions` re-deriving its
      own alert rules instead of reading `primaryExceptions` from the API is worth revisiting — three
      independent implementations of the same rule (health.js, alerts.js, Dashboard.jsx) is exactly
      how this drift happened.
- [x] Renamed `buildTodayActions`/`buildCoverageData`'s stale `mockSkus` parameter to `skus` — a
      leftover name from before TASK-10 rewired the Dashboard to live API data; purely cosmetic.
- [x] Verified via browser: zero-value SKU creation and edit (no crash, sane "No stock policy set" /
      "No demand" copy), Alerts Approve flow end-to-end (Manager Decision modal → `POST /api/decisions`
      → Decision Log row with the entered reason → alert count and per-type badges update correctly),
      Dashboard "Show more metrics" toggle.
- [x] Investigated washed-out text in the SKU edit modal under Glass theme; root-caused to a browser
      extension (`spoken-word` read-aloud highlighter) injecting global text-dimming styles into this
      testing profile, confirmed via `getComputedStyle` showing settled (non-transitioning) colors no
      app stylesheet declares, and `html > *` listing extension-injected elements. Not an app bug —
      no code change.
- [x] Noted, not fixed: a SKU created with every policy field left at 0 (min/target/max/reorder all
      0) computes `health_status = GREEN` — none of health.js's rules fire because they all require
      either `days_of_cover != null` or `available_qty > 0`. Defensible for a genuinely empty,
      never-sold item (nothing to fail), but showing a confident green "Healthy" badge next to
      "No stock policy set" reads oddly. Worth deciding deliberately (e.g. a distinct "Unconfigured"
      state) rather than fixing reactively — flagging for a product decision, not a code fix.
- [x] Noted, not fixed: `AddSkuForm` (Inventory.jsx) still shows all ~14 identity + policy fields at
      once — the same pattern SkuEditForm was restructured away from in TASK-16. Left as-is since a
      create flow legitimately needs every field before the record can exist (unlike editing, there's
      no "current state" to default to an Overview-only view of); revisit if it starts feeling heavy
      in practice.
- [x] Fixed a significant latent bug in `backend/src/db/seed.js`: `npm run seed` failed with
      `SQLITE_CONSTRAINT_FOREIGNKEY` as soon as any row existed in `decisions` (TASK-12's Approve/
      Modify/Reject audit table, which has a `sku_id` FK) — the wipe list predates that table and was
      never updated to clear it before `skus`. Never surfaced before because no session had recorded
      a real decision and then reseeded; hit it directly while cleaning up test data after the Approve
      flow verification above. Added `decisions` to both the DELETE loop and the `sqlite_sequence`
      reset, ordered before `skus`. This would otherwise have permanently blocked reseeding the demo
      database the first time anyone used the approval workflow for real.
- [x] `npx vite build` clean after all fixes

---

## TASK-18 — Second bug-finding pass: Alerts decision flow (2026-09-12)
Continued the reiteration into `Alerts.jsx`'s Approve/Modify/Reject and Ask AI paths.

- [x] Fixed a real content-mismatch bug: "Ask AI" looked up `MOCK_AI_EXPLANATIONS` by numeric
      `alert.id`, hand-written years ago against the old mock alert set. Now that `alert.id` comes from
      the live `alerts_log` table, that lookup only lined up with the hand-written text by coincidence
      for one alert — every other click showed a different SKU's canned explanation attributed to
      whatever was actually clicked. Replaced with `buildFallbackExplanation(alert)`, synthesized from
      the alert's own already-correct `message`/`recommended_action`/`ai_recommendation_qty` fields, so
      it's always accurate regardless of which alert is clicked. (Still a rule-based placeholder, not a
      real LLM call — TASK-11 remains blocked on an API key.)
- [x] Fixed a real validation gap in `ApprovalModal`: the "Reason / Notes" label shows a required red
      `*` for Modify/Reject, but nothing actually enforced it — a Reject could be recorded with an
      empty reason, leaving no audit trail for why. Added real enforcement (red border + inline error +
      disabled submit) matching the label.
- [x] Fixed a real silent-failure bug: `handleDecision` caught its own errors (console.error only) and
      unconditionally closed the modal in a `finally` block — a failed `POST /api/decisions` looked
      identical to a successful one, with the user's typed reason silently discarded and no error
      shown. Reworked the contract so the parent no longer swallows the error: `ApprovalModal` now
      awaits `onDecide`, shows `submitError` inline, and keeps the modal (and what the user typed) open
      on failure; it also gained a `saving` state disabling both buttons mid-request to prevent a
      double-click from recording the same decision twice.
- [x] Fixed the Decision Log's "AI Recommended" column: it only ever read `ai_quantity`, falling back
      to a bare, meaningless `"Review"` literal for every qualitative alert (idle, ageing, slow-moving)
      that doesn't have a quantity — even though the real recommendation text (`ai_recommendation`) was
      already stored and returned by the API right alongside it. Now shows that text (truncated with a
      full-text tooltip) instead of the placeholder.
- [x] Verified via browser: Ask AI now shows content matching the clicked alert's own SKU/type; Reject
      and Modify both correctly block submission on an empty reason and re-enable live as text is
      typed; a completed Reject appears in the Decision Log with the real recommendation text visible.
- [x] Verified Inventory table sort (ascending/descending, multiple columns) and the three native
      `<select>` filters (Health Status/Movement/Origin) both work correctly — an initial "nothing
      happens on click" observation for the filters was a false alarm: native `<select>` popups don't
      render in an automated screenshot even when functioning correctly; confirmed via direct DOM
      value-change instead.
- [x] Checked the Modify/Approve quantity input for the same class of HTML5 `step`-mismatch bug fixed
      earlier in `FormField.jsx` — not present here: every `ai_recommendation_qty` alerts.js produces
      is either `Math.round()`ed to an integer, exactly `0`, or `null` (which hides the field entirely),
      so it can never land on a non-integer value the `step={1}` input would silently reject.
- [x] `npx vite build` clean after all fixes

---

## TASK-19 — Third bug-finding pass: Restock validation + server-side input hardening (2026-09-12)
Continued the reiteration into the Restock flow, table sort/filter, and backend input validation.

- [x] Fixed a real feedback gap in the Restock modal: entering 0, a negative number, or a
      non-numeric quantity and clicking "Confirm Restock" silently did nothing — `handleRestock`'s
      guard clause just `return`ed with no message. The `<input type="number" min={0.1}>` attributes
      look like validation but never actually run, since this button isn't a form submit and HTML5
      constraint validation only fires on submit. Added an inline "Enter a quantity greater than 0."
      error (cleared live as the user retypes), matching the pattern already used elsewhere.
- [x] Fixed a real, if low-severity, robustness gap: `POST /api/skus` and `PUT /api/skus/:id` accepted
      any numeric value for policy/cost fields with zero server-side validation — confirmed via curl
      that `PUT {min_stock: -500}` was accepted and stored as-is. The only guard was client-side
      (`SkuEditForm`/`AddSkuForm`'s "Must be ≥ 0"), trivially bypassed by any direct API call. Added
      `validateNumericFields()` in `routes/inventory.js`, applied to both routes: rejects negative
      values for every policy/cost/adjustment field, and additionally caps `target_service_level` at 1
      (it's a probability). Verified via curl: negative values and `target_service_level > 1` are now
      rejected with a 400, valid updates still succeed.
- [x] Verified via browser: a large legitimate restock correctly clears the SKU's STOCKOUT_RISK alert
      and raises a brand-new OVERSTOCK alert automatically on next load — confirms the alert engine
      reacts live to state changes with no explicit dismiss needed, and validates `materializeAlerts`
      handles a dedupe_key's first-ever appearance correctly (not just the already-tested "stays
      suppressed after dismiss" path).
- [x] Verified via browser: duplicate SKU ID creation shows a clear inline error in `AddSkuForm`
      ("SKU TJ-25KG already exists") rather than failing silently or crashing.
- [x] Investigated the Inventory table's `ABC × XYZ Segmentation` matrix: cell intensity tint is a
      hardcoded `rgba(59,130,246,...)` (Light theme's `--blue`), not a CSS variable — in Glass theme
      (`--blue: #58a6ff`) this cell color doesn't quite match the rest of the UI's blue accent. Minor,
      cosmetic-only, theme-specific mismatch; not fixed this pass since a proper fix needs an RGB-triplet
      CSS variable (e.g. `--blue-rgb`) added to the design-system foundation, not a one-line patch —
      worth doing together with any future pass over the remaining hardcoded rgba() usages, rather than
      as a one-off.
- [x] Confirmed (no bug): `alerts_log`'s "dismiss is a one-way step, even if the condition recurs"
      behavior is already explicitly documented in `routes/inventory.js` as intentional MVP scope, not
      an oversight — left alone.
- [x] `npx vite build` clean after all fixes; backend smoke test (`npm run analytics`) matches baseline

---

## TASK-20 — Fourth bug-finding pass: modal keyboard/scroll consistency (2026-09-12)
- [x] Fixed a real UX inconsistency: `Inventory.jsx`'s `Modal` component (SKU edit, Add SKU, Restock)
      closes on Escape and locks background scroll while open; `Alerts.jsx`'s two custom modals
      (`AiModal`, `ApprovalModal`) had neither — Escape silently did nothing on the Alerts page, and
      the alert list behind them could still scroll. Extracted the same behavior into a
      `useModalEscape(onClose)` hook and applied it to both; `ApprovalModal`'s is guarded to no-op
      while `saving` is true, matching its Cancel button already being disabled mid-save.
- [x] Verified via browser: Escape now closes both the AI Explanation and Manager Decision modals.
- [x] Verified the Inventory table's empty-filter state (a search matching zero SKUs) renders a clean
      "No SKUs match your filters." row rather than a broken/empty table — no bug found.
- [x] `npx vite build` clean

---

## TASK-21 — Fifth bug-finding pass: theme tokens + code review of remaining engines (2026-09-12)
- [x] Fixed a leftover hardcoded color: `Sidebar.jsx`'s alert-count badge used `background: "#ef4444"`
      directly instead of `var(--red)`. Harmless in Light/Dark (where `--red` happens to equal that
      exact hex), but Glass theme's `--red` is `#f85149` — a visibly different shade the badge never
      picked up. Fixed and verified via zoomed screenshot in Glass theme.
- [x] Checked `Inventory.jsx`'s `HEALTH_DOT` (also hardcoded hex) against this same pattern — left
      alone: it mirrors `Badge.jsx`'s already-documented, deliberate precedent of fixed severity colors
      for RED/ORANGE/YELLOW/GREEN (there's no `--orange` token at all, by design), not an oversight.
- [x] Code-reviewed the four backend engines not yet examined this session (`velocity.js`,
      `safetystock.js`, `classification.js`, `segmentation.js`) for division-by-zero and empty-input
      edge cases — all already correctly guarded (`mean === 0` checks, `Math.max(variance, 0)`,
      `avgDailyDemand > 0` gates, `|| 1` fallback on a zero portfolio total). No bugs found.
- [x] Verified `ThemeContext.jsx` persists the theme choice to `localStorage` and restores it correctly
      on load — no bug found.
- [x] Verified `ErrorState`/`LoadingState` end-to-end against a real backend outage (killed the backend
      process, confirmed the Dashboard shows "Request failed (500)" — the 500 comes from Vite's dev
      proxy, not app code — with a working Retry button; restarted the backend and confirmed Retry
      recovers cleanly). No bug found.
- [x] `npx vite build` clean

---

## TASK-22 — Dashboard redesign: declutter + better chart selection (2026-09-12)
Direct follow-up to user feedback that the Dashboard "still feels cluttered" and its charts could be
"redesigned or better selected." Researched current dashboard-design guidance (progressive disclosure,
"≤8-10 primary data points," "single number the user checks most" — see chat for sources) before
proposing anything, then built three concept mockups as an artifact for review before touching code:
**A · Signal First** (merge the three overlapping list widgets into one, donut for health-by-value, ABC×XYZ
behind a disclosure), **B · Command Deck** (denser but every widget gets a purpose-built chart type —
bullet bars, heatmap, small multiples), **C · At a Glance** (one number + one ring + 3 lines, everything
else behind a single toggle — included for contrast, not recommended for a daily ops tool per the B2B
density research from the earlier visual-overhaul pass). Implemented Concept A, the recommended
direction, with one addition borrowed from Concept B (kept the per-SKU coverage bar chart rather than
dropping it, moved into the same disclosure as ABC×XYZ instead of losing it).

- [x] `Dashboard.jsx`: renamed `buildTodayActions` → `buildNeedsAttention` and merged what were three
      separate sections — Today's Top Actions, Open Exceptions, Ageing Inventory — into one ranked list.
      Ageing folds onto an existing row's tag/reason for the same SKU (Japonica renders as one row
      tagged "IDLE STOCK · AGEING", not two rows) or gets its own row when no other exception applies.
      Caught and fixed a regression during this merge: the original `buildTodayActions` never had a
      SLOW_MOVING branch (that only ever surfaced via the separate Open Exceptions widget, sourced from
      the backend's `primaryExceptions`) — without adding it back explicitly, Basmati Premium, Basmati
      Bulk, and Brown Rice Organic would have silently dropped off the merged Dashboard entirely, still
      visible only on `/inventory` and `/alerts`. Added a SLOW_MOVING branch mirroring `alerts.js`'s own
      rule (`movement_class === "Slow Moving" && days_of_cover > 120`) before shipping.
- [x] Replaced the flat `HealthByValueBar` with a `HealthDonut` (real recharts `PieChart`/`Pie`,
      `innerRadius`/`outerRadius`, center label showing the portfolio total) — proportion across four
      categories reads faster as area+angle than as a thin horizontal strip once shares are uneven.
- [x] Moved the per-SKU coverage-vs-lead-time bar chart and the ABC×XYZ matrix into one native
      `<details className="disclosure">` ("Portfolio structure — coverage detail & ABC × XYZ
      segmentation") — genuinely occasional-use analysis, not a daily-glance metric; kept both rather
      than dropping the coverage chart outright, so no analytical capability was actually lost, just
      reorganized. Added the `.disclosure` styles (native, no JS state) to `index.css`.
      "Show more metrics" (Coverage in Target Band, Compliance Position) was left exactly as it was —
      not part of what was being criticized this round.
- [x] Removed the now-dead `ExceptionRow` component and the `Badge` import it was the only user of.
- [x] Published three mockups as a Claude Artifact (built with the `artifact-design` skill) using the
      dashboard's real seeded numbers throughout, with a working concept switcher, before writing any
      product code — caught one thing worth recording: the artifact's interactive switcher initially
      looked broken when tested via raw-pixel-coordinate clicks in the browser-automation tool: a
      synthetic `.click()` on the same element worked instantly, proving the page's own JS was correct
      and the failure was the tooling's screenshot-vs-viewport coordinate scaling (documented earlier
      this session), not a defect — resolved by clicking via element reference instead.
- [x] Verified via browser across Light/Dark/Glass: Needs Attention list (all 6 exceptions present,
      correct severity-colored stripes, Japonica's combined tag), Inventory Health donut (correct
      proportions and center total), disclosure opens/closes and its coverage chart + ABC×XYZ render
      correctly; confirmed Inventory and Alerts pages unaffected (not touched this pass).
- [x] `npx vite build` clean

---

## TASK-23 — Dashboard: switch to Command Deck, add cross-filtering + collapsible sections (2026-09-12)
User picked **Concept B (Command Deck)** over the just-shipped Concept A after seeing both live, plus
three specific asks: keep "vs last month" in full on the hero and add a chart to illustrate it, real
click-to-filter interactivity "like PowerBI" from the charts into a table, ELI18 help tooltips
throughout, and an element of Concept C — optional collapsible sections, so density doesn't have to
mean clutter for a user who doesn't want it.

- [x] Rebuilt the main Dashboard grid to Concept B's composition: Inventory Health (labeled 100%-
      stacked bar, swapped back from TASK-22's donut per the user's explicit preference) and ABC×XYZ
      heatmap in one row; Cover vs Lead+Safety (hand-rolled bullet-chart rows, replacing the old
      recharts grouped-bar chart) and Needs Attention (now a dense `<table>`, not a card list) in the
      row below. The TASK-22 disclosure is gone — in Command Deck these are primary, always-visible
      widgets, not occasional-use detail.
- [x] Added a real two-bar month-comparison chart (`MonthTrendChart`, recharts) next to the hero,
      keeping the existing "▲ $151K **vs last month**" text in full (not shortened, as it had been in
      the concept mockup). Deliberately stayed a two-bar comparison rather than a fabricated multi-point
      trend line — this project has no historical snapshots stored yet, only the current figure and one
      hand-set prior-month figure (see the `PRIOR` constant's existing comment); hover shows the exact
      SGD value per bar via a real recharts `Tooltip`.
      **Scoping note on click-to-filter for this specific chart**: unlike the three widgets below, there
      is no real per-SKU breakdown of the $151K delta to drill into (the total is just two numbers), so
      making it clickable would mean fabricating a breakdown that isn't real data. Left it hover-only;
      the genuine PowerBI-style click-to-filter work went into the three widgets that do have real per-
      SKU data behind them (see below).
- [x] Implemented real click-to-filter cross-highlighting into the Needs Attention table — a single
      active filter (`{type: "health"|"segment"|"sku", value}`), toggled off by clicking the same
      element again, from all three of: a Health-by-Value segment, an ABC×XYZ cell (using the real
      `skus` array each cell already carries — no new backend query), and a Coverage bullet-chart row.
      Selected element gets a visible highlight (outline/border), the other elements in that same chart
      dim slightly, and a "Filtering by X ✕" chip appears above the table with a one-click clear.
      Verified all three filter sources plus the toggle-off and clear-chip paths via browser.
- [x] Added `ColHint` (the existing Inventory-table help-icon component, reused rather than building a
      new one) to every section title and every KPI tile — Total Inventory Value, all 6 KPI tiles,
      Needs Attention, Inventory Health, ABC×XYZ, Coverage, and Coverage-in-Target-Band. Extended
      `StatCard.jsx` with an optional `hint` prop to carry this. Copy is ELI18 throughout — plain
      language, a "What is this?" / "How to read it" split, assumes no prior inventory-ops vocabulary
      (e.g. GMROI, turnover, ABC×XYZ are all explained from scratch) without being condescending.
      Verified rendered content via browser.
- [x] Made all four main widgets independently collapsible (`Section`'s new `collapsible` prop + a
      `useCollapsed` hook backed by `localStorage`, keyed per-widget) — closed/open state persists
      across reloads, so it's a one-time "I don't need this" choice per user/browser, not a per-visit
      toggle. Defaults to open; nothing is hidden unless the user chooses to hide it. Verified a
      collapse survives a hard refresh.
- [x] Verified across Light/Dark/Glass; no console errors across the full interaction set (hover
      tooltips, three filter sources, toggle-off, clear chip, collapse/expand, reload-persistence);
      confirmed Inventory and Alerts pages unaffected (not touched this pass).
- [x] `npx vite build` clean

---

## TASK-24 — Alerts page polish: bring up to the Dashboard's bar (2026-09-12)
User's own priority pick after "suggest next steps": Alerts still structurally predated the Dashboard's
visual-consistency and interaction-pattern work (TASK-22/23) — it only ever got a token/color pass
(TASK-16) since it was explicitly out of scope for restructuring at the time.

- [x] Extracted `useCollapsed` out of `Dashboard.jsx` into a shared `frontend/src/hooks/useCollapsed.js`
      so Alerts could reuse the exact same persisted-collapse behavior instead of duplicating it.
- [x] Fixed a real "two widgets, one job" redundancy — the 6 summary tiles and the filter-pill row below
      them were two separate controls doing the identical thing (filter by alert type, with the same
      counts). Removed the pill row; the tiles are now the sole filter control (they already toggled on
      click), with a "Filtering by X ✕" chip appearing when active — the same pattern used for the
      Dashboard's cross-filter chip, for a consistent interaction language across pages.
- [x] Added `ColHint` (ELI18 "What is this? / How to read it") to all 6 alert-type tiles and to the
      Decision Log header, matching the Dashboard's tooltip coverage and copy style.
- [x] Made the Decision Log section collapsible via the shared hook — it only grows over time and isn't
      something a user needs open on every visit.
- [x] Restyled `AlertCard`: removed the bordered-and-shadowed box treatment (the last page still using
      it) in favor of a hairline-divider row with a colored left accent stripe, matching the rest of the
      app's post-overhaul style. Alert cards are now a continuous list, not a stack of separate cards.
- [x] Fixed a real copy-accuracy issue found while in this file: the AI Explanation modal's disclaimer
      said "AI-generated analysis," which overstates what `buildFallbackExplanation` actually does (a
      rule-based summary of already-computed fields — TASK-11's real LLM call is still blocked on an
      API key). Modal title changed from "AI Explanation" to "Explanation"; disclaimer now says
      "Rule-based summary of the numbers already computed for this SKU — not yet a live AI call."
- [x] Verified via browser across Light/Dark: tile-click filtering + toggle-off + clear-chip, ColHint
      content, Decision Log collapse + persistence, the corrected AI-modal copy, and that Dashboard still
      works correctly after the `useCollapsed` extraction. No console errors.
- [x] `npx vite build` clean

---

## TASK-25 — Dashboard critic pass: critical/high fixes + site-wide font-size increase (2026-09-12)
User asked for a strict UI/UX-critic + data-analyst review of the Dashboard. Findings were ranked by
severity (Critical/High/Medium/Low) and reported for review; user picked the Critical + High sections to
act on now, plus a general font-size increase for older users, "to follow website/mobile site design
guidelines."

- [x] **Honest "vs baseline" relabel.** The hero and every `StatCard` trend arrow said "vs last month,"
      which asserts a real, live month-over-month feed — this project has no stored historical snapshots
      yet; the comparison is a hand-set constant (`PRIOR`) that will silently go stale the moment a real
      month passes without someone updating it by hand. Relabeled to "vs baseline" everywhere in the UI
      (hero text, `StatCard`'s trend title), with the `title`/hover-hint copy spelling out plainly that
      it's a fixed reference point, not live tracking, until historical snapshots are built.
- [x] **Keyboard focus indicator, site-wide.** `index.css` unconditionally set `button { outline: none; }`
      with no replacement anywhere — every interactive control on Dashboard/Alerts (filter chips, chart
      bars/cells/rows, collapse toggles) was keyboard-invisible: a Tab-only user had no way to see where
      focus was. Added a `:focus-visible` outline (`var(--blue)`, 2px) to buttons/links/inputs/selects/
      textareas/`[tabindex]` globally.
- [x] **Touch/keyboard-accessible chart tooltips.** `HealthStack`, `AbcXyzMatrix`, and `CoverageBullets`
      carried their detail in a native `title` attribute only — invisible on touch (no hover to trigger
      it) and inconsistent with the `ColHint`/`HoverHint` pattern already used everywhere else on the
      same page. Replaced all three with `HoverHint` (focus + hover + Escape-to-close, already used by
      `StockPositionBar`), added `aria-label`s so each control has a real accessible name independent of
      the tooltip.
- [x] **Status-threshold recalibration.** Turnover/GMROI/Overstock/E&O only ever resolved to "warn," never
      "ok" or "bad," against the portfolio's real current/prior values (Turnover 3.4×/3.3× vs a <6.0
      "warn" line; GMROI $0.68 vs a <1.5 line that never escalated even here) — amber with no headroom in
      either direction reads as decorative, not a real signal. Added a real "bad" tier to all four:
      Turnover (<2.5 bad / <4.0 warn), GMROI (<1.0 bad / <1.5 warn — now matches its own ColHint copy,
      which already stated $1 as the real breakeven line), Overstock (>10% bad / >5% warn), E&O (>30% bad
      / >15% warn). Coverage-in-Target-Band got the same treatment (<50% bad / <80% warn) as part of the
      next fix.
- [x] **Un-hid Coverage-in-Target-Band.** Only 28.9% of portfolio value sits in the healthy coverage band
      — a genuinely alarming, daily-glance figure — but it was filed under "Show more metrics" on the
      stated grounds that it duplicated Health-by-Value. It doesn't: Health-by-Value buckets by
      RED/ORANGE/YELLOW/GREEN business rules, Coverage-in-Band buckets by below/in/above/idle
      days-of-cover — different lenses. Moved it into the always-visible secondary strip (now 7 KPI
      tiles); the disclosure toggle now holds only Compliance Position (genuinely situational — labeled
      "illustrative, pending governance approval") and was relabeled "Show/Hide compliance position" to
      match.
- [x] **`buildNeedsAttention` no longer silently drops overlapping conditions.** The per-SKU dedup kept
      only the first (lowest-priority-number) match and threw the rest away — a SKU that was both
      Overstock and Slow Moving, say, would show only "OVERSTOCK" with no trace the second condition
      existed (Ageing was the only condition that got folded onto an existing row). Now every matched
      condition folds its tag onto the row (`existing.tag += " · TAG"`) the same way Ageing already did;
      verified live against real data — "Japonica Short Grain 5KG" now correctly reads
      "IDLE STOCK · OVERSTOCK · AGEING" instead of just one of the three.
- [x] **Fixed silent truncation + a latent filter-order bug in Needs Attention.** `buildNeedsAttention`
      used to hard-cap at 8 rows internally with no indication more existed once a real catalog grows
      past that — and because the filter was applied *after* that internal cap, a filter could show "no
      matches" for a real exception whose category simply didn't make the pre-filter top-8 cut. Removed
      the cap from `buildNeedsAttention` (now returns the full sorted list); the cap is applied at the
      call site *after* filtering (`NEEDS_ATTENTION_CAP = 8`), with a "+N more — showing the 8
      highest-priority exceptions" note when the true count exceeds it.
- [x] **Site-wide font-size increase for older users.** `index.css`'s type scale sat at 11–32px with a
      14px body default — below the ~16px web body-text floor that WCAG/Apple HIG/Material Design
      converge on, and several components had sub-12px hardcoded literals bypassing the scale entirely.
      Bumped the whole `--text-*` scale up one step (new floor `--text-xs: 12px`, body/`--text-md: 16px`,
      up to `--text-2xl: 34px`) and the `body` base font-size 14→16px — this cascades through every
      component already using the tokens. Also swept every hardcoded `fontSize:` literal below the new
      floor across `Dashboard.jsx`, `StatCard.jsx`, `Sidebar.jsx`, `Badge.jsx`, `FormField.jsx`,
      `ErrorState.jsx`, `StockPositionBar.jsx`, `hintStyles.js` (the shared ColHint/HoverHint panel text),
      `Inventory.jsx`, and `Alerts.jsx`, bumping each by roughly one step so nothing on the site still
      renders below ~12px.
- [x] Verified via browser across Light/Dark on Dashboard/Alerts/Inventory: relabeled trend text, all 7
      KPI tiles' new status colors against live data (GMROI/E&O/Coverage-in-Band correctly red, Turnover/
      Overstock amber), the folded multi-tag Needs Attention row, HoverHint tooltips firing on hover for
      all three chart widgets (replacing native `title`), a visible focus ring on a real click-triggered
      focus, larger legible type throughout, no layout overflow/clipping from the size increase, and no
      console errors.
- [x] `npx vite build` clean

## TASK-26 — Remove Liquid Glass theme; strip em/en dashes app-wide (2026-09-12)
User feedback: the Liquid Glass theme was "useless," and heavy em/en dash usage throughout the UI copy
and code comments read as an obvious AI-generated tell. Both were fixed, and the dash rule was written
down as a standing instruction for future agent sessions.

- [x] Removed the "Liquid Glass" theme entirely: dropped its entry from `ThemeContext.jsx`'s `THEMES`
      array, deleted its whole `[data-theme="glass"]` color block plus the glass-only backdrop-blur rule
      and the gradient body background from `index.css`, and removed the now-dead `className="glass-blur"`
      references in `Sidebar.jsx` and `Inventory.jsx`. `ThemeProvider` now falls back to "light" if a
      browser has an old "glass" value saved in localStorage, so no one gets stuck on an undefined theme.
- [x] Replaced every literal em dash and en dash in frontend UI copy and code comments (`Dashboard.jsx`,
      `Alerts.jsx`, `Inventory.jsx`, `StatCard.jsx`, `Sidebar.jsx`, `hintStyles.js`, `StockPositionBar.jsx`,
      `FormField.jsx`, `LoadingState.jsx`, `HoverHint.jsx`, `useCollapsed.js`, `api/inventory.js`, and the
      mock data files) with a plain hyphen. Also fixed the backend's actual user-facing strings (the
      `recommended_action` and `message` templates in `engines/alerts.js`, `engines/index.js`, and
      `routes/products.js`) that render on the Alerts page and the SKU detail view. Left backend code
      comments alone (not user-facing, and out of scope for this pass) — see the new style rule below for
      going forward.
- [x] Wrote the "no em/en dash" rule down as a standing instruction for future agent sessions: added a
      new `CLAUDE.md` at the repo root (this project had none) pointing to the existing `.kiro/` docs plus
      the dash rule and the Kiro-hooks tooling note, and added the same rule to
      `.kiro/steering/project-context.md` (its `inclusion: always` frontmatter means Kiro sessions load it
      automatically too).
- [x] Verified via browser: theme switcher now shows only Light/Dark, no console errors, dash-free copy
      renders correctly on Dashboard. `npx vite build` clean.

## TASK-27 — Responsive nav: floating glass top bar on small screens (2026-09-12)
User brainstorm request, given three ASCII-mockup options via AskUserQuestion (floating bottom bar,
floating top bar, expanding FAB). User picked the floating glass top bar.

- [x] `Sidebar.jsx` now renders two markups: the existing full side panel (`.app-sidebar-panel`,
      unchanged) and a new compact `.app-topbar-glass` bar (brand mark, icon-only Dashboard/Inventory/
      Alerts links with the same alert badge, and a single tap to flip Light/Dark). Both always render;
      a CSS media query at 768px is the only thing deciding which one shows, so there is no layout flash
      while JS reads the viewport width.
- [x] The floating bar is a one-off frosted-glass treatment for this one component (`--glass-bar-bg`
      token, `backdrop-filter: blur(20px) saturate(180%)`), not a revival of the removed "Liquid Glass"
      site theme — it works correctly under both Light and Dark.
- [x] `Layout.jsx`'s `<main>` padding moved from inline style to a new `.app-main` class so the same media
      query can retarget it (76px top padding on small screens to clear the fixed bar) without an
      `!important` hack.
- [x] Verified: real window resizing did not change the page's actual viewport in this browser-automation
      environment (a tooling limitation, not a code issue — `window.innerWidth` stayed fixed regardless
      of the requested window size), so the small-screen markup was verified by temporarily forcing the
      breakpoint's CSS via an injected stylesheet instead. Confirmed the bar renders correctly, the active
      route highlights the right icon, the alert badge shows, the theme toggle flips Light/Dark live and
      persists across a route change, and the desktop panel is unaffected at the normal viewport. No
      console errors. `npx vite build` clean. Recommended the user do a final check on an actual phone or
      by manually resizing outside the automation tool, since real-device confirmation wasn't possible.

### TASK-27 fix — both navs rendered at once on a phone (2026-09-13)
User sent a screenshot from a real narrow viewport showing the floating glass bar AND the full side panel
rendering on top of each other. Real bug, shipped in the commit above.

- [x] Root cause: `Sidebar.jsx` set `display: "flex"` as an **inline style** on the `<aside>`. An inline
      `display` beats any stylesheet rule that lacks `!important`, so the breakpoint's
      `.app-sidebar-panel { display: none }` could never win, and the panel stayed visible under the bar
      while still consuming its 230px of width. Moved `display` and `flex-direction` into the
      `.app-sidebar-panel` class where the media query can actually reach them.
- [x] Why the original "verification" missed it: the forced-breakpoint preview injected
      `display: none !important`, which DID beat the inline style. That tested a mocked-up version of the
      fix, not the real cascade, and reported a pass on broken code. Re-verified this time by injecting
      the breakpoint's rules with **no `!important` anywhere** (gated on `@media (min-width: 0px)` so they
      apply immediately) and reading `getComputedStyle`: sidebar `flex` -> `none`, topbar `none` ->
      `block`, both dashboard rows `2 columns` -> `1fr`, main padding-top `76px`. Added a comment in
      `index.css` recording the rule so this is not reintroduced.
- [x] Second issue found in the same screenshot: the Dashboard's two widget rows were inline
      `gridTemplateColumns: "1fr 1fr"` / `"1fr 1.3fr"`, so Inventory Health and ABC × XYZ stayed
      side-by-side and got crushed at phone width (same inline-style-beats-media-query problem). Moved
      them to `.dash-row--even` / `.dash-row--wide-right` classes that collapse to a single column below
      the breakpoint.
- [x] Still outstanding, not fixed here: `Inventory.jsx:610`'s `1fr 1fr` grid inside the SKU edit modal
      has the same hardcoded-inline shape and will be tight on a phone. Left alone pending a proper pass
      over that modal on small screens.

## TASK-28 — Second critic pass: cards restored, unit bug, hierarchy (2026-09-13)
Second strict UI/UX-critic + data-analyst review of the Dashboard. User's one explicit instruction was
"I want the white cards back again to aid with visibility", with discretion over the rest.

- [x] **Cards restored** (the explicit ask). New `.card` class in `index.css` (background `--card-bg`,
      1px border, `--radius-lg`, `--shadow`). Applied to `Section` (all four widgets) and to a new
      summary card wrapping the hero value, month comparison, KPI strip and the compliance disclosure as
      one unit. The flat/hairline treatment from the Linear overhaul had left every widget floating on
      one undifferentiated grey field with nothing marking where one ended and the next began. Uses the
      theme token, so it is white in Light and slate in Dark rather than literally white in both.
- [x] **Data bug: Compliance Position was rendering metric tonnes as dollars.** `financials.js` computes
      `compliancePosition = complianceEligibleQty - complianceRequiredQty`, both sums of `on_hand_qty` in
      MT. The Dashboard passed it through `fmt$`, so +1,058 MT of rice displayed as **"+$1K"** - wrong
      unit, and the K-rounding destroyed the magnitude on top of it. Added a separate `fmtMt` formatter
      (thousands separators, no K/M abbreviation) kept deliberately distinct from `fmt$`, and the card
      now reads "+1,058 MT" with "2,853 MT eligible vs 1,795 MT required" as context.
- [x] **Information hierarchy: swapped the two widget rows.** Needs Attention, the only "what do I do
      today" widget on the page, was below the fold while the ABC × XYZ segmentation matrix (analysis,
      not action) held prime position above it. Now row 1 is Cover vs Lead + Safety and Needs Attention
      ("what needs doing"), row 2 is Inventory Health and ABC × XYZ ("how the portfolio is structured").
      Verified the cross-filter still works across the new arrangement: clicking Critical filters the
      table to exactly the 2 RED SKUs.
- [x] **Metric-vs-copy contradiction fixed.** The hero's "▲ $151K vs baseline" was painted red, i.e.
      asserting "bad", while that metric's own hint text says a rising inventory value "isn't
      automatically good or bad". Made it neutral; direction is still shown by the arrow.
- [x] **E&O gross vs risk-adjusted reconciled.** The KPI showed gross E&O ($1.36M) while the Needs
      Attention rows below use risk-adjusted ($273K) - the same concept appearing as two numbers 5x apart
      with nothing explaining the gap. The KPI sub-line now carries both.
- [x] **Colour overload reduced.** Six of seven KPIs resolve to warn or bad against this portfolio, and
      every one of them was rendering as a large coloured number, so the strip had no focal point at all.
      `StatCard` now recolours the value only for a genuine "bad"; "warn" gets a small amber status dot
      beside the label instead. Signal kept, shouting removed.
- [x] **Month comparison chart made readable.** It was two unlabelled rectangles at 140x60 with a hidden
      axis; worse, the two values are only ~4% apart, so on a zero baseline the bars are near-identical
      and the picture alone said nothing. Added value labels and axis labels and sized it up. Kept the
      zero baseline deliberately (truncating it to dramatise a 4% move is the classic misleading-bar
      trick) - the near-equal heights are the honest message, the labels are what make it informative.
- [x] **Dead space removed.** `align-items: start` on `.dash-row`, so a short card is no longer stretched
      to match a tall neighbour (Inventory Health had ~150px of empty card below its content).
- [x] **ABC × XYZ legend added.** The cell tint encodes inventory value and this was stated nowhere, so
      readers had no way to know the blue meant anything.
- [x] **WCAG AA text contrast fixed.** `--text-muted` (#94a3b8) measured ~3.6:1 on white, under AA's
      4.5:1 for normal text, while carrying real content (KPI sub-lines, axis labels, table captions).
      Moved both muted and secondary down one shade in Light (now 4.76:1 and 7.58:1, measured in-browser)
      and up one shade in Dark, preserving the three-step hierarchy.
- [x] Verified in Light and Dark, cross-filter re-tested after the reorder, no console errors,
      `npx vite build` clean.

### Known, deliberately not fixed in this pass
- `fmt$` rounds every value >= $1,000 to the nearest K, including row-level Needs Attention figures, so
  $26,217 reads "$26K". Fine for the hero, lossy where a user is comparing two similar rows.
- Needs Attention priority order still ranks Overstock (P3, "suspend purchasing", no ticking clock) above
  Reorder (P4, a SKU approaching its reorder point, genuinely time-sensitive).
- The KPI strip wraps raggedly: "Coverage in Target Band" takes two lines for its label and three for its
  sub-line while its neighbours take one, so baselines do not align across the row.
- `Inventory.jsx:610`'s hardcoded inline `1fr 1fr` grid inside the SKU edit modal still will not collapse
  on a phone (same inline-style-beats-media-query shape as the TASK-27 bug).

## TASK-29 — Replace ABC × XYZ with ABC × movement class (2026-09-13)
User asked what the rationale for the ABC × XYZ chart was and whether it was in the documentation. It
was not, and the investigation is worth recording.

**Findings**
- ABC *is* genuinely specified: `reference/rice-inventory-technical-spec.md` Step 8A, with formula,
  cumulative-% thresholds, configurable bands and acceptance criteria. Correctly implemented.
- **XYZ is in no source domain document.** Grepping the technical spec, the glossary and the
  terminology map for `XYZ`, `coefficient of variation` and `predictab` returns zero matches.
- **The spec asks for a different second axis.** Step 8A item 7: "Combine ABC class with
  Fast/Normal/Slow/Idle for management action", with an interpretation table (A+fast, A+idle, C+fast,
  C+idle). ABC × movement is the prescribed matrix; ABC × XYZ is not.
- **The code came first and the docs were back-filled to match it.** `segmentation.js` shipped in
  commit `c17ae80` already headed "ABC × XYZ SEGMENTATION ENGINE"; REQ-14 then says verbatim "Already
  implemented in code (`segmentation.js`, `abc_class`/`xyz_class` columns) but missing from this
  document until now", and design.md said "new to this document, already implemented in code". The
  alignment commit was `08ba8c1`. XYZ acquired the appearance of being specified by being written into
  a requirement titled after ABC.
- The widget was also the weakest on the page against real data: 5 of 9 cells empty, the Y and Z
  columns empty apart from one C-row SKU each, and its own caption told the reader to act on AZ / BZ,
  both of which were zero.

**Changes**
- [x] `segmentation.js → buildMatrix` now builds ABC × movement class (cols Fast/Normal/Slow/Idle, cell
      keys `A:Fast`), with the provenance recorded in the function's comment. `segmentPortfolio` still
      computes `xyz_class`, which REQ-14 documents and the Inventory table still displays; it simply no
      longer drives this matrix.
- [x] Renamed `stats.abcXyzMatrix` to `stats.abcMovementMatrix` through `engines/index.js` and
      `smoke.js` rather than leaving a name that misdescribes its contents.
- [x] Dashboard: `AbcXyzMatrix` -> `AbcMovementMatrix`, 4 columns, section retitled "Value × Movement",
      filter key format updated in `matchesFilter`/`filterLabel`, cell names rendered "A · Fast" for
      humans and screen readers rather than the raw `A:Fast` key. ELI18 hint copy rewritten against the
      spec's interpretation table.
- [x] Caption now reads off the live data instead of prescribing action in a possibly-empty cell, which
      is the exact flaw called out in the old one: it names the A · Idle count when there is one and
      says the corner is clear when there is not.
- [x] Needs Attention's overstock reason no longer prints the XYZ letter (`BX class` became
      `B class, Normal`), which is both spec-aligned and more informative.
- [x] Corrected the documentation rather than leaving the drift: design.md's section is now "ABC Value
      Classification" and records the provenance correction; REQ-14 carries an explicit warning that XYZ
      has no source-document backing and must not be reintroduced into the matrix without one.
- [x] Verified: matrix populates 6 of 12 cells along a sensible diagonal (A in Fast/Normal, B in
      Normal/Slow, C in Slow/Idle), click-to-filter works on the new keys ("Filtering by A · Fast"), no
      console errors, `npx vite build` clean.

**Process note.** This widget predates the two "strict critic" passes in TASK-25 and TASK-28, and
neither of them questioned whether it should exist - they audited how it was drawn, not whether it was
warranted. Provenance ("is this in the spec?") is worth an explicit line item in any future review pass.

## TASK-30 - Full interactive audit: bugs and UI/UX across all three pages (2026-09-13)
User asked for a full visual audit by actually interacting with every element, then a plan and its
implementation. Ten findings, all fixed.

**Data / correctness**
- [x] **The stock bar and the status badge were measuring different things.** The table and the SKU
      Overview drew the tick at `reorder_point_suggested` while the edit preview used
      `reorder_point_policy`, and alerts/health key off policy. Thai Jasmine 10KG therefore showed a red
      bar reading "28 MT below reorder point" next to a green "Healthy" badge, and the tick silently
      jumped 316 -> 302 when you switched tabs. All bars now use the policy value (the approved
      operating number the engines actually use); the suggested figure is named separately in the hover,
      per spec Step 8's "shown side by side, not merged".
- [x] `ai_recommendation_qty` of 0 was rendered via `!= null`, producing "Purchase 0 MT",
      "Suggested quantity: 0 MT" and "AI recommendation: 0 MT" on overstock / slow-moving / idle /
      ageing alerts, whose entire point is to stop ordering. Now gated on `> 0`.
- [x] Same carrying-cost figure formatted two ways: "SGD $12K" on the alert card, "SGD $11880" on the
      SKU detail. `fmt$` is now exported from `alerts.js` and reused in `index.js` so there is one
      definition.

**UI bugs**
- [x] Projection chart Y-axis clipped its leading digit ("800 MT" rendered as ":00 MT"): axis width 60 -> 78.
- [x] "1 active alerts" - pluralisation added.
- [x] Min order qty sat on a different baseline from its neighbours: it is the only sliderless field on
      the Policy tab, and NumberField stacks label over input while SliderField puts them on one line.
      Added `alignWithSlider` to NumberField.
- [x] Missing space after the warning emoji in the AI-modal disclaimer.

**UX**
- [x] The decision modal opened with the Reason field already red and "a reason is required" showing,
      scolding the user before they had done anything. Now tracked with `reasonTouched` and surfaced on
      blur or on a submit attempt.
- [x] The SKU modal re-centred on every tab switch (frame 749-824px tall, tab row moving ~37px), sliding
      the tabs out from under the pointer. Anchored to a fixed top offset instead of vertical centring;
      the tab row now sits at a constant 166px on all three tabs. A modest min-height stops the shortest
      tab collapsing, without padding the others out with dead space.
- [x] Overview is read-only but still offered a primary "Save changes". It now shows only "Close".
- [x] Alert type tiles reading 0 carried the same visual weight as populated ones. They now recede
      (muted label/icon, 0.55 opacity) while staying clickable, so the row stays a stable set of six.
- [x] Inventory subtitle filler ("rice inventory management") replaced with a real figure:
      "10 of 10 SKUs · 6 need attention", counted across the catalogue rather than the filtered view.
- [x] The three filter dropdowns had no accessible name - their only label lived inside an `<option>`.
      Added `aria-label`.

Verified by interaction across all three pages in both themes; `npx vite build` clean; no console errors.

## TASK-31 - Wire the audit log, and make it visible (2026-09-13)

`audit_log` has been in the schema since db/init.js was first written, carrying a comment naming the
events it was meant to hold (LLM_CALL, ALERT_TRIGGERED, RESTOCK). Nothing ever wrote a row to it. With
Observability an explicitly scored submission criterion, a created-but-empty table is the worst of both
worlds: it documents the intention and demonstrates none of it.

- [x] `backend/src/db/audit.js`: `logEvent` / `readEvents` / `eventCounts` / `diffFields`. Logging is
      best-effort and swallows its own failures. An audit insert must never be able to 500 the restock
      it is recording.
- [x] Six real write points: SKU_CREATED, SKU_UPDATED, RESTOCK, ALERT_TRIGGERED, ALERT_ACKNOWLEDGED,
      DECISION_RECORDED. LLM_CALL is defined and handled end to end but unemitted until TASK-11.
- [x] ALERT_TRIGGERED fires inside `materializeAlerts`, in the branch guarded by dedupe_key, so it means
      "this condition first became true" and not "someone loaded the Alerts page".
- [x] SKU_UPDATED stores a field-level before/after diff, which required selecting the full prior row
      rather than the existing `SELECT 1` existence check. A no-op Save logs nothing.
- [x] DECISION_RECORDED stores the system's proposal alongside the manager's action and the quantity
      delta, so override rate is a query rather than a research project.
- [x] `GET /api/audit` with event_type / sku_id / limit filters. `counts` is nested inside `data`
      because the frontend client unwraps to body.data and would otherwise drop it.
- [x] `seed.js` now wipes audit_log alongside alerts_log. Without that, a reseed leaves the trail empty
      forever: every alert is already materialized, so ALERT_TRIGGERED can never fire again.
- [x] New Activity page plus route and nav entry. Events render as plain-English sentences, with the
      stored input/output payload behind a per-row disclosure. Raw JSON is not observability.

Three defects found and fixed during browser verification: ColHint renders only the icon (its `label`
is the aria-label), so wrapping it alone in the h1 produced a page with no heading; engine copy already
ends in a full stop, so composing it into a sentence produced "targeted promotion.."; and a stray extra
period in the decision sentence.

Verified in both themes against real seeded data: 7 ALERT_TRIGGERED rows from a live alert evaluation
plus a real DECISION_RECORDED round trip. `npx vite build` clean.

## TASK-32 - README rewritten against the app that exists (2026-09-13)

The README still described the pre-rebuild demo: categories, out-of-stock, top-selling products, an
in-memory store, and a `/api/products` surface that is now the superseded legacy route. It is the first
thing a judge reads and it undersold the work badly, describing none of the engines, the two-axis
classification, the deterministic-versus-LLM split, or the decision trail.

- [x] Rewritten around the reasoning loop, with the loop drawn as a diagram, since that is a named
      judging criterion and was nowhere in the document.
- [x] Added the domain-rules table (On Hand vs Available, POs never added to stock, the two reorder
      points, Days of Cover at zero demand, movement class vs ABC). These are the distinctions that
      separate a dashboard that looks right from one that is right.
- [x] Documented the real API surface, the Observability section, and the deliberate omissions,
      including that TASK-11 is blocked on a key rather than on design.
- [x] Verified every command documented actually exists in the root package.json scripts.

## TASK-33 - Production deployment prep (2026-09-13)

Three of the four required submission artifacts do not exist, and the deployment URL is the only one
with an external dependency, so it is the one that cannot be recovered if it is left to the last week.
Everything that can be done without a host was done and verified locally. See `SUBMISSION.md`.

- [x] `db/init.js` reads `DATA_DIR` from the environment, defaulting to the repo-local `data/`. A
      mounted volume lives outside the source tree, and better-sqlite3 throws SQLITE_CANTOPEN rather
      than creating a missing parent, so the directory is created with `mkdirSync` first.
- [x] `index.js` serves `frontend/dist` and a SPA fallback when NODE_ENV=production. The Vite proxy
      that connects the two halves in dev does not exist in a production build. Registered after every
      /api route and before the 404 handler; the fallback excludes /api so a mistyped endpoint still
      returns JSON rather than a page of HTML.
- [x] CORS origin read from `CORS_ORIGIN`, defaulting to the previous hardcoded localhost value.
- [x] Seed on first boot, guarded on the SKU count, so an empty volume produces a working demo but a
      redeploy does not wipe one someone is mid-way through. Failure is logged, never fatal.
- [x] Verified: production server booted against an empty temp DATA_DIR, created the directory, seeded
      10 SKUs, served the built app, returned index.html for a hard refresh on /activity, returned JSON
      for /api/nope, and left local dev behaviour unchanged with no env vars set.

Remaining: create the service on the host, and decide between a persistent disk and treating the
database as disposable. The fallback is viable precisely because the seed is deterministic.

## TASK-34 - Deployment blueprint (2026-09-13)

TASK-33 made the app production-ready and verified it locally. This adds the declarative config so the
deploy is a click rather than a form-filling exercise.

- [x] `render.yaml`. Single web service, build and start commands, health check on /api/health, and the
      four env vars. Pins NODE_VERSION because better-sqlite3 is a native module compiled at install
      time, so the Node major is not an incidental detail.
- [x] Documented the persistence decision in the file itself rather than elsewhere: Render's free
      instance type does not support disks, so the blueprint runs without one and relies on
      seed-on-first-boot. That is sound because the seed is deterministic, and the paid-disk path is one
      commented block away with DATA_DIR already pointing at the mount.
- [x] `Dockerfile` as the Fly.io fallback, multi-stage, plus `.dockerignore`. Two failure modes are
      called out in comments because both are easy to hit: better-sqlite3 is native so builder and
      runtime must share a base image (Debian, not Alpine, which has no prebuilt binary for it), and
      backend/ and frontend/dist must remain SIBLINGS because index.js resolves the frontend as
      ../../frontend/dist.

**Verification, stated precisely.** No container runtime is installed on this machine (no docker,
podman, colima, nerdctl or finch), so `docker build` was NOT run and the image is unproven. What was
verified is the layout and runtime contract the Dockerfile depends on: a directory mirroring the image
layout exactly was assembled in a temp dir and `node backend/src/index.js` run from its root with
NODE_ENV=production, PORT and an empty DATA_DIR. It created the data directory, seeded 10 SKUs, served
/ and a hard refresh on /activity as HTML, served a hashed asset as JS, and still returned JSON for
/api/nope. The remaining unknown is the image build itself: apt-get, npm ci, and the native compile on
linux.

## TASK-35 - Four deferred defects (2026-09-13)

- [x] `fmt$` rounded to whole thousands, turning $26,217 into "$26K". It now keeps one decimal below
      $100K and drops it above, where the decimal stops earning its place. A trailing ".0" is trimmed so
      an exact $1,000 still reads "$1K". Verified on screen: $26.2K, $14.2K, $87.4K, $51.7K, $273K.
- [x] Needs Attention ranked both working-capital exceptions above REORDER, so a SKU about to run out
      could be pushed off the list by stock that had been sitting still for months and would still be
      sitting still tomorrow. Re-ranked by deadline first, exposure second: STOCKOUT RISK, REORDER, IDLE
      STOCK, OVERSTOCK, SLOW MOVING, AGEING. Working capital is the more expensive problem; it is never
      the more urgent one.
- [x] The KPI strip sat on two baselines because exactly one card (Coverage in Target Band) carried a
      `target` prop that rendered as a third line. The target now renders inline beside the value, so
      every card is exactly three rows: label, value, sub. Verified: both groups align across all seven.
- [x] Japonica's stock bar. Worse on inspection than reported: the idle fill was flat muted grey at 0.65
      opacity, near-identical to both the track and the greyscale avoid-shading, so fill, track and both
      shaded ranges merged into one uniform slab that read as a disabled control. It also hid a second
      fact, because `idle` short-circuited the over-maximum branch: Japonica holds 78 MT against a 60 MT
      maximum and said nothing about the overage, while the Dashboard tagged the same SKU
      "IDLE STOCK · OVERSTOCK · AGEING". The fill is now hatched (idle is not a severity, so it must not
      borrow red or amber, but it must read as present and inert rather than absent), the quantity is
      full-strength text, and the status line reads "78 MT idle - no recent demand · 18 MT over
      maximum". Verified in both themes.

**One verification gap, stated rather than glossed.** The re-ranking could not be demonstrated on
screen: the seeded portfolio currently produces no REORDER row, because no SKU satisfies that filter.
The change is verified by inspection of the priority constants and the sort comparator only. Forcing a
REORDER row would have meant mutating seeded stock levels to satisfy four simultaneous conditions, which
is a larger disturbance to the demo data than the check is worth.

## TASK-36 - PDF write-up draft (2026-09-13)

- [x] `WRITEUP.md`, assembled per the outline in SUBMISSION.md from README.md and design.md. Existing
      prose reused rather than re-authored. Nine sections plus a local-setup appendix, two marked
      screenshot slots, and a placeholder for the deployment URL.
- [x] Expanded three things the README states but does not argue: why deterministic-first has three
      separate justifications (cost, trust, correctness) rather than one, why the two reorder points are
      not redundancy, and why the decisions table is Phase 2 training data.

## TASK-37 - Two order quantities, and an Ask AI that said nothing (2026-09-13)

Found while reading real SKU data to build a better explanation, which is the only reason it surfaced:
nothing on screen looked wrong.

**The suggested order quantity was computed twice, two different ways.** `engines/index.js` computes
`suggested_order_qty = target_stock - projected_available_at_lead_time`, which design.md documents as
correct and records as an upgrade made on 2026-09-12, away from a snapshot-based proxy. `engines/
alerts.js` was still computing that retired proxy, `target_stock - available_qty`, and so was the
Dashboard's Needs Attention row. On TJ-25KG the two disagreed by 257 MT, roughly $347K of purchase
order, because the proxy ignores everything consumed while the order is in transit. The Inventory page
showed 597 and the Alerts page pre-filled 340 into the approval modal.

- [x] `alerts.js` gains one `orderQty(s)` helper reading the engine's own figure, used by both ordering
      alert types for the message text and the quantity. min_order_qty still floors it, since a supplier
      minimum is a constraint rather than a calculation.
- [x] Dashboard's Needs Attention reads `suggested_order_qty` too. Three sites, one answer.

**Ask AI returned the card back to the reader.** `buildFallbackExplanation` concatenated `alert.message`
with `alert.recommended_action`, which are the two lines already printed on the card the button sits on,
then repeated the quantity a third time. Clicking it added nothing. This is the app's one AI touchpoint
and Architecture & Reasoning Loop is a named judging criterion.

- [x] New `frontend/src/lib/explain.js`. Four-step trace per alert type: what was measured (inputs and
      the windows they came from), how it was derived (the arithmetic, checkable by hand), if nothing
      changes (the consequence, priced), why this action (the trade-off). All six alert types.
- [x] The modal renders these as a numbered rail. Numbering is justified here because the four steps
      genuinely are a sequence; numbering something unordered would be decoration.
- [x] Alerts now loads SKUs alongside alerts, since the alert carries the conclusion and the SKU carries
      the inputs. When a SKU cannot be matched the modal falls back to the old restatement and says so.
- [x] Disclaimer rewritten from "rule-based summary" to state that every figure can be checked against
      the Inventory page, which is the property that makes it trustworthy regardless of who wrote the
      prose. The honest "not yet a live model" wording is kept.

This is also not throwaway work pending TASK-11: the assembled trace is exactly the prompt context a
real model needs, and assembling it has to be deterministic either way.

**Smaller fixes in the same pass.**
- [x] Three money formatters disagreed. `fmt$` (Dashboard), `sgd` (explain.js) and `fmt$` (backend
      alerts.js) now share thresholds, so a carrying cost is not "$26K" in an alert and "$26.2K" on the
      dashboard.
- [x] The decision footer read "AI Recommendation: No order required for this alert" on four of the six
      alert types, directly beside Approve / Modify / Reject: it told the reader there was nothing to
      decide, then asked them to decide it. It now names the actual action ("Disposition review",
      "Suspend purchasing"). Relabelled "Decision:" rather than "Recommended:" after a first attempt
      created two "Recommended:" labels on one card.
- [x] "a 270 days limit" now reads "a 270-day limit".

Verified in the browser on the stockout and idle branches, plus `npm run analytics` and a clean build.

## TASK-38 - Hardening the explanation builder (2026-09-13)

Four of the six branches in lib/explain.js shipped in TASK-37 without ever being seen rendered, because
only two alert types were open on screen. Rather than click through modals, a throwaway script ran every
branch against every SKU (240 sections) and grepped the output for leaked placeholders.

- [x] First pass found one visible `null`. Investigating it exposed the real problem: `Number(null)` and
      `Number("")` are both 0, and both are finite, so the `Number.isFinite` guards in `mt`, `day` and
      `dayAdj` were rendering MISSING values as a confident "0 MT" and "0 days". A grep for "null" can
      never catch that, and an explanation a manager is about to act on is the worst place for a
      plausible wrong zero. Added an `isNum` guard that rejects null, undefined and empty string.
- [x] Hardening the helpers turned the silent zeros into visible nulls, which surfaced a second case:
      STOCKOUT_RISK and SLOW_MOVING both divide by demand, and a zero-demand SKU has no days of cover.
      Both sentences are now guarded and say so in words instead.
- [x] Re-ran: 240 sections, 0 problems.
- [x] Reading the prose of the two branches never seen on screen caught a correctness bug that no null
      check would have found. The OVERSTOCK explanation told the reader that anything not Fast Moving is
      "unlikely to clear on demand alone". Vietnam Fragrant is a Normal mover selling 3.23 MT a day with
      185 days of cover: demand will absolutely drain it, the ceiling is what is wrong. As written it
      pointed a manager at a discount they do not need. Now splits on Fast/Normal versus Slow/Idle.

**Not verified: narrow-viewport layout.** The Activity page has never been checked below desktop width,
and the browser resize tool reports success while leaving the viewport unchanged (tried 414px and
500px), so this could not be confirmed either way in this session. By construction the payload panels
are `flex: 1 1 260px` inside a `flexWrap: wrap` row and should stack, and the page inherits the shared
sidebar breakpoint from index.css, but that is reasoning about the code rather than a check.

## TASK-39 - Write-up screenshots (2026-09-13)

- [x] Three captures from the running app on live seeded data, saved to `docs/images/`: the Alerts page
      (human in the loop), the explanation modal (reasoning loop), and an expanded Activity record
      (observability). Each is referenced from WRITEUP.md with a caption and real alt text.
- [x] Added a third image beyond the two the outline called for. Section 3 argues the
      deterministic-first case at length and showed nothing; the reasoning trace is the evidence for it,
      and it is also the strongest single screen in the build.
- [x] SUBMISSION.md updated: the write-up now needs only the deployment URL.

Note for export: the image paths are repo-relative, so the markdown-to-PDF step has to run from the
repository root.

## TASK-40 - Declutter Alerts, and settle the Alerts versus Activity question (2026-09-13)

Stan reported the Alerts page as cluttered and asked whether Activity should fold into it. The two turn
out to be the same question, because the clutter had a structural cause rather than a styling one.

**Four encodings of two facts.** Each card carried a type-coloured left stripe, a type-coloured icon, a
type chip AND a severity chip, sitting under a tile row that already groups by type. Severity moved to
the stripe so one chip could go: icon and chip now carry type, the stripe carries severity.

**A box inside a box inside a box.** The recommended action sat in a bordered, tinted panel with its own
coloured left bar, inside a card that already has a border and a stripe. Unboxed, the label alone
separates it.

**Actions split across two places, and a different set per card.** Dismiss floated mid-card beside the
metric while the other four sat in a footer bar shown only when `needsApproval` passed, so four of the
seven live alerts offered no decision at all. Those four carry real recommended actions ("Reduce or
pause the next order", "Escalate to QA") and the write-up claims every recommendation terminates at a
human decision, which was simply not true. Every alert is now decidable, with one action row.

**A rainbow instead of a hierarchy.** Purple, green, amber and red buttons meant nothing led and the eye
read all four. One primary, the rest quiet. The primary also states what it will record ("Approve 597
MT"), which let the "Approving records:" caption go.

The metric dropped from 24px bold in the type colour to 20px in the text colour; it was competing with
the product name, which is what a manager actually scans for.

**Activity stays standalone, and the Decision Log left Alerts.** Alerts is a work queue: items leave it
when handled. Activity is the permanent record: nothing ever leaves. Folding one into the other fights
that, and Activity also covers RESTOCK, SKU_UPDATED and SKU_CREATED, which have nothing to do with
alerts. The real duplication was the Decision Log table at the bottom of Alerts, a strict subset of the
audit trail's DECISION_RECORDED events rendered as a second, worse view, which meant the page that
should shrink as you work also grew as you worked. Replaced with a one-line pointer to /activity.
Pruned the orphaned useCollapsed state, DECISION_LOG_HINT and ChevronDown import.

Verified in both themes. Four cards now fit where two did, without cramming. Alerts screenshot in
WRITEUP.md re-captured, since the old one showed the previous card design.

## TASK-41 - White cards on Alerts (2026-09-13)

Stan: body text on the Alerts list was reading against the page's grey background and was hard to read.
Correct, and it made Alerts the only page in the app whose content did not sit on a card. Dashboard
widgets, the Inventory table, the Activity timeline and even the Alerts tile row above are all on
`.card`; the alert list alone sat on bare `--bg` with hairline dividers.

- [x] Each alert is its own `.card` rather than the whole list being one surface. An alert is a single
      decision and dismissing it removes exactly one card, so the discrete unit matches the mental
      model. It also matches the tile row directly above, which is already six separate cards.
- [x] Dropped the per-row `borderBottom` and the `isLast` prop that drove it. The parent already spaces
      rows with `gap: 14`, so a divider on top of a gap was two separators doing one job.
- [x] `overflow: hidden` on the card, because the severity stripe is a 3px left border and without it
      the stripe squares off the rounded top and bottom corners.
- [x] The empty state now reuses `.card` instead of restating its four tokens inline.

Verified in both themes plus the filtered-to-empty state. WRITEUP.md screenshot re-captured again.

## TASK-11 - AI explanation layer, unblocked (2026-09-13)

Blocked since 2026-09-12 on an API key. Unblocked without one, by not depending on a single provider.

- [x] `backend/src/llm/provider.js`. One `chat()` behind four settings: `ollama` (local, free, the dev
      default), `gateway` (the organizers' AWS Bedrock gateway from the ShowMeYourAgent starter kit),
      `anthropic` (the team's own credit), `none`. The gateway is deliberately Ollama compatible, same
      POST /api/chat and message shape plus an X-API-Key header, so it shares the local code path.
- [x] Gateway 403s are retried at 3s, 6s, 9s. A 403 there is a rate limit wearing a permissions status
      code, and treating it as an auth failure sends you to check a key that is fine.
- [x] `backend/src/llm/explain.js`. The model NARRATES, it never computes. A llama3 smoke test called
      SGD 26,217 of margin "potential sales" and misread a 17 day shortfall, so the facts block labels
      every figure with its unit and the system prompt forbids inventing or renaming numbers. After
      labelling, the same model got the margin right.
- [x] `POST /api/alerts/explain` re-derives the alert from live analytics rather than trusting a client
      supplied message, so a stale tab cannot feed old figures to the model. It never 500s on a model
      problem: missing key, stopped daemon, rate limit and daily cap all return available:false, and the
      frontend falls back to the deterministic trace it already had.
- [x] The `LLM_CALL` audit event that db/audit.js reserved from the start now actually fires, recording
      provider, model, latency and token counts. No credential is ever logged.
- [x] Modal shows the model summary above the four step deterministic trace, so the prose is readable
      and the audited figures remain visible underneath it.

**Cost controls,** because the team shares one $100 pool with no per developer limit:
ollama as the default so development is free, Haiku on the direct path, a hard max_tokens ceiling, a
rolling daily call cap, and a response cache.

**Cache key, decided by Stan:** reuse while the situation is materially the same. Volatile figures are
bucketed (10 MT, 1 MT/day, 5 days) so small drift reuses the answer and material change re-asks.

A test of the intended behaviour caught a real bug in the first implementation: 160 MT drifting to
158 MT was supposed to be free and was not. The key included both `days_of_cover` and
`suggested_order_qty`, which are DERIVED from `available_qty`, so one stock movement got three
independent chances to cross a bucket boundary and cover falling 28 to 27 straddled the 27.5 line on
its own. Keying on the independent inputs (stock, inbound, demand rate) covers the same ground with one
boundary instead of three. Verified: 2 MT and 5 MT drift reuse, a 40 MT drop re-asks, a reclassification
re-asks, and renaming the supplier costs nothing.

Measured: 6.9s uncached against local llama3, 0.03s cached.

## TASK-42 - Three cost tiers, with the paid one behind an explicit action (2026-09-13)

Stan's requirement: default to the free local model, fall back to no-AI templates, and reach the paid
tier only by deliberate human action, with an always visible indicator of which is in use. The $100 is
an AWS credit from the organizers, so the metered tier draws on Bedrock.

- [x] Three tiers in `provider.js`: `rules` (no model, the deterministic trace is the whole answer),
      `local` (llama3, free and unlimited), `cloud` (metered, AWS Bedrock via the gateway or the
      Anthropic API).
- [x] `LLM_DEFAULT_MODE` cannot select `cloud`. Paid spending has to begin with a click in the running
      app, so nobody inherits a billing state by copying a config file or a `.env` from a teammate.
- [x] `setMode("cloud")` refuses when no credentials are configured, rather than switching into a state
      that then fails on first use.
- [x] `LLM_MODE_CHANGED` audit event. Entering or leaving a metered tier is a spending decision, so it
      belongs in the same trail as every other decision the app records.
- [x] `AiModeSwitch` in the sidebar, always visible. The metered tier takes two clicks: the first turns
      the button into "Spend credit?", the second commits. An inline confirm rather than
      `window.confirm`, which blocks the page and reads as a browser error on a recording.
- [x] The metered tier is marked with a `$` even when inactive, so the cost is visible before the click
      rather than discovered after it.

**Terminology.** "Hard-coded answers" was rejected as the label for the no-AI tier. Nothing is stored:
the text is computed from live figures by documented rules, and "hard-coded" implies static strings,
which undersells it to a judge. Settled on **Rule-based** / **Local model** / **AWS Bedrock**, the last
naming the billing source so the cost is unmissable.

## TASK-43 - Reducing model drift, and measuring it (2026-09-13)

Stan asked whether stricter prompting could cut llama3's precision drift. Prompting turned out to be
the weaker half of the answer.

- [x] System prompt rewritten as eight numbered hard rules with a worked example contrasting a correct
      answer against the exact drift observed (converted a duration, rounded a figure, renamed margin as
      sales).
- [x] `verifyExplanation` checks what the model wrote against the figures it was given: invented or
      rounded numbers, hedge words, word-durations in units nobody supplied, and money amounts renamed
      as sales, revenue, profit or turnover. Scores 8/8 on a set that includes both real llama3 drifts.
- [x] Numeric tolerance set to 0.3%. An earlier 1% passed 26000 in place of 26217, a rounded claim
      disguised as a match. 26.2K is 0.06% away and 26000 is 0.83% away, so the threshold has to sit
      between them rather than be chosen by feel.
- [x] `explainAlert` retries once, telling the model exactly what it broke. A model that invented a
      figure will usually invent it again from an identical prompt.
- [x] `scripts/bench-models.js`: every live alert, every model, scored by the production verifier.

**Two bugs found by the benchmark, one of them in the benchmark.**

`think: false` is now sent on every ollama request. qwen3 is a reasoning model and spent its entire
capped 280 token budget on an internal monologue, returning an EMPTY message. This reached a live click
as "Model endpoint returned an empty message" the moment qwen3 was made the default. Disabling thinking
also made it 36% faster, so the quality-costs-latency trade-off was itself partly an artifact.

The benchmark scored those empty responses as **7/7 clean**, because a verifier that looks for bad
things finds none in an empty string. It was measuring absence of detectable error and being read as
correctness. Responses under 80 characters now fail, and `done_reason` is recorded so truncation is
visible. A liveness check has to come before a quality check.

**Results, 28 runs per model (`--repeat 4`), after both fixes:**

| model | clean | latency | dangerous drift |
|---|---|---|---|
| llama3 | 23/28 (82%) | 2760ms | none in 28 runs |
| qwen3:8b | 21/28 (75%) | 5943ms | renamed money as "sales" 3x |
| llama3.1:8b | 20/28 (71%) | 3461ms | invented a figure once, renamed once |

llama3, already installed, wins on accuracy and speed, and is the only one of the three that never
produced a dangerous error. Its failures are all hedge words. A single pass over 7 alerts had put
llama3.1 last and qwen3 joint first, which is one alert of difference and not a result: repeats are
what separated a number from a finding.

Drift clusters by alert rather than scattering. qwen3 renamed money as "sales" on JP-5KG IDLE in 3 of
4 runs; llama3.1 converted 97 days into months on the same alert in 4 of 4. Both are prompt or facts
problems on one alert, not general model quality.

## TASK-44 - Readable durations, computed once (2026-09-13)

Stan: "9.3 months" and "9.1 months" are both worse than "9 months and 8 days". Correct, and the two
decimals existing at once was itself the bug.

- [x] `engines/duration.js`. One `humanDuration`, its own module. It started inside `engines/index.js`,
      but `alerts.js` needs it and `index.js` already requires `alerts.js`, so importing it back made a
      cycle: node resolved it to `undefined` and WARNED rather than threw, which would have surfaced as
      a crash on the first slow-moving alert instead of at startup.
- [x] Computed once in the engine and attached to the SKU as `days_of_cover_text`,
      `days_since_last_sale_text` and `inventory_age_text`. Four places render a duration (alert
      message, LLM facts, the frontend trace, the dashboard) and formatting in each is exactly how
      "9.1 months" ended up beside "9.3 months". Third time this project has learned that derived
      values computed twice eventually disagree.
- [x] `Number(null)` is 0 and finite, so the first version rendered a null `days_of_cover` as a
      confident "0 days" on the idle SKU, which reads as an emergency rather than as the Not Applicable
      the glossary requires. Third appearance of this same trap today.
- [x] "against a 9 months limit" restructured to "against a limit of 9 months" rather than inventing a
      second adjectival formatter.

**Measured effect, and it is not all good.** Year conversions ROSE: llama3 2 to 4, llama3.1 1 to 3.
"9 months and 8 days" makes "nearly a year" more tempting than "278 days" did. The earlier fix worked
because months were missing; this one backfired because months are inviting. "Supply the information
rather than forbid the behaviour" is not universal: it helps when the model is filling a gap, not when
it is rounding toward a familiar unit.

The format stays, because readability was the point and the safety net holds: a duration conversion is
classified dangerous, so it is retried and then rejected, and the reader falls back to the audited
trace. Roughly 1 click in 7 on llama3 now shows the trace without prose. Nobody ever sees a wrong
number. If that fallback rate is too high, moving "converted a duration" out of DANGEROUS in
`llm/explain.js` is a one line change, at the cost of showing "nearly a year" for 9 months and 8 days.

Tuning stops here. Five benchmark runs in, the remaining failures are rare, mostly cosmetic, and
handled correctly by the retry and fallback path.

## TASK-45 - Slot filling: the model stops writing numbers (2026-09-13)

Stan's question: if the maths is already hard coded, why is the model handling any of it? Half the
answer was "it is not, the engines compute everything". The other half was the real insight: the model
still RETYPED the figures into prose, and every numeric failure measured all day happened in that
retyping, not in any calculation.

- [x] `llm/slots.js`. 25 named placeholders built from engine-computed values. The model writes
      `{days_of_cover}`, never `28 days`, and the values are substituted after validation.
- [x] The raw output is rejected if it contains ANY digit, references an unknown placeholder, uses none
      at all, or repeats a unit after one. Stating a figure the engine did not compute is therefore not
      merely detectable, it is unrepresentable. That is the difference between a test and a type.
- [x] Three layers, strongest first: slots, then the original free text path with its verifier, then the
      deterministic trace. The feature degrades, it never disappears.
- [x] The verifier still runs on the RENDERED text, because slots cannot stop the model calling a margin
      figure "sales" or hedging with "nearly". Those are the words around the number.

**Constraining the arithmetic moved the risk up a level.** With figures made unrepresentable, the
model's remaining freedom was the ARGUMENT, and on the IDLE alert it used it to write "the stock level
has fallen below the reorder point, immediately place an order", the exact opposite of the right call.
Correct numbers inside a wrong argument read as more authoritative, not less. Fixed with a digit free
semantic brief per alert type, stating plainly what the alert means and what would be the wrong answer.

Three smaller findings. A prompt that forbids digits while PASTING the alert message and recommended
action (both full of digits) is a contradiction the model resolves by copying, so both became slots
themselves. Placeholder values carry their own units, so "{days_of_cover} days" rendered as "28 days
days" and is now rejected. And the preamble stripper required whitespace in `here\s+'s`, so it never
matched "Here's", the commonest form: a regex that misses the common case is worse than none, because
it looks handled.

**Measured end to end, 21 real explanations through the full path:**

    mode:      slots 14   freetext 7   rejected 0
    verified:  clean 16   cosmetic 5   DANGEROUS 0
    every explanation shown carried a correct figure

Not comparable with the earlier "86% usable", which measured raw single shot model calls rather than
the system with its retries and fallbacks.

**Honest caveat.** On llama3 (8B) slot mode buys numeric safety at a real cost in prose quality: it pads
awkwardly around injected values ("too much 620 MT, which includes both 580 MT and 40 MT"). That is an
8B model writing in an unnatural form, not a bug to regex away, and it is why free text still wins a
third of the time. The architecture should suit the Bedrock tier far better, where the model follows
constrained formats more reliably.

## TASK-47 - The launcher and the Goods In handheld flow (2026-09-13)

Stan's model of the business: stock enters, stock leaves, and the Control Tower decides what to do
about what is left. Those are three jobs done by different people on different devices, so the app now
opens on a launcher rather than on the dashboard.

- [x] `Launcher` at `/`. Three cards in the order stock actually moves. Each names the device and the
      place it belongs to, which is the fastest way to tell someone a screen is not meant for them.
- [x] Control Tower routes wrapped in `Layout` via an `Outlet`; the floor screens deliberately are not.
      A handheld has no room for navigation, and an operator at a dock has one job on screen at a time.
- [x] PIN sign in. Four digits, submitted on the fourth, dots rather than a field so the PIN is never
      visible to whoever is standing behind you. Demo PINs are printed on screen and labelled as a
      prototype affordance.
- [x] Four step receiving wizard against an open purchase order: pick the delivery, verify the SKU,
      count it, confirm. Live variance feedback on the count screen, framed as information rather than
      as an error, because a short delivery is a fact about the world and not a mistake by the person
      counting it.
- [x] A GRN styled as the document it stands in for, with its number, because that is what the driver
      waits for and what accounts reconcile against.
- [x] Guidance at two levels. The per screen instruction answers "what do I press now". A collapsed
      "How this works" answers "what am I doing and how much is left", which is what a new starter
      needs before beginning and anyone needs after an interruption.

**Light theme, on Stan's correction.** An industrial tool invites a dark high contrast treatment and I
proposed one. He was right to reject it: this project is designed and demoed in light. The device
character comes from SCALE and FOCUS instead, one action per screen with 56px targets and a real
keypad, which is above the 44px floor in Apple's HIG because the operator may be wearing gloves.

**A React bug worth recording.** The PIN filled and nothing happened. The submit effect had `busy` in
its dependency array AND set it inside, so setting it re-ran the effect, whose cleanup set
`cancelled = true` and discarded the very request it had just started. Fixed with a `useRef` guard,
which does not trigger a render and so cannot retrigger the effect.

Three smaller fixes after walking the flow: `textTransform: uppercase` on the scan input was shouting
the PLACEHOLDER at the operator; the variance reasons offered "Over shipped by supplier" as an
explanation for a SHORT receipt, which cannot be true; and the Goods Out card linked to a route that
does not exist yet, so it now reads "Next up" and is not clickable.

Verified end to end in the browser: signed in as Rahman B., received PO-2026-0001 short by 5 MT with a
reason, and got GRN-0001 with stock moving 620 to 815 MT.

## TASK-48 - Name the Launchpad, and make it reachable (2026-09-13)

- [x] The three card screen is now officially **the Launchpad**, renamed from Launcher in code and
      recorded in CLAUDE.md. "Launchpad" is the established term for a screen of entry points into
      separate workspaces (SAP Fiori, macOS), so it carries its meaning without explanation and is
      unambiguous spoken aloud, which "home" and "the menu" are not once three workspaces exist.
- [x] Cards compacted from roughly 265px to 190px. The description was the one thing a returning user
      never needs, and three lines of it forced scrolling on a phone, so it now sits behind a
      "What is this?" disclosure.
- [x] Deliberately NOT a hover tooltip. `HoverHint` binds `onMouseEnter` and `onFocus` only, so reusing
      it would have put the text out of reach on exactly the small screens this change is for. The
      disclosure is a button, and it calls `stopPropagation` so a tap explains the card rather than
      opening it.
- [x] An explicit Launchpad link in the sidebar, above Menu, styled as a leave-this-place action rather
      than as a fifth page, because it is not a peer of the four below it. The logo already linked
      there, but a logo that navigates is a convention people know rather than a signpost they can see,
      and the Control Tower was otherwise a room with no visible door.
- [x] The same exit on the phone top bar, which never shows the sidebar and would otherwise have left
      the Launchpad unreachable on a small screen.

## TASK-49 - Declutter the sidebar, split the narrow-screen navigation (2026-09-13)

The sidebar had grown three competing sections: four navigation links, three explanation tiers with a
caption, and two theme buttons. Twelve interactive elements, of which four were navigation and eight
were settings nobody changes twice in a session.

**What the well-made tools do.** Linear puts settings behind the workspace menu, Notion behind one
"Settings" row at the bottom, Stripe and Vercel move them out of the left nav entirely. None of them
keep a theme switcher permanently expanded beside their page links. The pattern is consistent: a
sidebar is for NAVIGATION, and settings collapse into a single entry at its edge.

- [x] `SettingsMenu`: one entry holding the explanation tier and the theme, opening as a popover, with
      outside-click and Escape to dismiss. `AiModeSwitch` deleted, its logic absorbed.
- [x] The trigger carries the STATE, not just a label: it reads "Local model · Light". Collapsing the
      controls should not cost the ability to see which engine is answering, which was the whole point
      of putting the tier in the sidebar.
- [x] Sidebar is now logo, Launchpad, four links, settings, footer. Twelve interactive elements down to
      six.

**Narrow screens: a two row strip, all at the top.** (Revised same day, see below.) The single pill held the logo, a Launchpad grid
icon, a Dashboard grid icon, alerts, activity and a theme toggle. Two near-identical grid glyphs sat one
tap apart, and leaving the Control Tower, moving inside it, and changing a setting were presented as one
group when they are three unrelated jobs.

- [x] Top strip is now two islands with space between them: Launchpad on the left, settings on the
      right. The strip itself is `pointer-events: none` so only the islands are targets.
- [x] Navigation is a second row inside the same top strip, with icon AND label. It briefly lived in a
      bottom tab bar on thumb-reach grounds, which Stan corrected: thumb reach is the right argument for
      an app you INSTALL and the wrong one for a page you OPEN. StockSense is a desktop web app that can
      be viewed narrow, and the web convention is navigation at the top.
- [x] Giving navigation a row to itself is what buys the room for labels, so the two row layout is doing
      the same work the bottom bar was, without moving anything away from where a web user looks.

**Not verified: the narrow layout itself.** The browser resize tool reports success while leaving the
viewport unchanged, as it has all session, so the two islands and the tab bar have only been reasoned
about, not seen. The desktop sidebar and the settings popover were both checked in the browser.

## Deferred (Phase 2+)
See `requirements.md` → "Explicitly Deferred (Phase 2/3)" for the full table with rationale. Summary:
movement ledger, lot/batch genealogy, mobile receiving, import clearance, full stock-status taxonomy
(blocked/damaged/rejected), backtested demand forecasting, full projected-inventory curve,
governance-approved compliance rule, agent execution governance, freshness state machine, full audit/
reconciliation controls. None of these are pending MVP1 tasks — they are intentionally not scheduled
until the phases in `design.md` Appendix E.
