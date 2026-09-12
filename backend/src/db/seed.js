// ─────────────────────────────────────────────────────────────────────────────
// SEED  —  10 rice SKUs + ~180 days of sales + open POs + unfilled-demand rows.
// Deliberate scenarios:
//   TJ-25KG  near stockout (fast mover, cover < lead time, no PO)
//   VF-10KG  overstocked (physical > max, 200 MT still inbound)
//   JP-5KG   idle (no sales in 90+ days, ageing)
//   BM-25KG  slow moving + ageing
// Run:  npm run seed        (from backend/)
// ─────────────────────────────────────────────────────────────────────────────

const { getDb, initDb } = require("./init");

const DAY_MS = 86_400_000;
const iso = (d) => new Date(d).toISOString().slice(0, 10);
const today = Date.now();
const dateOffset = (days) => iso(today - days * DAY_MS);

// Deterministic PRNG so re-seeds are reproducible.
function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ── SKU master + scenario parameters ────────────────────────────────────────
const SKUS = [
  {
    sku_id: "TJ-25KG", product_name: "Thai Jasmine 25KG", rice_variety: "Thai Hom Mali", grade: "Grade A",
    country_of_origin: "Thailand", brand: "Golden Elephant", packaging_size: "25KG", supplier: "Supplier ABC Thailand",
    min_order_qty: 20, reorder_point_policy: 302, min_stock: 280, target_stock: 500, max_stock: 700,
    lead_time_days: 45, lead_time_std_days: 5, target_service_level: 0.98, demand_cv: 0.18,
    unit_cost_sgd: 1350, unit_price_sgd: 1620, annual_carrying_rate_pct: 22, obsolescence_risk_pct: 5, max_holding_days: 270,
    on_hand_qty: 240, reserved_qty: 80, quality_hold_qty: 0, received_days_ago: 53,
    sales: { s30: 186, s60: 358, s90: 528, lost_30d: 8 }, po: null,
  },
  {
    sku_id: "VF-10KG", product_name: "Vietnam Fragrant 10KG", rice_variety: "Vietnamese Fragrant", grade: "Grade B",
    country_of_origin: "Vietnam", brand: "Mekong Gold", packaging_size: "10KG", supplier: "Supplier DEF Vietnam",
    min_order_qty: 10, reorder_point_policy: 120, min_stock: 100, target_stock: 280, max_stock: 400,
    lead_time_days: 32, lead_time_std_days: 4, target_service_level: 0.95, demand_cv: 0.22,
    unit_cost_sgd: 980, unit_price_sgd: 1150, annual_carrying_rate_pct: 24, obsolescence_risk_pct: 12, max_holding_days: 270,
    on_hand_qty: 620, reserved_qty: 40, quality_hold_qty: 0, received_days_ago: 17,
    sales: { s30: 95, s60: 178, s90: 265, lost_30d: 0 }, po: { qty: 200, eta_days: 12 },
  },
  {
    sku_id: "BM-5KG", product_name: "Basmati Premium 5KG", rice_variety: "Basmati", grade: "Premium",
    country_of_origin: "India", brand: "Royal Basmati", packaging_size: "5KG", supplier: "Supplier GHI India",
    min_order_qty: 5, reorder_point_policy: 85, min_stock: 70, target_stock: 150, max_stock: 220,
    lead_time_days: 52, lead_time_std_days: 6, target_service_level: 0.92, demand_cv: 0.55,
    unit_cost_sgd: 2100, unit_price_sgd: 2560, annual_carrying_rate_pct: 20, obsolescence_risk_pct: 18, max_holding_days: 240,
    on_hand_qty: 185, reserved_qty: 10, quality_hold_qty: 0, received_days_ago: 97,
    sales: { s30: 18, s60: 40, s90: 58, lost_30d: 0 }, po: null,
  },
  {
    sku_id: "JP-5KG", product_name: "Japonica Short Grain 5KG", rice_variety: "Japonica", grade: "Grade A",
    country_of_origin: "Japan", brand: "Sakura Rice", packaging_size: "5KG", supplier: "Supplier JKL Japan",
    min_order_qty: 2, reorder_point_policy: 20, min_stock: 15, target_stock: 40, max_stock: 60,
    lead_time_days: 35, lead_time_std_days: 4, target_service_level: 0.90, demand_cv: 1.2,
    unit_cost_sgd: 3200, unit_price_sgd: 3950, annual_carrying_rate_pct: 20, obsolescence_risk_pct: 35, max_holding_days: 270,
    on_hand_qty: 78, reserved_qty: 0, quality_hold_qty: 0, received_days_ago: 189,
    sales: { s30: 0, s60: 0, s90: 0, lost_30d: 0, idleSaleDaysAgo: 96, idleSaleQty: 3 }, po: null,
  },
  {
    sku_id: "TJ-10KG", product_name: "Thai Jasmine 10KG", rice_variety: "Thai Hom Mali", grade: "Grade A",
    country_of_origin: "Thailand", brand: "Golden Elephant", packaging_size: "10KG", supplier: "Supplier ABC Thailand",
    min_order_qty: 10, reorder_point_policy: 140, min_stock: 120, target_stock: 280, max_stock: 380,
    lead_time_days: 45, lead_time_std_days: 5, target_service_level: 0.98, demand_cv: 0.28,
    unit_cost_sgd: 1420, unit_price_sgd: 1740, annual_carrying_rate_pct: 22, obsolescence_risk_pct: 5, max_holding_days: 270,
    on_hand_qty: 310, reserved_qty: 60, quality_hold_qty: 0, received_days_ago: 12,
    sales: { s30: 142, s60: 270, s90: 395, lost_30d: 2 }, po: { qty: 300, eta_days: 20 },
  },
  {
    sku_id: "VF-25KG", product_name: "Vietnam Fragrant 25KG", rice_variety: "Vietnamese Fragrant", grade: "Grade A",
    country_of_origin: "Vietnam", brand: "Mekong Gold", packaging_size: "25KG", supplier: "Supplier DEF Vietnam",
    min_order_qty: 20, reorder_point_policy: 190, min_stock: 160, target_stock: 360, max_stock: 500,
    lead_time_days: 32, lead_time_std_days: 4, target_service_level: 0.97, demand_cv: 0.16,
    unit_cost_sgd: 920, unit_price_sgd: 1090, annual_carrying_rate_pct: 24, obsolescence_risk_pct: 8, max_holding_days: 270,
    on_hand_qty: 420, reserved_qty: 50, quality_hold_qty: 20, received_days_ago: 27,
    sales: { s30: 168, s60: 325, s90: 490, lost_30d: 3 }, po: { qty: 250, eta_days: 15 },
  },
  {
    sku_id: "BM-25KG", product_name: "Basmati Bulk 25KG", rice_variety: "Basmati", grade: "Grade B",
    country_of_origin: "India", brand: "Royal Basmati", packaging_size: "25KG", supplier: "Supplier GHI India",
    min_order_qty: 20, reorder_point_policy: 160, min_stock: 140, target_stock: 300, max_stock: 420,
    lead_time_days: 52, lead_time_std_days: 6, target_service_level: 0.93, demand_cv: 0.48,
    unit_cost_sgd: 1850, unit_price_sgd: 2180, annual_carrying_rate_pct: 20, obsolescence_risk_pct: 15, max_holding_days: 240,
    on_hand_qty: 340, reserved_qty: 20, quality_hold_qty: 0, received_days_ago: 109,
    sales: { s30: 32, s60: 72, s90: 105, lost_30d: 0 }, po: null,
  },
  {
    sku_id: "TW-25KG", product_name: "Thai White Rice 25KG", rice_variety: "Thai White", grade: "Grade B",
    country_of_origin: "Thailand", brand: "White Pearl", packaging_size: "25KG", supplier: "Supplier ABC Thailand",
    min_order_qty: 25, reorder_point_policy: 250, min_stock: 220, target_stock: 480, max_stock: 650,
    lead_time_days: 45, lead_time_std_days: 5, target_service_level: 0.97, demand_cv: 0.20,
    unit_cost_sgd: 820, unit_price_sgd: 970, annual_carrying_rate_pct: 24, obsolescence_risk_pct: 6, max_holding_days: 270,
    on_hand_qty: 290, reserved_qty: 30, quality_hold_qty: 0, received_days_ago: 36,
    sales: { s30: 138, s60: 265, s90: 392, lost_30d: 5 }, po: null,
  },
  {
    sku_id: "PH-25KG", product_name: "Philippine Sinandomeng 25KG", rice_variety: "Sinandomeng", grade: "Grade A",
    country_of_origin: "Philippines", brand: "Harvest Moon", packaging_size: "25KG", supplier: "Supplier MNO Philippines",
    min_order_qty: 15, reorder_point_policy: 130, min_stock: 110, target_stock: 260, max_stock: 360,
    lead_time_days: 28, lead_time_std_days: 3, target_service_level: 0.96, demand_cv: 0.24,
    unit_cost_sgd: 1050, unit_price_sgd: 1250, annual_carrying_rate_pct: 24, obsolescence_risk_pct: 7, max_holding_days: 270,
    on_hand_qty: 275, reserved_qty: 35, quality_hold_qty: 0, received_days_ago: 19,
    sales: { s30: 112, s60: 215, s90: 320, lost_30d: 1 }, po: { qty: 150, eta_days: 9 },
  },
  {
    sku_id: "BR-10KG", product_name: "Brown Rice Organic 10KG", rice_variety: "Brown Rice", grade: "Organic",
    country_of_origin: "Thailand", brand: "NatureFarm", packaging_size: "10KG", supplier: "Supplier ABC Thailand",
    min_order_qty: 5, reorder_point_policy: 45, min_stock: 35, target_stock: 90, max_stock: 130,
    lead_time_days: 45, lead_time_std_days: 5, target_service_level: 0.90, demand_cv: 0.60,
    unit_cost_sgd: 1680, unit_price_sgd: 2020, annual_carrying_rate_pct: 20, obsolescence_risk_pct: 20, max_holding_days: 180,
    on_hand_qty: 95, reserved_qty: 5, quality_hold_qty: 0, received_days_ago: 58,
    sales: { s30: 14, s60: 30, s90: 46, lost_30d: 0 }, po: null,
  },
];

// Build ~26 weeks of weekly sales transactions that hit the s30 / s60 / s90 targets.
function buildSales(sku, rng) {
  const { s30, s60, s90, lost_30d, idleSaleDaysAgo, idleSaleQty } = sku.sales;
  const rows = [];

  if (s90 === 0 && !idleSaleDaysAgo) return rows; // fully idle, never sold

  const wk = [
    { weeks: [0, 1, 2, 3], total: s30 },
    { weeks: [4, 5, 6, 7], total: Math.max(0, s60 - s30) },
    { weeks: [8, 9, 10, 11, 12], total: Math.max(0, s90 - s60) },
  ];
  // Weeks 13–25 continue at the 60–90d weekly rate.
  const tailRate = Math.max(0, s90 - s60) / 5;
  for (let w = 13; w <= 25; w++) wk.push({ weeks: [w], total: tailRate });

  for (const group of wk) {
    if (group.total <= 0) continue;
    const per = group.total / group.weeks.length;
    for (const w of group.weeks) {
      const qty = round1(per * (0.8 + rng() * 0.4)); // ±20% noise
      if (qty <= 0) continue;
      rows.push({
        sku_id: sku.sku_id,
        quantity_mt: qty,
        sale_date: dateOffset(w * 7 + 2 + Math.floor(rng() * 4)),
        customer: pick(rng, CUSTOMERS),
        channel: pick(rng, CHANNELS),
        status: "fulfilled",
      });
    }
  }

  // Idle SKU: a single old sale so "days since last sale" is well past 90.
  if (idleSaleDaysAgo) {
    rows.push({
      sku_id: sku.sku_id, quantity_mt: idleSaleQty, sale_date: dateOffset(idleSaleDaysAgo),
      customer: pick(rng, CUSTOMERS), channel: "wholesale", status: "fulfilled",
    });
  }

  // Unfilled demand (stockout) — split lost_30d across 1–2 recent rows.
  if (lost_30d > 0) {
    const n = lost_30d > 5 ? 2 : 1;
    for (let i = 0; i < n; i++) {
      rows.push({
        sku_id: sku.sku_id, quantity_mt: round1(lost_30d / n),
        sale_date: dateOffset(3 + i * 9 + Math.floor(rng() * 5)),
        customer: pick(rng, CUSTOMERS), channel: "direct", status: "lost",
      });
    }
  }

  return rows;
}

const CUSTOMERS = ["Sheng Siong", "FairPrice", "Prime Supermarket", "Kopitiam Group", "Select Catering", "Eastpoint Trading"];
const CHANNELS = ["direct", "wholesale", "retail", "food-service"];
const pick = (rng, arr) => arr[Math.floor(rng() * arr.length)];
const round1 = (n) => Math.round(n * 10) / 10;

function seed() {
  initDb();
  const db = getDb();

  const wipe = db.transaction(() => {
    for (const t of ["sales_transactions", "purchase_orders", "inventory_positions", "alerts_log", "skus"]) {
      db.exec(`DELETE FROM ${t}`);
    }
    db.exec(`DELETE FROM sqlite_sequence WHERE name IN
      ('sales_transactions','purchase_orders','inventory_positions','alerts_log','skus')`);
  });
  wipe();

  const insSku = db.prepare(`
    INSERT INTO skus (
      sku_id, product_name, rice_variety, grade, country_of_origin, brand, packaging_size, uom, supplier,
      min_order_qty, reorder_point_policy, min_stock, target_stock, max_stock, safety_stock_pct,
      lead_time_days, lead_time_std_days, target_service_level, demand_cv,
      unit_cost_sgd, unit_price_sgd, annual_carrying_rate_pct, obsolescence_risk_pct, max_holding_days, active
    ) VALUES (
      @sku_id, @product_name, @rice_variety, @grade, @country_of_origin, @brand, @packaging_size, 'MT', @supplier,
      @min_order_qty, @reorder_point_policy, @min_stock, @target_stock, @max_stock, 20,
      @lead_time_days, @lead_time_std_days, @target_service_level, @demand_cv,
      @unit_cost_sgd, @unit_price_sgd, @annual_carrying_rate_pct, @obsolescence_risk_pct, @max_holding_days, 1
    )`);

  const insPos = db.prepare(`
    INSERT INTO inventory_positions (sku_id, on_hand_qty, reserved_qty, quality_hold_qty, last_received_date)
    VALUES (@sku_id, @on_hand_qty, @reserved_qty, @quality_hold_qty, @last_received_date)`);

  const insSale = db.prepare(`
    INSERT INTO sales_transactions (sku_id, quantity_mt, sale_date, customer, channel, status)
    VALUES (@sku_id, @quantity_mt, @sale_date, @customer, @channel, @status)`);

  const insPo = db.prepare(`
    INSERT INTO purchase_orders (po_number, sku_id, ordered_qty, order_date, eta, status)
    VALUES (@po_number, @sku_id, @ordered_qty, @order_date, @eta, 'open')`);

  const rng = mulberry32(20260906);
  let poSeq = 1;
  let saleCount = 0;

  const run = db.transaction(() => {
    for (const sku of SKUS) {
      insSku.run(sku);
      insPos.run({
        sku_id: sku.sku_id,
        on_hand_qty: sku.on_hand_qty,
        reserved_qty: sku.reserved_qty,
        quality_hold_qty: sku.quality_hold_qty,
        last_received_date: dateOffset(sku.received_days_ago),
      });

      for (const row of buildSales(sku, rng)) { insSale.run(row); saleCount++; }

      if (sku.po) {
        insPo.run({
          po_number: `PO-2026-${String(poSeq++).padStart(4, "0")}`,
          sku_id: sku.sku_id,
          ordered_qty: sku.po.qty,
          order_date: dateOffset(sku.lead_time_days - sku.po.eta_days),
          eta: dateOffset(-sku.po.eta_days), // negative offset = future
        });
      }
    }
  });
  run();

  console.log(`✓ Seeded ${SKUS.length} SKUs, ${saleCount} sales transactions, ${poSeq - 1} open POs`);
}

if (require.main === module) seed();

module.exports = { seed, SKUS };
