// ─────────────────────────────────────────────────────────────────────────────
// INVENTORY POSITION ENGINE
//   available_qty      = on_hand - reserved - quality_hold
//   expected_incoming_qty = Σ open purchase-order qty     (glossary #15)
//   inventory_position  = available + expected_incoming    (glossary #18; no
//                         backorders/unreserved-outstanding-demand in MVP1)
// Also surfaces the nearest inbound ETA so risk logic can tell whether an open
// PO already covers a projected stockout.
// ─────────────────────────────────────────────────────────────────────────────

const DAY_MS = 86_400_000;

function computePosition(db, skuId, asOf = Date.now()) {
  const now = asOf instanceof Date ? asOf.getTime() : asOf;

  const pos = db
    .prepare(
      `SELECT on_hand_qty, reserved_qty, quality_hold_qty, last_received_date
         FROM inventory_positions WHERE sku_id = ?`
    )
    .get(skuId) || { on_hand_qty: 0, reserved_qty: 0, quality_hold_qty: 0, last_received_date: null };

  const openPos = db
    .prepare(
      `SELECT ordered_qty, eta FROM purchase_orders
        WHERE sku_id = ? AND status = 'open'`
    )
    .all(skuId);

  const onHand = round(pos.on_hand_qty);
  const reserved = round(pos.reserved_qty);
  const qualityHold = round(pos.quality_hold_qty);
  const available = round(onHand - reserved - qualityHold);
  const expectedIncoming = round(openPos.reduce((s, p) => s + p.ordered_qty, 0));

  const etas = openPos
    .filter((p) => p.eta)
    .map((p) => Math.ceil((new Date(p.eta).getTime() - now) / DAY_MS))
    .filter((d) => Number.isFinite(d))
    .sort((a, b) => a - b);
  const incoming_eta_days = etas.length ? Math.max(etas[0], 0) : null;

  const inventory_age_days = pos.last_received_date
    ? Math.floor((now - new Date(pos.last_received_date).getTime()) / DAY_MS)
    : null;

  return {
    on_hand_qty: onHand,
    reserved_qty: reserved,
    quality_hold_qty: qualityHold,
    available_qty: available,
    expected_incoming_qty: expectedIncoming,
    inventory_position: round(available + expectedIncoming),
    incoming_eta_days,
    last_received_date: pos.last_received_date,
    inventory_age_days,
    open_po_count: openPos.length,
    open_pos: openPos, // raw {ordered_qty, eta} rows — reused by the projection engine (TASK-07)
  };
}

const round = (n) => Math.round(n * 100) / 100;

module.exports = { computePosition };
