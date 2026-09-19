// ─────────────────────────────────────────────────────────────────────────────
// WAREHOUSE FLOOR ROUTES (TASK-46)
//
// The handheld side of the app: goods receipt (inbound) and goods issue
// (outbound). Distinct from routes/inventory.js, which serves the Control
// Tower, because the two have opposite shapes. The Control Tower answers
// "what should we do about this SKU"; the floor answers "this pallet is in
// front of me right now, what do I press".
//
// Two rules shape everything here.
//
// 1. Movements happen AGAINST an expected line, never free-form. A receipt
//    quotes a purchase order, an issue quotes a sales order, and the gap
//    between expected and actual is a variance somebody has to explain. That
//    is how a warehouse actually works, and it is what makes
//    expected_incoming_qty and reserved_qty mean something rather than drift.
//
// 2. Every movement is attributed. Quantity changes are the most consequential
//    writes in the system, so operator, timestamp and variance reason are
//    recorded on the movement row AND in the audit trail.
// ─────────────────────────────────────────────────────────────────────────────

const express = require("express");
const router = express.Router();
const { getDb, isInDemoContext } = require("../db/init");
const { EVENTS, logEvent } = require("../db/audit");
const { buildAnalytics } = require("../engines/index");

const nowIso = () => new Date().toISOString().replace("T", " ").slice(0, 19);

// GRN-0001 / DN-0001. Sequential per type, zero padded, which is what appears
// on the paperwork a driver signs.
function nextMovementNo(db, type) {
  const prefix = type === "RECEIPT" ? "GRN" : "DN";
  const row = db.prepare(
    `SELECT movement_no FROM goods_movements WHERE movement_type = ? ORDER BY id DESC LIMIT 1`
  ).get(type);
  const n = row ? Number(String(row.movement_no).split("-")[1]) + 1 : 1;
  return `${prefix}-${String(n).padStart(4, "0")}`;
}

// On a public deployment the handheld's login PINs are printed on the login
// screen and any visitor can use them, so an unguarded receive or pick would let a
// judge change the one real database every other judge is looking at, with nothing
// but a manual reseed to undo it. In production these two writes are therefore
// accepted only inside the demo sandbox. Reads stay open, and so does a development
// machine. ALLOW_LIVE_WAREHOUSE_WRITES=1 lifts it for the owner's own recording
// session on the live data. `needs_demo` lets the handheld offer to join the
// sandbox instead of showing a dead end.
function sandboxOnlyWhenPublic(req, res, next) {
  const isPublic = process.env.NODE_ENV === "production" && process.env.ALLOW_LIVE_WAREHOUSE_WRITES !== "1";
  if (isPublic && !isInDemoContext()) {
    return res.status(403).json({
      success: false,
      needs_demo: true,
      message: "Stock movements on this server are recorded in the demo sandbox only, so they cannot disturb the shared data. Join the demo to continue.",
    });
  }
  next();
}

// ── Authentication ───────────────────────────────────────────────────────────

// POST /api/warehouse/login  { pin }
// A shared device with a per person PIN. Deliberately not a session or a token:
// the operator id is passed back on each movement, which is the attribution the
// audit trail needs. A real deployment needs a session, device enrolment and
// hashed PINs; see the note in db/init.js.
router.post("/warehouse/login", (req, res) => {
  const pin = String(req.body?.pin || "").trim();
  if (!/^\d{4}$/.test(pin)) {
    return res.status(400).json({ success: false, message: "Enter a 4 digit PIN" });
  }
  const op = getDb().prepare(`SELECT id, name, role FROM operators WHERE pin = ? AND active = 1`).get(pin);
  if (!op) return res.status(401).json({ success: false, message: "PIN not recognised" });
  res.json({ success: true, data: op });
});

// GET /api/warehouse/operators - demo affordance only. The login screen prints
// the PINs so a judge can tap straight in, which is why this exists and why it
// must never exist in a real build.
router.get("/warehouse/operators", (req, res) => {
  const rows = getDb().prepare(`SELECT id, name, pin, role FROM operators WHERE active = 1 ORDER BY id`).all();
  res.json({ success: true, data: rows });
});

// ── Inbound: goods receipt ───────────────────────────────────────────────────

// GET /api/warehouse/inbound - open purchase orders, newest ETA first, with
// enough SKU context for the operator to confirm they have the right pallet.
router.get("/warehouse/inbound", (req, res) => {
  try {
    const rows = getDb().prepare(`
      SELECT po.po_number, po.sku_id, po.ordered_qty, po.eta, po.order_date,
             s.product_name, s.rice_variety, s.packaging_size, s.supplier, s.country_of_origin,
             p.on_hand_qty
        FROM purchase_orders po
        JOIN skus s ON s.sku_id = po.sku_id
        LEFT JOIN inventory_positions p ON p.sku_id = po.sku_id
       WHERE po.status = 'open'
       ORDER BY po.eta ASC
    `).all();
    res.json({ success: true, count: rows.length, data: rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Failed to load expected deliveries" });
  }
});

// POST /api/warehouse/inbound/receive
//   { po_number, received_qty, operator_id, variance_reason? }
//
// Over and under receipt are both allowed, because both happen: a short
// container and an over-shipped pallet are facts, not input errors. What the
// system insists on is that a variance is explained.
router.post("/warehouse/inbound/receive", sandboxOnlyWhenPublic, (req, res) => {
  const { po_number, received_qty, operator_id, variance_reason } = req.body || {};
  const qty = Number(received_qty);

  if (!po_number) return res.status(400).json({ success: false, message: "po_number is required" });
  if (!Number.isFinite(qty) || qty < 0) {
    return res.status(400).json({ success: false, message: "received_qty must be a number of 0 or more" });
  }

  try {
    const db = getDb();
    const po = db.prepare(`SELECT * FROM purchase_orders WHERE po_number = ? AND status = 'open'`).get(po_number);
    if (!po) return res.status(404).json({ success: false, message: `No open delivery ${po_number}` });

    const op = db.prepare(`SELECT id, name FROM operators WHERE id = ? AND active = 1`).get(operator_id);
    if (!op) return res.status(401).json({ success: false, message: "Sign in before confirming a receipt" });

    const variance = +(qty - po.ordered_qty).toFixed(2);
    if (variance !== 0 && !String(variance_reason || "").trim()) {
      return res.status(400).json({
        success: false,
        message: `Received quantity differs from the expected ${po.ordered_qty} MT. A reason is required.`,
        needs_reason: true,
        variance,
      });
    }

    const before = db.prepare(`SELECT on_hand_qty FROM inventory_positions WHERE sku_id = ?`).get(po.sku_id);
    if (!before) return res.status(404).json({ success: false, message: "SKU has no inventory position" });

    const movementNo = nextMovementNo(db, "RECEIPT");
    const today = new Date().toISOString().slice(0, 10);

    // One transaction: stock, the purchase order and the movement record move
    // together or not at all. A receipt that raised stock without closing its PO
    // would leave the quantity counted twice, once on hand and once as expected
    // incoming.
    db.transaction(() => {
      db.prepare(`
        UPDATE inventory_positions
           SET on_hand_qty = on_hand_qty + ?, last_received_date = ?, last_updated = datetime('now')
         WHERE sku_id = ?`).run(qty, today, po.sku_id);

      db.prepare(`UPDATE purchase_orders SET status = 'received', actual_arrival = ? WHERE po_number = ?`)
        .run(today, po_number);

      db.prepare(`
        INSERT INTO goods_movements
          (movement_no, movement_type, reference, sku_id, expected_qty, actual_qty, variance_qty, variance_reason, operator_id, operator_name)
        VALUES (?, 'RECEIPT', ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(movementNo, po_number, po.sku_id, po.ordered_qty, qty, variance, variance_reason || null, op.id, op.name);
    })();

    const { skus } = buildAnalytics(db);
    const after = skus.find((s) => s.sku_id === po.sku_id);

    logEvent(EVENTS.GOODS_RECEIVED, {
      skuId: po.sku_id,
      input: {
        po_number, expected_qty: po.ordered_qty, received_qty: qty,
        variance_qty: variance, variance_reason: variance_reason || null,
        operator: op.name, at: nowIso(),
      },
      output: {
        movement_no: movementNo,
        on_hand_before: before.on_hand_qty,
        on_hand_after: before.on_hand_qty + qty,
        available_qty: after ? after.available_qty : null,
        health_status: after ? after.health_status : null,
      },
    });

    res.status(201).json({
      success: true,
      data: {
        movement_no: movementNo,
        sku_id: po.sku_id,
        product_name: after ? after.product_name : po.sku_id,
        expected_qty: po.ordered_qty,
        received_qty: qty,
        variance_qty: variance,
        on_hand_before: before.on_hand_qty,
        on_hand_after: before.on_hand_qty + qty,
        available_qty: after ? after.available_qty : null,
        health_status: after ? after.health_status : null,
        operator: op.name,
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Failed to record the receipt" });
  }
});

// ── Outbound: goods issue ────────────────────────────────────────────────────

// GET /api/warehouse/outbound - open sales orders with a live availability
// check, so the operator sees before they walk whether the stock is there.
router.get("/warehouse/outbound", (req, res) => {
  try {
    const db = getDb();
    const { skus } = buildAnalytics(db);
    const rows = db.prepare(`
      SELECT so.so_number, so.sku_id, so.customer, so.ordered_qty, so.required_date,
             s.product_name, s.packaging_size
        FROM sales_orders so
        JOIN skus s ON s.sku_id = so.sku_id
       WHERE so.status = 'open'
       ORDER BY so.required_date ASC
    `).all();

    const data = rows.map((r) => {
      const sku = skus.find((s) => s.sku_id === r.sku_id);
      const available = sku ? sku.available_qty : 0;
      return {
        ...r,
        available_qty: available,
        on_hand_qty: sku ? sku.on_hand_qty : null,
        // Available already excludes reserved stock, and this order's own
        // quantity is part of that reservation, so it is added back to answer
        // the only question that matters on the floor: can I pick THIS order.
        can_fulfil: available + r.ordered_qty >= r.ordered_qty && (sku ? sku.on_hand_qty >= r.ordered_qty : false),
      };
    });
    res.json({ success: true, count: data.length, data });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Failed to load pick list" });
  }
});

// POST /api/warehouse/outbound/pick
//   { so_number, picked_qty, operator_id, short_reason? }
//
// The asymmetry with receiving: you cannot ship stock that is not there, so an
// over pick is refused outright rather than recorded as a variance. A short
// pick is allowed but must be explained.
router.post("/warehouse/outbound/pick", sandboxOnlyWhenPublic, (req, res) => {
  const { so_number, picked_qty, operator_id, short_reason } = req.body || {};
  const qty = Number(picked_qty);

  if (!so_number) return res.status(400).json({ success: false, message: "so_number is required" });
  if (!Number.isFinite(qty) || qty <= 0) {
    return res.status(400).json({ success: false, message: "picked_qty must be a positive number" });
  }

  try {
    const db = getDb();
    const so = db.prepare(`SELECT * FROM sales_orders WHERE so_number = ? AND status = 'open'`).get(so_number);
    if (!so) return res.status(404).json({ success: false, message: `No open order ${so_number}` });

    const op = db.prepare(`SELECT id, name FROM operators WHERE id = ? AND active = 1`).get(operator_id);
    if (!op) return res.status(401).json({ success: false, message: "Sign in before confirming a pick" });

    const pos = db.prepare(`SELECT on_hand_qty, reserved_qty FROM inventory_positions WHERE sku_id = ?`).get(so.sku_id);
    if (!pos) return res.status(404).json({ success: false, message: "SKU has no inventory position" });

    if (qty > so.ordered_qty) {
      return res.status(400).json({
        success: false,
        message: `Cannot pick more than the ${so.ordered_qty} MT ordered on ${so_number}.`,
      });
    }
    if (qty > pos.on_hand_qty) {
      return res.status(400).json({
        success: false,
        message: `Only ${pos.on_hand_qty} MT is physically on hand. You cannot ship what is not there.`,
      });
    }

    const shortBy = +(so.ordered_qty - qty).toFixed(2);
    if (shortBy > 0 && !String(short_reason || "").trim()) {
      return res.status(400).json({
        success: false,
        message: `Short pick of ${shortBy} MT against ${so.ordered_qty} MT ordered. A reason is required.`,
        needs_reason: true,
        variance: -shortBy,
      });
    }

    const movementNo = nextMovementNo(db, "ISSUE");

    // Reserved falls with on hand. Shipping the stock without releasing the
    // reservation would leave the SKU permanently reserving tonnes that have
    // already left the building, and available_qty would never recover.
    db.transaction(() => {
      db.prepare(`
        UPDATE inventory_positions
           SET on_hand_qty = on_hand_qty - ?,
               reserved_qty = MAX(0, reserved_qty - ?),
               last_updated = datetime('now')
         WHERE sku_id = ?`).run(qty, so.ordered_qty, so.sku_id);

      db.prepare(`
        UPDATE sales_orders
           SET status = 'picked', picked_qty = ?, picked_by = ?, picked_at = datetime('now')
         WHERE so_number = ?`).run(qty, op.name, so_number);

      db.prepare(`
        INSERT INTO goods_movements
          (movement_no, movement_type, reference, sku_id, expected_qty, actual_qty, variance_qty, variance_reason, operator_id, operator_name)
        VALUES (?, 'ISSUE', ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(movementNo, so_number, so.sku_id, so.ordered_qty, qty, -shortBy, short_reason || null, op.id, op.name);
    })();

    const { skus } = buildAnalytics(db);
    const after = skus.find((s) => s.sku_id === so.sku_id);

    logEvent(EVENTS.GOODS_ISSUED, {
      skuId: so.sku_id,
      input: {
        so_number, customer: so.customer, ordered_qty: so.ordered_qty, picked_qty: qty,
        short_by: shortBy, short_reason: short_reason || null, operator: op.name, at: nowIso(),
      },
      output: {
        movement_no: movementNo,
        on_hand_before: pos.on_hand_qty,
        on_hand_after: pos.on_hand_qty - qty,
        reserved_before: pos.reserved_qty,
        available_qty: after ? after.available_qty : null,
        health_status: after ? after.health_status : null,
      },
    });

    res.status(201).json({
      success: true,
      data: {
        movement_no: movementNo,
        sku_id: so.sku_id,
        product_name: after ? after.product_name : so.sku_id,
        customer: so.customer,
        ordered_qty: so.ordered_qty,
        picked_qty: qty,
        short_by: shortBy,
        on_hand_before: pos.on_hand_qty,
        on_hand_after: pos.on_hand_qty - qty,
        available_qty: after ? after.available_qty : null,
        health_status: after ? after.health_status : null,
        operator: op.name,
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Failed to record the pick" });
  }
});

// GET /api/warehouse/movements - the GRN and DN book, newest first.
router.get("/warehouse/movements", (req, res) => {
  try {
    const rows = getDb().prepare(`
      SELECT m.*, s.product_name
        FROM goods_movements m
        LEFT JOIN skus s ON s.sku_id = m.sku_id
       ORDER BY m.id DESC
       LIMIT 100
    `).all();
    res.json({ success: true, count: rows.length, data: rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Failed to load movements" });
  }
});

module.exports = router;
