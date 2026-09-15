// ─────────────────────────────────────────────────────────────────────────────
// ANALYTICS - pure, reusable derivation of every computed SKU field.
//
// Extracted from riceData.js so the same logic can run at module load (over the
// seed data) AND on every local edit / restock / add in the Inventory page.
// Nothing here imports riceData.js - keep it dependency-free to avoid a cycle
// (analytics ← riceData ← statsData).
// ─────────────────────────────────────────────────────────────────────────────

// Per-SKU policy inputs that the base mock rows don't carry. Every field falls
// back individually, so a partial override object is fine.
export const DEFAULT_EXTRAS = {
  unit_price_sgd: null,
  demand_cv: 0.3,
  annual_carrying_rate_pct: 22,
  obsolescence_risk_pct: 10,
  target_service_level: 0.95,
  lost_sales_30d: 0,
  incoming_eta_days: null,
};

// Service level → one-tailed normal Z-score (statistical safety stock).
export function zScore(sl) {
  const table = [
    [0.9, 1.28], [0.91, 1.34], [0.92, 1.41], [0.93, 1.48], [0.94, 1.56],
    [0.95, 1.65], [0.96, 1.75], [0.97, 1.88], [0.98, 2.05], [0.99, 2.33],
  ];
  let z = 1.28;
  for (const [p, v] of table) if (sl >= p) z = v;
  return z;
}

const num = (v, fallback = 0) => (Number.isFinite(+v) ? +v : fallback);

// Rule-based health status. Canonical rule set - must match backend/src/engines/health.js
// exactly (see .kiro/specs/mvp1-inventory-visibility/reference/terminology-map.md item 1;
// this used to silently diverge from the backend and was missing the max_holding_days trigger).
export function deriveHealthStatus(s) {
  const dos = s.days_of_cover;
  const ltSafety = num(s.lead_time_days, 45) + (s.safety_stock_days || 0);

  // RED
  if (dos != null && dos < num(s.lead_time_days, 45) && !s.covered_by_po) return "RED";
  if (s.inventory_age_days != null && s.inventory_age_days > num(s.max_holding_days, 270)) return "RED";
  if (s.movement_class === "Idle" && s.available_qty > 0) return "RED";

  // ORANGE
  if (dos != null && dos < ltSafety && !s.covered_by_po) return "ORANGE";
  if (s.on_hand_qty > s.max_stock) return "ORANGE";

  // YELLOW
  if (s.movement_class === "Slow Moving") return "YELLOW";
  if (dos != null && s.target_days_of_cover != null && dos > s.target_days_of_cover) return "YELLOW";

  return "GREEN";
}

/**
 * Derive every computed field for one SKU. Pure - returns a new object,
 * never mutates the input.
 *
 * @param {object} sku   base fields + the 7 policy inputs (per-key fallback to DEFAULT_EXTRAS)
 * @param {{recomputeHealth?: boolean}} [opts]
 *        recomputeHealth=false keeps sku.health_status as-is (used at seed load
 *        so the Dashboard KPIs stay byte-identical); true re-derives it.
 */
export function computeSkuAnalytics(sku, { recomputeHealth = true } = {}) {
  const s = { ...DEFAULT_EXTRAS, ...sku };

  const onHand = num(s.on_hand_qty);
  const reserved = num(s.reserved_qty);
  const hold = num(s.quality_hold_qty);
  const avg30 = num(s.avg_daily_usage_30d);
  const unitCost = num(s.unit_cost_sgd);
  const unitPrice = s.unit_price_sgd == null ? Math.round(unitCost * 1.2) : num(s.unit_price_sgd);
  const marginPerMt = unitPrice - unitCost;

  // ── Mechanical stock position ──────────────────────────────────────────────
  const available_qty = +(onHand - reserved - hold).toFixed(2);
  const days_of_cover = avg30 > 0 ? Math.round(available_qty / avg30) : null; // "Not Applicable" is a display-layer concern, not a data one - see StockPositionBar / dashboard
  const months_of_cover = days_of_cover != null ? +(days_of_cover / 30).toFixed(1) : null;

  // ── Velocity / financials ─────────────────────────────────────────────────
  // One demand rate everywhere, the 30 day moving average, as the backend engines
  // use (design.md, "Formula decisions", 15 Sep 2026).
  const expected_incoming_qty = num(s.expected_incoming_qty);
  const inventory_position = +(available_qty + expected_incoming_qty).toFixed(2); // glossary #18 (simplified - see design.md)
  const gross_margin_pct = unitPrice > 0 ? +((marginPerMt / unitPrice) * 100).toFixed(1) : 0;
  const annual_cogs = Math.round(avg30 * 365 * unitCost);
  const annual_gross_margin = Math.round(avg30 * 365 * marginPerMt);
  const inventory_value = Math.round(onHand * unitCost);

  // ── Statistical safety stock + reorder point ──────────────────────────────
  const safety_stock_days = Math.round(
    zScore(num(s.target_service_level, 0.95)) * num(s.demand_cv, 0.3) * Math.sqrt(num(s.lead_time_days, 45))
  );
  const safety_stock_mt = Math.round(safety_stock_days * avg30);
  const reorder_point_suggested = Math.round(num(s.lead_time_days, 45) * avg30 + safety_stock_mt);
  const target_days_of_cover = avg30 > 0 ? Math.round(num(s.target_stock) / avg30) : null;
  const suggested_order_qty = Math.max(0, +(num(s.target_stock) - inventory_position).toFixed(1)); // glossary #30, simplified

  // ── Coverage band ────────────────────────────────────────────────────────
  let coverage_band;
  if (days_of_cover === null) coverage_band = "idle";
  else if (days_of_cover < num(s.lead_time_days, 45) + safety_stock_days) coverage_band = "below";
  else if (target_days_of_cover && days_of_cover > target_days_of_cover) coverage_band = "above";
  else coverage_band = "in";

  const covered_by_po =
    expected_incoming_qty > 0 && s.incoming_eta_days != null &&
    days_of_cover != null && s.incoming_eta_days <= days_of_cover;

  // ── Exposure figures ────────────────────────────────────────────────────
  const overstock_qty = Math.max(0, +(onHand - num(s.max_stock)).toFixed(2));
  const overstock_value = Math.round(overstock_qty * unitCost);
  const overstock_carrying_cost = Math.round((overstock_value * num(s.annual_carrying_rate_pct, 22)) / 100);

  const movement_class = s.movement_class || "Normal";
  const isEO = movement_class === "Slow Moving" || movement_class === "Idle";
  const eo_value = isEO ? Math.round(available_qty * unitCost) : 0;
  const eo_value_risk_adjusted = Math.round((eo_value * num(s.obsolescence_risk_pct, 10)) / 100);

  const gapDays = days_of_cover != null ? Math.max(0, num(s.lead_time_days, 45) - days_of_cover) : 0;
  const stockout_gap_days = covered_by_po ? 0 : gapDays;
  const lost_units_risk = +(stockout_gap_days * avg30).toFixed(1);
  const lost_margin_risk = Math.round(lost_units_risk * marginPerMt);
  const lost_sales_value_risk = Math.round(lost_units_risk * unitPrice);

  const xyz_class = num(s.demand_cv, 0.3) < 0.25 ? "X" : num(s.demand_cv, 0.3) <= 0.5 ? "Y" : "Z";

  const derived = {
    unit_price_sgd: unitPrice,
    on_hand_qty: onHand,
    available_qty,
    days_of_cover,
    months_of_cover,
    expected_incoming_qty,
    inventory_position,
    gross_margin_pct,
    annual_cogs,
    annual_gross_margin,
    inventory_value,
    safety_stock_days,
    safety_stock_mt,
    reorder_point_suggested,
    target_days_of_cover,
    suggested_order_qty,
    coverage_band,
    covered_by_po,
    overstock_qty,
    overstock_value,
    overstock_carrying_cost,
    movement_class,
    eo_value,
    eo_value_risk_adjusted,
    stockout_gap_days,
    lost_units_risk,
    lost_margin_risk,
    lost_sales_value_risk,
    xyz_class,
  };

  const merged = { ...s, ...derived };
  merged.health_status =
    recomputeHealth || s.health_status == null ? deriveHealthStatus(merged) : s.health_status;

  return merged;
}

/**
 * Portfolio pass - ABC class is Pareto-relative so it needs every SKU.
 * Pure: returns a new array; each element gets `abc_class`.
 */
export function computePortfolioAnalytics(skus) {
  const byConsumption = [...skus].sort((a, b) => (b.annual_cogs || 0) - (a.annual_cogs || 0));
  const total = byConsumption.reduce((sum, s) => sum + (s.annual_cogs || 0), 0) || 1;

  const classById = {};
  let cumulative = 0;
  for (const s of byConsumption) {
    cumulative += s.annual_cogs || 0;
    const pct = cumulative / total;
    classById[s.sku_id] = pct <= 0.8 ? "A" : pct <= 0.95 ? "B" : "C";
  }

  return skus.map((s) => ({ ...s, abc_class: classById[s.sku_id] ?? "C" }));
}
