// ─────────────────────────────────────────────────────────────────────────────
// INVENTORY HEALTH ENGINE  (RED / ORANGE / YELLOW / GREEN)
// Evaluated in order — first match wins.
//
//   RED    days_of_stock < lead_time                       (stockout before resupply)
//          OR inventory_age > max_holding_days              (past holding limit)
//   ORANGE days_of_stock < lead_time + safety_stock_days    (inside the buffer)
//          OR physical_stock > max_stock                    (overstock)
//   YELLOW movement_class = 'Slow Moving'
//          OR days_of_stock > target_days                   (drifting high)
//   GREEN  otherwise
//
// covered_by_po softens a projected stockout that an inbound PO already closes.
// ─────────────────────────────────────────────────────────────────────────────

function computeHealth(s) {
  const dos = s.days_of_stock;
  const ltSafety = s.lead_time_days + (s.safety_stock_days || 0);

  // RED
  if (dos != null && dos < s.lead_time_days && !s.covered_by_po) return "RED";
  if (s.inventory_age_days != null && s.inventory_age_days > s.max_holding_days) return "RED";
  if (s.movement_class === "Idle" && s.available_stock > 0) return "RED";

  // ORANGE
  if (dos != null && dos < ltSafety && !s.covered_by_po) return "ORANGE";
  if (s.physical_stock > s.max_stock) return "ORANGE";

  // YELLOW
  if (s.movement_class === "Slow Moving") return "YELLOW";
  if (dos != null && s.target_days != null && dos > s.target_days) return "YELLOW";

  return "GREEN";
}

module.exports = { computeHealth };
