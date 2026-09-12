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

## Deferred (Phase 2+)
See `requirements.md` → "Explicitly Deferred (Phase 2/3)" for the full table with rationale. Summary:
movement ledger, lot/batch genealogy, mobile receiving, import clearance, full stock-status taxonomy
(blocked/damaged/rejected), backtested demand forecasting, full projected-inventory curve,
governance-approved compliance rule, agent execution governance, freshness state machine, full audit/
reconciliation controls. None of these are pending MVP1 tasks — they are intentionally not scheduled
until the phases in `design.md` Appendix E.
