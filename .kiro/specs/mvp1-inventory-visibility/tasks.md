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

## Deferred (Phase 2+)
See `requirements.md` → "Explicitly Deferred (Phase 2/3)" for the full table with rationale. Summary:
movement ledger, lot/batch genealogy, mobile receiving, import clearance, full stock-status taxonomy
(blocked/damaged/rejected), backtested demand forecasting, full projected-inventory curve,
governance-approved compliance rule, agent execution governance, freshness state machine, full audit/
reconciliation controls. None of these are pending MVP1 tasks — they are intentionally not scheduled
until the phases in `design.md` Appendix E.
