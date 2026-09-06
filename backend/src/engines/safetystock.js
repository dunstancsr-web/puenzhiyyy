// ─────────────────────────────────────────────────────────────────────────────
// SAFETY STOCK ENGINE
// Statistical safety stock from a target service level and demand + lead-time
// variability (King's formula). Replaces the flat safety_stock_pct buffer.
//
//   SS (units) = Z(service level) × √( LT × σ_d²  +  d² × σ_LT² )
//   Reorder point = d × LT  +  SS
//
// where d = avg daily demand, σ_d = daily demand std, LT = lead time (days),
// σ_LT = lead-time std (days).
// ─────────────────────────────────────────────────────────────────────────────

// Service level (cycle) → one-tailed normal Z-score.
function zScore(serviceLevel) {
  const table = [
    [0.5, 0.0], [0.75, 0.67], [0.8, 0.84], [0.85, 1.04], [0.9, 1.28],
    [0.91, 1.34], [0.92, 1.41], [0.93, 1.48], [0.94, 1.56], [0.95, 1.65],
    [0.96, 1.75], [0.97, 1.88], [0.98, 2.05], [0.99, 2.33], [0.999, 3.09],
  ];
  let z = 0;
  for (const [p, v] of table) if (serviceLevel >= p) z = v;
  return z;
}

/**
 * @param {object} p
 * @param {number} p.avgDailyDemand   blended daily usage (MT/day)
 * @param {number} p.demandCv         coefficient of variation of daily demand
 * @param {number} p.leadTimeDays
 * @param {number} p.leadTimeStdDays
 * @param {number} p.serviceLevel     e.g. 0.95
 * @returns {{ z, safety_stock_mt, safety_stock_days, reorder_point_mt, lead_time_demand_mt }}
 */
function computeSafetyStock({
  avgDailyDemand = 0,
  demandCv = 0.3,
  leadTimeDays = 45,
  leadTimeStdDays = 0,
  serviceLevel = 0.95,
}) {
  const z = zScore(serviceLevel);
  const sigmaD = demandCv * avgDailyDemand; // daily demand std
  const variance =
    leadTimeDays * sigmaD * sigmaD +
    avgDailyDemand * avgDailyDemand * leadTimeStdDays * leadTimeStdDays;
  const ssMt = z * Math.sqrt(Math.max(variance, 0));
  const leadTimeDemand = avgDailyDemand * leadTimeDays;

  return {
    z,
    safety_stock_mt: round(ssMt),
    safety_stock_days: avgDailyDemand > 0 ? Math.round(ssMt / avgDailyDemand) : 0,
    lead_time_demand_mt: round(leadTimeDemand),
    reorder_point_mt: round(leadTimeDemand + ssMt),
  };
}

const round = (n) => Math.round(n * 100) / 100;

module.exports = { zScore, computeSafetyStock };
