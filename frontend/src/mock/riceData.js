import { computeSkuAnalytics, computePortfolioAnalytics, DEFAULT_EXTRAS } from "./analytics";

// Mock rice SKU data with all computed fields pre-set.
// Deliberately includes all 4 health statuses and all 4 movement classes
// so every UI state is visible during validation (TASK-06).
//
// Scenarios built in:
//  TJ-25KG  → RED    + Fast Moving  → classic stockout risk
//  VF-10KG  → ORANGE + Normal       → overstock
//  BM-5KG   → YELLOW + Slow Moving  → slow mover, high days of stock
//  JP-5KG   → RED    + Idle         → no movement 104 days
//  TJ-10KG  → GREEN  + Fast Moving  → healthy fast mover
//  VF-25KG  → GREEN  + Normal       → healthy normal
//  BM-25KG  → YELLOW + Slow Moving  → slow, approaching ageing
//  TW-25KG  → ORANGE + Normal       → approaching reorder point
//  PH-25KG  → GREEN  + Normal       → healthy
//  BR-10KG  → YELLOW + Slow Moving  → slow, low demand

export const mockSkus = [
  {
    sku_id: "TJ-25KG",
    product_name: "Thailand Thai Hom Mali 25 KG",
    rice_variety: "Thai Hom Mali",
    grade: "Grade A",
    country_of_origin: "Thailand",
    brand: "Golden Elephant",
    packaging_size: "25KG",
    uom: "MT",
    supplier: "Supplier ABC Thailand",
    lead_time_days: 45,
    unit_cost_sgd: 1350,
    min_order_qty: 20,
    reorder_point_policy: 302,
    min_stock: 280,
    target_stock: 500,
    max_stock: 700,
    safety_stock_pct: 20,
    max_holding_days: 270,
    // Inventory
    on_hand_qty: 240,
    reserved_qty: 80,
    quality_hold_qty: 0,
    available_qty: 160,      // on_hand - reserved - hold
    last_received_date: "2026-07-15",
    inventory_age_days: 53,
    ageing_status: "Fresh",
    // Velocity
    sales_30d: 186,
    sales_60d: 358,
    sales_90d: 528,
    avg_daily_usage_30d: 6.2,
    avg_daily_usage_90d: 5.87,
    velocity_trend: "accelerating",
    // Computed
    days_of_cover: 26,
    months_of_cover: 0.9,
    movement_class: "Fast Moving",
    health_status: "RED",
    recommended_action: "Place replenishment order immediately. Projected stockout before next shipment can arrive.",
    // Incoming POs
    expected_incoming_qty: 0,
  },
  {
    sku_id: "VF-10KG",
    product_name: "Vietnam Vietnamese Fragrant 10 KG",
    rice_variety: "Vietnamese Fragrant",
    grade: "Grade B",
    country_of_origin: "Vietnam",
    brand: "Mekong Gold",
    packaging_size: "10KG",
    uom: "MT",
    supplier: "Supplier DEF Vietnam",
    lead_time_days: 32,
    unit_cost_sgd: 980,
    min_order_qty: 10,
    reorder_point_policy: 120,
    min_stock: 100,
    target_stock: 280,
    max_stock: 400,
    safety_stock_pct: 20,
    max_holding_days: 270,
    on_hand_qty: 620,
    reserved_qty: 40,
    quality_hold_qty: 0,
    available_qty: 580,
    last_received_date: "2026-08-20",
    inventory_age_days: 17,
    ageing_status: "Fresh",
    sales_30d: 95,
    sales_60d: 178,
    sales_90d: 265,
    avg_daily_usage_30d: 3.17,
    avg_daily_usage_90d: 2.94,
    velocity_trend: "stable",
    days_of_cover: 183,
    months_of_cover: 6.1,
    movement_class: "Normal",
    health_status: "ORANGE",
    recommended_action: "Suspend new purchasing. Current stock exceeds maximum recommended level by 180 MT.",
    expected_incoming_qty: 200,
  },
  {
    sku_id: "BM-5KG",
    product_name: "India Basmati 5 KG",
    rice_variety: "Basmati",
    grade: "Premium",
    country_of_origin: "India",
    brand: "Royal Basmati",
    packaging_size: "5KG",
    uom: "MT",
    supplier: "Supplier GHI India",
    lead_time_days: 52,
    unit_cost_sgd: 2100,
    min_order_qty: 5,
    reorder_point_policy: 85,
    min_stock: 70,
    target_stock: 150,
    max_stock: 220,
    safety_stock_pct: 20,
    max_holding_days: 240,
    on_hand_qty: 185,
    reserved_qty: 10,
    quality_hold_qty: 0,
    available_qty: 175,
    last_received_date: "2026-06-01",
    inventory_age_days: 97,
    ageing_status: "Normal",
    sales_30d: 18,
    sales_60d: 40,
    sales_90d: 58,
    avg_daily_usage_30d: 0.6,
    avg_daily_usage_90d: 0.64,
    velocity_trend: "decelerating",
    days_of_cover: 292,
    months_of_cover: 9.7,
    movement_class: "Slow Moving",
    health_status: "YELLOW",
    recommended_action: "Review sales strategy. Stock coverage exceeds 9 months - consider reducing next order quantity.",
    expected_incoming_qty: 0,
  },
  {
    sku_id: "JP-5KG",
    product_name: "Japan Japonica 5 KG",
    rice_variety: "Japonica",
    grade: "Grade A",
    country_of_origin: "Japan",
    brand: "Sakura Rice",
    packaging_size: "5KG",
    uom: "MT",
    supplier: "Supplier JKL Japan",
    lead_time_days: 35,
    unit_cost_sgd: 3200,
    min_order_qty: 2,
    reorder_point_policy: 20,
    min_stock: 15,
    target_stock: 40,
    max_stock: 60,
    safety_stock_pct: 20,
    max_holding_days: 270,
    on_hand_qty: 78,
    reserved_qty: 0,
    quality_hold_qty: 0,
    available_qty: 78,
    last_received_date: "2026-03-01",
    inventory_age_days: 189,
    ageing_status: "Ageing",
    sales_30d: 0,
    sales_60d: 0,
    sales_90d: 3,
    avg_daily_usage_30d: 0,
    avg_daily_usage_90d: 0.03,
    velocity_trend: "decelerating",
    days_of_cover: null,        // null = idle, no recent demand
    months_of_cover: null,
    movement_class: "Idle",
    health_status: "RED",
    recommended_action: "Stop replenishment immediately. No sales in 104 days. Initiate inventory disposition review - consider discount, alternative channel, or CSR evaluation.",
    expected_incoming_qty: 0,
  },
  {
    sku_id: "TJ-10KG",
    product_name: "Thailand Thai Hom Mali 10 KG",
    rice_variety: "Thai Hom Mali",
    grade: "Grade A",
    country_of_origin: "Thailand",
    brand: "Golden Elephant",
    packaging_size: "10KG",
    uom: "MT",
    supplier: "Supplier ABC Thailand",
    lead_time_days: 45,
    unit_cost_sgd: 1420,
    min_order_qty: 10,
    reorder_point_policy: 140,
    min_stock: 120,
    target_stock: 280,
    max_stock: 380,
    safety_stock_pct: 20,
    max_holding_days: 270,
    on_hand_qty: 310,
    reserved_qty: 60,
    quality_hold_qty: 0,
    available_qty: 250,
    last_received_date: "2026-08-25",
    inventory_age_days: 12,
    ageing_status: "Fresh",
    sales_30d: 142,
    sales_60d: 270,
    sales_90d: 395,
    avg_daily_usage_30d: 4.73,
    avg_daily_usage_90d: 4.39,
    velocity_trend: "accelerating",
    days_of_cover: 53,
    months_of_cover: 1.8,
    movement_class: "Fast Moving",
    health_status: "GREEN",
    recommended_action: "No immediate action required. Monitor - stock coverage is within healthy range.",
    expected_incoming_qty: 300,
  },
  {
    sku_id: "VF-25KG",
    product_name: "Vietnam Vietnamese Fragrant 25 KG",
    rice_variety: "Vietnamese Fragrant",
    grade: "Grade A",
    country_of_origin: "Vietnam",
    brand: "Mekong Gold",
    packaging_size: "25KG",
    uom: "MT",
    supplier: "Supplier DEF Vietnam",
    lead_time_days: 32,
    unit_cost_sgd: 920,
    min_order_qty: 20,
    reorder_point_policy: 190,
    min_stock: 160,
    target_stock: 360,
    max_stock: 500,
    safety_stock_pct: 20,
    max_holding_days: 270,
    on_hand_qty: 420,
    reserved_qty: 50,
    quality_hold_qty: 20,
    available_qty: 350,
    last_received_date: "2026-08-10",
    inventory_age_days: 27,
    ageing_status: "Fresh",
    sales_30d: 168,
    sales_60d: 325,
    sales_90d: 490,
    avg_daily_usage_30d: 5.6,
    avg_daily_usage_90d: 5.44,
    velocity_trend: "stable",
    days_of_cover: 63,
    months_of_cover: 2.1,
    movement_class: "Normal",
    health_status: "GREEN",
    recommended_action: "Healthy stock position. Review reorder timing in approximately 2 weeks.",
    expected_incoming_qty: 250,
  },
  {
    sku_id: "BM-25KG",
    product_name: "India Basmati 25 KG",
    rice_variety: "Basmati",
    grade: "Grade B",
    country_of_origin: "India",
    brand: "Royal Basmati",
    packaging_size: "25KG",
    uom: "MT",
    supplier: "Supplier GHI India",
    lead_time_days: 52,
    unit_cost_sgd: 1850,
    min_order_qty: 20,
    reorder_point_policy: 160,
    min_stock: 140,
    target_stock: 300,
    max_stock: 420,
    safety_stock_pct: 20,
    max_holding_days: 240,
    on_hand_qty: 340,
    reserved_qty: 20,
    quality_hold_qty: 0,
    available_qty: 320,
    last_received_date: "2026-05-20",
    inventory_age_days: 109,
    ageing_status: "Normal",
    sales_30d: 32,
    sales_60d: 72,
    sales_90d: 105,
    avg_daily_usage_30d: 1.07,
    avg_daily_usage_90d: 1.17,
    velocity_trend: "decelerating",
    days_of_cover: 299,
    months_of_cover: 10.0,
    movement_class: "Slow Moving",
    health_status: "YELLOW",
    recommended_action: "Reduce next order quantity. Stock coverage at 10 months. Demand is decelerating - review customer base.",
    expected_incoming_qty: 0,
  },
  {
    sku_id: "TW-25KG",
    product_name: "Thailand Thai White 25 KG",
    rice_variety: "Thai White",
    grade: "Grade B",
    country_of_origin: "Thailand",
    brand: "White Pearl",
    packaging_size: "25KG",
    uom: "MT",
    supplier: "Supplier ABC Thailand",
    lead_time_days: 45,
    unit_cost_sgd: 820,
    min_order_qty: 25,
    reorder_point_policy: 250,
    min_stock: 220,
    target_stock: 480,
    max_stock: 650,
    safety_stock_pct: 20,
    max_holding_days: 270,
    on_hand_qty: 290,
    reserved_qty: 30,
    quality_hold_qty: 0,
    available_qty: 260,
    last_received_date: "2026-08-01",
    inventory_age_days: 36,
    ageing_status: "Fresh",
    sales_30d: 138,
    sales_60d: 265,
    sales_90d: 392,
    avg_daily_usage_30d: 4.6,
    avg_daily_usage_90d: 4.36,
    velocity_trend: "stable",
    days_of_cover: 57,
    months_of_cover: 1.9,
    movement_class: "Normal",
    health_status: "ORANGE",
    recommended_action: "Approaching reorder point. Initiate procurement review. Place order within 7 days to avoid supply gap.",
    expected_incoming_qty: 0,
  },
  {
    sku_id: "PH-25KG",
    product_name: "Philippines Sinandomeng 25 KG",
    rice_variety: "Sinandomeng",
    grade: "Grade A",
    country_of_origin: "Philippines",
    brand: "Harvest Moon",
    packaging_size: "25KG",
    uom: "MT",
    supplier: "Supplier MNO Philippines",
    lead_time_days: 28,
    unit_cost_sgd: 1050,
    min_order_qty: 15,
    reorder_point_policy: 130,
    min_stock: 110,
    target_stock: 260,
    max_stock: 360,
    safety_stock_pct: 20,
    max_holding_days: 270,
    on_hand_qty: 275,
    reserved_qty: 35,
    quality_hold_qty: 0,
    available_qty: 240,
    last_received_date: "2026-08-18",
    inventory_age_days: 19,
    ageing_status: "Fresh",
    sales_30d: 112,
    sales_60d: 215,
    sales_90d: 320,
    avg_daily_usage_30d: 3.73,
    avg_daily_usage_90d: 3.56,
    velocity_trend: "stable",
    days_of_cover: 64,
    months_of_cover: 2.1,
    movement_class: "Normal",
    health_status: "GREEN",
    recommended_action: "Healthy. No action required.",
    expected_incoming_qty: 150,
  },
  {
    sku_id: "BR-10KG",
    product_name: "Thailand Brown Rice 10 KG",
    rice_variety: "Brown Rice",
    grade: "Organic",
    country_of_origin: "Thailand",
    brand: "NatureFarm",
    packaging_size: "10KG",
    uom: "MT",
    supplier: "Supplier ABC Thailand",
    lead_time_days: 45,
    unit_cost_sgd: 1680,
    min_order_qty: 5,
    reorder_point_policy: 45,
    min_stock: 35,
    target_stock: 90,
    max_stock: 130,
    safety_stock_pct: 20,
    max_holding_days: 180,   // organic rice has shorter holding limit
    on_hand_qty: 95,
    reserved_qty: 5,
    quality_hold_qty: 0,
    available_qty: 90,
    last_received_date: "2026-07-10",
    inventory_age_days: 58,
    ageing_status: "Fresh",
    sales_30d: 14,
    sales_60d: 30,
    sales_90d: 46,
    avg_daily_usage_30d: 0.47,
    avg_daily_usage_90d: 0.51,
    velocity_trend: "decelerating",
    days_of_cover: 191,
    months_of_cover: 6.4,
    movement_class: "Slow Moving",
    health_status: "YELLOW",
    recommended_action: "Slow moving. Reduce next order size. Monitor demand - organic segment may need targeted promotion.",
    expected_incoming_qty: 0,
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// INDUSTRY-STANDARD ANALYTICS LAYER
// Additional per-SKU inputs that MVP1 needs but the original mock lacked:
//  - unit_price_sgd          → margin, GMROI, lost-sales valuation
//  - demand_cv               → XYZ classification (coefficient of variation)
//  - annual_carrying_rate_pct→ cost of holding excess stock
//  - obsolescence_risk_pct   → risk-adjusted E&O valuation
//  - target_service_level    → statistical safety stock (Z-score)
//  - lost_sales_30d          → fill rate / OTIF
//  - incoming_eta_days       → whether an open PO already covers a stockout
// When the backend is built (TASK-08), these become real columns / seed data.
// ─────────────────────────────────────────────────────────────────────────────
const SKU_EXTRAS = {
  "TJ-25KG": { unit_price_sgd: 1620, demand_cv: 0.18, annual_carrying_rate_pct: 22, obsolescence_risk_pct: 5,  target_service_level: 0.98, lost_sales_30d: 8, incoming_eta_days: null },
  "VF-10KG": { unit_price_sgd: 1150, demand_cv: 0.22, annual_carrying_rate_pct: 24, obsolescence_risk_pct: 12, target_service_level: 0.95, lost_sales_30d: 0, incoming_eta_days: 12 },
  "BM-5KG":  { unit_price_sgd: 2560, demand_cv: 0.55, annual_carrying_rate_pct: 20, obsolescence_risk_pct: 18, target_service_level: 0.92, lost_sales_30d: 0, incoming_eta_days: null },
  "JP-5KG":  { unit_price_sgd: 3950, demand_cv: 1.20, annual_carrying_rate_pct: 20, obsolescence_risk_pct: 35, target_service_level: 0.90, lost_sales_30d: 0, incoming_eta_days: null },
  "TJ-10KG": { unit_price_sgd: 1740, demand_cv: 0.28, annual_carrying_rate_pct: 22, obsolescence_risk_pct: 5,  target_service_level: 0.98, lost_sales_30d: 2, incoming_eta_days: 20 },
  "VF-25KG": { unit_price_sgd: 1090, demand_cv: 0.16, annual_carrying_rate_pct: 24, obsolescence_risk_pct: 8,  target_service_level: 0.97, lost_sales_30d: 3, incoming_eta_days: 15 },
  "BM-25KG": { unit_price_sgd: 2180, demand_cv: 0.48, annual_carrying_rate_pct: 20, obsolescence_risk_pct: 15, target_service_level: 0.93, lost_sales_30d: 0, incoming_eta_days: null },
  "TW-25KG": { unit_price_sgd: 970,  demand_cv: 0.20, annual_carrying_rate_pct: 24, obsolescence_risk_pct: 6,  target_service_level: 0.97, lost_sales_30d: 5, incoming_eta_days: null },
  "PH-25KG": { unit_price_sgd: 1250, demand_cv: 0.24, annual_carrying_rate_pct: 24, obsolescence_risk_pct: 7,  target_service_level: 0.96, lost_sales_30d: 1, incoming_eta_days: 9 },
  "BR-10KG": { unit_price_sgd: 2020, demand_cv: 0.60, annual_carrying_rate_pct: 20, obsolescence_risk_pct: 20, target_service_level: 0.90, lost_sales_30d: 0, incoming_eta_days: null },
};

// Derive every computed field from the seed rows. Health is recomputed from the
// same rule engine the Inventory page uses on edit/restock, so a SKU's badge and
// its stock-position bar never disagree. (Only TW-25KG shifts vs the hand-authored
// seed: ORANGE → GREEN, since available sits above the statistical reorder point.)
mockSkus.forEach((s) => {
  Object.assign(s, { ...DEFAULT_EXTRAS, ...(SKU_EXTRAS[s.sku_id] || {}) });
  Object.assign(s, computeSkuAnalytics(s, { recomputeHealth: true }));
});
computePortfolioAnalytics(mockSkus).forEach((row, i) => {
  mockSkus[i].abc_class = row.abc_class;
});

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────
export const getSkuById = (id) => mockSkus.find((s) => s.sku_id === id);

// Health status counts
export const getHealthCounts = () =>
  mockSkus.reduce(
    (acc, s) => {
      acc[s.health_status] = (acc[s.health_status] || 0) + 1;
      return acc;
    },
    { GREEN: 0, YELLOW: 0, ORANGE: 0, RED: 0 }
  );

// Health distribution weighted by inventory value - 2 RED SKUs may be 3% or 40%
// of working capital. Count alone hides that.
export const getHealthByValue = () => {
  const base = { RED: 0, ORANGE: 0, YELLOW: 0, GREEN: 0 };
  const value = { ...base };
  const count = { ...base };
  mockSkus.forEach((s) => {
    value[s.health_status] += s.inventory_value;
    count[s.health_status] += 1;
  });
  const total = Object.values(value).reduce((a, b) => a + b, 0) || 1;
  return ["RED", "ORANGE", "YELLOW", "GREEN"].map((k) => ({
    status: k,
    value: value[k],
    count: count[k],
    pct: +((value[k] / total) * 100).toFixed(1),
  }));
};

// Movement class counts
export const getMovementCounts = () =>
  mockSkus.reduce(
    (acc, s) => {
      acc[s.movement_class] = (acc[s.movement_class] || 0) + 1;
      return acc;
    },
    { "Fast Moving": 0, Normal: 0, "Slow Moving": 0, Idle: 0 }
  );

// ABC × XYZ matrix - the foundational inventory segmentation.
// Rows A/B/C (value), columns X/Y/Z (predictability). Each cell: SKU count + value.
export const getAbcXyzMatrix = () => {
  const rows = ["A", "B", "C"];
  const cols = ["X", "Y", "Z"];
  const cells = {};
  rows.forEach((r) => cols.forEach((c) => (cells[`${r}${c}`] = { count: 0, value: 0, skus: [] })));
  mockSkus.forEach((s) => {
    const key = `${s.abc_class}${s.xyz_class}`;
    if (!cells[key]) return;
    cells[key].count += 1;
    cells[key].value += s.inventory_value;
    cells[key].skus.push(s.sku_id);
  });
  return { rows, cols, cells };
};

// Coverage band summary, weighted by value
export const getCoverageBandSummary = () => {
  const bands = { below: { count: 0, value: 0 }, in: { count: 0, value: 0 }, above: { count: 0, value: 0 }, idle: { count: 0, value: 0 } };
  mockSkus.forEach((s) => {
    bands[s.coverage_band].count += 1;
    bands[s.coverage_band].value += s.inventory_value;
  });
  const total = Object.values(bands).reduce((a, b) => a + b.value, 0) || 1;
  return {
    ...bands,
    total,
    inBandPct: +((bands.in.value / total) * 100).toFixed(1),
    abovePct: +((bands.above.value / total) * 100).toFixed(1),
    belowPct: +((bands.below.value / total) * 100).toFixed(1),
  };
};
