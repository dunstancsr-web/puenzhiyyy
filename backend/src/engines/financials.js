// ─────────────────────────────────────────────────────────────────────────────
// FINANCIALS ENGINE
// Per-SKU exposure figures (precise definitions, not raw stock value) and the
// portfolio KPI roll-up: turnover / DIO, GMROI, fill rate, stockout-risk value,
// overstock %, E&O %, value-weighted coverage-band split, and the illustrative
// portfolio-level Compliance Position (REQ-16).
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Per-SKU financial fields. Expects an already-enriched SKU object.
 */
function skuFinancials(s) {
  const marginPerMt = s.unit_price_sgd - s.unit_cost_sgd;
  const dailyRate = s.avg_daily_usage_30d || 0;

  const inventory_value = round(s.on_hand_qty * s.unit_cost_sgd);
  const annual_cogs = round(dailyRate * 365 * s.unit_cost_sgd);
  const annual_gross_margin = round(dailyRate * 365 * marginPerMt);
  const gross_margin_pct = s.unit_price_sgd > 0 ? round((marginPerMt / s.unit_price_sgd) * 100) : 0;

  // Overstock (above max) — value plus the annual cost of holding it
  const overstock_qty = Math.max(0, round(s.on_hand_qty - s.max_stock));
  const overstock_value = round(overstock_qty * s.unit_cost_sgd);
  const overstock_carrying_cost = round((overstock_value * s.annual_carrying_rate_pct) / 100);

  // Excess & Obsolete — slow + idle stock, gross and risk-adjusted
  const isEO = s.movement_class === "Slow Moving" || s.movement_class === "Idle";
  const eo_value = isEO ? round(s.available_qty * s.unit_cost_sgd) : 0;
  const eo_value_risk_adjusted = round((eo_value * s.obsolescence_risk_pct) / 100);

  // Projected stockout gap and the P&L it exposes
  const gapDays =
    s.days_of_cover != null && !s.covered_by_po
      ? Math.max(0, s.lead_time_days - s.days_of_cover)
      : 0;
  const lost_units_risk = round(gapDays * dailyRate);
  const lost_margin_risk = round(lost_units_risk * marginPerMt);
  const lost_sales_value_risk = round(lost_units_risk * s.unit_price_sgd);

  return {
    margin_per_mt: round(marginPerMt),
    gross_margin_pct,
    inventory_value,
    annual_cogs,
    annual_gross_margin,
    overstock_qty,
    overstock_value,
    overstock_carrying_cost,
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

  const overstockSkus = active.filter((s) => s.overstock_qty > 0);
  const overstockValue = sum(overstockSkus, "overstock_value");
  const overstockCarryingCost = sum(overstockSkus, "overstock_carrying_cost");

  const eoSkus = active.filter((s) => s.eo_value > 0);
  const eoValue = sum(eoSkus, "eo_value");
  const eoValueRiskAdjusted = sum(eoSkus, "eo_value_risk_adjusted");
  // E&O is two different risks added together: stock that is barely selling,
  // and stock that has not sold at all. The dashboard says so on screen now,
  // so the split has to come from here rather than being re-derived there.
  //
  // Note what this is NOT doing: it does not re-decide what counts as E&O. It
  // partitions the SAME eoSkus array and sums the SAME eo_value field, so the
  // two parts add back to eoValue by construction. Filtering `active` again on
  // movement_class would have been a second definition of E&O, and this repo
  // has been bitten twice by the same figure derived in two places.
  const eoSlowValue = sum(eoSkus.filter((s) => s.movement_class === "Slow Moving"), "eo_value");
  const eoIdleValue = sum(eoSkus.filter((s) => s.movement_class === "Idle"), "eo_value");

  // Compliance Position (REQ-16, glossary #38) — illustrative, portfolio-level: the real rice-
  // stockpile scheme is company-wide, not per-SKU. Uses demand as an honest stand-in for real
  // import-receipt history, which this project doesn't have.
  const complianceEligibleQty = round(sum(active, "on_hand_qty"));
  const complianceRequiredQty = round(2 * sum(active, "avg_daily_usage_30d") * 30);
  const compliancePosition = round(complianceEligibleQty - complianceRequiredQty);

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
    overstockValue: r0(overstockValue),
    overstockCarryingCost: r0(overstockCarryingCost),
    overstockPct: round((overstockValue / totalInventoryValue) * 100),
    overstockSkuCount: overstockSkus.length,
    eoValue: r0(eoValue),
    eoSlowValue: r0(eoSlowValue),
    eoIdleValue: r0(eoIdleValue),
    eoValueRiskAdjusted: r0(eoValueRiskAdjusted),
    eoPct: round((eoValue / totalInventoryValue) * 100),
    eoSkuCount: eoSkus.length,
    complianceEligibleQty: r0(complianceEligibleQty),
    complianceRequiredQty: r0(complianceRequiredQty),
    compliancePosition: r0(compliancePosition),
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
