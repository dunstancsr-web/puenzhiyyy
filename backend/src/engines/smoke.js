// Quick manual check of the analytics pipeline against the seeded database.
// Run:  npm run analytics   (from backend/, after npm run seed)

const { getDb, initDb } = require("../db/init");
const { buildAnalytics } = require("./index");

initDb();
const { skus, stats, alerts, primaryExceptions } = buildAnalytics(getDb());

console.log("\n── SKU ANALYTICS ─────────────────────────────────────────────");
console.table(
  skus.map((s) => ({
    sku: s.sku_id,
    health: s.health_status,
    move: s.movement_class,
    abcxyz: `${s.abc_class}${s.xyz_class}`,
    avail: s.available_qty,
    incoming: s.expected_incoming_qty,
    cover: s.days_of_cover,
    "LT+SS": s.lead_time_days + s.safety_stock_days,
    band: s.coverage_band,
    inv_value: s.inventory_value,
  }))
);

console.log("\n── PORTFOLIO KPIs ────────────────────────────────────────────");
console.log({
  totalInventoryValue: stats.totalInventoryValue,
  turnover: stats.turnover,
  dio: stats.dio,
  gmroi: stats.gmroi,
  fillRate: stats.fillRate,
  stockoutRiskMargin: stats.stockoutRiskMargin,
  overstockValue: stats.overstockValue,
  overstockPct: stats.overstockPct,
  eoValue: stats.eoValue,
  eoPct: stats.eoPct,
  coverageInBandPct: stats.coverageInBandPct,
  compliancePosition: stats.compliancePosition,
});
console.log("coverage:", JSON.stringify(stats.coverage));
console.log("healthByValue:", JSON.stringify(stats.healthByValue));
console.log("abcXyz cells:", JSON.stringify(stats.abcXyzMatrix.cells));

console.log("\n── ALERTS ────────────────────────────────────────────────────");
console.table(alerts.map((a) => ({ sku: a.sku_id, type: a.alert_type, sev: a.severity, trig: a.triggered_value, thr: a.threshold_value })));

console.log("\n── PRIMARY EXCEPTIONS (one per SKU) ──────────────────────────");
console.table(primaryExceptions.map((a) => ({ sku: a.sku_id, type: a.alert_type, sev: a.severity })));
