// ─────────────────────────────────────────────────────────────────────────────
// FINANCIALS ENGINE
// Per-SKU exposure figures (precise definitions, not raw stock value) and the
// portfolio KPI roll-up: turnover / DIO, GMROI, fill rate, stockout-risk value,
// excess %, E&O %, and the value-weighted coverage-band split.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Per-SKU financial fields. Expects an already-enriched SKU object.
 */
function skuFinancials(s) {
  const marginPerMt = s.unit_price_sgd - s.unit_cost_sgd;
  const blended = s.blended_daily_usage || 0;

  const inventory_value = round(s.physical_stock * s.unit_cost_sgd);
  const annual_cogs = round(blended * 365 * s.unit_cost_sgd);
  const annual_gross_margin = round(blended * 365 * marginPerMt);
  const gross_margin_pct = s.unit_price_sgd > 0 ? round((marginPerMt / s.unit_price_sgd) * 100) : 0;

  // Excess (above max) — value plus the annual cost of holding it
  const excess_mt = Math.max(0, round(s.physical_stock - s.max_stock));
  const excess_value = round(excess_mt * s.unit_cost_sgd);
  const excess_carrying_cost = round((excess_value * s.annual_carrying_rate_pct) / 100);

  // Excess & Obsolete — slow + idle stock, gross and risk-adjusted
  const isEO = s.movement_class === "Slow Moving" || s.movement_class === "Idle";
  const eo_value = isEO ? round(s.available_stock * s.unit_cost_sgd) : 0;
  const eo_value_risk_adjusted = round((eo_value * s.obsolescence_risk_pct) / 100);

  // Projected stockout gap and the P&L it exposes
  const gapDays =
    s.days_of_stock != null && !s.covered_by_po
      ? Math.max(0, s.lead_time_days - s.days_of_stock)
      : 0;
  const lost_units_risk = round(gapDays * blended);
  const lost_margin_risk = round(lost_units_risk * marginPerMt);
  const lost_sales_value_risk = round(lost_units_risk * s.unit_price_sgd);

  return {
    margin_per_mt: round(marginPerMt),
    gross_margin_pct,
    inventory_value,
    annual_cogs,
    annual_gross_margin,
    excess_mt,
    excess_value,
    excess_carrying_cost,
    eo_value,
    eo_value_risk_adjusted,
    stockout_gap_days: gapDays,
    lost_units_risk,
    lost_margin_risk,
    lost_sales_value_risk,
  };
}

/**
 * Portfolio KPI roll-up.
 * @param {Array} skus  fully enriched SKUs (velocity + position + financials + health + class)
 * @param {{ demand_30d:number, lost_30d:number }} demand  fill-rate inputs
 */
function portfolioStats(skus, demand) {
  const active = skus.filter((s) => s.active !== 0);

  const totalInventoryValue = sum(active, "inventory_value");
  const annualCogs = sum(active, "annual_cogs");
  const annualGrossMargin = sum(active, "annual_gross_margin");

  const turnover = totalInventoryValue > 0 ? round(annualCogs / totalInventoryValue) : 0;
  const dio = annualCogs > 0 ? Math.round(365 / (annualCogs / totalInventoryValue)) : null;
  const gmroi = totalInventoryValue > 0 ? round2(annualGrossMargin / totalInventoryValue) : 0;

  const fulfilled = demand.demand_30d - demand.lost_30d;
  const fillRate = demand.demand_30d > 0 ? round((fulfilled / demand.demand_30d) * 100) : 100;

  const stockoutSkus = active.filter((s) => s.stockout_gap_days > 0);
  const stockoutRiskMargin = sum(stockoutSkus, "lost_margin_risk");
  const stockoutRiskSales = sum(stockoutSkus, "lost_sales_value_risk");

  const excessSkus = active.filter((s) => s.excess_mt > 0);
  const excessValue = sum(excessSkus, "excess_value");
  const excessCarryingCost = sum(excessSkus, "excess_carrying_cost");

  const eoSkus = active.filter((s) => s.eo_value > 0);
  const eoValue = sum(eoSkus, "eo_value");
  const eoValueRiskAdjusted = sum(eoSkus, "eo_value_risk_adjusted");

  // Value-weighted coverage band
  const band = { below: 0, in: 0, above: 0, idle: 0 };
  for (const s of active) band[s.coverage_band] += s.inventory_value;
  const bandTotal = Object.values(band).reduce((a, b) => a + b, 0) || 1;

  // Health by value
  const healthByValue = ["RED", "ORANGE", "YELLOW", "GREEN"].map((k) => {
    const rows = active.filter((s) => s.health_status === k);
    const value = sum(rows, "inventory_value");
    return { status: k, value, count: rows.length, pct: round((value / totalInventoryValue) * 100) };
  });

  return {
    totalSkus: active.length,
    totalInventoryValue: r0(totalInventoryValue),
    annualCogs: r0(annualCogs),
    turnover,
    dio,
    gmroi,
    fillRate,
    lostSales30d: r0(demand.lost_30d),
    demand30d: r0(demand.demand_30d),
    stockoutRiskMargin: r0(stockoutRiskMargin),
    stockoutRiskSales: r0(stockoutRiskSales),
    stockoutSkuCount: stockoutSkus.length,
    excessValue: r0(excessValue),
    excessCarryingCost: r0(excessCarryingCost),
    excessPct: round((excessValue / totalInventoryValue) * 100),
    excessSkuCount: excessSkus.length,
    eoValue: r0(eoValue),
    eoValueRiskAdjusted: r0(eoValueRiskAdjusted),
    eoPct: round((eoValue / totalInventoryValue) * 100),
    eoSkuCount: eoSkus.length,
    coverage: {
      below: { value: r0(band.below), pct: round((band.below / bandTotal) * 100) },
      in: { value: r0(band.in), pct: round((band.in / bandTotal) * 100) },
      above: { value: r0(band.above), pct: round((band.above / bandTotal) * 100) },
      idle: { value: r0(band.idle), pct: round((band.idle / bandTotal) * 100) },
    },
    coverageInBandPct: round((band.in / bandTotal) * 100),
    healthByValue,
    healthCounts: counts(active, "health_status", ["RED", "ORANGE", "YELLOW", "GREEN"]),
    movementCounts: counts(active, "movement_class", ["Fast Moving", "Normal", "Slow Moving", "Idle"]),
  };
}

const sum = (rows, key) => rows.reduce((s, r) => s + (r[key] || 0), 0);
const round = (n) => Math.round(n * 10) / 10;
const round2 = (n) => Math.round(n * 100) / 100;
const r0 = (n) => Math.round(n);
const counts = (rows, key, keys) =>
  rows.reduce((acc, r) => { acc[r[key]] = (acc[r[key]] || 0) + 1; return acc; },
    Object.fromEntries(keys.map((k) => [k, 0])));

module.exports = { skuFinancials, portfolioStats };
