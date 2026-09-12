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
const { buildAnalytics } = require("../engines/index");
const { projectInventory } = require("../engines/projection");

const today = () => new Date().toISOString().slice(0, 10);

function getAnalytics() {
  return buildAnalytics(getDb());
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
      dailyDemand: sku.blended_daily_usage,
      openPos: sku.open_pos,
      safetyStockMt: sku.safety_stock_mt,
      reorderPoint: sku.reorder_point_suggested,
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
    res.status(201).json({ success: true, data: skus.find((s) => s.sku_id === b.sku_id) });
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
  "lead_time_days", "target_service_level", "unit_cost_sgd", "unit_price_sgd",
];
const POSITION_TABLE_FIELDS = ["reserved_qty", "quality_hold_qty"];

router.put("/skus/:id", (req, res) => {
  const b = req.body || {};
  try {
    const db = getDb();
    const existing = db.prepare(`SELECT 1 FROM skus WHERE sku_id = ?`).get(req.params.id);
    if (!existing) return res.status(404).json({ success: false, message: "SKU not found" });

    const skuUpdates = SKU_TABLE_FIELDS.filter((k) => b[k] !== undefined);
    const posUpdates = POSITION_TABLE_FIELDS.filter((k) => b[k] !== undefined);

    const run = db.transaction(() => {
      if (skuUpdates.length) {
        const setClause = skuUpdates.map((k) => `${k} = @${k}`).join(", ");
        db.prepare(`UPDATE skus SET ${setClause} WHERE sku_id = @sku_id`).run({ ...b, sku_id: req.params.id });
      }
      if (posUpdates.length) {
        const setClause = posUpdates.map((k) => `${k} = @${k}`).join(", ");
        db.prepare(`UPDATE inventory_positions SET ${setClause} WHERE sku_id = @sku_id`).run({ ...b, sku_id: req.params.id });
      }
    });
    run();

    const { skus } = getAnalytics();
    res.json({ success: true, data: skus.find((s) => s.sku_id === req.params.id) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Failed to update SKU" });
  }
});

// ── Inventory ────────────────────────────────────────────────────────────────

// POST /api/inventory/restock — add on-hand quantity, reset the receipt clock
router.post("/inventory/restock", (req, res) => {
  const { sku_id, quantity } = req.body || {};
  if (!sku_id) return res.status(400).json({ success: false, message: "sku_id is required" });
  const qty = Number(quantity);
  if (!qty || qty <= 0) return res.status(400).json({ success: false, message: "quantity must be a positive number" });

  try {
    const db = getDb();
    const existing = db.prepare(`SELECT 1 FROM inventory_positions WHERE sku_id = ?`).get(sku_id);
    if (!existing) return res.status(404).json({ success: false, message: "SKU not found" });

    db.prepare(`
      UPDATE inventory_positions
         SET on_hand_qty = on_hand_qty + ?, last_received_date = ?, last_updated = datetime('now')
       WHERE sku_id = ?`
    ).run(qty, today(), sku_id);

    const { skus } = getAnalytics();
    res.json({ success: true, data: skus.find((s) => s.sku_id === sku_id) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Failed to restock SKU" });
  }
});

// ── Dashboard ────────────────────────────────────────────────────────────────

// GET /api/dashboard/stats — portfolio KPI roll-up + as-of timestamp
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
    const info = db.prepare(`UPDATE alerts_log SET status = 'acknowledged', resolved_at = datetime('now') WHERE id = ?`)
      .run(req.params.id);
    if (info.changes === 0) return res.status(404).json({ success: false, message: "Alert not found" });
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Failed to acknowledge alert" });
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
    const info = db.prepare(`
      INSERT INTO decisions (sku_id, trigger_type, ai_recommendation, ai_quantity, manager_action, manager_quantity, manager_reason, decided_by)
      VALUES (@sku_id, @trigger_type, @ai_recommendation, @ai_quantity, @manager_action, @manager_quantity, @manager_reason, @decided_by)
    `).run({
      sku_id: b.sku_id,
      trigger_type: b.alert_type || b.trigger_type || null,
      ai_recommendation: b.ai_recommendation ?? null,
      ai_quantity: b.ai_quantity ?? null,
      manager_action: b.manager_action,
      manager_quantity: b.manager_quantity ?? null,
      manager_reason: b.manager_reason || null,
      decided_by: b.decided_by || "manager",
    });

    const created = db.prepare(`
      SELECT d.*, s.product_name AS sku_name FROM decisions d
        LEFT JOIN skus s ON s.sku_id = d.sku_id
       WHERE d.id = ?
    `).get(info.lastInsertRowid);
    res.status(201).json({ success: true, data: created });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Failed to record decision" });
  }
});

module.exports = router;
