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
  if (a >= 1e6) return `SGD $${(n / 1e6).toFixed(2)}M`;
  if (a >= 1e3) return `SGD $${Math.round(n / 1e3)}K`;
  return `SGD $${Math.round(n)}`;
};

function alertsForSku(s) {
  const out = [];
  const push = (a) => out.push({ dedupe_key: `${s.sku_id}:${a.alert_type}`, sku_id: s.sku_id, sku_name: s.product_name, ...a });

  // STOCKOUT_RISK
  if (s.days_of_stock != null && s.days_of_stock < s.lead_time_days && !s.covered_by_po) {
    push({
      alert_type: "STOCKOUT_RISK",
      severity: "critical",
      triggered_value: s.days_of_stock,
      threshold_value: s.lead_time_days,
      message: `${s.product_name} has ${s.days_of_stock} days of cover against a ${s.lead_time_days}-day supplier lead time. A stockout is projected ${s.stockout_gap_days} days before replenishment can arrive.`,
      recommended_action: `Place a replenishment order now (min ${fmtMt(s.min_order_qty)}). Suggested quantity ${fmtMt(Math.max(s.min_order_qty, s.target_stock - s.available_stock))}. ${s.on_order > 0 ? `${fmtMt(s.on_order)} already inbound (ETA ${s.incoming_eta_days}d) — expedite if possible.` : "Consider expedited freight."}`,
      ai_recommendation_qty: Math.round(Math.max(s.min_order_qty, s.target_stock - s.available_stock)),
    });
  }

  // REORDER — inventory position (on-hand + on-order), not just on-hand
  else if (s.inventory_position <= s.reorder_point_calc && s.movement_class !== "Idle") {
    push({
      alert_type: "REORDER",
      severity: "warning",
      triggered_value: Math.round(s.inventory_position),
      threshold_value: Math.round(s.reorder_point_calc),
      message: `${s.product_name} inventory position (${fmtMt(s.inventory_position)} on-hand + on-order) is at or below the reorder point (${fmtMt(s.reorder_point_calc)}).`,
      recommended_action: `Initiate a standard replenishment order of ~${fmtMt(s.target_stock - s.available_stock)} within the lead-time window.`,
      ai_recommendation_qty: Math.round(Math.max(s.min_order_qty, s.target_stock - s.available_stock)),
    });
  }

  // OVERSTOCK (idle stock is covered by the IDLE alert's disposition review)
  if (s.excess_mt > 0 && s.movement_class !== "Idle") {
    push({
      alert_type: "OVERSTOCK",
      severity: "warning",
      triggered_value: Math.round(s.physical_stock),
      threshold_value: Math.round(s.max_stock),
      message: `${s.product_name} physical stock (${fmtMt(s.physical_stock)}) exceeds the maximum level (${fmtMt(s.max_stock)}) by ${fmtMt(s.excess_mt)}.${s.on_order > 0 ? ` A further ${fmtMt(s.on_order)} is inbound.` : ""}`,
      recommended_action: `Suspend purchasing. ${s.on_order > 0 ? "Defer or cancel the inbound PO if contractually possible. " : ""}Excess carrying cost ≈ ${fmt$(s.excess_carrying_cost)}/year.`,
      ai_recommendation_qty: 0,
    });
  }

  // IDLE
  if (s.movement_class === "Idle" && s.available_stock > 0) {
    push({
      alert_type: "IDLE",
      severity: "critical",
      triggered_value: s.days_since_last_sale ?? 90,
      threshold_value: 90,
      message: `${s.product_name} has had no sales for ${s.days_since_last_sale ?? "90+"} days. ${fmtMt(s.available_stock)} on hand, ${fmt$(s.eo_value)} tied up.`,
      recommended_action: `Stop replenishment. Initiate disposition review — discount, alternative channel, or CSR donation. Write-down risk ≈ ${fmt$(s.eo_value_risk_adjusted)}.`,
      ai_recommendation_qty: null,
    });
  }

  // SLOW_MOVING
  if (s.movement_class === "Slow Moving" && s.days_of_stock != null && s.days_of_stock > 120) {
    push({
      alert_type: "SLOW_MOVING",
      severity: "warning",
      triggered_value: s.days_of_stock,
      threshold_value: 120,
      message: `${s.product_name} has ${s.days_of_stock} days of stock on hand (${s.months_of_stock} months). Demand is ${s.velocity_trend}.`,
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
      recommended_action: `Escalate to QA and commercial. Move stock before it reaches the holding limit — ${s.max_holding_days - s.inventory_age_days} days remain.`,
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

module.exports = { generateAlerts, alertsForSku, TYPE_PRIORITY };
