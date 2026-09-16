#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// FORECAST CHECK: does the forecast engine do what mvp2-demand-forecast/design.md says?
//
// Run from backend/:
//   node scripts/check-forecast.js
//
// Same idea as check-formulas.js, for the MVP2 forecast engine. It does two
// things:
//
//   1. AGREEMENT. Re-derive the forecast and backtest from raw inventory_history
//      rows, written out FROM THE SPEC TEXT, and compare with what
//      engines/forecast.js produces for every SKU. A test oracle, not the app's
//      code path: it never calls buildAnalytics and re-implements the formula so
//      that if the two disagree, one is wrong and a person decides which.
//
//   2. PROOF IT CAN FAIL. A check that cannot fail is worthless (rules.md,
//      "Prove a new check can fail"). The backtest is the trust gate, so we feed
//      it a series it MUST score badly (erratic) and one it MUST score well
//      (clean), and fail this script if either verdict is wrong.
//
// Exit code 1 on any disagreement or any failed self-test.
// ─────────────────────────────────────────────────────────────────────────────

const { getDb } = require("../src/db/init");
const {
  forecastSku,
  forecastSeries,
  backtest,
  monthlyOutflow,
  MIN_MONTHS,
} = require("../src/engines/forecast");

// ── The spec's formula, re-implemented from the text of design.md ────────────
// Deliberately a second, independent implementation. Kept parallel to the doc,
// NOT imported from the engine, so it can catch the engine drifting from the spec.
const ALPHA = 0.4, BETA = 0.2, PHI = 0.9, SEASON = 12;
const round = (n) => Math.round(n * 100) / 100;

function specHoltFit(series) {
  if (series.length < 2) return null;
  let level = series[0];
  let trend = series[1] - series[0];
  for (let i = 1; i < series.length; i++) {
    const prev = level;
    level = ALPHA * series[i] + (1 - ALPHA) * (level + PHI * trend);
    trend = BETA * (level - prev) + (1 - BETA) * PHI * trend;
  }
  return { level, trend };
}
function specHolt(fit, h) {
  if (!fit) return null;
  let damp = 0;
  for (let i = 1; i <= h; i++) damp += Math.pow(PHI, i);
  return Math.max(0, fit.level + damp * fit.trend);
}
function specForecast(series, horizon) {
  if (series.length < MIN_MONTHS) return null;
  const fit = specHoltFit(series);
  const hasSeason = series.length >= SEASON + 1;
  const monthly = [];
  for (let h = 1; h <= horizon; h++) {
    const trendPart = specHolt(fit, h);
    if (hasSeason) {
      const lastYear = series[series.length - SEASON + ((h - 1) % SEASON)];
      const yearAgoLevel = series[series.length - SEASON] || 0;
      const scale = yearAgoLevel > 0 ? fit.level / yearAgoLevel : 1;
      monthly.push(round(0.5 * trendPart + 0.5 * Math.max(0, lastYear * scale)));
    } else {
      monthly.push(round(trendPart));
    }
  }
  return monthly;
}

const near = (a, b, tol = 0.01) =>
  (a == null && b == null) || (a != null && b != null && Math.abs(a - b) <= tol);

const db = getDb();
const skus = db.prepare(`SELECT sku_id FROM skus WHERE active = 1 ORDER BY sku_id`).all();
const now = Date.now();
const horizon = 3;

let failures = 0;
console.log(`Forecast check against mvp2-demand-forecast/design.md, ${skus.length} SKUs\n`);

// ── 1. Agreement, per SKU ────────────────────────────────────────────────────
for (const { sku_id } of skus) {
  const series = monthlyOutflow(db, sku_id, new Date(now).toISOString().slice(0, 7)).map((h) => h.issues);
  const specMonthly = specForecast(series, horizon);
  const engine = forecastSku(db, sku_id, { asOf: now });

  // Both null (too little history) is agreement.
  if (specMonthly == null && engine == null) {
    console.log(`PASS  ${sku_id.padEnd(9)} (no forecast: history < ${MIN_MONTHS} months, both agree)`);
    continue;
  }
  if (specMonthly == null || engine == null) {
    console.log(`FAIL  ${sku_id.padEnd(9)} one side forecast and the other did not (spec ${specMonthly}, engine ${engine && engine.forecast_monthly})`);
    failures++;
    continue;
  }

  const monthlyOk = specMonthly.every((v, i) => near(v, engine.forecast_monthly[i]));
  // The engine's daily rate must equal its own horizon total spread over the horizon.
  const specDaily = round(specMonthly.reduce((a, b) => a + b, 0) / (horizon * 30.44));
  const dailyOk = near(specDaily, engine.forecast_daily_demand);

  if (monthlyOk && dailyOk) {
    console.log(
      `PASS  ${sku_id.padEnd(9)} monthly [${engine.forecast_monthly.join(", ")}]  ` +
      `${engine.forecast_daily_demand}/day  MAPE ${engine.backtest.mape ?? "n/a"}%`
    );
  } else {
    console.log(`FAIL  ${sku_id.padEnd(9)} spec monthly [${specMonthly}] vs engine [${engine.forecast_monthly}]; spec daily ${specDaily} vs engine ${engine.forecast_daily_demand}`);
    failures++;
  }
}

// ── 2. Proof the backtest can fail ───────────────────────────────────────────
console.log("\nSelf-tests (the backtest must discriminate, or it is not measuring anything):");
const selfTests = [
  {
    name: "erratic series scores badly (MAPE > 50%)",
    series: [10, 200, 5, 180, 8, 220, 3, 190, 12, 205, 6, 175],
    ok: (bt) => bt.mape != null && bt.mape > 50,
  },
  {
    name: "clean linear series scores well (MAPE < 10%)",
    series: [100, 102, 104, 106, 108, 110, 112, 114, 116, 118, 120, 122],
    ok: (bt) => bt.mape != null && bt.mape < 10,
  },
  {
    name: "all-zero series gives null MAPE, no divide-by-zero",
    series: [0, 0, 0, 0, 0, 0, 0],
    ok: (bt) => bt.mape === null,
  },
  {
    name: "short series returns no forecast",
    series: [10, 12, 11],
    ok: () => forecastSeries([10, 12, 11], 3) === null,
  },
  {
    name: "sharp crash never forecasts negative demand",
    series: [100, 80, 50, 20, 5, 0],
    ok: () => forecastSeries([100, 80, 50, 20, 5, 0], 3).monthly.every((v) => v >= 0),
  },
];
for (const t of selfTests) {
  const bt = backtest(t.series);
  const pass = t.ok(bt);
  if (!pass) failures++;
  console.log(`${pass ? "PASS" : "FAIL"}  ${t.name}  ${bt.mape != null ? `(MAPE ${bt.mape}%)` : ""}`);
}

console.log(`\n${failures ? `${failures} failure(s).` : "All forecast checks pass."}`);
process.exit(failures ? 1 : 0);
