#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// FORMULA CHECK: does the code do what design.md says? (15 Sep 2026)
//
// Run from backend/:
//   node scripts/check-formulas.js             check the dev database
//   node scripts/check-formulas.js --report    also write the review document for Stan
//   DATA_DIR=/tmp/x node src/db/seed.js && DATA_DIR=/tmp/x node scripts/check-formulas.js
//                                              a fresh seed, which is what CI does
//
// Each formula in design.md, "Key Computation Logic", is written out again
// below FROM THE TEXT OF THE SPEC, from the raw database rows, and compared
// with what the engines produce for every SKU. This file deliberately does not
// call the engine functions it checks. It is a test oracle, not a second
// implementation the app uses, so it does not break the one-source rule: if the
// two ever disagree, one of them is wrong and a person decides which.
//
// Where one formula uses another's result (health uses days_of_cover, for
// example), the check reads that input from the engine, so each formula is
// tested on its own and one disagreement is reported once, not everywhere.
//
// Exit code: 1 when a check fails that is NOT in formula-decisions.json.
// A failure listed there is a known disagreement waiting for Stan's decision:
// it is reported but does not block CI. When a decision is made, fix the spec
// or the code and remove its entry, so the check guards it again.
// ─────────────────────────────────────────────────────────────────────────────

const fs = require("fs");
const path = require("path");
const { getDb } = require("../src/db/init");
const { buildAnalytics } = require("../src/engines");
const { runForecast, backtest, MODEL_IDS } = require("../src/engines/forecast");

const REPORT = process.argv.includes("--report");
const DECISIONS_FILE = path.join(__dirname, "formula-decisions.json");
const decisions = fs.existsSync(DECISIONS_FILE) ? JSON.parse(fs.readFileSync(DECISIONS_FILE, "utf8")) : {};

const DAY_MS = 86_400_000;
const isoDaysAgo = (n, now) => new Date(now - n * DAY_MS).toISOString().slice(0, 10);
const near = (a, b, tol) => (a == null && b == null) || (a != null && b != null && Math.abs(Number(a) - Number(b)) <= tol);
const same = (a, b) => a === b;

const db = getDb();
const now = Date.now();
const { skus, stats, alerts } = buildAnalytics(db, now);
const bySku = Object.fromEntries(skus.map((s) => [s.sku_id, s]));

// ── Raw inputs, straight from the tables ─────────────────────────────────────
const raw = {};
for (const s of skus) {
  const pos = db.prepare(`SELECT on_hand_qty, reserved_qty, quality_hold_qty FROM inventory_positions WHERE sku_id = ?`).get(s.sku_id) || {};
  const openPos = db.prepare(`SELECT ordered_qty, eta FROM purchase_orders WHERE sku_id = ? AND status = 'open'`).all(s.sku_id);
  const sales = db.prepare(`SELECT quantity_mt, sale_date, status FROM sales_transactions WHERE sku_id = ?`).all(s.sku_id);
  raw[s.sku_id] = { pos, openPos, sales };
}

// ── The spec's formulas, as written in design.md ─────────────────────────────
const checks = [];
function check(id, section, formula, { tol = null, compare = null, perSku = null, portfolio = null, undocumented = [] }) {
  checks.push({ id, section, formula, tol, compare, perSku, portfolio, undocumented });
}

check("available_qty", "Available Stock", "on_hand_qty - reserved_qty - quality_hold_qty", {
  tol: 0.01,
  perSku: (s, r) => [r.pos.on_hand_qty - r.pos.reserved_qty - r.pos.quality_hold_qty, s.available_qty],
});
check("expected_incoming_qty", "Inventory Position", "SUM(ordered_qty) of open purchase orders", {
  tol: 0.01,
  perSku: (s, r) => [r.openPos.reduce((a, p) => a + p.ordered_qty, 0), s.expected_incoming_qty],
});
check("inventory_position", "Inventory Position", "available_qty + expected_incoming_qty", {
  tol: 0.01,
  perSku: (s, r) => [
    r.pos.on_hand_qty - r.pos.reserved_qty - r.pos.quality_hold_qty + r.openPos.reduce((a, p) => a + p.ordered_qty, 0),
    s.inventory_position,
  ],
});

// Sales Velocity: fulfilled sales only (design.md, decided 15 Sep).
const specSales = (r, days) => r.sales.filter((x) => x.status === "fulfilled" && x.sale_date >= isoDaysAgo(days, now)).reduce((a, x) => a + x.quantity_mt, 0);
const specAvg30 = (r) => specSales(r, 30) / 30;
const specAvg90 = (r) => specSales(r, 90) / 90;
check("sales_30d", "Sales Velocity", "SUM(quantity) of FULFILLED sales WHERE sale_date >= today - 30", {
  tol: 0.05,
  perSku: (s, r) => [specSales(r, 30), s.sales_30d],
});
check("velocity_trend", "Sales Velocity", "30-day average vs 90-day average, +/-10%", {
  compare: same,
  perSku: (s, r) => {
    const a30 = specAvg30(r), a90 = specAvg90(r);
    const t = a30 > a90 * 1.1 ? "accelerating" : a30 < a90 * 0.9 ? "decelerating" : "stable";
    return [t, s.velocity_trend];
  },
});
check("days_of_cover", "Days / Months of Cover", "available_qty / avg_daily_30d (Not Applicable when zero)", {
  tol: 1,
  perSku: (s, r) => {
    const a30 = specAvg30(r);
    return [a30 > 0 ? (r.pos.on_hand_qty - r.pos.reserved_qty - r.pos.quality_hold_qty) / a30 : null, s.days_of_cover];
  },
});
check("months_of_cover", "Days / Months of Cover", "days_of_cover / 30 (using the engine's days_of_cover)", {
  tol: 0.05,
  perSku: (s) => [s.days_of_cover != null ? s.days_of_cover / 30 : null, s.months_of_cover],
});
check("reorder_point_suggested", "Reorder Point", "lead_time_demand_mt + safety_stock_mt", {
  tol: 0.05,
  perSku: (s) => [s.lead_time_demand_mt + s.safety_stock_mt, s.reorder_point_suggested],
});

// Projected Inventory, then Suggested Order Quantity at lead time.
function specProjection(s, r, day) {
  const avail = r.pos.on_hand_qty - r.pos.reserved_qty - r.pos.quality_hold_qty;
  const landed = r.openPos
    .filter((p) => p.eta && Math.round((new Date(p.eta).getTime() - now) / DAY_MS) <= day && Math.round((new Date(p.eta).getTime() - now) / DAY_MS) >= 0)
    .reduce((a, p) => a + p.ordered_qty, 0);
  return avail - specAvg30(r) * day + landed;
}
check("suggested_order_qty", "Reorder Point / Projected Inventory", "max(0, target_stock - projected_available(lead_time_days))", {
  tol: 0.5,
  perSku: (s, r) => [Math.max(0, s.target_stock - specProjection(s, r, Math.round(s.lead_time_days))), s.suggested_order_qty],
});

// Movement Classification.
const a30s = skus.map((s) => specAvg30(raw[s.sku_id])).filter((v) => v > 0).sort((a, b) => a - b);
const p75 = (() => { if (!a30s.length) return 0; const i = (a30s.length - 1) * 0.75, lo = Math.floor(i), hi = Math.ceil(i); return a30s[lo] + (a30s[hi] - a30s[lo]) * (i - lo); })();
// Days of cover comes from the ENGINE, so this checks the movement rule on its
// own; the cover formula has its own check above.
function specMovement(s, r) {
  const last = r.sales.filter((x) => x.status === "fulfilled" && x.sale_date >= isoDaysAgo(90, now));
  if (!last.length) return "Idle";
  const a30 = specAvg30(r);
  if (a30 > 0 && s.days_of_cover != null && s.days_of_cover > 120) return "Slow Moving";
  if (a30 >= p75 && p75 > 0) return "Fast Moving";
  return "Normal";
}
check("movement_class", "Movement Classification", "Idle: no sales in 90d; Slow: cover > 120d; Fast: >= p75 of avg_daily_30d", {
  compare: same,
  perSku: (s, r) => [specMovement(s, r), s.movement_class],
});

// Health Status, using the ENGINE's movement class so this checks the health
// rule on its own rather than repeating the movement disagreement.
check("health_status", "Health Status", "RED / ORANGE / YELLOW / GREEN rules, first match wins", {
  compare: same,
  perSku: (s) => {
    const dos = s.days_of_cover;
    let h = "GREEN";
    if ((dos != null && dos < s.lead_time_days && !s.covered_by_po) || (s.inventory_age_days != null && s.inventory_age_days > s.max_holding_days) || (s.movement_class === "Idle" && s.available_qty > 0)) h = "RED";
    else if ((dos != null && dos < s.lead_time_days + s.safety_stock_days && !s.covered_by_po) || s.on_hand_qty > s.max_stock) h = "ORANGE";
    else if (s.movement_class === "Slow Moving" || (dos != null && s.target_days_of_cover != null && dos > s.target_days_of_cover)) h = "YELLOW";
    return [h, s.health_status];
  },
});

// ABC Value Classification.
const acv = skus.map((s) => ({ id: s.sku_id, v: specAvg30(raw[s.sku_id]) * 365 * s.unit_cost_sgd })).sort((a, b) => b.v - a.v);
const acvTotal = acv.reduce((a, x) => a + x.v, 0) || 1;
const specAbc = {};
{ let cum = 0; for (const x of acv) { cum += x.v; const pct = cum / acvTotal; specAbc[x.id] = pct <= 0.8 ? "A" : pct <= 0.95 ? "B" : "C"; } }
check("abc_class", "ABC Value Classification", "cumulative share of avg_daily_30d * 365 * unit_cost_sgd: A <= 80%, B <= 95%", {
  compare: same,
  perSku: (s) => [specAbc[s.sku_id], s.abc_class],
});

// Compliance Position (portfolio).
check("compliance_position", "Compliance Position", "SUM(on_hand_qty) - 2 * SUM(avg_daily_30d) * 30", {
  tol: 1,
  portfolio: () => {
    const eligible = skus.reduce((a, s) => a + raw[s.sku_id].pos.on_hand_qty, 0);
    const required = 2 * skus.reduce((a, s) => a + specAvg30(raw[s.sku_id]), 0) * 30;
    return [eligible - required, stats.compliancePosition];
  },
});

// ── Supporting Formulas (design.md) ─────────────────────────────────────────
function specDemandCv(s, r) {
  const weeks = new Array(12).fill(0);
  for (const x of r.sales) {
    if (x.status !== "fulfilled") continue;
    const wk = Math.floor((now - new Date(x.sale_date).getTime()) / DAY_MS / 7);
    if (wk >= 0 && wk < 12) weeks[wk] += x.quantity_mt;
  }
  const mean = weeks.reduce((a, b) => a + b, 0) / 12;
  const cv = mean === 0 ? 0 : Math.sqrt(weeks.reduce((a, b) => a + (b - mean) ** 2, 0) / 12) / mean;
  const held = Math.round(cv * 100) / 100; // rates and CV are held to 2 decimal places (design.md)
  return held > 0 ? held : s.demand_cv;
}
const Z_TABLE = [[0.5, 0], [0.75, 0.67], [0.8, 0.84], [0.85, 1.04], [0.9, 1.28], [0.91, 1.34], [0.92, 1.41], [0.93, 1.48], [0.94, 1.56], [0.95, 1.65], [0.96, 1.75], [0.97, 1.88], [0.98, 2.05], [0.99, 2.33], [0.999, 3.09]];
const specZ = (level) => Z_TABLE.reduce((z, [p, v]) => (level >= p ? v : z), 0);
check("xyz_class", "Supporting Formulas", "X if demand_cv < 0.25, Y if <= 0.5, else Z (12 weekly buckets)", {
  compare: same,
  perSku: (s, r) => { const cv = specDemandCv(s, r); return [cv < 0.25 ? "X" : cv <= 0.5 ? "Y" : "Z", s.xyz_class]; },
});
// MVP2 Day 5: use_forecast is now a real, live-toggleable switch on the
// Forecast Detail page, not a default-off field nobody flips - the "regression
// that matters" comment above (Day 3) no longer covers the whole surface, so
// this branches the demand rate the same way engines/index.js and the
// risk_buffer_mt check below already do, rather than leaving forecast-driven
// SKUs unchecked.
check("safety_stock_mt", "Supporting Formulas", "z * sqrt(LT * (cv * d)^2 + d^2 * LT_sd^2)", {
  tol: 0.05,
  perSku: (s, r) => {
    const d = s.use_forecast && s.forecast_avg_daily_demand != null
      ? s.forecast_avg_daily_demand
      : Math.round(specAvg30(r) * 100) / 100;
    const cv = s.use_forecast && s.forecast_demand_cv != null ? s.forecast_demand_cv : specDemandCv(s, r);
    const sd = cv * d;
    return [specZ(s.target_service_level) * Math.sqrt(s.lead_time_days * sd * sd + d * d * s.lead_time_std_days ** 2), s.safety_stock_mt];
  },
});
check("target_days_of_cover", "Supporting Formulas", "round(target_stock / avg_daily_30d)", {
  tol: 0,
  perSku: (s, r) => { const d = specAvg30(r); return [d > 0 ? Math.round(s.target_stock / d) : null, s.target_days_of_cover]; },
});
check("covered_by_po", "Supporting Formulas", "incoming > 0 AND earliest PO ETA (days) <= days_of_cover", {
  compare: same,
  perSku: (s, r) => {
    const etas = r.openPos.filter((p) => p.eta).map((p) => Math.max(0, Math.ceil((new Date(p.eta).getTime() - now) / DAY_MS))).sort((a, b) => a - b);
    const inc = r.openPos.reduce((a, p) => a + p.ordered_qty, 0);
    return [Boolean(inc > 0 && etas.length && s.days_of_cover != null && etas[0] <= s.days_of_cover), Boolean(s.covered_by_po)];
  },
});
check("coverage_band", "Supporting Formulas", "idle / below lead+safety / above target / in", {
  compare: same,
  perSku: (s) => {
    const c = s.days_of_cover;
    const band = c == null ? "idle" : c < s.lead_time_days + s.safety_stock_days ? "below" : s.target_days_of_cover != null && c > s.target_days_of_cover ? "above" : "in";
    return [band, s.coverage_band];
  },
});
check("ageing_status", "Supporting Formulas", "age / holding limit: < 0.34 Fresh, < 0.67 Normal, < 0.90 Ageing, else At Risk", {
  compare: same,
  perSku: (s) => {
    if (s.last_received_date == null) return ["Fresh", s.ageing_status];
    const age = Math.floor((now - new Date(s.last_received_date).getTime()) / DAY_MS);
    const ratio = age / (s.max_holding_days || 270);
    return [ratio < 0.34 ? "Fresh" : ratio < 0.67 ? "Normal" : ratio < 0.9 ? "Ageing" : "At Risk", s.ageing_status];
  },
});
check("stockout_gap_days", "Supporting Formulas", "max(0, lead_time - days_of_cover), 0 if covered or no cover", {
  tol: 0,
  perSku: (s) => [s.days_of_cover != null && !s.covered_by_po ? Math.max(0, s.lead_time_days - s.days_of_cover) : 0, s.stockout_gap_days],
});
check("eo_value", "Supporting Formulas", "available * unit cost if Slow Moving or Idle, else 0", {
  tol: 1,
  perSku: (s) => [["Slow Moving", "Idle"].includes(s.movement_class) ? s.available_qty * s.unit_cost_sgd : 0, s.eo_value],
});
check("overstock_qty", "Supporting Formulas", "max(0, on_hand_qty - max_stock)", {
  tol: 0.01,
  perSku: (s, r) => [Math.max(0, r.pos.on_hand_qty - s.max_stock), s.overstock_qty],
});
function specPortfolio() {
  const inv = skus.reduce((a, s) => a + raw[s.sku_id].pos.on_hand_qty * s.unit_cost_sgd, 0);
  const rate = (s) => Math.round(specAvg30(raw[s.sku_id]) * 100) / 100;
  const cogs = skus.reduce((a, s) => a + rate(s) * 365 * s.unit_cost_sgd, 0);
  const gm = skus.reduce((a, s) => a + rate(s) * 365 * (s.unit_price_sgd - s.unit_cost_sgd), 0);
  const since = isoDaysAgo(30, now);
  let ful = 0, lost = 0;
  for (const s of skus) for (const x of raw[s.sku_id].sales) if (x.sale_date >= since) { if (x.status === "fulfilled") ful += x.quantity_mt; else if (x.status === "lost") lost += x.quantity_mt; }
  return { turnover: cogs / inv, gmroi: gm / inv, fill: (ful / (ful + lost)) * 100 };
}
check("turnover", "Supporting Formulas", "SUM(annual_cogs) / SUM(inventory_value)", { tol: 0.05, portfolio: () => [specPortfolio().turnover, stats.turnover] });
check("gmroi", "Supporting Formulas", "SUM(annual_gross_margin) / SUM(inventory_value)", { tol: 0.005, portfolio: () => [specPortfolio().gmroi, stats.gmroi] });
check("fill_rate", "Supporting Formulas", "(demand_30d - lost_30d) / demand_30d * 100", { tol: 0.05, portfolio: () => [specPortfolio().fill, stats.fillRate] });

// ── MVP2: forecast engine + risk buffer (Day 3) ─────────────────────────────
// Independently re-derived from raw sales_transactions, the same discipline as
// every other check here — engines/forecast.js is never called on the "spec"
// side, only on the "code" side via runForecast()/backtest(). King's formula
// (safetystock.js) itself needs no new check: it is unchanged, so the
// existing safety_stock_mt check above (now forecast-aware, see Day 5) covers
// it for every SKU whether use_forecast is on or off.
const round1 = (n) => Math.round(n * 10) / 10;
function periodIdx(p) { const [y, m] = p.split("-").map(Number); return y * 12 + (m - 1); }
function idxPeriod(i) { const y = Math.floor(i / 12), m = (i % 12) + 1; return `${y}-${String(m).padStart(2, "0")}`; }
function specMonthlyFilled(r) {
  const byPeriod = new Map();
  for (const x of r.sales) {
    if (x.status !== "fulfilled") continue;
    const p = x.sale_date.slice(0, 7);
    byPeriod.set(p, (byPeriod.get(p) || 0) + x.quantity_mt);
  }
  if (!byPeriod.size) return [];
  const periods = [...byPeriod.keys()].sort();
  const first = periodIdx(periods[0]), last = periodIdx(periods[periods.length - 1]);
  const series = [];
  for (let i = first; i <= last; i++) series.push({ period: idxPeriod(i), qty: byPeriod.get(idxPeriod(i)) || 0 });
  return series;
}

check("forecast_naive_seasonal", "MVP2 forecast engine", "same calendar month, averaged across every prior year in history", {
  tol: 0.15,
  perSku: (s, r) => {
    const series = specMonthlyFilled(r);
    if (!series.length) return [null, null];
    const targetPeriod = idxPeriod(periodIdx(series[series.length - 1].period) + 1);
    const targetMonth = Number(targetPeriod.slice(5, 7));
    const sameMonth = series.filter((x) => Number(x.period.slice(5, 7)) === targetMonth).map((x) => x.qty);
    const expected = sameMonth.length
      ? sameMonth.reduce((a, b) => a + b, 0) / sameMonth.length
      : series.reduce((a, x) => a + x.qty, 0) / series.length;
    const { monthly } = runForecast(db, s.sku_id, "naive_seasonal", 1);
    return [round1(expected), monthly[0]?.qty ?? null];
  },
});

check("forecast_linear_trend", "MVP2 forecast engine", "deseasonalize by calendar month, fit OLS, reseasonalize", {
  tol: 0.15,
  perSku: (s, r) => {
    const series = specMonthlyFilled(r);
    if (series.length < 2) return [null, null];
    const byMonth = new Map();
    for (const x of series) {
      const m = Number(x.period.slice(5, 7));
      if (!byMonth.has(m)) byMonth.set(m, []);
      byMonth.get(m).push(x.qty);
    }
    const baseline = (m) => { const vs = byMonth.get(m); const avg = vs.reduce((a, b) => a + b, 0) / vs.length; return avg > 0 ? avg : 1; };
    const points = series.map((x, i) => ({ x: i, y: x.qty / baseline(Number(x.period.slice(5, 7))) }));
    const n = points.length;
    const sumX = points.reduce((a, p) => a + p.x, 0), sumY = points.reduce((a, p) => a + p.y, 0);
    const sumXY = points.reduce((a, p) => a + p.x * p.y, 0), sumXX = points.reduce((a, p) => a + p.x * p.x, 0);
    const denom = n * sumXX - sumX * sumX;
    const slope = denom !== 0 ? (n * sumXY - sumX * sumY) / denom : 0;
    const intercept = (sumY - slope * sumX) / n;
    const targetIdx = series.length;
    const targetMonth = Number(idxPeriod(periodIdx(series[series.length - 1].period) + 1).slice(5, 7));
    const ratio = Math.max(0, intercept + slope * targetIdx);
    const expected = Math.max(0, ratio * baseline(targetMonth));
    const { monthly } = runForecast(db, s.sku_id, "linear_trend", 1);
    return [round1(expected), monthly[0]?.qty ?? null];
  },
});

// Holt-Winters is not re-derived line-by-line (re-implementing exponential
// smoothing a second time would mostly test whether the same bug was made
// twice). A property check instead: every forecast month stays within a sane
// envelope of the SKU's own history. Catches sign errors and blow-ups, the
// realistic failure modes for a smoothing/grid-search bug, without a second
// implementation to maintain.
check("forecast_holt_winters_bounds", "MVP2 forecast engine", "every forecast month in [0, 3x max historical monthly demand]", {
  compare: same,
  perSku: (s, r) => {
    const series = specMonthlyFilled(r);
    if (series.length < 24) return ["skip: needs 24mo history", "skip: needs 24mo history"];
    const maxHist = Math.max(...series.map((x) => x.qty), 0);
    const { monthly } = runForecast(db, s.sku_id, "holt_winters", 6);
    return [true, monthly.every((m) => m.qty >= 0 && m.qty <= maxHist * 3)];
  },
});

// Same reasoning as Holt-Winters above: a property check, not a second
// implementation of the damped-trend math. Ported from a teammate's branch
// (Tawmo, feature/demand-forecast-engine) — the bound proves this repo's copy
// wasn't damaged in porting, it doesn't re-validate their original design.
check("forecast_holt_damped_seasonal_bounds", "MVP2 forecast engine", "every forecast month in [0, 3x max historical monthly demand]", {
  compare: same,
  perSku: (s, r) => {
    const series = specMonthlyFilled(r);
    if (series.length < 2) return ["skip: needs 2mo history", "skip: needs 2mo history"];
    const maxHist = Math.max(...series.map((x) => x.qty), 0);
    const { monthly } = runForecast(db, s.sku_id, "holt_damped_seasonal", 6);
    return [true, monthly.every((m) => m.qty >= 0 && m.qty <= maxHist * 3)];
  },
});

// Written out here on purpose, not imported from the engine: "basmati" must not match "Non-Basmati".
const isKind = (variety, term) => new RegExp(`(?<!non[- ])\\b${term}\\b`, "i").test(String(variety || ""));
const inScope = (json, variety, want) => {
  const list = json ? JSON.parse(json) : null;
  return !list || !list.length || list.some((t) => isKind(variety, t)) === want;
};

check("risk_buffer_mt", "MVP2 risk buffer", "SUM(matching risk_events.buffer_days_add, honouring affects/excludes varieties), capped at 30 days, x the demand rate in force", {
  tol: 0.1,
  perSku: (s) => {
    const events = db.prepare(`
      SELECT buffer_days_add, affects_varieties, excludes_varieties FROM risk_events
       WHERE active = 1 AND ((country_of_origin IS NOT NULL AND country_of_origin = @o) OR (supplier IS NOT NULL AND supplier = @sup))`
    ).all({ o: s.country_of_origin || null, sup: s.supplier || null })
      .filter((e) => inScope(e.affects_varieties, s.rice_variety, true) && inScope(e.excludes_varieties, s.rice_variety, false));
    const days = Math.min(30, events.reduce((a, e) => a + e.buffer_days_add, 0));
    const rate = s.forecast_avg_daily_demand ?? s.avg_daily_usage_30d;
    return [round1(days * rate), s.risk_buffer_mt];
  },
});
check("reorder_point_suggested_with_risk", "MVP2 risk buffer", "reorder_point_suggested + risk_buffer_mt", {
  tol: 0.05,
  perSku: (s) => [round1(s.reorder_point_suggested + s.risk_buffer_mt), s.reorder_point_suggested_with_risk],
});

// The one check guarding the property this whole feature's legitimacy rests
// on: auto-mode is a real calculation, not an LLM call, so it has to be
// exactly reproducible on the same data.
check("backtest_determinism", "MVP2 auto-mode", "backtest() run twice on identical data returns byte-identical WMAPE", {
  compare: same,
  perSku: (s) => {
    const a = JSON.stringify(backtest(db, s.sku_id, MODEL_IDS).scores);
    const b = JSON.stringify(backtest(db, s.sku_id, MODEL_IDS).scores);
    return [a, b];
  },
});

// Alert rules, requirements.md REQ-09, on the engine's inputs.
check("alerts", "requirements.md REQ-09", "the six alert rules", {
  compare: same,
  perSku: (s) => {
    const want = [];
    const stockout = s.days_of_cover != null && s.days_of_cover < s.lead_time_days && !s.covered_by_po;
    if (stockout) want.push("STOCKOUT_RISK");
    else if (s.inventory_position <= s.reorder_point_policy && s.movement_class !== "Idle") want.push("REORDER");
    if (s.overstock_qty > 0 && s.movement_class !== "Idle") want.push("OVERSTOCK");
    if (s.movement_class === "Idle" && s.available_qty > 0) want.push("IDLE");
    if (s.movement_class === "Slow Moving" && s.days_of_cover != null && s.days_of_cover > 120) want.push("SLOW_MOVING");
    if (s.ageing_status === "Ageing" || s.ageing_status === "At Risk") want.push("AGEING");
    if (s.use_forecast && s.reorder_point_suggested_with_risk != null) {
      const gap = Math.abs(s.reorder_point_suggested_with_risk - s.reorder_point_policy);
      const gapPct = s.reorder_point_policy > 0 ? gap / s.reorder_point_policy : (s.reorder_point_suggested_with_risk > 0 ? 1 : 0);
      if (gapPct > 0.10) want.push("POLICY_CHANGE_SUGGESTED");
    }
    const got = alerts.filter((a) => a.sku_id === s.sku_id).map((a) => a.alert_type);
    return [want.sort().join(",") || "none", [...new Set(got)].sort().join(",") || "none"];
  },
});

// ── Run ──────────────────────────────────────────────────────────────────────
const fmt = (v) => (v == null ? "n/a" : typeof v === "number" ? String(Math.round(v * 100) / 100) : String(v));
const results = checks.map((c) => {
  const cmp = c.compare || ((a, b) => near(a, b, c.tol));
  const rows = c.portfolio
    ? [["portfolio", ...c.portfolio()]]
    : skus.map((s) => [s.sku_id, ...c.perSku(s, raw[s.sku_id])]);
  const diffs = rows.filter(([, spec, code]) => !cmp(spec, code));
  return { ...c, rows, diffs, known: Boolean(decisions[c.id]) };
});

let blocking = 0;
console.log(`Formula check against design.md, ${skus.length} SKUs, ${new Date(now).toISOString().slice(0, 10)}\n`);
for (const r of results) {
  const state = !r.diffs.length ? "PASS" : r.known ? "KNOWN" : "FAIL";
  if (state === "FAIL") blocking++;
  console.log(`${state.padEnd(5)} ${r.id.padEnd(24)} ${r.diffs.length ? `${r.diffs.length} of ${r.rows.length} differ` : ""}`);
  for (const [sku, spec, code] of r.diffs.slice(0, 4)) console.log(`        ${sku}: spec ${fmt(spec)}, code ${fmt(code)}`);
  if (r.known && !r.diffs.length) console.log(`        listed in formula-decisions.json but now passes: remove the entry`);
}
const undocumented = [...new Set(results.flatMap((r) => r.undocumented))];
if (undocumented.length) console.log(`\nUsed by the spec but never defined in it: ${undocumented.join("; ")}`);
console.log(`\n${blocking ? `${blocking} unexpected failure(s).` : "No unexpected failures."} ${results.filter((r) => r.diffs.length && r.known).length} known, awaiting a decision.`);

if (REPORT) {
  const out = path.join(__dirname, "../../docs/(Stan) 2 To review/(Stan) FORMULA MISMATCHES.md");
  const lines = [
    "# (Stan) Formula mismatches: design.md versus the code",
    "",
    `> **For Stan to decide.** Generated by \`backend/scripts/check-formulas.js --report\` on ${new Date(now).toISOString().slice(0, 16).replace("T", " ")} UTC from the live data. Do not edit by hand: re-run it. The meaning of each mismatch and the options are in \`backend/scripts/formula-decisions.json\`.`,
    "",
    "| Check | Result | Spec formula |",
    "|---|---|---|",
    ...results.map((r) => `| ${r.id} | ${!r.diffs.length ? "pass" : `**${r.diffs.length} of ${r.rows.length} differ**`} | ${r.formula} |`),
    "",
  ];
  for (const r of results.filter((x) => x.diffs.length)) {
    const d = decisions[r.id] || {};
    lines.push(`## ${r.id}`, "", `Spec (design.md, "${r.section}"): ${r.formula}`, "");
    if (d.code) lines.push(`Code: ${d.code}`, "");
    if (d.impact) lines.push(`What changes on screen if the spec is applied: ${d.impact}`, "");
    if (d.recommendation) lines.push(`Recommendation: ${d.recommendation}`, "");
    lines.push("| SKU | Spec gives | Code gives |", "|---|---|---|", ...r.diffs.map(([sku, spec, code]) => `| ${sku} | ${fmt(spec)} | ${fmt(code)} |`), "");
  }
  if (undocumented.length) lines.push("## Used by the spec but never defined in it", "", ...undocumented.map((u) => `- ${u}`), "");
  fs.writeFileSync(out, lines.join("\n"));
  console.log(`\nReport written: ${path.relative(path.join(__dirname, "../.."), out)}`);
}

process.exit(blocking ? 1 : 0);
