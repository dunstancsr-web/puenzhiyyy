import { mockSkus, getAbcXyzMatrix, getCoverageBandSummary, getHealthByValue } from "./riceData";
import { mockAlerts } from "./alertsData";

// ─────────────────────────────────────────────────────────────────────────────
// Dashboard KPIs - computed from mock data so they stay in sync.
// Rebuilt to industry-standard inventory metrics: turnover / DIO, fill rate,
// GMROI, and value-weighted risk figures (not raw SKU counts / stock value).
// ─────────────────────────────────────────────────────────────────────────────

const activeSkus = mockSkus.filter((s) => s.health_status);

// ── Value & flow ─────────────────────────────────────────────────────────────
const totalInventoryValue = activeSkus.reduce((sum, s) => sum + s.inventory_value, 0);
const annualCogs = activeSkus.reduce((sum, s) => sum + s.annual_cogs, 0);
const annualGrossMargin = activeSkus.reduce((sum, s) => sum + s.annual_gross_margin, 0);

// Inventory turnover = annualised COGS ÷ inventory value at cost
const turnover = +(annualCogs / totalInventoryValue).toFixed(1);
// Days Inventory Outstanding - value-weighted, unlike a plain days-of-stock mean
const dio = Math.round(365 / (annualCogs / totalInventoryValue));
// GMROI = annual gross margin $ per $1 of inventory investment
const gmroi = +(annualGrossMargin / totalInventoryValue).toFixed(2);

// ── Service level / fill rate (last 30 days) ─────────────────────────────────
const demand30d = activeSkus.reduce((sum, s) => sum + s.sales_30d + (s.lost_sales_30d || 0), 0);
const fulfilled30d = activeSkus.reduce((sum, s) => sum + s.sales_30d, 0);
const lostSales30d = activeSkus.reduce((sum, s) => sum + (s.lost_sales_30d || 0), 0);
const fillRate = +((fulfilled30d / demand30d) * 100).toFixed(1);

// ── Stockout risk (projected P&L, not stock value) ──────────────────────────
const stockoutSkus = activeSkus.filter((s) => s.stockout_gap_days > 0);
const stockoutRiskMargin = stockoutSkus.reduce((sum, s) => sum + s.lost_margin_risk, 0);
const stockoutRiskSales = stockoutSkus.reduce((sum, s) => sum + s.lost_sales_value_risk, 0);

// ── Overstock (above max) ────────────────────────────────────────────────────
const overstockSkus = activeSkus.filter((s) => s.overstock_qty > 0);
const overstockValue = overstockSkus.reduce((sum, s) => sum + s.overstock_value, 0);
const overstockCarryingCost = overstockSkus.reduce((sum, s) => sum + s.overstock_carrying_cost, 0);
const overstockPct = +((overstockValue / totalInventoryValue) * 100).toFixed(1);

// ── Excess & Obsolete (slow + idle) ─────────────────────────────────────────
const eoSkus = activeSkus.filter((s) => s.eo_value > 0);
const eoValue = eoSkus.reduce((sum, s) => sum + s.eo_value, 0);
const eoValueRiskAdjusted = eoSkus.reduce((sum, s) => sum + s.eo_value_risk_adjusted, 0);
const eoPct = +((eoValue / totalInventoryValue) * 100).toFixed(1);

// ── Coverage band (value-weighted) ─────────────────────────────────────────
const coverage = getCoverageBandSummary();

// ── Health, movement, segmentation ─────────────────────────────────────────
const healthCounts = activeSkus.reduce(
  (acc, s) => { acc[s.health_status] = (acc[s.health_status] || 0) + 1; return acc; },
  { GREEN: 0, YELLOW: 0, ORANGE: 0, RED: 0 }
);
const movementCounts = activeSkus.reduce(
  (acc, s) => { acc[s.movement_class] = (acc[s.movement_class] || 0) + 1; return acc; },
  { "Fast Moving": 0, Normal: 0, "Slow Moving": 0, Idle: 0 }
);
const healthByValue = getHealthByValue();
const abcXyzMatrix = getAbcXyzMatrix();

// Unweighted average days of cover - kept for reference / comparison alongside the
// value-weighted DIO above (glossary #22, Days of Cover).
const skusWithDays = activeSkus.filter((s) => s.days_of_cover !== null);
const avgDaysOfCover = Math.round(
  skusWithDays.reduce((sum, s) => sum + s.days_of_cover, 0) / skusWithDays.length
);

// ── Compliance Position (REQ-16, glossary #38) - illustrative, portfolio-level ──
// The real rice-stockpile scheme is company-wide, not per-SKU. Uses demand as an
// honest stand-in for real import-receipt history, which this project doesn't have.
const complianceEligibleQty = Math.round(activeSkus.reduce((sum, s) => sum + s.on_hand_qty, 0));
const complianceRequiredQty = Math.round(2 * activeSkus.reduce((sum, s) => sum + s.avg_daily_usage_30d, 0) * 30);
const compliancePosition = complianceEligibleQty - complianceRequiredQty;

// ── Data Status (REQ-17, glossary #39) - informational as-of timestamp only; no
// live staleness detection in MVP1 (that needs spec Step 18A's freshness state
// machine, deferred - see requirements.md "Explicitly Deferred").
const asOf = new Date().toISOString();

// ── Top stockout risks ─────────────────────────────────────────────────────
const stockoutRisks = [...activeSkus]
  .sort((a, b) => {
    if (a.days_of_cover === null) return 1;
    if (b.days_of_cover === null) return -1;
    return (a.days_of_cover - a.lead_time_days) - (b.days_of_cover - b.lead_time_days);
  })
  .slice(0, 5)
  .map((s) => ({
    sku_id: s.sku_id,
    product_name: s.product_name,
    days_of_cover: s.days_of_cover,
    lead_time_days: s.lead_time_days,
    safety_stock_days: s.safety_stock_days,
    expected_incoming_qty: s.expected_incoming_qty,
    covered_by_po: s.covered_by_po,
    health_status: s.health_status,
  }));

// ── Ageing ────────────────────────────────────────────────────────────────
const ageingItems = activeSkus.filter(
  (s) => s.ageing_status === "Ageing" || s.ageing_status === "At Risk"
);

// ── Exception queue - one row per SKU, highest-priority trigger only ────────
const SEVERITY_RANK = { critical: 0, warning: 1, info: 2 };
const primaryExceptions = Object.values(
  mockAlerts
    .filter((a) => !a.acknowledged)
    .reduce((acc, a) => {
      const cur = acc[a.sku_id];
      if (!cur || SEVERITY_RANK[a.severity] < SEVERITY_RANK[cur.severity]) acc[a.sku_id] = a;
      return acc;
    }, {})
).sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]);

const openExceptions = {
  count: primaryExceptions.length,
  critical: primaryExceptions.filter((a) => a.severity === "critical").length,
  rawAlertCount: mockAlerts.filter((a) => !a.acknowledged).length,
};

// ─────────────────────────────────────────────────────────────────────────────
// Prior period (last month) - hand-set so the dashboard can show direction.
// Story: service level recovering, but working capital deteriorating - a classic
// over-correction toward fulfilment at the expense of turnover.
// ─────────────────────────────────────────────────────────────────────────────
const prior = {
  totalInventoryValue: 3_560_000,
  turnover: 3.3,
  dio: 111,
  gmroi: 0.62,
  fillRate: 96.1,
  stockoutRiskMargin: 12_000,
  overstockPct: 6.1,
  eoPct: 34.0,
  coverageInBandPct: 41.0,
};

function delta(cur, prev, { higherIsBetter = true, unit = "", pp = false } = {}) {
  const diff = +(cur - prev).toFixed(2);
  const dir = diff > 0 ? "up" : diff < 0 ? "down" : "flat";
  const good = diff === 0 ? true : higherIsBetter ? diff > 0 : diff < 0;
  const mag = Math.abs(diff);
  const text = pp ? `${mag} pp` : `${unit}${mag}`;
  return { dir, good, text, diff };
}

export const mockStats = {
  // Counts (kept for existing components)
  totalSkus: activeSkus.length,
  avgDaysOfCover,
  redCount: healthCounts.RED,
  orangeCount: healthCounts.ORANGE,
  yellowCount: healthCounts.YELLOW,
  greenCount: healthCounts.GREEN,
  healthCounts,
  movementCounts,

  // Value & flow
  totalInventoryValue: Math.round(totalInventoryValue),
  annualCogs: Math.round(annualCogs),
  turnover,
  dio,
  gmroi,

  // Service
  fillRate,
  lostSales30d,
  demand30d,

  // Risk (value-weighted / P&L based)
  stockoutRiskMargin: Math.round(stockoutRiskMargin),
  stockoutRiskSales: Math.round(stockoutRiskSales),
  stockoutSkuCount: stockoutSkus.length,

  overstockValue: Math.round(overstockValue),
  overstockCarryingCost: Math.round(overstockCarryingCost),
  overstockPct,
  overstockSkuCount: overstockSkus.length,

  eoValue: Math.round(eoValue),
  eoValueRiskAdjusted: Math.round(eoValueRiskAdjusted),
  eoPct,
  eoSkuCount: eoSkus.length,

  // Coverage band
  coverage,
  coverageInBandPct: coverage.inBandPct,

  // Segmentation
  healthByValue,
  abcXyzMatrix,

  // Compliance Position - illustrative, portfolio-level (REQ-16)
  complianceEligibleQty,
  complianceRequiredQty,
  compliancePosition,

  // Data Status - informational as-of timestamp (REQ-17)
  asOf,

  // Exceptions
  openExceptions,
  primaryExceptions,
  activeAlertCount: openExceptions.rawAlertCount,

  // Lists
  stockoutRisks,
  ageingItems,

  // Trends vs last month
  trends: {
    inventoryValue: delta(totalInventoryValue, prior.totalInventoryValue, { higherIsBetter: false, unit: "$", }),
    turnover: delta(turnover, prior.turnover, { higherIsBetter: true }),
    gmroi: delta(gmroi, prior.gmroi, { higherIsBetter: true, unit: "$" }),
    fillRate: delta(fillRate, prior.fillRate, { higherIsBetter: true, pp: true }),
    stockoutRiskMargin: delta(stockoutRiskMargin, prior.stockoutRiskMargin, { higherIsBetter: false, unit: "$" }),
    overstockPct: delta(overstockPct, prior.overstockPct, { higherIsBetter: false, pp: true }),
    eoPct: delta(eoPct, prior.eoPct, { higherIsBetter: false, pp: true }),
    coverageInBandPct: delta(coverage.inBandPct, prior.coverageInBandPct, { higherIsBetter: true, pp: true }),
  },
};
