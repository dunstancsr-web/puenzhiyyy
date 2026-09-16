// ─────────────────────────────────────────────────────────────────────────────
// FORECAST ENGINE (MVP2 Day 2)
//
// Three Node-only models over the monthly-bucketed sales history, no external
// ML dependency. All deterministic: given the same rows, the same model
// always produces the same numbers, and auto-mode's pick (see backtest()
// below) is a real calculation, never a model call. See design.md /
// .kiro/DEVLOG.md for the full reasoning behind the shortlist.
//
//   naive_seasonal  same calendar month, averaged across every prior year in
//                   history. Zero parameters, the floor every other model has
//                   to beat.
//   linear_trend    deseasonalize each month by its own seasonal-naive
//                   baseline, fit OLS on the deseasonalized series, project
//                   forward, reseasonalize. Cheapest to explain in English
//                   ("demand is trending up/down at X MT/month").
//   holt_winters    additive triple exponential smoothing over a 12-month
//                   season. alpha/beta/gamma are fit by grid search
//                   minimizing in-sample SSE, never hand-set. Degrades to
//                   naive_seasonal below two full seasonal cycles of history,
//                   rather than fit unstable parameters on too little data.
//
// runForecast() produces the numbers safetystock.js needs (avgDailyDemand,
// demandCv replacements — see engines/index.js). backtest() is the
// deterministic auto-mode selector: a rolling-origin walk-forward over WMAPE,
// never an LLM call.
// ─────────────────────────────────────────────────────────────────────────────

/** "YYYY-MM" <-> a contiguous month index, so period arithmetic is integer math. */
function periodToIndex(period) {
  const [y, m] = period.split("-").map(Number);
  return y * 12 + (m - 1);
}
function indexToPeriod(idx) {
  const y = Math.floor(idx / 12);
  const m = (idx % 12) + 1;
  return `${y}-${String(m).padStart(2, "0")}`;
}
function addMonths(period, n) {
  return indexToPeriod(periodToIndex(period) + n);
}

/**
 * One row per calendar month, oldest first, gaps filled with 0 — a month
 * with no sales is a real observation (zero demand), not a missing one, and
 * every model below needs a contiguous series to index into.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {string} skuId
 * @returns {{period: string, qty: number}[]}
 */
function monthlySeries(db, skuId) {
  const rows = db.prepare(`
    SELECT quantity_mt, sale_date
      FROM sales_transactions
     WHERE sku_id = ? AND status = 'fulfilled'
     ORDER BY sale_date`).all(skuId);

  if (!rows.length) return [];

  const byPeriod = new Map();
  for (const r of rows) {
    const p = r.sale_date.slice(0, 7);
    byPeriod.set(p, round1((byPeriod.get(p) || 0) + r.quantity_mt));
  }

  const periods = [...byPeriod.keys()].sort();
  const first = periodToIndex(periods[0]);
  const last = periodToIndex(periods[periods.length - 1]);
  const series = [];
  for (let idx = first; idx <= last; idx++) {
    const p = indexToPeriod(idx);
    series.push({ period: p, qty: byPeriod.get(p) || 0 });
  }
  return series;
}

// ── Model 1: naive seasonal ─────────────────────────────────────────────────
function naiveSeasonalForecast(series, targetPeriods) {
  const byMonth = new Map(); // 1-12 -> [qty, qty, ...] across every year seen
  for (const { period, qty } of series) {
    const m = Number(period.slice(5, 7));
    if (!byMonth.has(m)) byMonth.set(m, []);
    byMonth.get(m).push(qty);
  }
  const overallAvg = series.length ? series.reduce((s, r) => s + r.qty, 0) / series.length : 0;

  return targetPeriods.map((period) => {
    const m = Number(period.slice(5, 7));
    const values = byMonth.get(m);
    const qty = values?.length ? values.reduce((a, b) => a + b, 0) / values.length : overallAvg;
    return { period, qty: round1(Math.max(0, qty)) };
  });
}

// ── Model 2: linear trend on a deseasonalized series ────────────────────────
function linearTrendForecast(series, targetPeriods) {
  if (series.length < 2) {
    const qty = series[0]?.qty || 0;
    return targetPeriods.map((period) => ({ period, qty }));
  }

  const byMonth = new Map();
  for (const { period, qty } of series) {
    const m = Number(period.slice(5, 7));
    if (!byMonth.has(m)) byMonth.set(m, []);
    byMonth.get(m).push(qty);
  }
  // A month with a zero seasonal baseline (never sold in that calendar month)
  // would divide the series by zero; floor it at 1 rather than skip the
  // point, since a deseasonalized ratio of "qty / 1" still fits the trend
  // line sensibly for an otherwise-idle month.
  const seasonalBaseline = (m) => {
    const values = byMonth.get(m);
    const avg = values.reduce((a, b) => a + b, 0) / values.length;
    return avg > 0 ? avg : 1;
  };

  const points = series.map((r, i) => ({ x: i, y: r.qty / seasonalBaseline(Number(r.period.slice(5, 7))) }));
  const n = points.length;
  const sumX = points.reduce((s, p) => s + p.x, 0);
  const sumY = points.reduce((s, p) => s + p.y, 0);
  const sumXY = points.reduce((s, p) => s + p.x * p.y, 0);
  const sumXX = points.reduce((s, p) => s + p.x * p.x, 0);
  const denom = n * sumXX - sumX * sumX;
  const slope = denom !== 0 ? (n * sumXY - sumX * sumY) / denom : 0;
  const intercept = (sumY - slope * sumX) / n;

  const lastIndex = series.length - 1;
  return targetPeriods.map((period, k) => {
    const idx = lastIndex + 1 + k;
    const ratio = Math.max(0, intercept + slope * idx);
    const qty = ratio * seasonalBaseline(Number(period.slice(5, 7)));
    return { period, qty: round1(Math.max(0, qty)) };
  });
}

// ── Model 3: Holt-Winters (additive, 12-month season) ───────────────────────
function holtWintersForecast(series, targetPeriods, seasonPeriod = 12) {
  const n = series.length;
  if (n < seasonPeriod * 2) return naiveSeasonalForecast(series, targetPeriods);

  const y = series.map((r) => r.qty);

  const fit = (alpha, beta, gamma) => {
    const season1 = y.slice(0, seasonPeriod);
    const season2 = y.slice(seasonPeriod, seasonPeriod * 2);
    const mean1 = season1.reduce((a, b) => a + b, 0) / seasonPeriod;
    const mean2 = season2.reduce((a, b) => a + b, 0) / seasonPeriod;
    let level = mean1;
    let trend = (mean2 - mean1) / seasonPeriod;
    const seasonal = season1.map((v) => v - mean1);

    let sse = 0;
    for (let t = 0; t < n; t++) {
      const s = seasonal[t % seasonPeriod];
      const prevLevel = level;
      const forecastT = prevLevel + trend + s;
      sse += (forecastT - y[t]) ** 2;

      const actual = y[t];
      level = alpha * (actual - s) + (1 - alpha) * (prevLevel + trend);
      trend = beta * (level - prevLevel) + (1 - beta) * trend;
      seasonal[t % seasonPeriod] = gamma * (actual - level) + (1 - gamma) * s;
    }
    return { sse, level, trend, seasonal };
  };

  // Coarse grid search: cheap at this data size (a few hundred fits, each a
  // single pass over <= 24 points) and avoids an optimizer dependency for a
  // handful of points. alpha/beta/gamma are never hand-set.
  let best = null;
  for (const alpha of [0.1, 0.3, 0.5, 0.7, 0.9]) {
    for (const beta of [0.05, 0.15, 0.3]) {
      for (const gamma of [0.1, 0.3, 0.5, 0.7]) {
        const result = fit(alpha, beta, gamma);
        if (!best || result.sse < best.sse) best = result;
      }
    }
  }

  const lastIndex = n - 1;
  return targetPeriods.map((period, k) => {
    const h = k + 1;
    const s = best.seasonal[(lastIndex + h) % seasonPeriod];
    const qty = Math.max(0, best.level + h * best.trend + s);
    return { period, qty: round1(qty) };
  });
}

const MODELS = [
  { id: "naive_seasonal", label: "Naive seasonal", fn: naiveSeasonalForecast },
  { id: "linear_trend", label: "Linear trend", fn: linearTrendForecast },
  { id: "holt_winters", label: "Holt-Winters", fn: holtWintersForecast },
];
const MODEL_IDS = MODELS.map((m) => m.id);

function forecastPeriods(series, modelId, targetPeriods) {
  const model = MODELS.find((m) => m.id === modelId);
  if (!model) throw new Error(`Unknown forecast model: ${modelId}`);
  return model.fn(series, targetPeriods);
}

/**
 * @param {import('better-sqlite3').Database} db
 * @param {string} skuId
 * @param {string} model  one of MODEL_IDS
 * @param {number} horizonMonths  3-6
 */
function runForecast(db, skuId, model, horizonMonths = 6) {
  const series = monthlySeries(db, skuId);
  if (!series.length) {
    return { model, horizon_months: horizonMonths, monthly: [], avg_daily_demand_forecast: 0, demand_cv_forecast: 0 };
  }

  const lastPeriod = series[series.length - 1].period;
  const targetPeriods = Array.from({ length: horizonMonths }, (_, i) => addMonths(lastPeriod, i + 1));
  const monthly = forecastPeriods(series, model, targetPeriods);

  const values = monthly.map((m) => m.qty);
  const meanQty = values.reduce((a, b) => a + b, 0) / values.length;
  // /30, not the calendar-exact days-per-month: every other daily rate in
  // this app (avg_daily_usage_30d in velocity.js) uses the same convention,
  // and a forecast demand rate has to be comparable to it, not more precise
  // than it in a way nothing else matches.
  const avg_daily_demand_forecast = round2(meanQty / 30);
  const demand_cv_forecast = round2(coefficientOfVariation(values));

  return { model, horizon_months: horizonMonths, monthly, avg_daily_demand_forecast, demand_cv_forecast };
}

/**
 * Deterministic auto-mode selector: rolling-origin (walk-forward) holdout,
 * never an LLM call. Origin starts at minHistoryMonths - 1 (need >= 12 months
 * so Holt-Winters sees one full season) and rolls forward one month at a
 * time, scoring every candidate model's 1-month-ahead forecast against WMAPE
 * (weighted MAPE - stays well-behaved on the near-zero months an Idle SKU
 * has, where plain MAPE blows up).
 *
 * @param {import('better-sqlite3').Database} db
 * @param {string} skuId
 * @param {string[]} models  candidate model ids to score
 * @returns {{winner: string, metric: string, scores: object, foldsUsed: number, lowConfidence: boolean}}
 */
function backtest(db, skuId, models = MODEL_IDS, { minHistoryMonths = 12 } = {}) {
  const series = monthlySeries(db, skuId);
  const acc = Object.fromEntries(models.map((id) => [id, { absError: 0, actualSum: 0 }]));

  const maxOrigin = series.length - 2; // need one more real month after the origin to score against
  let foldsUsed = 0;
  for (let origin = minHistoryMonths - 1; origin <= maxOrigin; origin++) {
    const actualPeriod = series[origin + 1];
    if (!actualPeriod) break;
    const train = series.slice(0, origin + 1);
    foldsUsed++;
    for (const id of models) {
      const [forecast] = forecastPeriods(train, id, [actualPeriod.period]);
      acc[id].absError += Math.abs(forecast.qty - actualPeriod.qty);
      acc[id].actualSum += actualPeriod.qty;
    }
  }

  const scores = {};
  for (const id of models) {
    scores[id] = acc[id].actualSum > 0 ? round2(acc[id].absError / acc[id].actualSum) : null;
  }

  const scored = Object.entries(scores).filter(([, v]) => v !== null);
  const winner = scored.length
    ? scored.reduce((best, cur) => (cur[1] < best[1] ? cur : best))[0]
    : models[0];

  // Fewer than half a year of scored folds: still a real answer, but flagged
  // rather than shown with false precision (an Idle SKU's long zero-sales
  // runs are the usual cause).
  return { winner, metric: "WMAPE", scores, foldsUsed, lowConfidence: foldsUsed < 6 };
}

function coefficientOfVariation(values) {
  if (!values.length) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  if (mean === 0) return 0;
  const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance) / mean;
}

const round1 = (n) => Math.round(n * 10) / 10;
const round2 = (n) => Math.round(n * 100) / 100;

module.exports = {
  runForecast, backtest, monthlySeries,
  MODELS, MODEL_IDS,
  periodToIndex, indexToPeriod, addMonths,
};
