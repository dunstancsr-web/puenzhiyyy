// ─────────────────────────────────────────────────────────────────────────────
// INVENTORY / ANALYTICS ROUTES (TASK-09)
// Real endpoints over the SQLite schema + analytics engine — replaces the
// frontend's static mock data (TASK-10). The legacy /api/products routes
// (routes/products.js, backend/src/data/products.js) are untouched — separate
// in-memory demo store, not part of this schema.
//
// Response shape matches routes/products.js's convention: { success, data, message? }.
// ─────────────────────────────────────────────────────────────────────────────

const express = require("express");
const router = express.Router();
const { getDb } = require("../db/init");
const { EVENTS, logEvent, readEvents, eventCounts, diffFields } = require("../db/audit");
const { addRequestEvent } = require("../db/requestEvents");
const { buildAnalytics } = require("../engines/index");
const { explainAlert, providerInfo, LlmUnavailable } = require("../llm/explain");
const { explainActionItem } = require("../llm/explainActionItem");
const { askDatabase } = require("../llm/askDatabase");
const { listModes, getDefaultMode, resolveTier } = require("../llm/provider");
const demoAccess = require("../llm/demoAccess");
const { projectInventory } = require("../engines/projection");
const { toCsv, parseCsv } = require("../db/csv");
const { sandboxOnlyWhenPublic } = require("../middleware/sandboxGuard");

const today = () => new Date().toISOString().slice(0, 10);

function getAnalytics() {
  return buildAnalytics(getDb());
}

// Numeric fields on skus/inventory_positions that must be >= 0 (target_service_level
// additionally must be <= 1, being a probability). SkuEditForm/AddSkuForm already
// enforce this client-side ("Must be ≥ 0"), but that's the only guard that existed —
// POST /skus and PUT /skus/:id accepted any number, including negative ones, from
// any direct API call. Found via curl: PUT {min_stock: -500} was accepted and stored
// as-is with no error.
const NONNEGATIVE_NUMERIC_FIELDS = [
  "min_order_qty", "reorder_point_policy", "min_stock", "target_stock", "max_stock",
  "safety_stock_pct", "lead_time_days", "lead_time_std_days", "target_service_level", "unit_cost_sgd",
  "unit_price_sgd", "reserved_qty", "quality_hold_qty",
];

// Returns an error message string, or null if every provided numeric field is valid.
function validateNumericFields(body) {
  for (const k of NONNEGATIVE_NUMERIC_FIELDS) {
    if (body[k] === undefined) continue;
    const n = Number(body[k]);
    if (!Number.isFinite(n) || n < 0) return `${k} must be a number >= 0`;
    if (k === "target_service_level" && n > 1) return `${k} must be <= 1`;
  }
  return null;
}

// ── SKUs ─────────────────────────────────────────────────────────────────────

// GET /api/skus — every active SKU with all computed fields
router.get("/skus", (req, res) => {
  try {
    const { skus } = getAnalytics();
    res.json({ success: true, count: skus.length, data: skus });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Failed to load SKUs" });
  }
});

// Registered BEFORE /skus/:id on purpose. Express matches in order, so with
// the other ordering "export" is read as an id and the request 404s as an
// unknown SKU, which is a confusing way to fail.
// GET /api/skus/export — every SKU, every editable field, as CSV
router.get("/skus/export", (req, res) => {
  try {
    const db = getDb();
    const rows = db.prepare(`
      SELECT s.*, p.on_hand_qty, p.reserved_qty, p.quality_hold_qty
        FROM skus s
        LEFT JOIN inventory_positions p ON p.sku_id = s.sku_id
       WHERE s.active = 1
       ORDER BY s.sku_id`).all();

    // Computed context comes from the engine, never recomputed here. Reading
    // the engine's own field is the standing rule in this repo.
    const { skus } = getAnalytics();
    const computed = new Map(skus.map((s) => [s.sku_id, s]));
    const merged = rows.map((r) => {
      const c = computed.get(r.sku_id) || {};
      return { ...r, ...Object.fromEntries(EXPORT_CONTEXT.map((k) => [k, c[k]])) };
    });

    const csv = merged.length
      ? toCsv([...IMPORT_COLUMNS, ...EXPORT_CONTEXT], merged)
      : toCsv(MINIMAL_TEMPLATE_COLUMNS, [EXAMPLE_ROW]);
    const stamp = today();
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="stocksense-inventory-${stamp}.csv"`);
    res.send(csv);
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Failed to export SKUs" });
  }
});

// GET /api/skus/opening-balance-suggestions — one plain sum per SKU (receipts
// in minus fulfilled sales out, all time), offered on onboarding's opening
// balance step as an opt-in starting point someone clicks to accept, never
// pre-filled (Stan's call, 18 Sep: this is exactly the "sum the history"
// derivation onboarding deliberately does NOT trust as a real count, so it
// stays a labelled suggestion, not the value itself). One query, one owner:
// nothing else should re-derive this from row-level history (rules.md,
// "Derived values computed twice"). Fulfilled sales only, matching Stan's
// formula decision (see formula-decisions.json) used everywhere else demand
// is summed. Must be registered BEFORE /skus/:id below, or Express reads
// "opening-balance-suggestions" as a sku_id and this 404s as "SKU not found" -
// caught by actually curling it, not just reading the route table.
router.get("/skus/opening-balance-suggestions", (req, res) => {
  try {
    const db = getDb();
    const received = db.prepare(`
      SELECT sku_id, SUM(actual_qty) AS qty FROM goods_movements
       WHERE movement_type = 'RECEIPT' GROUP BY sku_id`).all();
    const sold = db.prepare(`
      SELECT sku_id, SUM(quantity_mt) AS qty FROM sales_transactions
       WHERE status = 'fulfilled' GROUP BY sku_id`).all();
    const net = {};
    for (const r of received) net[r.sku_id] = (net[r.sku_id] || 0) + r.qty;
    for (const s of sold) net[s.sku_id] = (net[s.sku_id] || 0) - s.qty;
    const suggestions = {};
    for (const [sku_id, qty] of Object.entries(net)) {
      suggestions[sku_id] = Math.round(Math.max(0, qty) * 10) / 10;
    }
    res.json({ success: true, data: suggestions });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Failed to compute opening balance suggestions" });
  }
});

// POST /api/skus/opening-balance  { sku_id, quantity }
// The one way onboarding puts a first count on the shelf, replacing the office restock removed
// with the duties split. It is deliberately narrow so it cannot become that restock again:
//   - only a product with NO stock yet (on hand is 0), so it can never top up a live balance;
//   - only once per product (a second call is refused with 409);
//   - recorded as its own movement type, OPENING (OB-0001), never as a RECEIPT, so it is not
//     mistaken for a delivery and does not feed the opening-balance suggestion;
//   - audited (OPENING_BALANCE_SET) with who and when, and refused on a public server outside
//     the demo sandbox like every other write.
// Once a product has stock, it changes only on the warehouse floor.
router.post("/skus/opening-balance", sandboxOnlyWhenPublic, (req, res) => {
  const { sku_id, quantity } = req.body || {};
  if (!sku_id) return res.status(400).json({ success: false, message: "sku_id is required" });
  const qty = Number(quantity);
  if (!Number.isFinite(qty) || qty <= 0) {
    return res.status(400).json({ success: false, message: "quantity must be a positive number" });
  }
  try {
    const db = getDb();
    const pos = db.prepare(`SELECT on_hand_qty FROM inventory_positions WHERE sku_id = ?`).get(sku_id);
    if (!pos) return res.status(404).json({ success: false, message: "SKU not found" });
    if (Number(pos.on_hand_qty) > 0) {
      return res.status(409).json({ success: false, message: "This product already has stock. From here on it changes only when the warehouse receives or dispatches goods." });
    }
    const done = db.prepare(`SELECT movement_no FROM goods_movements WHERE sku_id = ? AND movement_type = 'OPENING'`).get(sku_id);
    if (done) {
      return res.status(409).json({ success: false, message: `An opening balance was already recorded for this product (${done.movement_no}).` });
    }
    const last = db.prepare(`SELECT movement_no FROM goods_movements WHERE movement_type = 'OPENING' ORDER BY id DESC LIMIT 1`).get();
    const n = last ? Number(String(last.movement_no).split("-")[1]) + 1 : 1;
    const movementNo = `OB-${String(n).padStart(4, "0")}`;
    const day = new Date().toISOString().slice(0, 10);

    db.transaction(() => {
      db.prepare(`UPDATE inventory_positions SET on_hand_qty = ?, last_received_date = ?, last_updated = datetime('now') WHERE sku_id = ?`)
        .run(qty, day, sku_id);
      db.prepare(`
        INSERT INTO goods_movements (movement_no, movement_type, reference, sku_id, expected_qty, actual_qty, variance_qty, operator_name)
        VALUES (?, 'OPENING', 'opening balance', ?, NULL, ?, 0, 'onboarding')`).run(movementNo, sku_id, qty);
    })();

    const { skus } = buildAnalytics(db);
    const after = skus.find((x) => x.sku_id === sku_id);
    logEvent(EVENTS.OPENING_BALANCE_SET, {
      skuId: sku_id,
      input: { quantity_mt: qty, on_hand_before: pos.on_hand_qty, at: new Date().toISOString() },
      output: { movement_no: movementNo, on_hand_after: qty, available_qty: after ? after.available_qty : null, health_status: after ? after.health_status : null },
    });
    res.status(201).json({ success: true, data: after });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Failed to record the opening balance" });
  }
});

// GET /api/skus/:id — single SKU, fully computed
router.get("/skus/:id", (req, res) => {
  try {
    const { skus } = getAnalytics();
    const sku = skus.find((s) => s.sku_id === req.params.id);
    if (!sku) return res.status(404).json({ success: false, message: "SKU not found" });
    res.json({ success: true, data: sku });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Failed to load SKU" });
  }
});

// GET /api/skus/:id/projection — 90-day projected inventory curve (TASK-07)
router.get("/skus/:id/projection", (req, res) => {
  try {
    const { skus } = getAnalytics();
    const sku = skus.find((s) => s.sku_id === req.params.id);
    if (!sku) return res.status(404).json({ success: false, message: "SKU not found" });

    const result = projectInventory({
      availableQty: sku.available_qty,
      dailyDemand: sku.avg_daily_usage_30d,
      openPos: sku.open_pos,
      safetyStockMt: sku.safety_stock_mt,
      // The approved value, the one the REORDER alert fires on (TASK-95).
      reorderPoint: sku.reorder_point_policy,
      days: 90,
    });

    res.json({
      success: true,
      data: {
        ...result,
        reference: {
          safety_stock_mt: sku.safety_stock_mt,
          reorder_point_suggested: sku.reorder_point_suggested,
          reorder_point_policy: sku.reorder_point_policy,
          target_stock: sku.target_stock,
          max_stock: sku.max_stock,
        },
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Failed to build projection" });
  }
});

// POST /api/skus — create a new SKU. Any policy/engine input not supplied
// (service level, demand CV, carrying rate, etc.) falls back to the schema's
// own SQL defaults (see db/init.js) — matches NEW_SKU_DEFAULTS on the frontend.
router.post("/skus", (req, res) => {
  const b = req.body || {};
  const required = ["sku_id", "product_name"];
  for (const field of required) {
    if (!b[field]) return res.status(400).json({ success: false, message: `Missing required field: ${field}` });
  }
  const numericError = validateNumericFields(b);
  if (numericError) return res.status(400).json({ success: false, message: numericError });

  try {
    const db = getDb();
    const existing = db.prepare(`SELECT 1 FROM skus WHERE sku_id = ?`).get(b.sku_id);
    if (existing) return res.status(409).json({ success: false, message: `SKU ${b.sku_id} already exists` });

    const insertSku = db.prepare(`
      INSERT INTO skus (
        sku_id, product_name, rice_variety, grade, country_of_origin, brand, packaging_size, uom, supplier,
        min_order_qty, reorder_point_policy, min_stock, target_stock, max_stock, safety_stock_pct,
        lead_time_days, unit_cost_sgd, unit_price_sgd, active
      ) VALUES (
        @sku_id, @product_name, @rice_variety, @grade, @country_of_origin, @brand, @packaging_size, 'MT', @supplier,
        @min_order_qty, @reorder_point_policy, @min_stock, @target_stock, @max_stock, @safety_stock_pct,
        @lead_time_days, @unit_cost_sgd, @unit_price_sgd, 1
      )`);
    const insertPos = db.prepare(`
      INSERT INTO inventory_positions (sku_id, on_hand_qty, reserved_qty, quality_hold_qty, last_received_date)
      VALUES (?, 0, 0, 0, ?)`);

    const run = db.transaction(() => {
      insertSku.run({
        sku_id: b.sku_id, product_name: b.product_name,
        rice_variety: b.rice_variety || null, grade: b.grade || null,
        country_of_origin: b.country_of_origin || null, brand: b.brand || null,
        packaging_size: b.packaging_size || null, supplier: b.supplier || null,
        min_order_qty: Number(b.min_order_qty) || 0,
        reorder_point_policy: Number(b.reorder_point_policy) || 0,
        min_stock: Number(b.min_stock) || 0, target_stock: Number(b.target_stock) || 0,
        max_stock: Number(b.max_stock) || 0, safety_stock_pct: Number(b.safety_stock_pct) || 20,
        lead_time_days: Number(b.lead_time_days) || 45,
        unit_cost_sgd: Number(b.unit_cost_sgd) || 0, unit_price_sgd: Number(b.unit_price_sgd) || 0,
      });
      insertPos.run(b.sku_id, today());
    });
    run();

    const { skus } = getAnalytics();
    const created = skus.find((s) => s.sku_id === b.sku_id);

    // The output side records what the engines DERIVED from the new SKU, not
    // just the fields that were posted. That is the interesting half: it shows
    // the classification and reorder maths running on arrival.
    logEvent(EVENTS.SKU_CREATED, {
      skuId: b.sku_id,
      input: { product_name: b.product_name, supplier: b.supplier || null, lead_time_days: Number(b.lead_time_days) || 45 },
      output: created
        ? {
            abc_class: created.abc_class,
            reorder_point_suggested: created.reorder_point_suggested,
            safety_stock_mt: created.safety_stock_mt,
            health_status: created.health_status,
          }
        : null,
    });

    res.status(201).json({ success: true, data: created });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Failed to create SKU" });
  }
});

// PUT /api/skus/:id — update policy/identity fields (skus table) and
// reserved/quality-hold (inventory_positions table) in one call.
const SKU_TABLE_FIELDS = [
  "product_name", "rice_variety", "grade", "country_of_origin", "brand", "supplier", "packaging_size",
  "min_order_qty", "reorder_point_policy", "min_stock", "target_stock", "max_stock", "safety_stock_pct",
  "lead_time_days", "lead_time_std_days", "target_service_level", "unit_cost_sgd", "unit_price_sgd",
];
const POSITION_TABLE_FIELDS = ["reserved_qty", "quality_hold_qty"];

// Shared by PUT /api/skus/:id below and POST /api/decisions' policy-approval
// branch, so a human typing into the SKU form and an approved AI suggestion
// go through exactly one write path, not two that could drift apart.
function applySkuUpdate(db, skuId, fields) {
  const skuUpdates = SKU_TABLE_FIELDS.filter((k) => fields[k] !== undefined);
  const posUpdates = POSITION_TABLE_FIELDS.filter((k) => fields[k] !== undefined);
  const run = db.transaction(() => {
    if (skuUpdates.length) {
      const setClause = skuUpdates.map((k) => `${k} = @${k}`).join(", ");
      db.prepare(`UPDATE skus SET ${setClause} WHERE sku_id = @sku_id`).run({ ...fields, sku_id: skuId });
    }
    if (posUpdates.length) {
      const setClause = posUpdates.map((k) => `${k} = @${k}`).join(", ");
      db.prepare(`UPDATE inventory_positions SET ${setClause} WHERE sku_id = @sku_id`).run({ ...fields, sku_id: skuId });
    }
  });
  run();
}

router.put("/skus/:id", (req, res) => {
  const b = req.body || {};
  const numericError = validateNumericFields(b);
  if (numericError) return res.status(400).json({ success: false, message: numericError });
  try {
    const db = getDb();
    // Select the full row, not just `1`: the audit trail needs the before-state
    // to diff against, and it has to be read inside the same request, before
    // the UPDATE runs.
    const existing = db.prepare(`
      SELECT s.*, p.reserved_qty, p.quality_hold_qty
        FROM skus s
        LEFT JOIN inventory_positions p ON p.sku_id = s.sku_id
       WHERE s.sku_id = ?`).get(req.params.id);
    if (!existing) return res.status(404).json({ success: false, message: "SKU not found" });

    applySkuUpdate(db, req.params.id, b);

    const { skus } = getAnalytics();
    const updated = skus.find((s) => s.sku_id === req.params.id);

    // Only log when something actually moved. A Save that changed nothing is
    // noise, and a trail full of no-op rows is the fastest way to make an audit
    // log unreadable.
    const changes = diffFields(existing, b, [...SKU_TABLE_FIELDS, ...POSITION_TABLE_FIELDS]);
    if (Object.keys(changes).length) {
      logEvent(EVENTS.SKU_UPDATED, {
        skuId: req.params.id,
        input: { changed_fields: Object.keys(changes), changes },
        output: updated
          ? { health_status: updated.health_status, reorder_point_suggested: updated.reorder_point_suggested, available_qty: updated.available_qty }
          : null,
      });
    }

    res.json({ success: true, data: updated });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Failed to update SKU" });
  }
});

// GET /api/dashboard/history — monthly consumption at cost (TASK-65)
//
// What this is NOT: a history of Total Inventory Value. Nothing in this schema
// records what stock was worth on a past date, and reconstructing it backwards
// from sales would have to assume no goods were ever received, which would draw
// a smooth line sloping up into the past: entirely plausible, entirely wrong.
// So this charts what IS recorded, the value consumed each month, which is the
// thing that draws inventory down and therefore earns its place beside the
// hero figure.
//
// `partial` is the load-bearing field. The data starts mid-March and the
// current month is still running, so those two months hold roughly half a
// month of sales each. Drawn as ordinary bars beside a full month they read as
// a collapse in demand, which is a false story told with true numbers. The
// server decides this rather than the chart, because the server is the only
// side that knows the real coverage window.
router.get("/dashboard/history", (req, res) => {
  const months = Math.min(36, Math.max(1, Number(req.query.months) || 6));
  try {
    const db = getDb();

    // Closing stock and its value, straight from inventory_history. The value
    // is derived here rather than stored, and it uses each row's OWN
    // unit_cost_sgd, so a price change today cannot rewrite what last year's
    // stock was worth.
    //
    // new_value_sgd splits that closing value into the stock that ARRIVED in
    // the month and the stock CARRIED OVER from before it, under FIFO (oldest
    // issued first, which is what a rice warehouse does and what the ageing
    // engine already assumes):
    //
    //   arrived = MIN(receipts_qty, closing_qty)
    //
    // Both cases fall out of that one expression. If the month's issues did
    // not exhaust the opening stock, everything received is still on hand and
    // arrived = receipts. If issues ran past the opening stock, the only stock
    // left is new and arrived = closing. No branch needed.
    //
    // The MIN is INSIDE the SUM on purpose, so it is evaluated per SKU row
    // before aggregation. Applying it to portfolio totals would let one SKU's
    // receipts offset another SKU's issues and quietly overstate the new band.
    const stock = db.prepare(`
      SELECT period,
             ROUND(SUM(closing_qty), 1)                   AS closing_qty_mt,
             ROUND(SUM(closing_qty * unit_cost_sgd))      AS closing_value_sgd,
             ROUND(SUM(MIN(receipts_qty, closing_qty) * unit_cost_sgd)) AS new_value_sgd,
             ROUND(SUM(receipts_qty), 1)                  AS receipts_qty_mt,
             ROUND(SUM(issues_qty), 1)                    AS issues_qty_mt
        FROM inventory_history
       GROUP BY period
       ORDER BY period`).all();

    // Consumption, from the transactions. Kept separate from issues_qty above
    // on purpose: they should agree, and two independent readings of the same
    // fact are how a disagreement becomes visible instead of silent.
    const consumed = new Map(
      db.prepare(`
        SELECT substr(t.sale_date, 1, 7) AS period,
               ROUND(SUM(t.quantity_mt), 1)                     AS consumed_qty_mt,
               ROUND(SUM(t.quantity_mt * s.unit_cost_sgd))      AS consumed_value_sgd,
               COUNT(*)                                         AS txns
          FROM sales_transactions t
          JOIN skus s ON s.sku_id = t.sku_id
         WHERE t.status = 'fulfilled'
         GROUP BY period`).all().map((r) => [r.period, r])
    );

    if (!stock.length) return res.json({ success: true, data: { months: [], coverage: null } });

    const thisMonth = new Date().toISOString().slice(0, 7);
    const series = stock.slice(-months).map((r) => {
      const c = consumed.get(r.period) || { consumed_qty_mt: 0, consumed_value_sgd: 0, txns: 0 };
      return {
        ...r, ...c,
        // Subtracted rather than summed a second time, so the two stacked
        // segments add up to closing_value_sgd exactly. Rounding each half
        // independently would leave a dollar or two of daylight between the
        // stack and the hero figure beside it.
        carried_value_sgd: r.closing_value_sgd - r.new_value_sgd,
        // Only the current month is partial now. History rows are whole
        // months by construction, so the old first-month edge case is gone.
        partial: r.period === thisMonth,
      };
    });

    const full = series.filter((r) => !r.partial);
    const average = full.length
      ? Math.round(full.reduce((a, r) => a + r.consumed_value_sgd, 0) / full.length)
      : null;

    // Previous-period comparison, replacing the hardcoded PRIOR constants that
    // used to drive every trend arrow. Null when there is no prior period
    // rather than a fabricated fallback.
    const latest = series[series.length - 1] || null;
    const prior = series.length > 1 ? series[series.length - 2] : null;

    res.json({
      success: true,
      data: {
        months: series,
        average,
        fullMonths: full.length,
        latest,
        prior,
        coverage: stock.length
          ? { from: stock[0].period, to: stock[stock.length - 1].period, periods: stock.length }
          : null,
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Failed to build history" });
  }
});

// ── Monthly history as CSV (TASK-85) ─────────────────────────────────────────
//
// A SECOND file rather than more columns on the SKU export, because the two
// have different grains: one row per SKU there, one row per SKU per month
// here. Merging them would mean either repeating every SKU field 24 times or
// adding a column per month, and the column-per-month shape is exactly what
// stops working past a year.
const HISTORY_KEY = ["sku_id", "period"];
const HISTORY_EDITABLE = ["opening_qty", "receipts_qty", "issues_qty", "closing_qty", "unit_cost_sgd"];
const HISTORY_COLUMNS = [...HISTORY_KEY, ...HISTORY_EDITABLE];
const HISTORY_CONTEXT = ["product_name", "closing_value_sgd"];

// GET /api/skus/history/export?months=N — monthly history, newest N periods
router.get("/skus/history/export", (req, res) => {
  const months = Math.min(120, Math.max(1, Number(req.query.months) || 24));
  try {
    const db = getDb();
    const periods = db.prepare(
      `SELECT DISTINCT period FROM inventory_history ORDER BY period DESC LIMIT ?`
    ).all(months).map((r) => r.period);

    if (!periods.length) {
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      return res.send(toCsv([...HISTORY_COLUMNS, ...HISTORY_CONTEXT], []));
    }

    const placeholders = periods.map(() => "?").join(",");
    const rows = db.prepare(`
      SELECT h.sku_id, h.period, h.opening_qty, h.receipts_qty, h.issues_qty,
             h.closing_qty, h.unit_cost_sgd,
             s.product_name,
             ROUND(h.closing_qty * h.unit_cost_sgd, 2) AS closing_value_sgd
        FROM inventory_history h
        JOIN skus s ON s.sku_id = h.sku_id
       WHERE h.period IN (${placeholders})
       ORDER BY h.sku_id, h.period`).all(...periods);

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition",
      `attachment; filename="stocksense-history-${today()}.csv"`);
    res.send(toCsv([...HISTORY_COLUMNS, ...HISTORY_CONTEXT], rows));
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Failed to export history" });
  }
});

// POST /api/skus/history/import — { csv, apply }
//
// Same preview-then-apply contract as the SKU import, plus the checks that
// make this dataset self-verifying. A spreadsheet whose arithmetic does not
// balance cannot enter the database, which is what keeps the dashboard's
// history honest without anyone having to trust it.
router.post("/skus/history/import", (req, res) => {
  const { csv, apply = false } = req.body || {};
  if (typeof csv !== "string" || !csv.trim()) {
    return res.status(400).json({ success: false, message: "No CSV content was received" });
  }

  let parsed;
  try {
    parsed = parseCsv(csv);
  } catch (err) {
    return res.status(400).json({ success: false, message: `Could not read the file: ${err.message}` });
  }
  for (const k of HISTORY_KEY) {
    if (!parsed.columns.includes(k)) {
      return res.status(400).json({
        success: false,
        message: `The file has no ${k} column, so there is no way to tell which row each line is for.`,
      });
    }
  }

  try {
    const db = getDb();
    // product_name is joined in so the review panel can name the SKU rather
    // than show only its code.
    const current = db.prepare(`
      SELECT h.*, s.product_name
        FROM inventory_history h
        JOIN skus s ON s.sku_id = h.sku_id`).all();
    const byKey = new Map(current.map((r) => [`${r.sku_id}|${r.period}`, r]));
    const knownSku = new Set(db.prepare(`SELECT sku_id FROM skus`).all().map((r) => r.sku_id));

    const editable = parsed.columns.filter((c) => HISTORY_EDITABLE.includes(c));
    const ignored = parsed.columns.filter((c) => !HISTORY_COLUMNS.includes(c));

    const changes = [];
    const errors = [];
    const seen = new Set();
    let unchanged = 0;

    for (const row of parsed.rows) {
      const line = row.__line;
      const sku = row.sku_id;
      const period = row.period;
      if (!sku || !period) { errors.push({ line, message: `Row ${line} is missing sku_id or period` }); continue; }
      if (!/^\d{4}-\d{2}$/.test(period)) {
        errors.push({ line, message: `${sku} ${period}: period must look like 2026-04 (line ${line})` });
        continue;
      }
      const key = `${sku}|${period}`;
      if (seen.has(key)) { errors.push({ line, message: `${sku} ${period} appears more than once (line ${line})` }); continue; }
      seen.add(key);
      if (!knownSku.has(sku)) { errors.push({ line, message: `${sku} is not a known SKU (line ${line})` }); continue; }

      const existing = byKey.get(key);
      if (!existing) { errors.push({ line, message: `${sku} has no ${period} row to update (line ${line})` }); continue; }

      const fields = {};
      let failed = false;
      for (const f of editable) {
        const delta = cellChange(f, row[f], existing[f]);
        if (!delta) continue;
        if (delta.error) { errors.push({ line, message: `${sku} ${period}: ${delta.error} (line ${line})` }); failed = true; continue; }
        fields[f] = delta;
      }
      if (failed) continue;

      // The balance check. Applied to the row AS IT WOULD BE after the edit,
      // not as it is now, so a half-finished correction is caught here rather
      // than after it is written.
      const after = { ...existing };
      for (const [f, d] of Object.entries(fields)) after[f] = d.to;
      const expected = after.opening_qty + after.receipts_qty - after.issues_qty;
      if (Math.abs(expected - after.closing_qty) > 0.05) {
        errors.push({
          line,
          message: `${sku} ${period} does not balance: ${after.opening_qty} + ${after.receipts_qty} - ${after.issues_qty} = ${Math.round(expected * 10) / 10}, but closing is ${after.closing_qty} (line ${line})`,
        });
        continue;
      }

      if (Object.keys(fields).length === 0) { unchanged++; continue; }
      changes.push({ sku_id: sku, period, name: existing.product_name, line, fields, after });
    }

    // Continuity across periods, checked once over the whole file rather than
    // per row: each period's opening must be the previous period's closing.
    // This can only be judged after every edit in the file is known.
    if (!errors.length && changes.length) {
      const merged = new Map(current.map((r) => [`${r.sku_id}|${r.period}`, { ...r }]));
      for (const c of changes) merged.set(`${c.sku_id}|${c.period}`, { ...merged.get(`${c.sku_id}|${c.period}`), ...c.after });
      const bySku = new Map();
      for (const r of merged.values()) {
        if (!bySku.has(r.sku_id)) bySku.set(r.sku_id, []);
        bySku.get(r.sku_id).push(r);
      }
      for (const [sku, rows] of bySku) {
        rows.sort((a, b) => a.period.localeCompare(b.period));
        for (let i = 1; i < rows.length; i++) {
          if (Math.abs(rows[i - 1].closing_qty - rows[i].opening_qty) > 0.05) {
            errors.push({
              line: 0,
              message: `${sku} ${rows[i].period}: opening ${rows[i].opening_qty} does not continue from ${rows[i - 1].period} closing ${rows[i - 1].closing_qty}`,
            });
          }
        }
      }
    }

    // A WARNING, not an error: the newest closing should equal the stock
    // actually on hand, but someone correcting history may legitimately fix
    // the months first and the position afterwards.
    const warnings = [];
    if (changes.length) {
      const newest = db.prepare(`SELECT MAX(period) p FROM inventory_history`).get().p;
      const touched = new Set(changes.filter((c) => c.period === newest).map((c) => c.sku_id));
      for (const sku of touched) {
        const c = changes.find((x) => x.sku_id === sku && x.period === newest);
        const onHand = db.prepare(`SELECT on_hand_qty FROM inventory_positions WHERE sku_id = ?`).get(sku);
        if (onHand && Math.abs(c.after.closing_qty - onHand.on_hand_qty) > 0.05) {
          warnings.push(`${sku}: ${newest} closing would be ${c.after.closing_qty}, but ${onHand.on_hand_qty} is on hand today.`);
        }
      }
    }

    const summary = {
      rows: parsed.rows.length,
      changed: changes.length,
      unchanged,
      errors,
      warnings,
      ignoredColumns: ignored,
      applied: false,
    };

    if (!apply || errors.length || !changes.length) {
      return res.json({ success: true, data: { ...summary, changes } });
    }

    const run = db.transaction(() => {
      for (const c of changes) {
        const set = Object.keys(c.fields).map((f) => `${f} = @${f}`).join(", ");
        const values = Object.fromEntries(Object.entries(c.fields).map(([f, d]) => [f, d.to]));
        db.prepare(`UPDATE inventory_history SET ${set} WHERE sku_id = @sku_id AND period = @period`)
          .run({ ...values, sku_id: c.sku_id, period: c.period });
      }
    });
    run();

    for (const c of changes) {
      logEvent(EVENTS.SKU_UPDATED, {
        skuId: c.sku_id,
        input: {
          source: "history_csv_import",
          period: c.period,
          changed_fields: Object.keys(c.fields),
          changes: Object.fromEntries(Object.entries(c.fields).map(([f, d]) => [f, d])),
        },
        output: { closing_qty: c.after.closing_qty, closing_value_sgd: Math.round(c.after.closing_qty * c.after.unit_cost_sgd) },
      });
    }

    res.json({ success: true, data: { ...summary, changes, applied: true } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Failed to import history" });
  }
});

// ── Sales history onboarding upload (MVP2, step 1) ───────────────────────────
//
// APPEND-only, unlike the history import above: a sale has no natural unique
// key, so there is nothing to diff against. The preview reports what would be
// ADDED, not what would CHANGE — new rows, their date range, a per-SKU
// breakdown, and any unknown SKUs, which are rejected and reported rather than
// silently skipped or auto-created (same rule as the history import's
// knownSku check). This shape is also what makes the import trivially
// replaceable later by a live feed connector appending to the same table: no
// schema change, just a different source for the same rows.
const SALES_KEY = ["sku_id", "quantity_mt", "sale_date"];
const SALES_OPTIONAL = ["customer", "channel", "status"];
const SALES_COLUMNS = [...SALES_KEY, ...SALES_OPTIONAL];
const SALES_STATUSES = ["fulfilled", "lost"];

// GET /api/skus/history/export-sales?days=N — raw sales_transactions rows,
// newest first. Same "download, edit, re-upload" shape as every other export
// here, so onboarding a first dataset and correcting one later are the same
// workflow, not two.
router.get("/skus/history/export-sales", (req, res) => {
  const days = Math.min(1000, Math.max(1, Number(req.query.days) || 180));
  try {
    const db = getDb();
    const since = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
    const rows = db.prepare(`
      SELECT sku_id, quantity_mt, sale_date, customer, channel, status
        FROM sales_transactions
       WHERE sale_date >= ?
       ORDER BY sale_date DESC, sku_id`).all(since);

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition",
      `attachment; filename="stocksense-sales-history-${today()}.csv"`);
    res.send(toCsv(SALES_COLUMNS, rows));
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Failed to export sales history" });
  }
});

// pendingSkus: onboarding's combined "attach sales while reviewing the
// catalog upload" step (Onboarding.jsx). Those SKUs aren't in the table yet
// at PREVIEW time (they're rows in a CSV the user hasn't clicked Apply on),
// so without this every one of them would preview as "not a known SKU".
// {sku_id, product_name} pairs, not bare IDs, so the breakdown below can
// still show a real name instead of a placeholder. Only ever honoured on a
// preview (apply=false): the real insert below always re-checks the live
// table regardless of what this array claims, since by the time sales
// actually apply, the frontend has already applied the catalog for real, and
// pretending a request-supplied ID exists at APPLY time would let a sale
// reference a product that was never actually created.
router.post("/skus/history/import-sales", (req, res) => {
  const { csv, apply = false, pendingSkus = [] } = req.body || {};
  if (typeof csv !== "string" || !csv.trim()) {
    return res.status(400).json({ success: false, message: "No CSV content was received" });
  }

  let parsed;
  try {
    parsed = parseCsv(csv);
  } catch (err) {
    return res.status(400).json({ success: false, message: `Could not read the file: ${err.message}` });
  }
  for (const k of SALES_KEY) {
    if (!parsed.columns.includes(k)) {
      return res.status(400).json({
        success: false,
        message: `The file has no ${k} column, so there is no way to record each sale.`,
      });
    }
  }

  try {
    const db = getDb();
    const skuNames = new Map(
      db.prepare(`SELECT sku_id, product_name FROM skus`).all().map((r) => [r.sku_id, r.product_name])
    );
    if (!apply) {
      for (const p of pendingSkus) {
        if (p?.sku_id && !skuNames.has(p.sku_id)) skuNames.set(p.sku_id, p.product_name || "(new product)");
      }
    }
    const ignored = parsed.columns.filter((c) => !SALES_COLUMNS.includes(c));

    const toInsert = [];
    const errors = [];
    const unknownSkus = new Set();
    const bySku = new Map(); // sku_id -> { name, count, qty_total }

    for (const row of parsed.rows) {
      const line = row.__line;
      const sku = row.sku_id;
      if (!sku) { errors.push({ line, message: `Row ${line} is missing sku_id` }); continue; }
      if (!skuNames.has(sku)) { unknownSkus.add(sku); errors.push({ line, message: `${sku} is not a known SKU (line ${line})` }); continue; }

      const qty = Number(row.quantity_mt);
      if (!Number.isFinite(qty) || qty <= 0) {
        errors.push({ line, message: `${sku}: quantity_mt must be a positive number (line ${line})` });
        continue;
      }

      if (!/^\d{4}-\d{2}-\d{2}$/.test(row.sale_date || "")) {
        errors.push({ line, message: `${sku}: sale_date must look like 2026-04-15 (line ${line})` });
        continue;
      }

      const status = (row.status || "fulfilled").trim();
      if (!SALES_STATUSES.includes(status)) {
        errors.push({ line, message: `${sku}: status must be "fulfilled" or "lost", not "${status}" (line ${line})` });
        continue;
      }

      const record = {
        sku_id: sku,
        quantity_mt: qty,
        sale_date: row.sale_date,
        customer: row.customer || null,
        channel: (row.channel || "direct").trim(),
        status,
      };
      toInsert.push({ line, record });

      const agg = bySku.get(sku) || { sku_id: sku, name: skuNames.get(sku), count: 0, qty_total: 0 };
      agg.count += 1;
      agg.qty_total = Math.round((agg.qty_total + qty) * 10) / 10;
      bySku.set(sku, agg);
    }

    const dates = toInsert.map((r) => r.record.sale_date).sort();

    // Actual rows, not just the aggregated skuBreakdown below - so "300 sales
    // across 3 SKUs" is something you can also SEE, not just take on faith.
    // Earliest and latest 5 by date (not file order, which is whatever the
    // CSV happened to list first) rather than all of them: readable at a
    // glance for the 4-row case and the 4,000-row one alike.
    const byDate = [...toInsert].sort((a, b) => a.record.sale_date.localeCompare(b.record.sale_date));
    const sampleRows = byDate.length <= 10
      ? byDate.map((r) => r.record)
      : [...byDate.slice(0, 5), ...byDate.slice(-5)].map((r) => r.record);

    const summary = {
      rows: parsed.rows.length,
      changed: toInsert.length, // reused for BulkEdit.jsx's shared blocked/apply-button logic
      unchanged: 0,             // append-only: there is no "already matches" case
      errors,
      warnings: [],
      ignoredColumns: ignored,
      unknownSkus: [...unknownSkus],
      dateRange: dates.length ? { from: dates[0], to: dates[dates.length - 1] } : null,
      skuBreakdown: [...bySku.values()].sort((a, b) => b.qty_total - a.qty_total),
      sampleRows,
      sampleRowsTruncated: byDate.length > 10,
      applied: false,
    };

    if (!apply || errors.length || !toInsert.length) {
      return res.json({ success: true, data: summary });
    }

    const insSale = db.prepare(`
      INSERT INTO sales_transactions (sku_id, quantity_mt, sale_date, customer, channel, status)
      VALUES (@sku_id, @quantity_mt, @sale_date, @customer, @channel, @status)`);
    const run = db.transaction(() => {
      for (const { record } of toInsert) insSale.run(record);
    });
    run();

    logEvent(EVENTS.SALES_HISTORY_IMPORTED, {
      input: { row_count: toInsert.length, date_range: summary.dateRange, sku_count: bySku.size },
      output: { inserted: toInsert.length },
    });

    res.json({ success: true, data: { ...summary, applied: true } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Failed to import sales history" });
  }
});

// ── Bulk edit: CSV out, CSV back in (TASK-60) ────────────────────────────────
//
// The workflow this exists for is "export everything, fix fifty rows in a
// spreadsheet, put it back", which is how inventory data is actually corrected
// in the field and which the one-SKU-at-a-time edit modal makes miserable.
//
// Three deliberate decisions:
//
//   1. sku_id is the KEY, and it is never updated. A row whose sku_id matches
//      updates that SKU; one that does not is reported as unknown and skipped.
//      Import cannot create or delete SKUs. "Amend the database completely"
//      means every editable value, not the set of SKUs itself: a typo in a key
//      column should not silently delete a product line.
//   2. Every import is validated in full BEFORE anything is written, and the
//      writes then run in one transaction. A half-applied spreadsheet is the
//      worst outcome available, because nobody can tell which half.
//   3. The preview is the same code path as the apply, with the write skipped.
//      A preview computed by different code than the write is a preview of
//      something else.
const IMPORT_KEY = "sku_id";
const IMPORT_EDITABLE = [...SKU_TABLE_FIELDS, "on_hand_qty", ...POSITION_TABLE_FIELDS];
const IMPORT_COLUMNS = [IMPORT_KEY, ...IMPORT_EDITABLE];

// Read-only context columns. Exported so the spreadsheet is worth looking at on
// its own, and ignored on the way back in, since they are computed.
const EXPORT_CONTEXT = ["available_qty", "health_status", "days_of_cover", "abc_class"];

// A blank template (no SKUs yet) ships one filled-in example row instead of
// bare headers, so a first-time uploader sees realistic values, not columns
// with no sense of what belongs in them. The sku_id carries the "delete me"
// instruction because it is the leftmost, most-read cell in a spreadsheet.
// /skus/import-new below refuses to create a real SKU from it, in case someone
// uploads the template without deleting the row.
//
// Deliberately narrower than IMPORT_COLUMNS below (Stan's call, 18 Sep, after
// the domain expert's own source document turned out to list a much shorter
// "minimum fields" set than requirements.md's REQ-02 had grown into - see
// reference/rice-inventory-technical-spec.md, Step 1): sku_id and
// product_name are the only two the database actually requires, and of
// everything else, lead_time_days/reorder_point_policy/target_stock are the
// three that make the reorder math mean something real rather than resting
// entirely on defaults. Every other column (variety, grade, origin, brand,
// packaging, supplier, costs, min/max stock, safety stock %, MOQ) still
// exists in the schema and is still editable from Inventory or Bulk edit
// afterward - narrower here on purpose, not deleted from the app.
const MINIMAL_TEMPLATE_COLUMNS = ["sku_id", "product_name", "lead_time_days", "reorder_point_policy", "target_stock"];
const EXAMPLE_ROW_SKU_ID = "EXAMPLE-DELETE-ME";
const EXAMPLE_ROW = {
  sku_id: EXAMPLE_ROW_SKU_ID,
  product_name: "Delete this row — Thai Jasmine 25KG shown as an example",
  lead_time_days: 45, reorder_point_policy: 300, target_stock: 500,
};

// Every column either import treats as a non-negative number. The history
// quantities join the set so cellChange validates and compares them the same
// way, including the 1e-9 tolerance that stops a spreadsheet round trip of
// 0.95 into 0.9500000000000001 being reported as an edit.
const NUMERIC_IMPORT_FIELDS = new Set([
  ...NONNEGATIVE_NUMERIC_FIELDS,
  "on_hand_qty",
  "opening_qty", "receipts_qty", "issues_qty", "closing_qty",
]);

// Compare an incoming cell against the stored value. Returns null when nothing
// moved, so an untouched spreadsheet produces an empty change list.
function cellChange(field, raw, current) {
  if (raw === undefined || raw === "") return null;   // blank means "leave alone"
  if (NUMERIC_IMPORT_FIELDS.has(field)) {
    const n = Number(raw);
    if (!Number.isFinite(n)) return { error: `${field} is not a number` };
    if (n < 0) return { error: `${field} must be >= 0` };
    if (field === "target_service_level" && n > 1) return { error: `${field} must be <= 1` };
    // Tolerance, not equality: a spreadsheet round trip turns 0.95 into
    // 0.9500000000000001 often enough that exact comparison would report every
    // untouched row as changed.
    if (Math.abs(n - Number(current ?? 0)) < 1e-9) return null;
    return { from: Number(current ?? 0), to: n };
  }
  const s = String(raw);
  if (s === String(current ?? "")) return null;
  return { from: current ?? "", to: s };
}

// POST /api/skus/import — { csv, apply } → what would change, or what did
router.post("/skus/import", (req, res) => {
  const { csv, apply = false } = req.body || {};
  if (typeof csv !== "string" || !csv.trim()) {
    return res.status(400).json({ success: false, message: "No CSV content was received" });
  }

  let parsed;
  try {
    parsed = parseCsv(csv);
  } catch (err) {
    return res.status(400).json({ success: false, message: `Could not read the file: ${err.message}` });
  }

  if (!parsed.columns.includes(IMPORT_KEY)) {
    return res.status(400).json({
      success: false,
      message: `The file has no ${IMPORT_KEY} column, so there is no way to tell which SKU each row is for.`,
    });
  }

  try {
    const db = getDb();
    const current = db.prepare(`
      SELECT s.*, p.on_hand_qty, p.reserved_qty, p.quality_hold_qty
        FROM skus s
        LEFT JOIN inventory_positions p ON p.sku_id = s.sku_id`).all();
    const bySku = new Map(current.map((r) => [r.sku_id, r]));

    // Columns present in the file that we will edit. A file may legitimately
    // carry fewer columns than the export, and any column we do not recognise
    // (including the computed context ones) is reported and ignored.
    const editable = parsed.columns.filter((c) => IMPORT_EDITABLE.includes(c));
    const ignored = parsed.columns.filter((c) => c !== IMPORT_KEY && !IMPORT_EDITABLE.includes(c));

    const changes = [];   // one entry per row that actually moves
    const errors = [];
    const seen = new Set();
    let unchanged = 0;

    for (const row of parsed.rows) {
      const id = row[IMPORT_KEY];
      const line = row.__line;
      if (!id) { errors.push({ line, message: `Row ${line} has no ${IMPORT_KEY}` }); continue; }
      if (seen.has(id)) { errors.push({ line, message: `${id} appears more than once (line ${line})` }); continue; }
      seen.add(id);

      const existing = bySku.get(id);
      if (!existing) { errors.push({ line, message: `${id} is not a known SKU (line ${line})` }); continue; }

      const fields = {};
      let rowFailed = false;
      for (const field of editable) {
        const delta = cellChange(field, row[field], existing[field]);
        if (!delta) continue;
        if (delta.error) { errors.push({ line, message: `${id}: ${delta.error} (line ${line})` }); rowFailed = true; continue; }
        fields[field] = delta;
      }
      if (rowFailed) continue;
      if (Object.keys(fields).length === 0) { unchanged++; continue; }
      changes.push({ sku_id: id, name: existing.product_name, line, fields });
    }

    const summary = {
      rows: parsed.rows.length,
      changed: changes.length,
      unchanged,
      errors,
      ignoredColumns: ignored,
      applied: false,
    };

    // Refuse to write anything while a single row is wrong. Applying the good
    // rows and listing the bad ones sounds helpful and is not: it leaves the
    // spreadsheet and the database in different states, with no record of which
    // rows made it, which is exactly the situation a bulk edit must avoid.
    if (!apply || errors.length || !changes.length) {
      return res.json({ success: true, data: { ...summary, changes } });
    }

    const run = db.transaction(() => {
      for (const c of changes) {
        const skuSet = Object.keys(c.fields).filter((f) => SKU_TABLE_FIELDS.includes(f));
        const posSet = Object.keys(c.fields).filter((f) => f === "on_hand_qty" || POSITION_TABLE_FIELDS.includes(f));
        const values = Object.fromEntries(Object.entries(c.fields).map(([f, d]) => [f, d.to]));

        if (skuSet.length) {
          db.prepare(`UPDATE skus SET ${skuSet.map((f) => `${f} = @${f}`).join(", ")} WHERE sku_id = @sku_id`)
            .run({ ...values, sku_id: c.sku_id });
        }
        if (posSet.length) {
          db.prepare(`UPDATE inventory_positions SET ${posSet.map((f) => `${f} = @${f}`).join(", ")}, last_updated = datetime('now') WHERE sku_id = @sku_id`)
            .run({ ...values, sku_id: c.sku_id });
        }
      }
    });
    run();

    // One audit event per SKU, same shape the single-SKU edit writes, so the
    // Activity tab reads the same either way and a bulk change is not a blind
    // spot in the trail.
    const { skus: after } = getAnalytics();
    const afterIndex = new Map(after.map((s) => [s.sku_id, s]));
    for (const c of changes) {
      const updated = afterIndex.get(c.sku_id);
      logEvent(EVENTS.SKU_UPDATED, {
        skuId: c.sku_id,
        input: {
          source: "csv_import",
          changed_fields: Object.keys(c.fields),
          changes: Object.fromEntries(Object.entries(c.fields).map(([f, d]) => [f, d])),
        },
        output: updated
          ? { health_status: updated.health_status, reorder_point_suggested: updated.reorder_point_suggested, available_qty: updated.available_qty }
          : null,
      });
    }

    res.json({ success: true, data: { ...summary, changes, applied: true } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Failed to import SKUs" });
  }
});

// ── Forecast (MVP2 Day 3) ─────────────────────────────────────────────────────
const { runForecast, backtest, monthlySeries, getActiveForecast, MODEL_IDS } = require("../engines/forecast");
const { computeSafetyStock } = require("../engines/safetystock");
const { computeRiskBuffer } = require("../engines/riskbuffer");

// GET /api/forecast/models — the shortlist + auto, shaped like GET /api/llm/mode
// so the frontend picker follows the same convention as the explanation tiers.
router.get("/forecast/models", (req, res) => {
  const detail = {
    naive_seasonal: "Same calendar month, averaged across every prior year in the history. No parameters, the floor every other model has to beat.",
    linear_trend: "A straight trend line fit under the seasonal pattern. Easiest to explain in plain English: demand trending up or down by a fixed amount a month.",
    holt_winters: "Trend plus seasonality, weighted toward recent months. The standard method when there is enough history to support it.",
    // Ported from a teammate's branch (Tawmo, feature/demand-forecast-engine) — see forecast.js.
    holt_damped_seasonal: "A damped trend blended evenly with last year's season, so a long-horizon forecast can't run away. Built independently by a teammate; worth comparing against the other three on a given SKU.",
  };
  const models = MODEL_IDS.map((id) => ({ id, label: MODEL_LABEL[id], detail: detail[id], available: true }));
  models.push({
    id: "auto",
    label: "Auto",
    detail: "Backtests every model on this SKU's own history and picks whichever scores lowest error. Deterministic — never a model call.",
    available: true,
  });
  res.json({ success: true, data: { models } });
});
const MODEL_LABEL = {
  naive_seasonal: "Naive seasonal", linear_trend: "Linear trend", holt_winters: "Holt-Winters",
  holt_damped_seasonal: "Holt damped + seasonal",
};

// PUT /api/skus/:id/forecast-config — { forecast_model, use_forecast }
//
// Separate from PUT /api/skus/:id on purpose: picking a model is a distinct,
// smaller action from every other policy edit, and keeping it out of
// SKU_TABLE_FIELDS means forecast_model/use_forecast can never be set as a
// side effect of an unrelated Save.
const FORECAST_MODEL_VALUES = [...MODEL_IDS, "auto", null];
router.put("/skus/:id/forecast-config", (req, res) => {
  const b = req.body || {};
  if (b.forecast_model !== undefined && !FORECAST_MODEL_VALUES.includes(b.forecast_model)) {
    return res.status(400).json({ success: false, message: `forecast_model must be one of ${MODEL_IDS.join(", ")}, auto, or null` });
  }
  try {
    const db = getDb();
    const existing = db.prepare(`SELECT sku_id, forecast_model, use_forecast FROM skus WHERE sku_id = ?`).get(req.params.id);
    if (!existing) return res.status(404).json({ success: false, message: "SKU not found" });

    const fields = {};
    if (b.forecast_model !== undefined) fields.forecast_model = b.forecast_model;
    if (b.use_forecast !== undefined) fields.use_forecast = b.use_forecast ? 1 : 0;
    if (Object.keys(fields).length) {
      const setClause = Object.keys(fields).map((k) => `${k} = @${k}`).join(", ");
      db.prepare(`UPDATE skus SET ${setClause} WHERE sku_id = @sku_id`).run({ ...fields, sku_id: req.params.id });

      logEvent(EVENTS.SKU_UPDATED, {
        skuId: req.params.id,
        input: { source: "forecast_config", changed_fields: Object.keys(fields) },
        output: { forecast_model: fields.forecast_model ?? existing.forecast_model, use_forecast: fields.use_forecast ?? existing.use_forecast },
      });
    }

    const { skus } = getAnalytics();
    res.json({ success: true, data: skus.find((s) => s.sku_id === req.params.id) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Failed to update forecast config" });
  }
});

// POST /api/forecast/recompute — { sku_id? }
//
// Runs for every SKU with a forecast_model set (not gated on use_forecast:
// picking a model is intent to forecast, use_forecast is the separate switch
// that activates it in safetystock.js — see engines/index.js). 'auto' runs
// the real backtest and writes its winner; a pinned model runs without one.
// This is the lazy-cache write side: engines/index.js only ever READS the
// active row here, never recomputes inline (see the MVP2 plan's "Recompute
// mechanism" — no scheduler, no job queue, an explicit trigger instead).
router.post("/forecast/recompute", (req, res) => {
  const { sku_id } = req.body || {};
  try {
    const db = getDb();
    const targets = db.prepare(
      `SELECT sku_id, forecast_model FROM skus WHERE active = 1 AND forecast_model IS NOT NULL${sku_id ? " AND sku_id = ?" : ""}`
    ).all(...(sku_id ? [sku_id] : []));

    if (sku_id && !targets.length) {
      return res.status(404).json({ success: false, message: `${sku_id} has no forecast_model set` });
    }

    const results = [];
    const run = db.transaction(() => {
      for (const t of targets) {
        let model = t.forecast_model;
        let bt = null;
        if (model === "auto") {
          bt = backtest(db, t.sku_id, MODEL_IDS);
          model = bt.winner;
        }
        const f = runForecast(db, t.sku_id, model, 6);

        db.prepare(`UPDATE forecasts SET is_active = 0 WHERE sku_id = ? AND is_active = 1`).run(t.sku_id);
        db.prepare(`
          INSERT INTO forecasts (
            sku_id, model, horizon_months, avg_daily_demand_forecast, demand_cv_forecast,
            monthly_forecast_json, backtest_metric, backtest_score, candidate_scores_json, low_confidence, is_active
          ) VALUES (@sku_id, @model, @horizon_months, @avg_daily_demand_forecast, @demand_cv_forecast,
            @monthly_forecast_json, @backtest_metric, @backtest_score, @candidate_scores_json, @low_confidence, 1)`
        ).run({
          sku_id: t.sku_id, model, horizon_months: f.horizon_months,
          avg_daily_demand_forecast: f.avg_daily_demand_forecast, demand_cv_forecast: f.demand_cv_forecast,
          monthly_forecast_json: JSON.stringify(f.monthly),
          backtest_metric: bt ? bt.metric : null,
          backtest_score: bt ? bt.scores[model] : null,
          candidate_scores_json: bt ? JSON.stringify(bt.scores) : null,
          low_confidence: bt ? (bt.lowConfidence ? 1 : 0) : 0,
        });
        results.push({ sku_id: t.sku_id, model, avg_daily_demand_forecast: f.avg_daily_demand_forecast, backtest: bt });
      }
    });
    run();

    for (const r of results) {
      logEvent(EVENTS.SKU_UPDATED, {
        skuId: r.sku_id,
        input: { source: "forecast_recompute", requested_model: targets.find((t) => t.sku_id === r.sku_id).forecast_model },
        output: { model: r.model, avg_daily_demand_forecast: r.avg_daily_demand_forecast, backtest_winner: r.backtest?.winner || null },
      });
    }

    res.json({ success: true, data: { recomputed: results.length, results } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Failed to recompute forecasts" });
  }
});

// GET /api/skus/:id/forecast — real sales history (always present, possibly
// empty) plus the active forecast row if one has been generated yet. Two
// separate things in one response because the "Why This Forecast" page's
// sales chart needs history even before any model has ever been run.
router.get("/skus/:id/forecast", (req, res) => {
  try {
    const db = getDb();
    const known = db.prepare(`SELECT 1 FROM skus WHERE sku_id = ?`).get(req.params.id);
    if (!known) return res.status(404).json({ success: false, message: "SKU not found" });

    const history = monthlySeries(db, req.params.id);

    const row = db.prepare(`
      SELECT model, generated_at, horizon_months, avg_daily_demand_forecast, demand_cv_forecast,
             monthly_forecast_json, backtest_metric, backtest_score, candidate_scores_json, low_confidence
        FROM forecasts WHERE sku_id = ? AND is_active = 1`).get(req.params.id);

    res.json({
      success: true,
      data: {
        history,
        forecast: !row ? null : {
          model: row.model,
          generated_at: row.generated_at,
          horizon_months: row.horizon_months,
          avg_daily_demand_forecast: row.avg_daily_demand_forecast,
          demand_cv_forecast: row.demand_cv_forecast,
          monthly: JSON.parse(row.monthly_forecast_json),
          backtest_metric: row.backtest_metric,
          backtest_score: row.backtest_score,
          candidate_scores: row.candidate_scores_json ? JSON.parse(row.candidate_scores_json) : null,
          low_confidence: !!row.low_confidence,
        },
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Failed to load forecast" });
  }
});

// GET /api/skus/:id/inventory-history?months=12 — real monthly on-hand
// balance for the position chart's actual line, and the receipts/issues
// split for the inflow/outflow chart. Same inventory_history rows the
// portfolio-wide GET /dashboard/history reads, filtered to one SKU.
router.get("/skus/:id/inventory-history", (req, res) => {
  const months = Math.min(36, Math.max(1, Number(req.query.months) || 12));
  try {
    const db = getDb();
    const known = db.prepare(`SELECT 1 FROM skus WHERE sku_id = ?`).get(req.params.id);
    if (!known) return res.status(404).json({ success: false, message: "SKU not found" });

    const rows = db.prepare(`
      SELECT period, opening_qty, receipts_qty, issues_qty, closing_qty
        FROM inventory_history WHERE sku_id = ? ORDER BY period`).all(req.params.id);

    res.json({ success: true, data: rows.slice(-months) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Failed to load inventory history" });
  }
});

// POST /api/skus/:id/forecast/preview — { lead_time_days, lead_time_std_days,
// target_service_level, target_stock }
//
// The "what if" sandbox's one and only source of truth for the formula:
// re-runs computeSafetyStock() (safetystock.js, King's formula, unmodified)
// and computeRiskBuffer() with hypothetical inputs, against the SKU's real
// active forecast demand. Nothing is written to the database — this is a
// preview, not a save. Requires an active forecast (Recompute first): this
// page's whole premise is "what would forecast-driven policy look like,"
// which has no answer before a forecast exists.
const REVIEW_PERIOD_DAYS = 30; // assumed periodic review cycle; not yet tracked per SKU by this app
router.post("/skus/:id/forecast/preview", (req, res) => {
  const b = req.body || {};
  try {
    const db = getDb();
    const sku = db.prepare(`SELECT * FROM skus WHERE sku_id = ?`).get(req.params.id);
    if (!sku) return res.status(404).json({ success: false, message: "SKU not found" });

    const active = getActiveForecast(db, req.params.id);
    if (!active) {
      return res.status(400).json({ success: false, message: "No forecast yet — run Recompute first." });
    }

    const leadTimeDays = Number(b.lead_time_days ?? sku.lead_time_days);
    const leadTimeStdDays = Number(b.lead_time_std_days ?? sku.lead_time_std_days);
    const targetServiceLevel = Number(b.target_service_level ?? sku.target_service_level);
    const targetStock = Number(b.target_stock ?? sku.target_stock);

    const ss = computeSafetyStock({
      avgDailyDemand: active.avg_daily_demand_forecast,
      demandCv: active.demand_cv_forecast,
      leadTimeDays,
      leadTimeStdDays,
      serviceLevel: targetServiceLevel,
    });
    const risk = computeRiskBuffer(db, sku);
    const risk_buffer_mt = round1(risk.days * active.avg_daily_demand_forecast);
    const reorder_point_suggested_with_risk = round1(ss.reorder_point_suggested + risk_buffer_mt);
    const target_stock_suggested = round1(
      active.avg_daily_demand_forecast * (REVIEW_PERIOD_DAYS + leadTimeDays) + ss.safety_stock_mt
    );

    res.json({
      success: true,
      data: {
        forecast_avg_daily_demand: active.avg_daily_demand_forecast,
        forecast_model: active.model,
        lead_time_demand_mt: ss.lead_time_demand_mt,
        safety_stock_mt: ss.safety_stock_mt,
        risk_buffer_mt,
        risk_buffer_reason: risk.reason,
        reorder_point_suggested_with_risk,
        target_stock_suggested,
        inputs: { leadTimeDays, leadTimeStdDays, targetServiceLevel, targetStock },
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Failed to compute preview" });
  }
});
const round1 = (n) => Math.round(n * 10) / 10;

// POST /api/skus/import-new — CREATE SKUs from a spreadsheet (MVP2 onboarding)
//
// /skus/import above is UPDATE-only by design (sku_id is the key and import
// "cannot create or delete SKUs") — exactly right for correcting an existing
// catalog, and exactly wrong for a first-run upload into an EMPTY one, where
// every row would hit "is not a known SKU" and the whole file would refuse to
// apply. This is the create-shaped counterpart, same 3-step preview/apply
// contract, same field set POST /skus accepts for a single SKU. A sku_id that
// already exists is an error here, not silently skipped or overwritten —
// creating and updating stay two different, explicit actions.
const CREATE_KEY = "sku_id";
const CREATE_REQUIRED = ["sku_id", "product_name"];
const CREATE_TEXT = ["rice_variety", "grade", "country_of_origin", "brand", "packaging_size", "supplier"];
const CREATE_NUMERIC = [
  "min_order_qty", "reorder_point_policy", "min_stock", "target_stock", "max_stock",
  "safety_stock_pct", "lead_time_days", "unit_cost_sgd", "unit_price_sgd",
];
const CREATE_COLUMNS = [...CREATE_REQUIRED.filter((f) => f !== CREATE_KEY), ...CREATE_TEXT, ...CREATE_NUMERIC, CREATE_KEY];

// A blank cell means "use the default", not "use zero" — matching db/init.js's
// own column defaults and POST /skus above. Only these two need a non-zero
// fallback: a 0-day lead time or 0% safety stock feeds straight into
// reorder_point_suggested and reads as GREEN (nothing needed), which is the
// opposite of "not yet configured".
const CREATE_NUMERIC_DEFAULTS = { safety_stock_pct: 20, lead_time_days: 45 };

// Labels for the "assumed" badges the import preview shows per row (Onboarding
// step 1's review screen), one source of truth with CREATE_NUMERIC_DEFAULTS
// above so the number shown to the uploader can never drift from the number
// actually written. Only these two fields get a badge — every other blank
// numeric column defaults to a genuinely unremarkable 0 (see CatalogFields.jsx),
// not a standing assumption worth flagging.
const ASSUMPTION_LABELS = { safety_stock_pct: "20% safety stock", lead_time_days: "45-day lead time" };

router.post("/skus/import-new", (req, res) => {
  const { csv, apply = false } = req.body || {};
  if (typeof csv !== "string" || !csv.trim()) {
    return res.status(400).json({ success: false, message: "No CSV content was received" });
  }

  let parsed;
  try {
    parsed = parseCsv(csv);
  } catch (err) {
    return res.status(400).json({ success: false, message: `Could not read the file: ${err.message}` });
  }
  for (const k of ["sku_id", "product_name"]) {
    if (!parsed.columns.includes(k)) {
      return res.status(400).json({
        success: false,
        message: `The file has no ${k} column, which every new product needs.`,
      });
    }
  }

  try {
    const db = getDb();
    const known = new Set(db.prepare(`SELECT sku_id FROM skus`).all().map((r) => r.sku_id));
    const ignored = parsed.columns.filter((c) => !CREATE_COLUMNS.includes(c));

    const toCreate = [];
    const errors = [];
    const warnings = [];
    const seen = new Set();

    for (const row of parsed.rows) {
      const line = row.__line;
      const id = row.sku_id;
      if (!id) { errors.push({ line, message: `Row ${line} has no sku_id` }); continue; }
      if (id === EXAMPLE_ROW_SKU_ID) { warnings.push(`Line ${line}: the example row was skipped, not added.`); continue; }
      if (seen.has(id)) { errors.push({ line, message: `${id} appears more than once (line ${line})` }); continue; }
      seen.add(id);
      if (known.has(id)) { errors.push({ line, message: `${id} already exists (line ${line}) — use Upload SKUs to edit it instead` }); continue; }
      if (!row.product_name) { errors.push({ line, message: `${id}: product_name is required (line ${line})` }); continue; }

      const record = { sku_id: id, product_name: row.product_name };
      const assumed = [];
      let rowFailed = false;
      for (const f of CREATE_TEXT) record[f] = row[f] || null;
      for (const f of CREATE_NUMERIC) {
        const raw = row[f];
        if (raw === undefined || raw === "") {
          record[f] = CREATE_NUMERIC_DEFAULTS[f] ?? 0;
          if (ASSUMPTION_LABELS[f]) assumed.push(ASSUMPTION_LABELS[f]);
          continue;
        }
        const n = Number(raw);
        if (!Number.isFinite(n) || n < 0) {
          errors.push({ line, message: `${id}: ${f} must be a number >= 0 (line ${line})` });
          rowFailed = true;
          break;
        }
        record[f] = n;
      }
      if (rowFailed) continue;
      toCreate.push({ line, record, assumed });
    }

    const summary = {
      rows: parsed.rows.length,
      changed: toCreate.length, // reused for BulkEdit.jsx/Onboarding.jsx's shared blocked/apply-button logic
      unchanged: 0,
      errors,
      warnings,
      warningBody: "Nothing else needs fixing here; this is just a note about a row that was left out.",
      ignoredColumns: ignored,
      changes: toCreate.map(({ record, assumed }) => ({ sku_id: record.sku_id, name: record.product_name, fields: {}, assumed })),
      applied: false,
    };

    if (!apply || errors.length || !toCreate.length) {
      return res.json({ success: true, data: summary });
    }

    const insertSku = db.prepare(`
      INSERT INTO skus (
        sku_id, product_name, rice_variety, grade, country_of_origin, brand, packaging_size, uom, supplier,
        min_order_qty, reorder_point_policy, min_stock, target_stock, max_stock, safety_stock_pct,
        lead_time_days, unit_cost_sgd, unit_price_sgd, active
      ) VALUES (
        @sku_id, @product_name, @rice_variety, @grade, @country_of_origin, @brand, @packaging_size, 'MT', @supplier,
        @min_order_qty, @reorder_point_policy, @min_stock, @target_stock, @max_stock, @safety_stock_pct,
        @lead_time_days, @unit_cost_sgd, @unit_price_sgd, 1
      )`);
    const insertPos = db.prepare(`
      INSERT INTO inventory_positions (sku_id, on_hand_qty, reserved_qty, quality_hold_qty, last_received_date)
      VALUES (?, 0, 0, 0, ?)`);

    const run = db.transaction(() => {
      for (const { record } of toCreate) { insertSku.run(record); insertPos.run(record.sku_id, today()); }
    });
    run();

    const { skus: after } = getAnalytics();
    const afterIndex = new Map(after.map((s) => [s.sku_id, s]));
    for (const { record } of toCreate) {
      const created = afterIndex.get(record.sku_id);
      logEvent(EVENTS.SKU_CREATED, {
        skuId: record.sku_id,
        input: { source: "csv_import", product_name: record.product_name, supplier: record.supplier },
        output: created
          ? { abc_class: created.abc_class, reorder_point_suggested: created.reorder_point_suggested, health_status: created.health_status }
          : null,
      });
    }

    res.json({ success: true, data: { ...summary, applied: true } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Failed to create SKUs" });
  }
});

// ── Inventory ────────────────────────────────────────────────────────────────
//
// There is deliberately NO stock-writing endpoint here (Reorder Loop step 7,
// "Separate the duties"). This router serves the Control Tower, which reads the
// ledger but never changes what is physically in the building. Stock moves only
// on the warehouse floor, against an expected line, attributed to an operator:
// POST /api/warehouse/inbound/receive and POST /api/warehouse/outbound/pick.
//
// A POST /api/inventory/restock used to live here and added on-hand quantity
// straight from the office, with no purchase order, no operator and no
// variance. It was removed when the duties were separated: the one thing the
// Control Tower may now trigger is a request to the buyer (POST
// /api/order-requests), which records intent and never touches stock.

// ── Order requests (Reorder Loop step 7) ──────────────────────────────────────
// The Control Tower's one write. It records a request to the buyer to order
// more of a SKU; it does NOT change stock. Deliberately in this router (the
// Control Tower API) precisely because it is the office's only permitted write,
// and it touches order_requests, never inventory_positions.

// REQ-0001, sequential, zero padded — the same shape goods_movements uses for
// its GRN/DN numbers, so the two id schemes read alike on the Activity page.
function nextRequestNo(db) {
  const row = db.prepare(`SELECT request_no FROM order_requests ORDER BY id DESC LIMIT 1`).get();
  const n = row ? Number(String(row.request_no).split("-")[1]) + 1 : 1;
  return `REQ-${String(n).padStart(4, "0")}`;
}

// The steps a request can go through, and who does each one. The office raises it; the buyer
// acknowledges it and raises the purchase order; the buyer's manager approves or rejects that
// order. Same shape as the industry flow (requisition, purchase order, approval), kept to the
// steps this app can show honestly. There is no login, so the ACTOR is a role fixed by the step,
// never taken from the request body: a client cannot claim a different role than the step allows.
// Receiving the goods (closing the request from Goods In) is a later step, see the tracker.
const REQUEST_TRANSITIONS = {
  open:         ["acknowledged", "cancelled"],
  acknowledged: ["po_raised", "cancelled"],
  po_raised:    ["approved", "rejected", "cancelled"],
  // approved, rejected and cancelled are final.
};
const REQUEST_ACTORS = {
  acknowledged: "buyer",
  po_raised: "buyer",
  approved: "buyer manager",
  rejected: "buyer manager",
  cancelled: "control tower",
};


// Attach each request's timeline, oldest step first, in one query rather than one per request.
function withEvents(db, rows) {
  if (!rows.length) return rows;
  const ids = rows.map((r) => r.id);
  const events = db.prepare(`
    SELECT request_id, status, actor, note, created_at FROM order_request_events
     WHERE request_id IN (${ids.map(() => "?").join(",")}) ORDER BY id`).all(...ids);
  const byRequest = new Map();
  for (const e of events) {
    if (!byRequest.has(e.request_id)) byRequest.set(e.request_id, []);
    byRequest.get(e.request_id).push(e);
  }
  return rows.map((r) => ({ ...r, events: byRequest.get(r.id) || [] }));
}

// POST /api/order-requests  { sku_id, quantity, reason? }
router.post("/order-requests", sandboxOnlyWhenPublic, (req, res) => {
  const b = req.body || {};
  if (!b.sku_id) return res.status(400).json({ success: false, message: "sku_id is required" });
  const qty = Number(b.quantity);
  if (!Number.isFinite(qty) || qty <= 0) {
    return res.status(400).json({ success: false, message: "quantity must be a positive number" });
  }

  try {
    const db = getDb();
    const sku = db.prepare(`SELECT sku_id, product_name FROM skus WHERE sku_id = ?`).get(b.sku_id);
    if (!sku) return res.status(404).json({ success: false, message: "SKU not found" });

    const requestNo = nextRequestNo(db);
    const reason = String(b.reason || "").trim() || null;
    const requestedBy = String(b.requested_by || "").trim() || "control tower";

    const info = db.prepare(`
      INSERT INTO order_requests (request_no, sku_id, quantity_mt, reason, requested_by)
      VALUES (?, ?, ?, ?, ?)`
    ).run(requestNo, b.sku_id, qty, reason, requestedBy);
    addRequestEvent(db, info.lastInsertRowid, "open", requestedBy, reason);

    const created = db.prepare(`
      SELECT r.*, s.product_name AS sku_name FROM order_requests r
        LEFT JOIN skus s ON s.sku_id = r.sku_id
       WHERE r.id = ?`).get(info.lastInsertRowid);
    created.events = withEvents(db, [created])[0].events;

    // No output stock figures on purpose: this event's whole point is that
    // nothing about the physical position moved. Input carries the ask, output
    // carries only the request identity and status.
    logEvent(EVENTS.ORDER_REQUESTED, {
      skuId: b.sku_id,
      input: { quantity_mt: qty, reason, requested_by: requestedBy },
      output: { request_no: requestNo, status: created.status },
    });

    res.status(201).json({ success: true, data: created });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Failed to raise the order request" });
  }
});

// GET /api/order-requests?sku_id=...&status=open,acknowledged   (each row carries its timeline)
router.get("/order-requests", (req, res) => {
  try {
    const db = getDb();
    const where = [];
    const params = {};
    if (req.query.sku_id) { where.push("r.sku_id = @sku_id"); params.sku_id = req.query.sku_id; }
    if (req.query.status) {
      // One status, or several separated by commas (the card asks for every active one).
      const statuses = String(req.query.status).split(",").map((x) => x.trim()).filter(Boolean);
      where.push(`r.status IN (${statuses.map((_, i) => `@st${i}`).join(",")})`);
      statuses.forEach((x, i) => { params[`st${i}`] = x; });
    }

    const rows = db.prepare(`
      SELECT r.*, s.product_name AS sku_name FROM order_requests r
        LEFT JOIN skus s ON s.sku_id = r.sku_id
       ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
       ORDER BY r.id DESC
       LIMIT 200`).all(params);

    res.json({ success: true, count: rows.length, data: withEvents(db, rows) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Failed to load order requests" });
  }
});

// PATCH /api/order-requests/:id  { status, note? }
//
// Moves a request one step along REQUEST_TRANSITIONS: acknowledged, po_raised, approved or
// rejected (rejecting needs a reason), or cancelled from any step before the end. This still
// changes NO stock: an approved request means a purchase order is approved for the warehouse
// to receive against later, and that receipt (on the floor, by an operator) is the only thing
// that ever moves on_hand_qty. Steps only go forward, the same shape alert acknowledgement
// uses, so a stale tab cannot flip a decided request back: a step the request cannot take
// from where it is returns 409.
router.patch("/order-requests/:id", sandboxOnlyWhenPublic, (req, res) => {
  const id = Number(req.params.id);
  const status = String(req.body?.status || "").trim();
  const note = String(req.body?.note || "").trim() || null;
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ success: false, message: "A valid request id is required" });
  }
  if (!REQUEST_ACTORS[status]) {
    return res.status(400).json({ success: false, message: `status must be one of: ${Object.keys(REQUEST_ACTORS).join(", ")}` });
  }
  if (status === "rejected" && !note) {
    return res.status(400).json({ success: false, message: "A reason is required to reject a request." });
  }

  try {
    const db = getDb();
    const existing = db.prepare(`SELECT * FROM order_requests WHERE id = ?`).get(id);
    if (!existing) return res.status(404).json({ success: false, message: "Order request not found" });
    if (!(REQUEST_TRANSITIONS[existing.status] || []).includes(status)) {
      return res.status(409).json({
        success: false,
        message: `Request ${existing.request_no} is ${existing.status} and cannot move to ${status}.`,
      });
    }

    const actor = REQUEST_ACTORS[status];
    let poNumber = null;
    // The status change, its timeline row and (on approval) the purchase order go in together or not at all.
    db.transaction(() => {
      db.prepare(`UPDATE order_requests SET status = ? WHERE id = ?`).run(status, id);
      addRequestEvent(db, id, status, actor, note);
      if (status === "approved") {
        // The purchase order is created only now, so the warehouse never sees an order nobody approved. It
        // becomes Expected Incoming, and Goods In receiving it is what closes this request (warehouse.js).
        // Stock still does not move here.
        const lead = db.prepare(`SELECT lead_time_days FROM skus WHERE sku_id = ?`).get(existing.sku_id)?.lead_time_days ?? 45;
        const eta = new Date(Date.now() + lead * 86_400_000).toISOString().slice(0, 10);
        poNumber = `PO-${existing.request_no}`;
        db.prepare(`
          INSERT INTO purchase_orders (po_number, sku_id, ordered_qty, order_date, eta, status)
          VALUES (?, ?, ?, date('now'), ?, 'open')`).run(poNumber, existing.sku_id, existing.quantity_mt, eta);
        db.prepare(`UPDATE order_requests SET po_number = ? WHERE id = ?`).run(poNumber, id);
      }
    })();

    const updated = db.prepare(`
      SELECT r.*, s.product_name AS sku_name FROM order_requests r
        LEFT JOIN skus s ON s.sku_id = r.sku_id
       WHERE r.id = ?`).get(id);

    // Again no output stock figures: the whole point of step 7 is that this
    // office action does not move the physical position.
    logEvent(EVENTS.ORDER_REQUEST_UPDATED, {
      skuId: existing.sku_id,
      input: { request_no: existing.request_no, quantity_mt: existing.quantity_mt, from: existing.status, actor, note },
      output: { status, po_number: poNumber },
    });

    res.json({ success: true, data: withEvents(db, [updated])[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Failed to update the order request" });
  }
});

// ── Dashboard ────────────────────────────────────────────────────────────────

// GET /api/dashboard/stats — portfolio KPI roll-up + as-of timestamp
// GET /api/data-version - a cheap fingerprint of "has anything the Control Tower
// shows changed". It exists so a page can ask "is what I loaded still current"
// without recomputing the analytics (the Dashboard endpoints run every engine).
// Five indexed MAX lookups: the audit log and the goods movement book (which
// every stock change writes to), decisions, alerts, and the stock table's own
// last_updated as a catch-all for any path that edits a position without an
// audit row. Opaque to callers: only "same or different" means anything.
router.get("/data-version", (req, res) => {
  try {
    const db = getDb();
    const one = (sql) => db.prepare(sql).get().v;
    const version = [
      one("SELECT COALESCE(MAX(id), 0) AS v FROM audit_log"),
      one("SELECT COALESCE(MAX(id), 0) AS v FROM goods_movements"),
      one("SELECT COALESCE(MAX(id), 0) AS v FROM decisions"),
      one("SELECT COALESCE(MAX(id), 0) AS v FROM alerts_log"),
      one("SELECT COALESCE(MAX(last_updated), '') AS v FROM inventory_positions"),
      one("SELECT COUNT(*) AS v FROM inventory_positions"),
    ].join(":");
    res.json({ success: true, data: { version } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Failed to read data version" });
  }
});

router.get("/dashboard/stats", (req, res) => {
  try {
    const { stats, asOf, primaryExceptions } = getAnalytics();
    res.json({ success: true, data: { ...stats, asOf, primaryExceptions } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Failed to load dashboard stats" });
  }
});

// ── Alerts ───────────────────────────────────────────────────────────────────
// alerts_log persists lifecycle only (open -> acknowledged); alert CONTENT is
// always freshly computed from live inventory state, keyed by dedupe_key
// (sku_id + ':' + alert_type). Once acknowledged, a dedupe_key stays suppressed
// even if the underlying condition still holds — "dismiss" is a one-way step,
// matching the schema's documented lifecycle.

function materializeAlerts(db, alerts) {
  const findLatest = db.prepare(`SELECT id, status FROM alerts_log WHERE dedupe_key = ? ORDER BY id DESC LIMIT 1`);
  const insert = db.prepare(`
    INSERT INTO alerts_log (dedupe_key, sku_id, alert_type, severity, message, recommended_action, triggered_value, threshold_value, status)
    VALUES (@dedupe_key, @sku_id, @alert_type, @severity, @message, @recommended_action, @triggered_value, @threshold_value, 'open')`);

  const out = [];
  for (const a of alerts) {
    const existing = findLatest.get(a.dedupe_key);
    if (existing && existing.status !== "open") continue; // acknowledged/actioned/resolved — stays suppressed
    let id = existing ? existing.id : null;
    if (!existing) {
      const info = insert.run({
        dedupe_key: a.dedupe_key, sku_id: a.sku_id, alert_type: a.alert_type, severity: a.severity,
        message: a.message, recommended_action: a.recommended_action,
        triggered_value: a.triggered_value ?? null, threshold_value: a.threshold_value ?? null,
      });
      id = info.lastInsertRowid;

      // Logged here, on first materialization, not on every GET /api/alerts.
      // The dedupe_key guard above means this branch runs exactly once per
      // alert, which is what makes ALERT_TRIGGERED mean "this condition first
      // became true" rather than "someone loaded the page".
      logEvent(EVENTS.ALERT_TRIGGERED, {
        skuId: a.sku_id,
        input: {
          alert_type: a.alert_type,
          triggered_value: a.triggered_value ?? null,
          threshold_value: a.threshold_value ?? null,
        },
        output: { alert_id: id, severity: a.severity, message: a.message, recommended_action: a.recommended_action },
      });
    }
    out.push({ ...a, id });
  }
  return out;
}

// GET /api/alerts — live alerts, persisted lifecycle applied
router.get("/alerts", (req, res) => {
  try {
    const db = getDb();
    const { alerts } = getAnalytics();
    const data = materializeAlerts(db, alerts);
    res.json({ success: true, count: data.length, data });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Failed to load alerts" });
  }
});

// POST /api/alerts/:id/acknowledge — dismiss (does not delete)
router.post("/alerts/:id/acknowledge", (req, res) => {
  try {
    const db = getDb();
    const before = db.prepare(`SELECT sku_id, alert_type, severity FROM alerts_log WHERE id = ?`).get(req.params.id);
    const info = db.prepare(`UPDATE alerts_log SET status = 'acknowledged', resolved_at = datetime('now') WHERE id = ?`)
      .run(req.params.id);
    if (info.changes === 0) return res.status(404).json({ success: false, message: "Alert not found" });

    logEvent(EVENTS.ALERT_ACKNOWLEDGED, {
      skuId: before ? before.sku_id : null,
      input: { alert_id: Number(req.params.id), alert_type: before ? before.alert_type : null, severity: before ? before.severity : null },
      output: { status: "acknowledged", dismissed_by: "manager" },
    });

    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Failed to acknowledge alert" });
  }
});

// POST /api/alerts/:id/reopen - the undo for a dismissal. Only an acknowledged alert can come back. If its
// condition still holds it reappears in GET /api/alerts; if it has cleared since, it simply does not.
// (A dismissal is otherwise permanent: materializeAlerts keeps any non-open alert suppressed.)
router.post("/alerts/:id/reopen", (req, res) => {
  try {
    const db = getDb();
    const row = db.prepare(`SELECT id, sku_id, alert_type, severity, status FROM alerts_log WHERE id = ?`).get(req.params.id);
    if (!row) return res.status(404).json({ success: false, message: "Alert not found" });
    if (row.status !== "acknowledged") {
      return res.status(409).json({ success: false, message: "Only a dismissed alert can be reopened" });
    }
    db.prepare(`UPDATE alerts_log SET status = 'open', resolved_at = NULL WHERE id = ?`).run(row.id);
    logEvent(EVENTS.ALERT_REOPENED, {
      skuId: row.sku_id,
      input: { alert_id: row.id, alert_type: row.alert_type, severity: row.severity },
      output: { status: "open" },
    });
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Failed to reopen the alert" });
  }
});

// GET /api/alerts/handled - alerts that are not open (dismissed or decided), so History can offer to reopen
// the ones still dismissed. Ids and status only; the events themselves come from the audit log.
router.get("/alerts/handled", (req, res) => {
  try {
    const rows = getDb().prepare(`SELECT id, sku_id, alert_type, status FROM alerts_log WHERE status != 'open'`).all();
    res.json({ success: true, count: rows.length, data: rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Failed to load handled alerts" });
  }
});

// GET /api/alerts/:id/history - what happened to this alert: raised, dismissed or reopened, and the decisions
// recorded on the same product and alert type. Decision events name the product and trigger type, not the
// alert id, so they are matched that way (good enough, not exact: an earlier alert of the same type on the
// same product shares its decisions).
router.get("/alerts/:id/history", (req, res) => {
  try {
    const db = getDb();
    const alert = db.prepare(`SELECT id, sku_id, alert_type FROM alerts_log WHERE id = ?`).get(req.params.id);
    if (!alert) return res.status(404).json({ success: false, message: "Alert not found" });
    const rows = db.prepare(`
      SELECT a.*, s.product_name AS sku_name FROM audit_log a
        LEFT JOIN skus s ON s.sku_id = a.sku_id
       WHERE (a.event_type = 'ALERT_TRIGGERED'    AND json_extract(a.output_data, '$.alert_id') = @id)
          OR (a.event_type IN ('ALERT_ACKNOWLEDGED', 'ALERT_REOPENED') AND json_extract(a.input_data, '$.alert_id') = @id)
          OR (a.event_type = 'DECISION_RECORDED' AND a.sku_id = @sku AND json_extract(a.input_data, '$.trigger_type') = @type)
       ORDER BY a.id`).all({ id: alert.id, sku: alert.sku_id, type: alert.alert_type });
    const parse = (raw) => { try { return raw == null ? null : JSON.parse(raw); } catch { return raw; } };
    res.json({ success: true, count: rows.length, data: rows.map((r) => ({ ...r, input_data: parse(r.input_data), output_data: parse(r.output_data) })) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Failed to load the alert history" });
  }
});

// ── Decisions (TASK-12) ──────────────────────────────────────────────────────
// Manager Approve/Modify/Reject audit trail. Independent of the AI-explanation
// layer (TASK-11, not yet wired) — a manager can decide on the rule-based
// recommended_action alone; this just makes that decision durable.

// GET /api/decisions — full audit log, most recent first. Joined to skus for
// product_name, since `decisions` only stores sku_id (kept lean/normalized).
router.get("/decisions", (req, res) => {
  try {
    const db = getDb();
    const data = db.prepare(`
      SELECT d.*, s.product_name AS sku_name
        FROM decisions d
        LEFT JOIN skus s ON s.sku_id = d.sku_id
       ORDER BY d.decided_at DESC
    `).all();
    res.json({ success: true, count: data.length, data });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Failed to load decisions" });
  }
});

// POST /api/decisions — record a manager decision
router.post("/decisions", (req, res) => {
  const b = req.body || {};
  if (!b.sku_id) return res.status(400).json({ success: false, message: "sku_id is required" });
  if (!["approved", "modified", "rejected"].includes(b.manager_action)) {
    return res.status(400).json({ success: false, message: "manager_action must be approved, modified, or rejected" });
  }

  try {
    const db = getDb();

    // The frontend sends this field as `alert_type` (Alerts.jsx's
    // handleDecision), never `trigger_type` — resolved ONCE here and reused
    // for both the insert and the apply-policy check below, rather than each
    // reading the raw body separately, which is exactly the kind of drift
    // that let a real approval silently apply nothing the first time this
    // was tested through the actual UI instead of a hand-built curl request.
    const triggerType = b.alert_type || b.trigger_type || null;

    // A POLICY_CHANGE_SUGGESTED approval or amendment applies the new
    // reorder_point_policy in the SAME transaction as recording the
    // decision, via the exact function PUT /api/skus/:id uses — so this is
    // one write path with two doors in, not a second one to keep in sync.
    // Reject applies nothing. No new "pending" state on decisions: the
    // suggestion lived as an alert until this moment, exactly like every
    // other alert type's decision.
    const applyPolicy =
      triggerType === "POLICY_CHANGE_SUGGESTED" &&
      b.manager_action !== "rejected" &&
      b.manager_quantity != null;

    // applySkuUpdate is also reachable straight from PUT /api/skus/:id, which
    // validates first — this is the other door in, so it needs the same check
    // rather than trusting manager_quantity as already-safe.
    if (applyPolicy) {
      const numericError = validateNumericFields({ reorder_point_policy: b.manager_quantity });
      if (numericError) return res.status(400).json({ success: false, message: numericError });
    }

    const info = db.transaction(() => {
      const result = db.prepare(`
        INSERT INTO decisions (sku_id, trigger_type, ai_recommendation, ai_quantity, manager_action, manager_quantity, manager_reason, decided_by)
        VALUES (@sku_id, @trigger_type, @ai_recommendation, @ai_quantity, @manager_action, @manager_quantity, @manager_reason, @decided_by)
      `).run({
        sku_id: b.sku_id,
        trigger_type: triggerType,
        ai_recommendation: b.ai_recommendation ?? null,
        ai_quantity: b.ai_quantity ?? null,
        manager_action: b.manager_action,
        manager_quantity: b.manager_quantity ?? null,
        manager_reason: b.manager_reason || null,
        decided_by: b.decided_by || "manager",
      });
      if (applyPolicy) applySkuUpdate(db, b.sku_id, { reorder_point_policy: b.manager_quantity });
      return result;
    })();

    const created = db.prepare(`
      SELECT d.*, s.product_name AS sku_name FROM decisions d
        LEFT JOIN skus s ON s.sku_id = d.sku_id
       WHERE d.id = ?
    `).get(info.lastInsertRowid);

    // The human-in-the-loop event. Input is what the system proposed, output is
    // what the manager did with it, so approve / modify / reject and the delta
    // between the two quantities are both readable straight off the trail.
    logEvent(EVENTS.DECISION_RECORDED, {
      skuId: b.sku_id,
      input: {
        trigger_type: created.trigger_type,
        ai_recommendation: created.ai_recommendation,
        ai_quantity: created.ai_quantity,
      },
      output: {
        decision_id: created.id,
        manager_action: created.manager_action,
        manager_quantity: created.manager_quantity,
        manager_reason: created.manager_reason,
        delta_qty:
          created.ai_quantity != null && created.manager_quantity != null
            ? +(created.manager_quantity - created.ai_quantity).toFixed(2)
            : null,
        policy_applied: applyPolicy ? { reorder_point_policy: b.manager_quantity } : null,
      },
    });

    res.status(201).json({ success: true, data: created });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Failed to record decision" });
  }
});

// ── Audit log (TASK-31) ──────────────────────────────────────────────────────
// Read side of db/audit.js. Every state change in this API writes a row here,
// so this one endpoint answers "what has the system done, and what did a human
// do about it" without reading the database by hand.

// GET /api/audit?event_type=RESTOCK&sku_id=...&limit=200
router.get("/audit", (req, res) => {
  try {
    const events = readEvents({
      eventType: req.query.event_type,
      skuId: req.query.sku_id,
      limit: req.query.limit,
    });
    // `counts` is nested inside `data` deliberately: the frontend client unwraps
    // responses to body.data, so anything at the top level next to it would be
    // dropped before a caller could see it.
    res.json({ success: true, count: events.length, data: { events, counts: eventCounts({ skuId: req.query.sku_id }) } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Failed to load audit log" });
  }
});

// ── AI explanation (TASK-11) ─────────────────────────────────────────────────
// POST /api/alerts/explain  { sku_id, alert_type }
//
// Takes the SKU and alert type rather than an alert id, and re-derives the
// alert from live analytics. Alert CONTENT is always freshly computed (see the
// note above materializeAlerts), so accepting a client-supplied message would
// let a stale tab put outdated figures in front of the model.
//
// Never 500s on a model problem. A missing key, a stopped ollama daemon, a
// rate-limited gateway and a daily cap all return 200 with available:false and
// a reason, because the frontend has a complete deterministic explanation of
// its own to fall back on. The model is an enhancement, not a dependency.
//
// Body: { sku_id, alert_type, tier? }. The tier is the VISITOR's choice
// (TASK-90) and falls back to the server default when absent. The cloud tier
// additionally needs a valid pass from POST /llm/unlock in the X-Demo-Unlock
// header wherever a PIN is required.
router.post("/alerts/explain", async (req, res) => {
  const { sku_id, alert_type } = req.body || {};
  if (!sku_id || !alert_type) {
    return res.status(400).json({ success: false, message: "sku_id and alert_type are required" });
  }
  const tier = resolveTier(req.body?.tier || getDefaultMode());

  // Refused before any analytics work, and with `locked` set so the page can
  // tell "your pass expired, enter the PIN again" apart from "the model is
  // down". Still a 200 with available:false, for the reason given above.
  if (tier === "cloud" && !demoAccess.passValid(req.get("X-Demo-Unlock"))) {
    const gate = demoAccess.gateStatus();
    return res.json({
      success: true,
      data: {
        available: false,
        locked: gate.ok,
        reason: gate.ok ? "Paid explanations are locked. Enter the demo PIN in Settings to unlock them." : gate.reason,
        ...providerInfo(tier),
      },
    });
  }

  try {
    const { skus, alerts } = getAnalytics();
    const sku = skus.find((s) => s.sku_id === sku_id);
    const alert = alerts.find((a) => a.sku_id === sku_id && a.alert_type === alert_type);
    if (!sku || !alert) {
      return res.status(404).json({ success: false, message: "No live alert of that type for this SKU" });
    }

    try {
      const out = await explainAlert(sku, alert, { tier });
      res.json({
        success: true,
        data: {
          available: true,
          explanation: out.text,
          provider: out.provider,
          model: out.model,
          mode: out.mode,
          cached: out.cached,
        },
      });
    } catch (err) {
      if (err instanceof LlmUnavailable) {
        return res.json({ success: true, data: { available: false, reason: err.message, ...providerInfo(tier) } });
      }
      throw err;
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Failed to build explanation" });
  }
});

// Same three-branch decision tree as frontend/src/pages/ActionItems.jsx's own
// blindSpotReason() - kept deliberately duplicated rather than shared, since
// the alternative (a shared module reachable from both a Node backend and a
// Vite frontend bundle) is real infrastructure for three `if` statements. If
// this grows past a handful of branches, unify it; for now the risk of the
// two silently disagreeing is small and worth watching, not worth building
// around yet.
function blindSpotReasonServer(sku) {
  if (!sku.avg_daily_usage_30d) {
    return { whatsMissing: "No sales history yet", why: "Can't project a stockout date without a demand rate to project forward.", fix: "Nothing to do - resolves itself once this product has sold a few times." };
  }
  if (!sku.target_stock) {
    return { whatsMissing: "Target stock was never set (0)", why: "Suggested order quantity is target stock minus projected position - with no target, it can't mean anything.", fix: "Set it on Table" };
  }
  if (!sku.reorder_point_policy) {
    return { whatsMissing: "Reorder point was never set (0)", why: "Figures that compare against the approved reorder point aren't meaningful yet.", fix: "Set it on Table" };
  }
  return null;
}

// POST /api/action-items/explain  { sku_id, kind: "stockout" | "blindspot", tier? }
//
// Same shape as /alerts/explain just above: re-derives everything live from
// analytics rather than trusting anything the client sends about WHY a row
// is on the page, for the same reason - a stale tab must never hand the
// model outdated evidence. See backend/src/llm/explainActionItem.js for the
// explanation pipeline itself.
router.post("/action-items/explain", async (req, res) => {
  const { sku_id, kind } = req.body || {};
  if (!sku_id || !["stockout", "blindspot"].includes(kind)) {
    return res.status(400).json({ success: false, message: "sku_id and a valid kind (stockout or blindspot) are required" });
  }
  const tier = resolveTier(req.body?.tier || getDefaultMode());

  if (tier === "cloud" && !demoAccess.passValid(req.get("X-Demo-Unlock"))) {
    const gate = demoAccess.gateStatus();
    return res.json({
      success: true,
      data: {
        available: false,
        locked: gate.ok,
        reason: gate.ok ? "Paid explanations are locked. Enter the demo PIN in Settings to unlock them." : gate.reason,
        ...providerInfo(tier),
      },
    });
  }

  try {
    const { skus } = getAnalytics();
    const sku = skus.find((s) => s.sku_id === sku_id);
    if (!sku) return res.status(404).json({ success: false, message: "SKU not found" });

    let item;
    if (kind === "stockout") {
      const proj = projectInventory({
        availableQty: sku.available_qty, dailyDemand: sku.avg_daily_usage_30d,
        openPos: sku.open_pos, safetyStockMt: sku.safety_stock_mt,
        reorderPoint: sku.reorder_point_policy, days: 90,
      });
      const daysUntil = (iso) => (iso ? Math.max(0, Math.round((new Date(iso).getTime() - Date.now()) / 86_400_000)) : null);
      const stockoutDays = daysUntil(proj.first_stockout_date);
      const breachDays = daysUntil(proj.first_safety_breach_date);
      const days = stockoutDays != null ? stockoutDays : breachDays;
      if (days == null) {
        return res.status(404).json({ success: false, message: "Nothing projected to run out or breach safety stock for this SKU right now" });
      }
      item = { nearest: { days }, isStockout: stockoutDays != null };
    } else {
      const reason = blindSpotReasonServer(sku);
      if (!reason) return res.status(404).json({ success: false, message: "No blind spot found for this SKU right now" });
      item = { reason };
    }

    try {
      const out = await explainActionItem({ kind, sku, item, tier });
      res.json({
        success: true,
        data: { available: true, explanation: out.text, provider: out.provider, model: out.model, cached: out.cached },
      });
    } catch (err) {
      if (err instanceof LlmUnavailable) {
        return res.json({ success: true, data: { available: false, reason: err.message, ...providerInfo(tier) } });
      }
      throw err;
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Failed to build explanation" });
  }
});

// POST /api/ask-database  { question, tier? }
//
// The tier past Action Items' fixed "Why?" (19 Sep): an open-ended question,
// answered by a model that can call a small set of read-only tools
// (backend/src/llm/tools.js) to fetch facts it wasn't pre-loaded with -
// never raw SQL, never a write. See askDatabase.js for the full reasoning.
// Same never-500-on-a-model-problem contract as /alerts/explain and
// /action-items/explain above.
router.post("/ask-database", async (req, res) => {
  const { question } = req.body || {};
  if (!question || typeof question !== "string" || !question.trim()) {
    return res.status(400).json({ success: false, message: "question is required" });
  }
  const tier = resolveTier(req.body?.tier || getDefaultMode());

  if (tier === "cloud" && !demoAccess.passValid(req.get("X-Demo-Unlock"))) {
    const gate = demoAccess.gateStatus();
    return res.json({
      success: true,
      data: {
        available: false,
        locked: gate.ok,
        reason: gate.ok ? "Paid explanations are locked. Enter the demo PIN in Settings to unlock them." : gate.reason,
        ...providerInfo(tier),
      },
    });
  }

  try {
    const analytics = getAnalytics();
    const out = await askDatabase({ question: question.trim(), db: getDb(), analytics, tier });
    res.json({
      success: true,
      data: { available: true, answer: out.text, provider: out.provider, model: out.model, toolCalls: out.toolCalls },
    });
  } catch (err) {
    if (err instanceof LlmUnavailable) {
      return res.json({ success: true, data: { available: false, reason: err.message, ...providerInfo(tier) } });
    }
    console.error(err);
    res.status(500).json({ success: false, message: "Failed to answer the question" });
  }
});

// ── Model tier (TASK-42) ─────────────────────────────────────────────────────
// Three tiers in increasing order of cost: rules (free, no model), local (free,
// on this machine), cloud (metered, spends shared AWS credit).

//
// Since TASK-90 there is no server-wide tier to switch. Each visitor's choice
// lives in their own browser and travels with each request, because on a
// public URL a global switch let one visitor turn on paid calls for everyone.
// POST /api/llm/mode was removed rather than kept as a no-op, so an old client
// fails loudly instead of believing it changed something.

// GET /api/llm/mode - the server default plus every tier and whether this
// server can offer it. `mode` is only the DEFAULT for visitors with no choice.
router.get("/llm/mode", (req, res) => {
  const gate = { ...demoAccess.gateStatus(), pinRequired: demoAccess.pinRequired() };
  res.json({ success: true, data: { mode: getDefaultMode(), modes: listModes(gate) } });
});

// POST /api/llm/unlock  { pin }
// Exchanges the demo PIN for a two hour pass this browser sends with paid
// requests. Rate limited inside demoAccess, per client and in total.
//
// Audited on success and on lockout, NOT on every wrong guess: a flood of
// guesses must not become a flood of rows, and the lockout is the event a
// person needs to see. The PIN itself is never logged, right or wrong.
router.post("/llm/unlock", (req, res) => {
  const result = demoAccess.tryUnlock(req.ip, req.body?.pin);
  if (result.ok) {
    logEvent(EVENTS.LLM_UNLOCKED, { output: { expires_at: new Date(result.expiresAt).toISOString() } });
    return res.json({ success: true, data: { pass: result.pass, expiresAt: result.expiresAt } });
  }
  if (result.lockedOut) {
    logEvent(EVENTS.LLM_UNLOCK_LOCKED_OUT, { output: { reason: result.reason } });
  }
  res.status(result.status).json({ success: false, message: result.reason });
});

module.exports = router;
