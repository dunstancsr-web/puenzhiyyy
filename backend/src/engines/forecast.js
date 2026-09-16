// ─────────────────────────────────────────────────────────────────────────────
// DEMAND FORECAST ENGINE  (MVP2, the Reorder Loop steps 2-3)
//
// Turns each SKU's monthly outflow history into a forward projection of demand,
// and, crucially, measures how well that projection would have done on history
// it did not see. The docs are firm on this: an UNVALIDATED forecast figure is
// worse than none (requirements.md "Explicitly Deferred", Step 10; WRITEUP §7).
// So this engine never returns a forecast without a backtest accuracy beside it,
// and the caller decides whether the accuracy is good enough to trust.
//
// DETERMINISTIC. No model, no randomness, no LLM. Same history in, same numbers
// out, every time (rules.md; REQ-21: a model may narrate, never compute).
//
// TRAINING SIGNAL: inventory_history.issues_qty, the monthly FULFILLED outflow
// per SKU (24 months seeded). This is the same fulfilled-only demand the
// velocity engine uses for the 30 day rate (seed.js builds issues_qty from
// fulfilled sales only), so the forecast lives in the same demand world as the
// rest of the app rather than inventing a second definition of "demand".
//
// METHOD (first cut, no new dependencies): a damped level+trend projection
// (Holt-style) blended with a seasonal-naive term (same month last year). Kept
// deliberately simple and explainable; a heavier model (Prophet/ARIMA/GBM) is a
// later swap once this proves the loop end to end. The build map lists those as
// "the usual candidates", not a requirement for the first cut.
//
// WHAT IT DOES NOT DO: it does not change the app-wide demand rate. Today every
// engine reads avg_daily_usage_30d and only that (design.md, "one demand rate").
// Whether the forecast REPLACES or BLENDS with that rate is Stan's decision, so
// this engine only PRODUCES figures; wiring them into safety stock / projection
// is a separate, gated step.
// ─────────────────────────────────────────────────────────────────────────────

const round = (n) => Math.round(n * 100) / 100;

// Minimum history before a forecast is meaningful. Below this we return null and
// the caller falls back to the 30 day average (Number(null) is 0 and 0 is
// finite, per rules.md, so callers must guard on presence, not truthiness).
const MIN_MONTHS = 6;
const SEASON = 12; // monthly data, yearly season

/**
 * Read a SKU's monthly outflow series, oldest first.
 * Returns [{ period:'YYYY-MM', issues: number }], excluding the current
 * (incomplete) month so a half-finished month never looks like a demand drop.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {string} skuId
 * @param {string} [currentPeriod]  'YYYY-MM' to exclude; defaults to this month
 */
function monthlyOutflow(db, skuId, currentPeriod = new Date().toISOString().slice(0, 7)) {
  const rows = db
    .prepare(
      `SELECT period, issues_qty AS issues
         FROM inventory_history
        WHERE sku_id = ? AND period < ?
        ORDER BY period`
    )
    .all(skuId, currentPeriod);
  return rows.map((r) => ({ period: r.period, issues: Number(r.issues) || 0 }));
}

// ── Holt (damped trend) one-pass fit, plus a seasonal-naive blend ────────────
// alpha/beta/phi are fixed, not fitted per SKU: with only ~24 points, fitting
// them per SKU overfits, and fixed sensible values keep the engine explainable
// and deterministic. phi < 1 damps the trend so a long horizon can't run away.
const ALPHA = 0.4; // level smoothing
const BETA = 0.2;  // trend smoothing
const PHI = 0.9;   // trend damping

function holtDamped(series) {
  if (series.length < 2) return null;
  let level = series[0];
  let trend = series[1] - series[0];
  for (let i = 1; i < series.length; i++) {
    const prevLevel = level;
    level = ALPHA * series[i] + (1 - ALPHA) * (level + PHI * trend);
    trend = BETA * (level - prevLevel) + (1 - BETA) * PHI * trend;
  }
  return { level, trend };
}

// Forecast h steps ahead from a fitted level/trend, damped, floored at zero
// (you cannot sell negative rice).
function holtForecast(fit, h) {
  if (!fit) return null;
  let damp = 0;
  for (let i = 1; i <= h; i++) damp += Math.pow(PHI, i);
  return Math.max(0, fit.level + damp * fit.trend);
}

/**
 * Project the next `horizon` months of outflow for one series.
 * Blends the damped-trend forecast with a seasonal-naive term (the same month a
 * year earlier) when at least a full season of history exists; otherwise it is
 * trend only. Returns null when history is too short to be meaningful.
 *
 * @param {number[]} series  monthly outflow, oldest first
 * @param {number} horizon   months ahead (default 3, the build map's window)
 * @returns {{ monthly:number[], method:string } | null}
 */
function forecastSeries(series, horizon = 3) {
  if (series.length < MIN_MONTHS) return null;
  const fit = holtDamped(series);
  const hasSeason = series.length >= SEASON + 1;

  const monthly = [];
  for (let h = 1; h <= horizon; h++) {
    const trendPart = holtForecast(fit, h);
    if (hasSeason) {
      // Seasonal-naive: value from the same month last year, carried by the
      // ratio of recent level to the level a year ago so a growing SKU's
      // season scales up rather than repeating last year's absolute figure.
      const lastYear = series[series.length - SEASON + ((h - 1) % SEASON)];
      const yearAgoLevel = series[series.length - SEASON] || 0;
      const scale = yearAgoLevel > 0 ? fit.level / yearAgoLevel : 1;
      const seasonalPart = Math.max(0, lastYear * scale);
      monthly.push(round(0.5 * trendPart + 0.5 * seasonalPart));
    } else {
      monthly.push(round(trendPart));
    }
  }
  return { monthly, method: hasSeason ? "holt+seasonal" : "holt" };
}

// ── Backtest: how well would this have done on months it did not see? ────────
// Rolling-origin holdout. For each of the last `folds` months, fit on
// everything before it and forecast one month ahead, then compare to the
// actual. Reports MAPE (mean absolute percentage error) and MAE (MT). A forecast
// with no backtest must never surface a number, so the caller keys "trust" off
// mape rather than showing the projection unconditionally.
//
// MAPE guards: a month with zero actual outflow has no defined percentage error,
// so it is excluded from MAPE (and counted separately) rather than dividing by
// zero. If every holdout month is zero, mape is null and only MAE is reported.
function backtest(series, folds = 6) {
  if (series.length < MIN_MONTHS + 1) return { mape: null, mae: null, folds: 0 };
  const usableFolds = Math.min(folds, series.length - MIN_MONTHS);
  const pctErrors = [];
  const absErrors = [];
  for (let k = usableFolds; k >= 1; k--) {
    const cut = series.length - k;
    const train = series.slice(0, cut);
    const actual = series[cut];
    const fc = forecastSeries(train, 1);
    if (!fc) continue;
    const predicted = fc.monthly[0];
    absErrors.push(Math.abs(predicted - actual));
    if (actual > 0) pctErrors.push(Math.abs(predicted - actual) / actual);
  }
  const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
  const mape = pctErrors.length ? round(mean(pctErrors) * 100) : null;
  const mae = absErrors.length ? round(mean(absErrors)) : null;
  return { mape, mae, folds: absErrors.length, zero_months: absErrors.length - pctErrors.length };
}

/**
 * Full forecast for one SKU, the shape a caller consumes.
 * Returns null when there is not enough history (the caller then keeps the
 * 30 day average). Presence of `forecast_daily_demand` is the signal that a
 * usable forecast exists; guard on it explicitly, not on truthiness.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {string} skuId
 * @param {object} [opts]
 * @param {number} [opts.horizon=3]
 * @param {Date|number} [opts.asOf]
 * @returns {null | {
 *   forecast_monthly:number[], forecast_horizon_mt:number,
 *   forecast_daily_demand:number, forecast_cv:number,
 *   method:string, months_of_history:number,
 *   backtest:{mape:number|null, mae:number|null, folds:number, zero_months:number}
 * }}
 */
function forecastSku(db, skuId, { horizon = 3, asOf = Date.now() } = {}) {
  const currentPeriod = new Date(asOf instanceof Date ? asOf.getTime() : asOf)
    .toISOString()
    .slice(0, 7);
  const history = monthlyOutflow(db, skuId, currentPeriod);
  const series = history.map((h) => h.issues);
  const fc = forecastSeries(series, horizon);
  if (!fc) return null;

  const horizonTotal = fc.monthly.reduce((a, b) => a + b, 0);
  // Convert the monthly projection to a daily rate the existing engines speak:
  // horizon months of MT spread over ~30.44 days each.
  const forecastDaily = round(horizonTotal / (horizon * 30.44));

  // Forecast variability, for safety stock (the Reorder Loop step 5 wants the
  // forecast's own variability, not just the historical demand_cv). Coefficient
  // of variation of the recent monthly series.
  const recent = series.slice(-SEASON);
  const mean = recent.reduce((a, b) => a + b, 0) / recent.length;
  const variance = recent.reduce((a, b) => a + (b - mean) ** 2, 0) / recent.length;
  const cv = mean > 0 ? round(Math.sqrt(variance) / mean) : 0;

  return {
    forecast_monthly: fc.monthly,
    forecast_horizon_mt: round(horizonTotal),
    forecast_daily_demand: forecastDaily,
    forecast_cv: cv,
    method: fc.method,
    months_of_history: series.length,
    backtest: backtest(series),
  };
}

module.exports = {
  forecastSku,
  forecastSeries,
  backtest,
  monthlyOutflow,
  MIN_MONTHS,
};
