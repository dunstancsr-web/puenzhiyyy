// ─────────────────────────────────────────────────────────────────────────────
// ANALYTICS — pure, reusable derivation of every computed SKU field.
//
// Extracted from riceData.js so the same logic can run at module load (over the
// seed data) AND on every local edit / restock / add in the Inventory page.
// Nothing here imports riceData.js — keep it dependency-free to avoid a cycle
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

// Rule-based health status. Mirrors backend/src/engines/health.js.
export function deriveHealthStatus(s) {
  if (s.movement_class === "Idle" && s.available_stock > 0) return "RED";
  if (s.coverage_band === "below" && !s.covered_by_po) return "RED";
  if (s.excess_mt > 0) return "ORANGE";
  if (s.coverage_band === "below") return "ORANGE"; // tight, but a PO is inbound
  if (s.movement_class === "Slow Moving") return "YELLOW";
  if (s.coverage_band === "above") return "YELLOW";
  return "GREEN";
}

/**
 * Derive every computed field for one SKU. Pure — returns a new object,
 * never mutates the input.
 *
 * @param {object} sku   base fields + the 7 policy inputs (per-key fallback to DEFAULT_EXTRAS)
 * @param {{recomputeHealth?: boolean}} [opts]
 *        recomputeHealth=false keeps sku.health_status as-is (used at seed load
 *        so the Dashboard KPIs stay byte-identical); true re-derives it.
 */
export function computeSkuAnalytics(sku, { recomputeHealth = true } = {}) {
  const s = { ...DEFAULT_EXTRAS, ...sku };

  const physical = num(s.physical_stock);
  const reserved = num(s.reserved_qty);
  const hold = num(s.quality_hold_qty);
  const avg30 = num(s.avg_daily_usage_30d);
  const avg90 = num(s.avg_daily_usage_90d);
  const unitCost = num(s.unit_cost_sgd);
  const unitPrice = s.unit_price_sgd == null ? Math.round(unitCost * 1.2) : num(s.unit_price_sgd);
  const marginPerMt = unitPrice - unitCost;

  // ── Mechanical stock position ──────────────────────────────────────────────
  const available_stock = +(physical - reserved - hold).toFixed(2);
  const days_of_stock = avg30 > 0 ? Math.round(available_stock / avg30) : null;
  const months_of_stock = days_of_stock != null ? +(days_of_stock / 30).toFixed(1) : null;

  // ── Velocity / financials ─────────────────────────────────────────────────
  const blended_daily_usage = +(0.5 * avg30 + 0.5 * avg90).toFixed(2);
  const on_order = num(s.incoming_stock);
  const gross_margin_pct = unitPrice > 0 ? +((marginPerMt / unitPrice) * 100).toFixed(1) : 0;
  const annual_cogs = Math.round(blended_daily_usage * 365 * unitCost);
  const annual_gross_margin = Math.round(blended_daily_usage * 365 * marginPerMt);
  const inventory_value = Math.round(physical * unitCost);

  // ── Statistical safety stock + reorder point ──────────────────────────────
  const safety_stock_days = Math.round(
    zScore(num(s.target_service_level, 0.95)) * num(s.demand_cv, 0.3) * Math.sqrt(num(s.lead_time_days, 45))
  );
  const safety_stock_mt = Math.round(safety_stock_days * blended_daily_usage);
  const reorder_point_calc = Math.round(num(s.lead_time_days, 45) * blended_daily_usage + safety_stock_mt);
  const target_days = blended_daily_usage > 0 ? Math.round(num(s.target_stock) / blended_daily_usage) : null;

  // ── Coverage band ────────────────────────────────────────────────────────
  let coverage_band;
  if (days_of_stock === null) coverage_band = "idle";
  else if (days_of_stock < num(s.lead_time_days, 45) + safety_stock_days) coverage_band = "below";
  else if (target_days && days_of_stock > target_days) coverage_band = "above";
  else coverage_band = "in";

  const covered_by_po =
    on_order > 0 && s.incoming_eta_days != null &&
    days_of_stock != null && s.incoming_eta_days <= days_of_stock;

  // ── Exposure figures ────────────────────────────────────────────────────
  const excess_mt = Math.max(0, +(physical - num(s.max_stock)).toFixed(2));
  const excess_value = Math.round(excess_mt * unitCost);
  const excess_carrying_cost = Math.round((excess_value * num(s.annual_carrying_rate_pct, 22)) / 100);

  const movement_class = s.movement_class || "Normal";
  const isEO = movement_class === "Slow Moving" || movement_class === "Idle";
  const eo_value = isEO ? Math.round(available_stock * unitCost) : 0;
  const eo_value_risk_adjusted = Math.round((eo_value * num(s.obsolescence_risk_pct, 10)) / 100);

  const gapDays = days_of_stock != null ? Math.max(0, num(s.lead_time_days, 45) - days_of_stock) : 0;
  const stockout_gap_days = covered_by_po ? 0 : gapDays;
  const lost_units_risk = +(stockout_gap_days * blended_daily_usage).toFixed(1);
  const lost_margin_risk = Math.round(lost_units_risk * marginPerMt);
  const lost_sales_value_risk = Math.round(lost_units_risk * unitPrice);

  const xyz_class = num(s.demand_cv, 0.3) < 0.25 ? "X" : num(s.demand_cv, 0.3) <= 0.5 ? "Y" : "Z";

  const derived = {
    unit_price_sgd: unitPrice,
    available_stock,
    days_of_stock,
    months_of_stock,
    blended_daily_usage,
    on_order,
    gross_margin_pct,
    annual_cogs,
    annual_gross_margin,
    inventory_value,
    safety_stock_days,
    safety_stock_mt,
    reorder_point_calc,
    target_days,
    coverage_band,
    covered_by_po,
    excess_mt,
    excess_value,
    excess_carrying_cost,
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
 * Portfolio pass — ABC class is Pareto-relative so it needs every SKU.
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
