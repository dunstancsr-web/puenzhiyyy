// ─────────────────────────────────────────────────────────────────────────────
// ONBOARDING SUGGESTED SETTINGS (MVP2 Day 8)
// After a fresh catalog/sales upload, every SKU otherwise sits at raw schema
// defaults (95% service level, target_stock 0, lead_time_days 45) until a
// manager edits it by hand. This suggests better starting values instead —
// still editable, still requiring acceptance, never written until the manager
// applies them.
//
// Reads getAnalytics()'s own fields throughout (avg_daily_usage_30d,
// safety_stock_mt, abc_class, lead_time_days) rather than recomputing any of
// them — the same "derived value computed twice" trap rules.md already
// documents a real incident from.
// ─────────────────────────────────────────────────────────────────────────────

// Shared with routes/inventory.js's /forecast/preview target_stock_suggested,
// which imports this rather than keeping its own copy of the same assumption.
const REVIEW_PERIOD_DAYS = 30; // assumed periodic review cycle; not yet tracked per SKU by this app

// Tier-default target service level by ABC class (2026-09-17, Stan's decision).
// Sits mid-range of the common FMCG practitioner convention (roughly A 97-99%,
// B 93-96%, C 88-92%), NOT a cost-optimal calculation — peer-reviewed research
// (Teunter, Babai & Syntetos, "ABC Classification: Service Levels and Inventory
// Costs", Production and Operations Management, 2010) shows fixed per-tier
// service levels leave real savings on the table versus full cost-based
// optimization, which is out of scope here. The frontend tooltip carries this
// same caveat — see SuggestedSettingsReview.jsx.
const SERVICE_LEVEL_BY_TIER = {
  A: 0.98,
  B: 0.95,
  C: 0.90,
};

const round1 = (n) => Math.round(n * 10) / 10;

/**
 * @param {Array<object>} skus  getAnalytics().skus — already carries
 *   avg_daily_usage_30d, safety_stock_mt, abc_class, lead_time_days,
 *   target_service_level, target_stock, max_holding_days, movement_class.
 * @returns {Array<object>} one suggestion row per active SKU
 */
function suggestSettings(skus) {
  return skus.map((s) => {
    const hasDemandData = s.avg_daily_usage_30d > 0;

    const serviceLevelSuggested = SERVICE_LEVEL_BY_TIER[s.abc_class] ?? 0.95;

    let targetStockSuggested = round1(
      s.avg_daily_usage_30d * (REVIEW_PERIOD_DAYS + s.lead_time_days) + s.safety_stock_mt
    );
    // Ageing cap: don't suggest holding more than max_holding_days' worth,
    // but only when there's a real demand rate to cap against — capping a
    // zero-demand suggestion at zero would hide the review-period+lead-time
    // floor a brand new SKU still needs.
    if (hasDemandData && s.max_holding_days) {
      const ageingCap = round1(s.avg_daily_usage_30d * s.max_holding_days);
      if (ageingCap < targetStockSuggested) targetStockSuggested = ageingCap;
    }

    return {
      sku_id: s.sku_id,
      name: s.product_name,
      abc_class: s.abc_class,
      movement_class: s.movement_class,
      target_service_level: {
        current: s.target_service_level,
        suggested: serviceLevelSuggested,
        confidence: "tier-default", // never "measured": this is a policy default, not derived from this SKU's own data
        reason: `${s.abc_class}-tier default`,
      },
      target_stock: {
        current: s.target_stock,
        suggested: targetStockSuggested,
        confidence: hasDemandData ? "measured" : "low",
        reason: hasDemandData
          ? `${REVIEW_PERIOD_DAYS + s.lead_time_days} days of demand + safety stock`
          : "no sales history yet — based on lead time and safety stock only",
      },
      lead_time_days: {
        current: s.lead_time_days,
        suggested: s.lead_time_days, // honestly not suggested from data — see reason
        confidence: "low",
        reason: "no receiving history yet (purchase_orders.actual_arrival is never populated); using the current default",
      },
    };
  });
}

module.exports = { suggestSettings, REVIEW_PERIOD_DAYS, SERVICE_LEVEL_BY_TIER };
