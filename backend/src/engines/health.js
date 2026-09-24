// ─────────────────────────────────────────────────────────────────────────────
// INVENTORY HEALTH ENGINE  (RED / ORANGE / YELLOW / GREEN)
// Evaluated in order — first match wins. This is the canonical rule set — the
// frontend mock (analytics.js) must implement the same rules; see
// .kiro/specs/mvp1-inventory-visibility/reference/terminology-map.md item 1.
//
//   RED    days_of_cover < lead_time                       (stockout before resupply)
//          OR inventory_age > max_holding_days              (past holding limit)
//          OR movement_class = Idle AND available_qty > 0   (idle stock on hand is a risk, not a pass)
//   ORANGE days_of_cover < lead_time + safety_stock_days + risk_buffer_days  (inside the buffer)
//          OR on_hand_qty > max_stock                       (overstock)
//   YELLOW movement_class = 'Slow Moving'
//          OR days_of_cover > target_days_of_cover          (drifting high)
//   GREEN  otherwise
//
// covered_by_po softens a projected stockout that an inbound PO already closes.
//
// Reorder Loop step 9 wires step 8 into the classification: risk_buffer_days is
// the temporary buffer a live market signal adds at a SKU's origin/supplier
// (riskbuffer.js), the same term that produces reorder_point_suggested_with_risk
// in engines/index.js. Adding it to the ORANGE threshold is what makes "as the
// reorder point shifts, classify" true for the risk layer too, not only the
// King's-formula safety stock: a SKU sitting inside the risk-widened buffer now
// flags ORANGE rather than reading GREEN until the base buffer alone is
// breached. It stays a SEPARATE, visible addend (never folded into the King's
// formula variance math), so with no active signal risk_buffer_days is 0 and
// health is byte-identical to before. covered_by_po still softens both bands:
// an inbound PO that already closes the gap is not re-flagged by the buffer.
// ─────────────────────────────────────────────────────────────────────────────

function computeHealth(s) {
  const dos = s.days_of_cover;
  const ltSafety = s.lead_time_days + (s.safety_stock_days || 0) + (s.risk_buffer_days || 0);

  // RED
  if (dos != null && dos < s.lead_time_days && !s.covered_by_po) return "RED";
  if (s.inventory_age_days != null && s.inventory_age_days > s.max_holding_days) return "RED";
  if (s.movement_class === "Idle" && s.available_qty > 0) return "RED";

  // ORANGE
  if (dos != null && dos < ltSafety && !s.covered_by_po) return "ORANGE";
  if (s.on_hand_qty > s.max_stock) return "ORANGE";

  // YELLOW
  if (s.movement_class === "Slow Moving") return "YELLOW";
  if (dos != null && s.target_days_of_cover != null && dos > s.target_days_of_cover) return "YELLOW";

  return "GREEN";
}

module.exports = { computeHealth };
