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
// Where the spec uses a value it never defines (safety_stock_days,
// target_days_of_cover, the age thresholds), the check takes that input from
// the engine and says so in the report. Those are listed as UNDOCUMENTED.
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

// Sales Velocity: the spec sums quantity with no status filter.
const specSales = (r, days) => r.sales.filter((x) => x.sale_date >= isoDaysAgo(days, now)).reduce((a, x) => a + x.quantity_mt, 0);
const specAvg30 = (r) => specSales(r, 30) / 30;
const specAvg90 = (r) => specSales(r, 90) / 90;
check("sales_30d", "Sales Velocity", "SUM(quantity) WHERE sale_date >= today - 30", {
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
  undocumented: ["safety_stock_mt", "lead_time_demand_mt"],
  perSku: (s) => [s.lead_time_demand_mt + s.safety_stock_mt, s.reorder_point_suggested],
});

// Projected Inventory, then Suggested Order Quantity at lead time.
function specProjection(s, r, day) {
  const avail = r.pos.on_hand_qty - r.pos.reserved_qty - r.pos.quality_hold_qty;
  const landed = r.openPos
    .filter((p) => p.eta && Math.round((new Date(p.eta).getTime() - now) / DAY_MS) <= day && Math.round((new Date(p.eta).getTime() - now) / DAY_MS) >= 0)
    .reduce((a, p) => a + p.ordered_qty, 0);
  return avail - s.blended_daily_usage * day + landed;
}
check("suggested_order_qty", "Reorder Point / Projected Inventory", "max(0, target_stock - projected_available(lead_time_days))", {
  tol: 0.5,
  undocumented: ["blended_daily_usage (the projection's demand rate)"],
  perSku: (s, r) => [Math.max(0, s.target_stock - specProjection(s, r, Math.round(s.lead_time_days))), s.suggested_order_qty],
});

// Movement Classification.
const a30s = skus.map((s) => specAvg30(raw[s.sku_id])).filter((v) => v > 0).sort((a, b) => a - b);
const p75 = (() => { if (!a30s.length) return 0; const i = (a30s.length - 1) * 0.75, lo = Math.floor(i), hi = Math.ceil(i); return a30s[lo] + (a30s[hi] - a30s[lo]) * (i - lo); })();
function specMovement(s, r) {
  const last = r.sales.filter((x) => x.sale_date >= isoDaysAgo(90, now));
  if (!last.length) return "Idle";
  const a30 = specAvg30(r);
  const avail = r.pos.on_hand_qty - r.pos.reserved_qty - r.pos.quality_hold_qty;
  if (a30 > 0 && avail / a30 > 120) return "Slow Moving";
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
  undocumented: ["safety_stock_days", "target_days_of_cover", "covered_by_po", "inventory_age_days", "movement_class (engine)"],
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
const acv = skus.map((s) => ({ id: s.sku_id, v: s.blended_daily_usage * 365 * s.unit_cost_sgd })).sort((a, b) => b.v - a.v);
const acvTotal = acv.reduce((a, x) => a + x.v, 0) || 1;
const specAbc = {};
{ let cum = 0; for (const x of acv) { cum += x.v; const pct = cum / acvTotal; specAbc[x.id] = pct <= 0.8 ? "A" : pct <= 0.95 ? "B" : "C"; } }
check("abc_class", "ABC Value Classification", "cumulative share of blended_daily_usage * 365 * unit_cost_sgd: A <= 80%, B <= 95%", {
  compare: same,
  perSku: (s) => [specAbc[s.sku_id], s.abc_class],
});

// Compliance Position (portfolio).
check("compliance_position", "Compliance Position", "SUM(on_hand_qty) - 2 * SUM(blended_daily_usage) * 30", {
  tol: 1,
  portfolio: () => {
    const eligible = skus.reduce((a, s) => a + raw[s.sku_id].pos.on_hand_qty, 0);
    const required = 2 * skus.reduce((a, s) => a + s.blended_daily_usage, 0) * 30;
    return [eligible - required, stats.compliancePosition];
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
