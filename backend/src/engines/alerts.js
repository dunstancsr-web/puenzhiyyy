// ─────────────────────────────────────────────────────────────────────────────
// ALERT ENGINE
// Turns enriched SKU analytics into typed, deduped alerts with plain-English
// messages and rule-based recommended actions (no LLM). One live row per
// (sku_id, alert_type) via dedupe_key.
// ─────────────────────────────────────────────────────────────────────────────

const TYPE_PRIORITY = {
  STOCKOUT_RISK: 0, IDLE: 1, REORDER: 2, OVERSTOCK: 3, AGEING: 4, SLOW_MOVING: 5,
};

const fmtMt = (n) => `${Math.round(n)} MT`;
const fmt$ = (n) => {
  const a = Math.abs(n);
  // Thresholds match fmt$ in frontend/src/pages/Dashboard.jsx and sgd() in
  // frontend/src/lib/explain.js. All three render the same figures, and a
  // carrying cost that reads "$26K" in an alert and "$26.2K" on the dashboard
  // looks like two different numbers.
  if (a >= 1e6) return `SGD $${(n / 1e6).toFixed(2)}M`;
  if (a >= 1e5) return `SGD $${Math.round(n / 1e3)}K`;
  if (a >= 1e3) return `SGD $${(n / 1e3).toFixed(1).replace(/\.0$/, "")}K`;
  return `SGD $${Math.round(n)}`;
};

// How much to order, for the two alert types that recommend ordering.
//
// This used to be recomputed here as `target_stock - available_qty`, a
// snapshot-based proxy that ignores everything consumed WHILE the order is in
// transit. engines/index.js already computes the real figure as
// `target_stock - projected_available_at_lead_time` (design.md "Reorder Point
// and Suggested Order Quantity", upgraded away from exactly this proxy on
// 2026-09-12) and attaches it to every SKU before generateAlerts is called.
// The alert engine simply never picked up the upgrade.
//
// The two disagreed badly. On TJ-25KG the proxy said 340 MT while the SKU's own
// suggested_order_qty said 597 MT: a 257 MT gap, about $347K of purchase order,
// with the Inventory page showing one number and the Alerts page pre-filling
// the other into the approval modal. Same disease as the reorder-point policy
// versus suggested bug: one question, two answers, no way for a manager to tell
// which one the system means.
//
// min_order_qty still floors it, because a supplier minimum is a hard
// constraint rather than a calculation.
const orderQty = (s) => Math.round(Math.max(s.min_order_qty, s.suggested_order_qty));

function alertsForSku(s) {
  const out = [];
  const push = (a) => out.push({ dedupe_key: `${s.sku_id}:${a.alert_type}`, sku_id: s.sku_id, sku_name: s.product_name, ...a });

  // STOCKOUT_RISK
  if (s.days_of_cover != null && s.days_of_cover < s.lead_time_days && !s.covered_by_po) {
    push({
      alert_type: "STOCKOUT_RISK",
      severity: "critical",
      triggered_value: s.days_of_cover,
      threshold_value: s.lead_time_days,
      message: `${s.product_name} has ${s.days_of_cover} days of cover against a ${s.lead_time_days}-day supplier lead time. A stockout is projected ${s.stockout_gap_days} days before replenishment can arrive.`,
      recommended_action: `Place a replenishment order now (min ${fmtMt(s.min_order_qty)}). Suggested quantity ${fmtMt(orderQty(s))}. ${s.expected_incoming_qty > 0 ? `${fmtMt(s.expected_incoming_qty)} already inbound (ETA ${s.incoming_eta_days}d) - expedite if possible.` : "Consider expedited freight."}`,
      ai_recommendation_qty: orderQty(s),
    });
  }

  // REORDER - inventory position (on-hand + expected incoming), not just on-hand
  else if (s.inventory_position <= s.reorder_point_suggested && s.movement_class !== "Idle") {
    push({
      alert_type: "REORDER",
      severity: "warning",
      triggered_value: Math.round(s.inventory_position),
      threshold_value: Math.round(s.reorder_point_suggested),
      message: `${s.product_name} inventory position (${fmtMt(s.inventory_position)} on-hand + expected incoming) is at or below the reorder point (${fmtMt(s.reorder_point_suggested)}).`,
      recommended_action: `Initiate a standard replenishment order of ~${fmtMt(orderQty(s))} within the lead-time window.`,
      ai_recommendation_qty: orderQty(s),
    });
  }

  // OVERSTOCK (idle stock is covered by the IDLE alert's disposition review)
  if (s.overstock_qty > 0 && s.movement_class !== "Idle") {
    push({
      alert_type: "OVERSTOCK",
      severity: "warning",
      triggered_value: Math.round(s.on_hand_qty),
      threshold_value: Math.round(s.max_stock),
      message: `${s.product_name} on-hand stock (${fmtMt(s.on_hand_qty)}) exceeds the maximum level (${fmtMt(s.max_stock)}) by ${fmtMt(s.overstock_qty)}.${s.expected_incoming_qty > 0 ? ` A further ${fmtMt(s.expected_incoming_qty)} is inbound.` : ""}`,
      recommended_action: `Suspend purchasing. ${s.expected_incoming_qty > 0 ? "Defer or cancel the inbound PO if contractually possible. " : ""}Overstock carrying cost ≈ ${fmt$(s.overstock_carrying_cost)}/year.`,
      ai_recommendation_qty: 0,
    });
  }

  // IDLE
  if (s.movement_class === "Idle" && s.available_qty > 0) {
    push({
      alert_type: "IDLE",
      severity: "critical",
      triggered_value: s.days_since_last_sale ?? 90,
      threshold_value: 90,
      message: `${s.product_name} has had no sales for ${s.days_since_last_sale ?? "90+"} days. ${fmtMt(s.available_qty)} on hand, ${fmt$(s.eo_value)} tied up.`,
      recommended_action: `Stop replenishment. Initiate disposition review - discount, alternative channel, or CSR donation. Write-down risk ≈ ${fmt$(s.eo_value_risk_adjusted)}.`,
      ai_recommendation_qty: null,
    });
  }

  // SLOW_MOVING
  if (s.movement_class === "Slow Moving" && s.days_of_cover != null && s.days_of_cover > 120) {
    push({
      alert_type: "SLOW_MOVING",
      severity: "warning",
      triggered_value: s.days_of_cover,
      threshold_value: 120,
      message: `${s.product_name} has ${s.days_of_cover} days of cover on hand (${s.months_of_cover} months). Demand is ${s.velocity_trend}.`,
      recommended_action: `Reduce or pause the next order. Review the customer base; consider a targeted promotion.`,
      ai_recommendation_qty: null,
    });
  }

  // AGEING
  if (s.ageing_status === "Ageing" || s.ageing_status === "At Risk") {
    push({
      alert_type: "AGEING",
      severity: s.ageing_status === "At Risk" ? "critical" : "warning",
      triggered_value: s.inventory_age_days,
      threshold_value: s.max_holding_days,
      message: `${s.product_name} has been held ${s.inventory_age_days} days against a ${s.max_holding_days}-day limit (status: ${s.ageing_status}).`,
      recommended_action: `Escalate to QA and commercial. Move stock before it reaches the holding limit - ${s.max_holding_days - s.inventory_age_days} days remain.`,
      ai_recommendation_qty: null,
    });
  }

  return out;
}

/**
 * @param {Array} skus  enriched SKUs
 * @returns {{ alerts: Array, primaryExceptions: Array }}
 */
function generateAlerts(skus) {
  const alerts = skus.flatMap(alertsForSku);

  const sevRank = { critical: 0, warning: 1, info: 2 };
  const bySku = {};
  for (const a of alerts) {
    const cur = bySku[a.sku_id];
    const better =
      !cur ||
      sevRank[a.severity] < sevRank[cur.severity] ||
      (sevRank[a.severity] === sevRank[cur.severity] &&
        TYPE_PRIORITY[a.alert_type] < TYPE_PRIORITY[cur.alert_type]);
    if (better) bySku[a.sku_id] = a;
  }
  const primaryExceptions = Object.values(bySku).sort(
    (a, b) =>
      sevRank[a.severity] - sevRank[b.severity] ||
      TYPE_PRIORITY[a.alert_type] - TYPE_PRIORITY[b.alert_type]
  );

  return { alerts, primaryExceptions };
}

module.exports = { generateAlerts, alertsForSku, TYPE_PRIORITY, fmt$};
