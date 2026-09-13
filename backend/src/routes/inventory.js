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
const { buildAnalytics } = require("../engines/index");
const { explainAlert, providerInfo, LlmUnavailable } = require("../llm/explain");
const { listModes, getMode, setMode } = require("../llm/provider");
const { projectInventory } = require("../engines/projection");
const { toCsv, parseCsv } = require("../db/csv");

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
  "safety_stock_pct", "lead_time_days", "target_service_level", "unit_cost_sgd",
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

    const csv = toCsv([...IMPORT_COLUMNS, ...EXPORT_CONTEXT], merged);
    const stamp = today();
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="stocksense-inventory-${stamp}.csv"`);
    res.send(csv);
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Failed to export SKUs" });
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
  "lead_time_days", "target_service_level", "unit_cost_sgd", "unit_price_sgd",
];
const POSITION_TABLE_FIELDS = ["reserved_qty", "quality_hold_qty"];

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
  const months = Math.min(24, Math.max(1, Number(req.query.months) || 6));
  try {
    const db = getDb();
    const span = db.prepare(`
      SELECT MIN(sale_date) first, MAX(sale_date) last FROM sales_transactions`).get();
    if (!span?.first) return res.json({ success: true, data: { months: [], coverage: null } });

    const rows = db.prepare(`
      SELECT substr(t.sale_date, 1, 7) AS month,
             ROUND(SUM(t.quantity_mt), 1) AS qty_mt,
             ROUND(SUM(t.quantity_mt * s.unit_cost_sgd)) AS value_sgd,
             COUNT(*) AS txns
        FROM sales_transactions t
        JOIN skus s ON s.sku_id = t.sku_id
       WHERE t.status = 'fulfilled'
       GROUP BY month
       ORDER BY month`).all();

    const firstMonth = span.first.slice(0, 7);
    const lastMonth = span.last.slice(0, 7);
    // A month is partial when the data window opens after the 1st or closes
    // before the month is over. Only the two edge months can ever qualify.
    const partialOf = (m) =>
      (m === firstMonth && span.first.slice(8) !== "01") || m === lastMonth;

    const series = rows.slice(-months).map((r) => ({ ...r, partial: partialOf(r.month) }));
    const full = series.filter((r) => !r.partial);
    // The reference line is the mean of the COMPLETE months only. Including a
    // half month would drag it down and make every full month look like an
    // overshoot.
    const average = full.length
      ? Math.round(full.reduce((a, r) => a + r.value_sgd, 0) / full.length)
      : null;

    res.json({
      success: true,
      data: {
        months: series,
        average,
        fullMonths: full.length,
        coverage: { from: span.first, to: span.last },
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Failed to build history" });
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

const NUMERIC_IMPORT_FIELDS = new Set([...NONNEGATIVE_NUMERIC_FIELDS, "on_hand_qty"]);

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

// ── Inventory ────────────────────────────────────────────────────────────────

// POST /api/inventory/restock — add on-hand quantity, reset the receipt clock
router.post("/inventory/restock", (req, res) => {
  const { sku_id, quantity } = req.body || {};
  if (!sku_id) return res.status(400).json({ success: false, message: "sku_id is required" });
  const qty = Number(quantity);
  if (!qty || qty <= 0) return res.status(400).json({ success: false, message: "quantity must be a positive number" });

  try {
    const db = getDb();
    const existing = db.prepare(`SELECT on_hand_qty FROM inventory_positions WHERE sku_id = ?`).get(sku_id);
    if (!existing) return res.status(404).json({ success: false, message: "SKU not found" });

    db.prepare(`
      UPDATE inventory_positions
         SET on_hand_qty = on_hand_qty + ?, last_received_date = ?, last_updated = datetime('now')
       WHERE sku_id = ?`
    ).run(qty, today(), sku_id);

    const { skus } = getAnalytics();
    const after = skus.find((s) => s.sku_id === sku_id);

    logEvent(EVENTS.RESTOCK, {
      skuId: sku_id,
      input: { quantity_mt: qty, on_hand_before: existing.on_hand_qty, received_date: today() },
      output: after
        ? { on_hand_after: existing.on_hand_qty + qty, available_qty: after.available_qty, health_status: after.health_status }
        : null,
    });

    res.json({ success: true, data: after });
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
    res.json({ success: true, count: events.length, data: { events, counts: eventCounts() } });
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
router.post("/alerts/explain", async (req, res) => {
  const { sku_id, alert_type } = req.body || {};
  if (!sku_id || !alert_type) {
    return res.status(400).json({ success: false, message: "sku_id and alert_type are required" });
  }
  try {
    const { skus, alerts } = getAnalytics();
    const sku = skus.find((s) => s.sku_id === sku_id);
    const alert = alerts.find((a) => a.sku_id === sku_id && a.alert_type === alert_type);
    if (!sku || !alert) {
      return res.status(404).json({ success: false, message: "No live alert of that type for this SKU" });
    }

    try {
      const out = await explainAlert(sku, alert);
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
        return res.json({ success: true, data: { available: false, reason: err.message, ...providerInfo() } });
      }
      throw err;
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Failed to build explanation" });
  }
});

// ── Model tier (TASK-42) ─────────────────────────────────────────────────────
// Three tiers in increasing order of cost: rules (free, no model), local (free,
// on this machine), cloud (metered, spends shared AWS credit).

// GET /api/llm/mode - current tier plus what is available to switch to
router.get("/llm/mode", (req, res) => {
  res.json({ success: true, data: { mode: getMode(), modes: listModes() } });
});

// POST /api/llm/mode  { mode }
// The only way into the metered tier. Refuses when credentials are absent
// rather than switching into a state that then fails on first use.
router.post("/llm/mode", (req, res) => {
  try {
    const previous = getMode();
    const mode = setMode(req.body?.mode);

    // Entering or leaving the paid tier is a spending decision, so it belongs
    // in the same trail as every other decision the app records.
    if (mode !== previous) {
      logEvent(EVENTS.LLM_MODE_CHANGED, {
        input: { from: previous, to: mode },
        output: { metered: mode === "cloud", ...providerInfo() },
      });
    }
    res.json({ success: true, data: { mode, modes: listModes() } });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

module.exports = router;
