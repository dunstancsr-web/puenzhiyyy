// ─────────────────────────────────────────────────────────────────────────────
// ANALYTICS ORCHESTRATOR
// Single entry point the API routes call. Runs every engine in dependency
// order and returns the fully enriched SKU list + portfolio KPIs + alerts —
// the same shape the frontend mock (riceData.js / statsData.js) exposes.
//
//   const { skus, stats, alerts, primaryExceptions, abcMovementMatrix } =
//       buildAnalytics(db);
// ─────────────────────────────────────────────────────────────────────────────

const { computeVelocity, daysAgo } = require("./velocity");
const { computePosition } = require("./position");
const { computeSafetyStock } = require("./safetystock");
const { classifyPortfolio } = require("./classification");
const { segmentPortfolio, buildMatrix } = require("./segmentation");
const { computeHealth } = require("./health");
const { skuFinancials, portfolioStats } = require("./financials");
const { generateAlerts, fmt$ } = require("./alerts");
const { projectInventory } = require("./projection");
const { humanDuration } = require("./duration");

function ageingStatus(ageDays, maxHoldingDays) {
  if (ageDays == null) return "Fresh";
  const ratio = ageDays / (maxHoldingDays || 270);
  if (ratio < 0.34) return "Fresh";
  if (ratio < 0.67) return "Normal";
  if (ratio < 0.9) return "Ageing";
  return "At Risk";
}

function buildAnalytics(db, asOf = Date.now()) {
  const now = asOf instanceof Date ? asOf.getTime() : asOf;
  const masters = db.prepare(`SELECT * FROM skus WHERE active = 1`).all();

  const lostStmt = db.prepare(
    `SELECT COALESCE(SUM(quantity_mt), 0) AS lost
       FROM sales_transactions
      WHERE sku_id = ? AND status = 'lost' AND sale_date >= ?`
  );

  // ── Pass 1: velocity, position, safety stock, coverage primitives ──────────
  let skus = masters.map((m) => {
    const v = computeVelocity(db, m.sku_id, now);
    const p = computePosition(db, m.sku_id, now);

    const demandCv = v.demand_cv > 0 ? v.demand_cv : m.demand_cv;
    const ss = computeSafetyStock({
      avgDailyDemand: v.avg_daily_usage_30d,
      demandCv,
      leadTimeDays: m.lead_time_days,
      leadTimeStdDays: m.lead_time_std_days,
      serviceLevel: m.target_service_level,
    });

    // The one demand rate: the 30 day moving average (velocity.js).
    const dailyRate = v.avg_daily_usage_30d;
    const days_of_cover = dailyRate > 0 ? Math.round(p.available_qty / dailyRate) : null;
    const months_of_cover = days_of_cover != null ? round1(days_of_cover / 30) : null;
    const target_days_of_cover = dailyRate > 0 ? Math.round(m.target_stock / dailyRate) : null;

    const covered_by_po =
      p.expected_incoming_qty > 0 &&
      p.incoming_eta_days != null &&
      days_of_cover != null &&
      p.incoming_eta_days <= days_of_cover;

    const lost_30d = lostStmt.get(m.sku_id, daysAgo(30, now)).lost;

    // Suggested Order Quantity (glossary #30) = target stock - projected position at receipt,
    // using the real projection curve (TASK-07) run out to the lead time.
    const projectionAtReceipt = projectInventory({
      availableQty: p.available_qty,
      dailyDemand: dailyRate,
      openPos: p.open_pos,
      days: Math.max(0, Math.round(m.lead_time_days)),
      asOf: now,
    });
    const projectedPositionAtReceipt = projectionAtReceipt.curve[projectionAtReceipt.curve.length - 1].projected_available;
    const suggested_order_qty = Math.max(0, round1(m.target_stock - projectedPositionAtReceipt));

    return {
      ...m,
      ...v,
      ...p,
      demand_cv: demandCv,
      safety_stock_days: ss.safety_stock_days,
      safety_stock_mt: ss.safety_stock_mt,
      reorder_point_suggested: ss.reorder_point_suggested,
      lead_time_demand_mt: ss.lead_time_demand_mt,
      service_z: ss.z,
      days_of_cover,
      months_of_cover,
      days_of_cover_text: humanDuration(days_of_cover),
      target_days_of_cover,
      covered_by_po,
      suggested_order_qty,
      lost_30d,
      days_since_last_sale_text: humanDuration(v.days_since_last_sale),
      inventory_age_text: humanDuration(p.inventory_age_days),
      ageing_status: ageingStatus(p.inventory_age_days, m.max_holding_days),
      annual_cogs: Math.round(dailyRate * 365 * m.unit_cost_sgd),
    };
  });

  // ── Portfolio passes: movement class + ABC/XYZ ────────────────────────────
  const movement = classifyPortfolio(skus);
  skus.forEach((s) => (s.movement_class = movement.get(s.sku_id)));

  const segments = segmentPortfolio(skus);
  skus.forEach((s) => Object.assign(s, segments.get(s.sku_id)));

  // ── Pass 2: coverage band, financials, health ─────────────────────────────
  skus = skus.map((s) => {
    let coverage_band;
    if (s.days_of_cover == null) coverage_band = "idle";
    else if (s.days_of_cover < s.lead_time_days + s.safety_stock_days) coverage_band = "below";
    else if (s.target_days_of_cover != null && s.days_of_cover > s.target_days_of_cover) coverage_band = "above";
    else coverage_band = "in";

    const withBand = { ...s, coverage_band };
    const fin = skuFinancials(withBand);
    const enriched = { ...withBand, ...fin };
    enriched.health_status = computeHealth(enriched);
    enriched.recommended_action = recommend(enriched);
    return enriched;
  });

  // ── Roll-ups ─────────────────────────────────────────────────────────────
  const demand = skus.reduce(
    (acc, s) => {
      acc.lost_30d += s.lost_30d || 0;
      acc.demand_30d += (s.sales_30d || 0) + (s.lost_30d || 0);
      return acc;
    },
    { lost_30d: 0, demand_30d: 0 }
  );

  const stats = portfolioStats(skus, demand);
  const abcMovementMatrix = buildMatrix(skus);
  const { alerts, primaryExceptions } = generateAlerts(skus);

  stats.abcMovementMatrix = abcMovementMatrix;
  stats.openExceptions = {
    count: primaryExceptions.length,
    critical: primaryExceptions.filter((a) => a.severity === "critical").length,
    rawAlertCount: alerts.length,
  };

  return { skus, stats, alerts, primaryExceptions, abcMovementMatrix, asOf: new Date(now).toISOString() };
}

// Short rule-based recommended action for the SKU detail view.
function recommend(s) {
  if (s.health_status === "RED" && s.movement_class === "Idle")
    return "Stop replenishment. Initiate disposition review - discount, alternative channel, or CSR evaluation.";
  if (s.health_status === "RED")
    return `Place replenishment order immediately. Projected ${s.stockout_gap_days}-day stockout before resupply.`;
  if (s.overstock_qty > 0)
    // fmt$ shared with alerts.js so the same figure is not "SGD $12K" on the
    // alert card and "SGD $11880" on the SKU detail.
    return `Suspend purchasing. ${Math.round(s.overstock_qty)} MT above max - carrying cost ≈ ${fmt$(s.overstock_carrying_cost)}/yr.`;
  if (s.movement_class === "Slow Moving")
    return "Reduce next order quantity. Stock coverage well above target - review demand.";
  if (s.coverage_band === "below")
    return "Approaching reorder point. Initiate procurement review within the lead-time window.";
  return "No action required. Stock position within the healthy band.";
}

const round1 = (n) => Math.round(n * 10) / 10;

module.exports = { buildAnalytics, ageingStatus };
