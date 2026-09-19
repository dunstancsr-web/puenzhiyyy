// Checks the market signal engine against figures worked out BY HAND, so a wrong
// formula fails here rather than shipping a confident wrong order quantity.
//   node backend/scripts/test-signals.js
// No database and no model: pure arithmetic on synthetic SKUs, plus the variety
// scoping in the risk buffer against a throwaway in-memory table.

const assert = require("assert");
const Database = require("better-sqlite3");
const S = require("../src/engines/signals");
const { computeRiskBuffer } = require("../src/engines/riskbuffer");

const ASOF = Date.UTC(2026, 8, 19);
const day = (n) => new Date(ASOF + n * 86_400_000).toISOString().slice(0, 10);
let passed = 0;
const check = (name, fn) => { fn(); passed++; console.log("  ok  " + name); };

const sku = (o = {}) => ({
  sku_id: "T", product_name: "Test", country_of_origin: "Thailand", supplier: "S", rice_variety: "Jasmine",
  available_qty: 100, avg_daily_usage_30d: 2, lead_time_days: 10, target_stock: 200,
  suggested_order_qty: 0, open_pos: [], days_of_cover: 50, ...o,
});

console.log("variety matching");
check("basmati is basmati", () => assert.strictEqual(S.isVariety("Basmati", "basmati"), true));
check("non-basmati is NOT basmati", () => assert.strictEqual(S.isVariety("Non-Basmati White", "basmati"), false));
check("non-basmati is non-basmati", () => assert.strictEqual(S.isVariety("Non-Basmati White", "non-basmati"), true));
check("jasmine is not basmati", () => assert.strictEqual(S.isVariety("Thai Hom Mali", "basmati"), false));

console.log("matching a signal to a SKU");
const nonBasmatiBan = { country_of_origin: "India", affects_varieties: ["non-basmati"] };
const basmatiFloor = { country_of_origin: "India", affects_varieties: ["basmati"] };
const indiaBasmati = sku({ country_of_origin: "India", rice_variety: "Basmati" });
check("a NON-basmati ban does not flag a basmati SKU", () => assert.strictEqual(S.matchSignal(nonBasmatiBan, indiaBasmati).match, false));
check("a basmati floor price does flag it", () => assert.strictEqual(S.matchSignal(basmatiFloor, indiaBasmati).match, true));
check("a different country is never flagged", () => assert.strictEqual(S.matchSignal(basmatiFloor, sku()).match, false));
check("an exempt variety is not flagged", () => assert.strictEqual(S.matchSignal({ country_of_origin: "India", excludes_varieties: ["basmati"] }, indiaBasmati).match, false));
check("a supplier match works without a country", () => assert.strictEqual(S.matchSignal({ supplier: "S" }, sku()).match, true));

console.log("the scenario arithmetic (worked by hand)");
// available 100, 2/day, lead 10, delay 5 -> a new order lands day 15.
// stock runs out day 50; position on day 15 = 100 - 30 = 70; order = 200 - 70 = 130.
check("comfortable stock: no gap, order 130, latest order in 35 days", () => {
  const r = S.scenarioFor(sku(), 5, ASOF);
  assert.strictEqual(r.new_order_arrives_in_days, 15);
  assert.strictEqual(r.stockout_in_days, 50);
  assert.strictEqual(r.days_without_stock, 0);
  assert.strictEqual(r.latest_order_in_days, 35);
  assert.strictEqual(r.position_at_arrival_mt, 70);
  assert.strictEqual(r.order_qty_mt, 130);
});
// available 20 -> out on day 10; a new order lands day 15 -> 5 days empty, too late already.
check("thin stock: 5 empty days, already too late, urgency act_now", () => {
  const r = S.scenarioFor(sku({ available_qty: 20 }), 5, ASOF);
  assert.strictEqual(r.stockout_in_days, 10);
  assert.strictEqual(r.days_without_stock, 5);
  assert.strictEqual(r.latest_order_in_days, -5);
  assert.strictEqual(S.urgencyOf(r), "act_now");
});
// available 10 -> out on day 5. Lead 10 means a normal order lands day 10: already 5 empty days with no news.
// A 5 day delay lands it day 15: 10 empty days, so the news adds exactly 5.
check("a SKU already short is not blamed on the news", () => {
  const r = S.scenarioFor(sku({ available_qty: 10 }), 5, ASOF);
  assert.strictEqual(r.days_without_stock_without_signal, 5);
  assert.strictEqual(r.days_without_stock, 10);
  assert.strictEqual(r.days_added_by_signal, 5);
});
check("healthy stock: the news adds nothing when cover outlasts the delay", () => {
  const r = S.scenarioFor(sku(), 5, ASOF);
  assert.strictEqual(r.days_without_stock_without_signal, 0);
  assert.strictEqual(r.days_added_by_signal, 0);
});
check("a bigger delay never makes it better", () => {
  const a = S.scenarioFor(sku({ available_qty: 60 }), 5, ASOF);
  const b = S.scenarioFor(sku({ available_qty: 60 }), 30, ASOF);
  assert.ok(b.days_without_stock >= a.days_without_stock);
  assert.ok(b.order_qty_mt >= a.order_qty_mt);
});
// stock 20, 2/day: out on day 10. A 100 MT PO due day 8 rescues it (20 - 16 + 100 = 104 on day 8,
// then 2/day, so the next stockout is day 60). Slipped 10 days it lands on day 18, after the stockout.
check("an open PO that slips past the stockout stops rescuing it", () => {
  const withPo = sku({ available_qty: 20, open_pos: [{ ordered_qty: 100, eta: day(8) }] });
  const r = S.scenarioFor(withPo, 10, ASOF);
  assert.strictEqual(r.stockout_date_without_signal, day(60));
  assert.strictEqual(r.stockout_in_days, 10);
});
check("nothing sells: no stockout, nothing to order", () => {
  const r = S.scenarioFor(sku({ avg_daily_usage_30d: 0, target_stock: 50 }), 14, ASOF);
  assert.strictEqual(r.stockout_in_days, null);
  assert.strictEqual(r.days_without_stock, 0);
  assert.strictEqual(r.order_qty_mt, 0);
});
check("extra over normal is measured against the existing suggestion", () => {
  const r = S.scenarioFor(sku({ suggested_order_qty: 100 }), 5, ASOF);
  assert.strictEqual(r.extra_over_normal_mt, 30);
});

console.log("urgency and the assessment");
check("urgency: window closing within 14 days is order_soon", () => assert.strictEqual(S.urgencyOf({ days_without_stock: 0, latest_order_in_days: 9 }), "order_soon"));
check("urgency: a wide margin is monitor", () => assert.strictEqual(S.urgencyOf({ days_without_stock: 0, latest_order_in_days: 35 }), "monitor"));
check("an easing signal has no range and adds nothing", () => {
  const a = S.assessSignal({ ...basmatiFloor, event_type: "export_restriction", severity: "medium", direction: "eases" }, [indiaBasmati], ASOF);
  assert.strictEqual(a.playbook, null);
  assert.strictEqual(a.exposures[0].urgency, "informational");
});
check("the assessment sorts worst first and reports who was spared", () => {
  const skus = [
    sku({ sku_id: "OK", available_qty: 400 }),
    sku({ sku_id: "BAD", available_qty: 20 }),
    sku({ sku_id: "SPARED", country_of_origin: "India", rice_variety: "Basmati" }),
  ];
  const a = S.assessSignal({ country_of_origin: "Thailand", event_type: "port_logistics", severity: "medium", direction: "tightens" }, skus, ASOF);
  assert.deepStrictEqual(a.exposures.map((e) => e.sku_id), ["BAD", "OK"]);
  const b = S.assessSignal({ country_of_origin: "India", event_type: "export_restriction", severity: "high", direction: "tightens", affects_varieties: ["non-basmati"] }, skus, ASOF);
  assert.deepStrictEqual(b.not_affected.map((e) => e.sku_id), ["SPARED"]);
  assert.strictEqual(b.exposures.length, 0);
});
check("playbook: every type has all three severities, low <= high", () => {
  for (const t of S.EVENT_TYPES) for (const s of S.SEVERITIES) {
    const r = S.playbookDays(t, s);
    assert.ok(r && r[0] > 0 && r[0] <= r[1], `${t}/${s}`);
  }
});

console.log("risk buffer honours variety scope");
check("an approved signal buffers basmati but not the non-basmati exemption", () => {
  const db = new Database(":memory:");
  db.exec(`CREATE TABLE risk_events (id INTEGER PRIMARY KEY, label TEXT, country_of_origin TEXT, supplier TEXT, severity TEXT,
           buffer_days_add REAL, active INTEGER DEFAULT 1, affects_varieties TEXT, excludes_varieties TEXT)`);
  db.prepare(`INSERT INTO risk_events (label, country_of_origin, severity, buffer_days_add, affects_varieties) VALUES ('MEP', 'India', 'medium', 15.5, ?)`)
    .run(JSON.stringify(["basmati"]));
  db.prepare(`INSERT INTO risk_events (label, country_of_origin, severity, buffer_days_add) VALUES ('unscoped', 'Thailand', 'low', 4)`).run();
  assert.strictEqual(computeRiskBuffer(db, { country_of_origin: "India", supplier: "x", rice_variety: "Basmati" }).days, 15.5);
  assert.strictEqual(computeRiskBuffer(db, { country_of_origin: "India", supplier: "x", rice_variety: "Non-Basmati White" }).days, 0);
  assert.strictEqual(computeRiskBuffer(db, { country_of_origin: "Thailand", supplier: "x", rice_variety: "Jasmine" }).days, 4);
});

console.log(`\n${passed} checks passed`);
