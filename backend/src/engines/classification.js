// ─────────────────────────────────────────────────────────────────────────────
// MOVEMENT CLASSIFICATION ENGINE
// Implements design.md "Movement Classification" exactly (requirements.md
// REQ-06). Rules are evaluated in order, first match wins:
//
//   Idle         no fulfilled sales in the last 90 days
//   Slow Moving  selling (30 day average > 0) AND days_of_cover > 120
//   Fast Moving  30 day average >= 75th percentile of selling SKUs
//   Normal       otherwise
//
// Changed 15 Sep 2026 on Stan's decision. Slow Moving used to be a ranking
// (the bottom quarter by demand rate), which always labels some SKU slow and
// disagreed with both specs and with the SLOW_MOVING alert, which already
// requires cover over 120 days. The trade-off accepted: a fast seller holding
// more than 120 days of stock is now Slow Moving, because too much stock for
// its demand is what "slow" means to a manager. See design.md, "Formula
// decisions".
// ─────────────────────────────────────────────────────────────────────────────

function percentile(sortedAsc, p) {
  if (!sortedAsc.length) return 0;
  const idx = (sortedAsc.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sortedAsc[lo];
  return sortedAsc[lo] + (sortedAsc[hi] - sortedAsc[lo]) * (idx - lo);
}

/**
 * @param {Array<{ sku_id, avg_daily_usage_30d, days_of_cover, days_since_last_sale }>} rows
 *   days_of_cover is the engine's own field (engines/index.js), read rather than re-derived.
 * @returns {Map<string, string>} sku_id -> movement class
 */
function classifyPortfolio(rows) {
  const rates = rows
    .map((r) => r.avg_daily_usage_30d)
    .filter((v) => v > 0)
    .sort((a, b) => a - b);
  const p75 = percentile(rates, 0.75);

  const out = new Map();
  for (const r of rows) {
    let cls;
    if (r.days_since_last_sale == null || r.days_since_last_sale >= 90) {
      cls = "Idle";
    } else if (r.avg_daily_usage_30d > 0 && r.days_of_cover != null && r.days_of_cover > 120) {
      cls = "Slow Moving";
    } else if (p75 > 0 && r.avg_daily_usage_30d >= p75) {
      cls = "Fast Moving";
    } else {
      cls = "Normal";
    }
    out.set(r.sku_id, cls);
  }
  return out;
}

module.exports = { classifyPortfolio, percentile };
