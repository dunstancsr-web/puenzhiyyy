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
const { getActiveForecast } = require("./forecast");
const { computeRiskBuffer } = require("./riskbuffer");
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

    // MVP2: for a SKU opted into forecasting, avgDailyDemand/demandCv going
    // INTO King's formula come from the active forecast instead of the 30
    // day average — but ONLY here. avg_daily_usage_30d itself, and its seven
    // other consumers (cover, projection, suggested order, ABC, financials,
    // compliance), are untouched: the "one demand rate" decision on record
    // in design.md is about operational reality today, a different question
    // from expected future demand. Falls back to the 30 day average if a
    // SKU is flagged for forecasting but no forecast has been generated yet
    // (?? not ||, so a genuine 0 MT/day forecast is not treated as absent),
    // rather than a zero/undefined safety stock.
    const activeForecast = m.use_forecast ? getActiveForecast(db, m.sku_id) : null;
    const forecastDemand = activeForecast ? activeForecast.avg_daily_demand_forecast : null;
    const forecastCv = activeForecast ? activeForecast.demand_cv_forecast : null;

    // Display-only metadata for the Forecast overview list (MVP2 Day 6):
    // fetched regardless of use_forecast, since "has this SKU been forecast
    // at all, and how stale is it" is a real question even for a SKU that
    // hasn't been opted in yet. Never feeds computation — activeForecast
    // above, gated on use_forecast, is the only row King's formula ever sees.
    const forecastRow = m.forecast_model ? getActiveForecast(db, m.sku_id) : null;

    const ss = computeSafetyStock({
      avgDailyDemand: forecastDemand ?? v.avg_daily_usage_30d,
      demandCv: forecastCv ?? demandCv,
      leadTimeDays: m.lead_time_days,
      leadTimeStdDays: m.lead_time_std_days,
      serviceLevel: m.target_service_level,
    });

    // Risk buffer: added AFTER King's formula as a separate, visible addend,
    // not folded into the variance math — so the formula itself stays
    // provably unchanged (check-formulas.js recalculates it verbatim) and
    // the buffer's own contribution stays separately explainable ("+12 MT
    // for India export-ban exposure") instead of disappearing into an
    // opaque Z*sigma number. strategic_adjustment (a documented Phase 2
    // placeholder, see db/init.js) is the analytics-output field this lands
    // in, overriding the raw stored column below rather than writing back
    // to it — this is a computed figure, not stored state.
    const risk = computeRiskBuffer(db, m);
    const risk_buffer_mt = round1(risk.days * (forecastDemand ?? v.avg_daily_usage_30d));

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
      demand_source: activeForecast ? activeForecast.model : "velocity_30d",
      forecast_avg_daily_demand: forecastDemand,
      forecast_demand_cv: forecastCv,
      forecast_low_confidence: activeForecast ? !!activeForecast.low_confidence : false,
      // Display-only (see forecastRow above) — independent of use_forecast.
      forecast_active_model: forecastRow ? forecastRow.model : null,
      forecast_backtest_score: forecastRow ? forecastRow.backtest_score : null,
      forecast_generated_at: forecastRow ? forecastRow.generated_at : null,
      risk_buffer_mt,
      risk_buffer_days: risk.days,
      risk_buffer_reason: risk.reason,
      reorder_point_suggested_with_risk: round1(ss.reorder_point_suggested + risk_buffer_mt),
      strategic_adjustment: risk_buffer_mt,
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
