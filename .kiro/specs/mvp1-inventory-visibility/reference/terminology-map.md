# Terminology Map — Rename & Formula Alignment

This is the master reference for the domain-alignment pass done on 2026-09-12 against the two documents
in this folder ([technical spec](./rice-inventory-technical-spec.md),
[terms glossary](./rice-inventory-terms-glossary.md)). It records **every field that changed name**,
**every formula that changed**, and **why** — so nobody "corrects" a name back to the old one without
knowing it was deliberate, and so Kiro/Tawmo can pick this work up mid-stream with full context.

Status column: ✅ done · 🔜 planned, not yet applied to code.

## Field renames

| Old identifier | New identifier | Canonical term (glossary #) | Where it lived | Status |
|---|---|---|---|---|
| `physical_stock` | `on_hand_qty` | On Hand (#4) | `skus`/`inventory_positions` schema, all engines, all mocks, all UI | 🔜 |
| `available_stock` | `available_qty` | Available Stock (#7) | `position.js`, `analytics.js`, `health.js`, `alerts.js`, `financials.js`, mocks, UI | 🔜 |
| `reserved_qty` | *(unchanged)* | Reserved Stock (#5) | already correct | ✅ n/a |
| `quality_hold_qty` | *(unchanged — re-documented)* | one component of "Unavailable" (#6) | see note below | ✅ n/a |
| `on_order` **+** `incoming_stock` (duplicate aliases for the same value) | `expected_incoming_qty` | Expected Incoming Stock (#15) | `position.js` set both; `riceData.js` raw field was `incoming_stock`; `analytics.js` read `s.incoming_stock` | 🔜 |
| `inventory_position` | *(unchanged — formula re-documented)* | Inventory Position (#18) | `position.js`, `alerts.js` | ✅ n/a |
| `reorder_point` (skus table column, "manual/legacy") | `reorder_point_policy` | the approved operating Reorder Point (#28) | `init.js` skus table, edit-form UI | 🔜 |
| `reorder_point_calc` (engine output) / `reorder_point_mt` (safetystock.js internal) | `reorder_point_suggested` | system-calculated suggestion, compared against the policy value | `engines/index.js`, `safetystock.js`, `analytics.js`, `alerts.js` | 🔜 |
| `days_of_stock` | `days_of_cover` | Days of Cover (#22) | `engines/index.js`, `analytics.js`, `health.js`, `alerts.js`, UI | 🔜 |
| `months_of_stock` | `months_of_cover` | derived from Days of Cover | `engines/index.js`, `analytics.js` | 🔜 |
| `target_days` | `target_days_of_cover` | planning reference level | `engines/index.js`, `analytics.js`, `health.js` | 🔜 |
| `excess_mt` / `excess_value` / legacy alias `overstockedValue` | `overstock_qty` / `overstock_value` | Overstock trigger (spec Step 13, glossary App B) | `financials.js`, `analytics.js`, `statsData.js` | 🔜 |
| `eo_value` / `eo_value_risk_adjusted` / legacy alias `slowIdleValue` | *(keep the two real fields; drop the alias)* | Excess & Obsolete value | `financials.js`, `analytics.js`, `statsData.js` | 🔜 |

**Not renamed on purpose:**
- `reserved_qty`, `quality_hold_qty` already match the glossary's spirit; renaming them would just
  create churn.
- `inventory_position` already matches term #18's name exactly — only its *formula* needed
  documentation (see below), not its name.
- Batch/lot fields, movement-ledger fields, stock-status values beyond reserved/quality-hold (blocked,
  damaged, rejected) don't exist in this codebase at all — see "Explicitly Deferred" in `../requirements.md`.

## New fields (didn't exist before this pass)

| New identifier | Canonical term | Formula | Status |
|---|---|---|---|
| `suggested_order_qty` | Suggested Order Quantity (#30) | `max(0, target_stock − inventory_position)` — a simplification of the glossary's full "target − projected stock at receipt," since the projection engine (spec's TASK-07 equivalent) isn't built yet | 🔜 |
| `compliance_required_qty` (portfolio-level, in `portfolioStats`) | required side of Compliance Position (#38) | `2 × Σ(blended_daily_usage) × 30` across all active SKUs — demand used as an honest stand-in for real import-receipt history, which this project doesn't have | 🔜 |
| `compliance_eligible_qty` (portfolio-level) | eligible side of Compliance Position (#38) | `Σ on_hand_qty` across all active SKUs (currently: all on-hand, since blocked/damaged/rejected statuses don't exist yet) | 🔜 |
| `compliance_position` (portfolio-level) | Compliance Position (#38) | `compliance_eligible_qty − compliance_required_qty` | 🔜 |
| `as_of` (frontend mock — backend already has `asOf`) | Data Age / freshness (#39) | timestamp surfaced as a "Data Status" dashboard label (glossary Appendix A) | 🔜 |

## Formula corrections (independent of naming)

1. **`analytics.js: deriveHealthStatus` vs. backend `health.js` had silently diverged** — different
   rule structure, and the mock was missing the `inventory_age_days > max_holding_days` RED trigger
   that the backend has. **Resolution: the backend's rule set is canonical**; the frontend mock is
   updated to match it exactly. See `../design.md` for the single, reconciled rule set. 🔜
2. **De-duplicated `on_order`/`incoming_stock`** into one field, `expected_incoming_qty`. 🔜
3. **Removed the stale hand-set `inventory_position: -140`** on TJ-25KG in `riceData.js` — its inline
   comment described a formula (`available + incoming - committed demand`) that no code actually
   implements. It now computes from the real formula like every other SKU. 🔜
4. **Zero-demand Days of Cover now renders "Not Applicable"** in the UI instead of a blank/null, per
   glossary term #22's explicit rule. 🔜
5. **Legacy aliases dropped entirely**: `overstockedValue` and `slowIdleValue` in `statsData.js` (both
   were explicitly commented `// legacy alias`) — callers use the canonical `overstock_value` / `eo_value`
   directly. 🔜

## Verification

Once the rename lands, `grep -rn` for every "old identifier" string in the table above should return
zero hits in `backend/src/` and `frontend/src/`, outside of this file and the reference docs (which
intentionally quote the old names for history).
