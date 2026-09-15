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

// How many months of history the seed builds. 24 rather than 12 so the
// template is demonstrated past a year rather than merely claimed to work
// there, and because a year-on-year comparison needs 13 months minimum.
//
// Safe to raise. velocity.js bounds its own fetch at 200 days and annual_cogs
// annualises from the 30 day average, so nothing behind today's KPIs, ABC
// classes, health statuses or alerts reads past week 29. Verified before this
// was changed, not assumed.
const HISTORY_MONTHS = 24;
const HISTORY_WEEKS = Math.ceil((HISTORY_MONTHS * 30.44) / 7); // 105

// Build weekly sales transactions that hit the s30 / s60 / s90 targets and
// then continue at the 60-90d rate for the rest of the window.
/** Stable 32-bit seed from a SKU id, so each SKU's older history is its own
 *  reproducible stream and is independent of SKU ordering. */
function seedFrom(id) {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function buildSales(sku, rng) {
  const { s30, s60, s90, lost_30d, idleSaleDaysAgo, idleSaleQty } = sku.sales;
  const rows = [];

  if (s90 === 0 && !idleSaleDaysAgo) return rows; // fully idle, never sold

  const wk = [
    { weeks: [0, 1, 2, 3], total: s30 },
    { weeks: [4, 5, 6, 7], total: Math.max(0, s60 - s30) },
    { weeks: [8, 9, 10, 11, 12], total: Math.max(0, s90 - s60) },
  ];
  // Weeks 13-25 continue at the 60–90d weekly rate.
  const tailRate = Math.max(0, s90 - s60) / 5;
  for (let w = 13; w <= 25; w++) wk.push({ weeks: [w], total: tailRate });

  const emit = (w, total, draw) => {
    const qty = round1(total * (0.8 + draw() * 0.4)); // ±20% noise
    if (qty <= 0) return;
    rows.push({
      sku_id: sku.sku_id,
      quantity_mt: qty,
      sale_date: dateOffset(w * 7 + 2 + Math.floor(draw() * 4)),
      customer: pick(draw, CUSTOMERS),
      channel: pick(draw, CHANNELS),
      status: "fulfilled",
    });
  };

  for (const group of wk) {
    if (group.total <= 0) continue;
    const per = group.total / group.weeks.length;
    for (const w of group.weeks) emit(w, per, rng);
  }

  // Weeks 26 onward are the older history, and they draw from a SEPARATE
  // per-SKU stream rather than the shared one.
  //
  // This is not fussiness. `rng` is a single sequence threaded through every
  // SKU in order, so drawing more numbers here would shift every subsequent
  // SKU's draws and change the recent weeks too. It did: extending the shared
  // loop moved GMROI from 0.68 to 0.67 and DIO from 106 to 108 without a
  // single recent sale being intentionally altered. A separate stream keeps
  // the last 26 weeks byte-identical to what the demo has always shown, so
  // adding two years of history genuinely changes nothing on screen today.
  if (tailRate > 0) {
    const tailRng = mulberry32(seedFrom(sku.sku_id));
    for (let w = 26; w <= HISTORY_WEEKS; w++) emit(w, tailRate, tailRng);
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

// ─────────────────────────────────────────────────────────────────────────────
// MONTHLY HISTORY (TASK-85)
//
// Walks BACKWARDS from the known ending state, which is what makes the chain
// tie exactly rather than approximately. Going forwards from an invented
// opening balance would land wherever it landed, and the newest closing figure
// would disagree with inventory_positions.on_hand_qty: the chart would then
// contradict the KPI strip, which is the one failure this feature must not
// have.
//
//   closing[newest] = the SKU's actual on_hand_qty          (fixed)
//   issues[m]       = SUM of that month's fulfilled sales   (never invented)
//   receipts[m]     = a plausible lot, clamped so opening never goes negative
//   opening[m]      = closing[m] + issues[m] - receipts[m]
//   closing[m-1]    = opening[m]
//
// So the only constructed number is receipts, and its job is to make a real
// ending balance and a real sales series meet. Everything else is either
// measured or forced by arithmetic.
// ─────────────────────────────────────────────────────────────────────────────
function periodKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/** The last HISTORY_MONTHS period keys, oldest first, ending with this month. */
function historyPeriods(now = new Date(today)) {
  const out = [];
  for (let i = HISTORY_MONTHS - 1; i >= 0; i--) {
    out.push(periodKey(new Date(now.getFullYear(), now.getMonth() - i, 1)));
  }
  return out;
}

function buildHistory(sku, salesRows) {
  // Its own stream, NOT the shared one. Threading the shared `rng` in here
  // drew numbers mid-loop and shifted every later SKU's sales, which moved
  // GMROI and DIO without a single recent sale being intentionally changed.
  // The receipt pattern is a property of the SKU, so it is seeded from the
  // SKU id and is independent of how many SKUs precede it.
  const rng = mulberry32(seedFrom(sku.sku_id) ^ 0x9e3779b9);
  const periods = historyPeriods();

  // Issues come from the transactions themselves. "lost" rows are demand that
  // was never shipped, so they move no stock and are excluded, exactly as
  // velocity.js excludes them.
  const issuesByPeriod = new Map();
  for (const r of salesRows) {
    if (r.status !== "fulfilled") continue;
    const p = r.sale_date.slice(0, 7);
    issuesByPeriod.set(p, round1((issuesByPeriod.get(p) || 0) + r.quantity_mt));
  }

  const lot = Math.max(sku.min_order_qty || 0, 10);
  const rows = [];
  let closing = sku.on_hand_qty;

  for (let i = periods.length - 1; i >= 0; i--) {
    const period = periods[i];
    const issues = issuesByPeriod.get(period) || 0;

    // A receipt roughly replaces what went out, lumpy rather than smooth: real
    // importers buy in containers, not in daily trickles. Rounded to the SKU's
    // own minimum order quantity so the figures look like purchases.
    let receipts = 0;
    if (issues > 0) {
      const lots = Math.round((issues * (0.7 + rng() * 0.7)) / lot);
      receipts = Math.max(0, lots) * lot;
    }

    // opening cannot be negative: you cannot start a month owing stock.
    let opening = round1(closing + issues - receipts);
    if (opening < 0) {
      receipts = round1(closing + issues);
      opening = 0;
    }

    rows.push({
      sku_id: sku.sku_id,
      period,
      opening_qty: opening,
      receipts_qty: round1(receipts),
      issues_qty: issues,
      closing_qty: round1(closing),
      unit_cost_sgd: sku.unit_cost_sgd,
    });

    closing = opening;
  }

  return rows.reverse(); // oldest first
}

const CUSTOMERS = ["Sheng Siong", "FairPrice", "Prime Supermarket", "Kopitiam Group", "Select Catering", "Eastpoint Trading"];
const CHANNELS = ["direct", "wholesale", "retail", "food-service"];
const pick = (rng, arr) => arr[Math.floor(rng() * arr.length)];
const round1 = (n) => Math.round(n * 10) / 10;

function seed() {
  initDb();
  const db = getDb();

  // The wipe below erases audit_log, which is the only record of paid model
  // spend on this machine (TASK-93). Say what is about to go, so it can be
  // copied into docs/(Stan) 1 Reference/(Stan) MODEL SPEND.md first. A notice, not a prompt: the
  // seed is run from scripts and on first boot, where nothing can answer one.
  try {
    const { paidSpend } = require("../llm/spend");
    const s = paidSpend(db);
    if (s.calls.length) {
      console.log(
        `NOTE: erasing ${s.calls.length} paid model call record(s), about USD ${s.usd.toFixed(4)}. ` +
        `If they are not in docs/(Stan) 1 Reference/(Stan) MODEL SPEND.md yet, they are now lost from this database.`
      );
    }
  } catch { /* first boot: no audit_log yet, nothing to report */ }

  const wipe = db.transaction(() => {
    // "decisions" (TASK-12) has a FK on sku_id and must be cleared before
    // "skus" — this table was added after this wipe list was first written,
    // and reseeding after recording even one decision failed with
    // SQLITE_CONSTRAINT_FOREIGNKEY until it was added here.
    // "audit_log" (TASK-31) is wiped alongside "alerts_log" for a reason: alerts
    // are only written to audit_log the first time each dedupe_key is
    // materialized. Clearing alerts without clearing the audit trail would
    // leave duplicate ALERT_TRIGGERED rows for conditions that were re-detected
    // on the fresh data, and clearing neither leaves the trail empty after a
    // reseed, because every alert is already materialized.
    for (const t of ["inventory_history", "sales_transactions", "purchase_orders", "sales_orders", "goods_movements", "operators", "inventory_positions", "alerts_log", "audit_log", "decisions", "skus"]) {
      db.exec(`DELETE FROM ${t}`);
    }
    db.exec(`DELETE FROM sqlite_sequence WHERE name IN
      ('inventory_history','sales_transactions','purchase_orders','sales_orders','goods_movements','operators','inventory_positions','alerts_log','audit_log','decisions','skus')`);
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

  const insHist = db.prepare(`
    INSERT INTO inventory_history (sku_id, period, opening_qty, receipts_qty, issues_qty, closing_qty, unit_cost_sgd)
    VALUES (@sku_id, @period, @opening_qty, @receipts_qty, @issues_qty, @closing_qty, @unit_cost_sgd)`);

  const insPo = db.prepare(`
    INSERT INTO purchase_orders (po_number, sku_id, ordered_qty, order_date, eta, status)
    VALUES (@po_number, @sku_id, @ordered_qty, @order_date, @eta, 'open')`);

  const rng = mulberry32(20260906);
  let poSeq = 1;
  let saleCount = 0;
  let histCount = 0;

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

      // The SAME array is inserted and then summarised. Calling buildSales
      // twice would consume the shared PRNG twice and produce a history whose
      // issues did not match the transactions actually stored.
      const sales = buildSales(sku, rng);
      for (const row of sales) { insSale.run(row); saleCount++; }

      for (const row of buildHistory(sku, sales)) { insHist.run(row); histCount++; }

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

  // ── Operators ──────────────────────────────────────────────────────────────
  // Demo PINs, printed on the login screen. Not secrets. See db/init.js.
  const insertOp = db.prepare(`INSERT INTO operators (name, pin, role) VALUES (?, ?, ?)`);
  // The team, so a demo signs in as a real person rather than a placeholder.
  // Stan is "both" and keeps the PIN he chose, since he is the one driving
  // the demo and should not have to pick an operator to get through a screen.
  const OPERATORS = [
    ["Wenjin", "1234", "receiving"],
    ["Taw", "2345", "dispatch"],
    ["CY", "3456", "both"],
    ["Stan", "6767", "both"],
  ];
  for (const o of OPERATORS) insertOp.run(...o);

  // ── Sales orders ───────────────────────────────────────────────────────────
  // Derived FROM reserved_qty rather than invented alongside it, so the open
  // order quantities for a SKU always sum to exactly what the dashboard says is
  // reserved. Inventing them independently would let the warehouse and the
  // Control Tower disagree about the same tonnes.
  const CUSTOMERS = [
    "Tiong Bahru Provisions", "Golden Prata House", "NTUC FairPrice (Central)",
    "Sakura Japanese Kitchen", "Al-Azhar Restaurant", "Seng Kee Wholesale",
  ];
  const insertSo = db.prepare(`
    INSERT INTO sales_orders (so_number, sku_id, customer, ordered_qty, required_date, status)
    VALUES (?, ?, ?, ?, ?, 'open')`);

  let soSeq = 3301;
  let soCount = 0;
  for (const sku of SKUS) {
    const reserved = sku.reserved_qty || 0;
    if (reserved <= 0) continue;
    // Split larger reservations across two customers so the pick list is not
    // one order per SKU, which is not what a real dispatch day looks like.
    const parts = reserved >= 40 ? [Math.round(reserved * 0.6), reserved - Math.round(reserved * 0.6)] : [reserved];
    parts.forEach((qty, i) => {
      const due = new Date(Date.now() + (1 + i * 2) * 86400000).toISOString().slice(0, 10);
      insertSo.run(`SO-${soSeq++}`, sku.sku_id, CUSTOMERS[soCount % CUSTOMERS.length], qty, due);
      soCount++;
    });
  }

  console.log(`✓ Seeded ${SKUS.length} SKUs, ${saleCount} sales transactions, ${poSeq - 1} open POs, ${soCount} open sales orders, ${OPERATORS.length} operators`);
  console.log(`✓ Seeded ${histCount} months of inventory history (${HISTORY_MONTHS} per SKU)`);

  // ── Tie-out ────────────────────────────────────────────────────────────────
  // Printed, and loud on failure, because a silently broken chain is the exact
  // failure this feature cannot have: the hero chart would disagree with the
  // KPI strip and both would look fine. Three things are asserted per SKU:
  // every period balances, every opening equals the prior closing, and the
  // newest closing equals the stock actually on hand.
  const problems = verifyHistory(db);
  if (problems.length) {
    console.error(`✗ inventory_history does NOT tie (${problems.length} problems):`);
    for (const p of problems.slice(0, 10)) console.error("   " + p);
    process.exitCode = 1;
  } else {
    const val = db.prepare(`
      SELECT ROUND(SUM(h.closing_qty * h.unit_cost_sgd)) v
        FROM inventory_history h
       WHERE h.period = (SELECT MAX(period) FROM inventory_history)`).get().v;
    console.log(`✓ History ties: every period balances and the newest closing matches on-hand (SGD ${Number(val).toLocaleString("en-SG")})`);
  }
}

/**
 * Returns a list of human-readable problems; empty means the history is sound.
 * Exported so a route or a script can run the same check rather than
 * reimplementing it, which is how two versions of a rule drift apart.
 */
function verifyHistory(db) {
  const problems = [];
  const skus = db.prepare(`SELECT sku_id FROM skus ORDER BY sku_id`).all();
  const onHand = new Map(
    db.prepare(`SELECT sku_id, on_hand_qty FROM inventory_positions`).all().map((r) => [r.sku_id, r.on_hand_qty])
  );
  const near = (a, b) => Math.abs(a - b) < 0.05; // one decimal place of tolerance

  for (const { sku_id } of skus) {
    const rows = db.prepare(
      `SELECT * FROM inventory_history WHERE sku_id = ? ORDER BY period`
    ).all(sku_id);
    if (!rows.length) { problems.push(`${sku_id}: no history rows`); continue; }

    let prevClosing = null;
    for (const r of rows) {
      const expected = r.opening_qty + r.receipts_qty - r.issues_qty;
      if (!near(expected, r.closing_qty)) {
        problems.push(`${sku_id} ${r.period}: ${r.opening_qty} + ${r.receipts_qty} - ${r.issues_qty} = ${round1(expected)}, but closing is ${r.closing_qty}`);
      }
      if (prevClosing !== null && !near(prevClosing, r.opening_qty)) {
        problems.push(`${sku_id} ${r.period}: opening ${r.opening_qty} does not continue from previous closing ${prevClosing}`);
      }
      if (r.opening_qty < -0.05 || r.closing_qty < -0.05) {
        problems.push(`${sku_id} ${r.period}: negative stock (${r.opening_qty} -> ${r.closing_qty})`);
      }
      prevClosing = r.closing_qty;
    }

    const last = rows[rows.length - 1];
    const actual = onHand.get(sku_id);
    if (actual === undefined) problems.push(`${sku_id}: no inventory_positions row`);
    else if (!near(last.closing_qty, actual)) {
      problems.push(`${sku_id}: newest closing ${last.closing_qty} does not match on-hand ${actual}`);
    }
  }
  return problems;
}

if (require.main === module) seed();

module.exports = { seed, verifyHistory, SKUS };
