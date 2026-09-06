// ─────────────────────────────────────────────────────────────────────────────
// MOVEMENT CLASSIFICATION ENGINE
// Classify by THROUGHPUT (velocity), not by coverage — a SKU can be a fast
// mover and still be overstocked. Coverage problems are surfaced separately by
// the health / coverage-band engines.
//
//   Idle         no fulfilled sales in the last 90 days
//   Fast Moving  blended daily rate >= 75th percentile of selling SKUs
//   Slow Moving  blended daily rate <= 25th percentile of selling SKUs
//   Normal       the middle two quartiles
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
 * @param {Array<{ sku_id, blended_daily_usage, days_since_last_sale }>} rows
 * @returns {Map<string, string>} sku_id -> movement class
 */
function classifyPortfolio(rows) {
  const rates = rows
    .map((r) => r.blended_daily_usage)
    .filter((v) => v > 0)
    .sort((a, b) => a - b);
  const p75 = percentile(rates, 0.75);
  const p25 = percentile(rates, 0.25);

  const out = new Map();
  for (const r of rows) {
    let cls;
    if (r.days_since_last_sale == null || r.days_since_last_sale >= 90 || r.blended_daily_usage === 0) {
      cls = "Idle";
    } else if (r.blended_daily_usage >= p75 && p75 > 0) {
      cls = "Fast Moving";
    } else if (r.blended_daily_usage <= p25) {
      cls = "Slow Moving";
    } else {
      cls = "Normal";
    }
    out.set(r.sku_id, cls);
  }
  return out;
}

module.exports = { classifyPortfolio, percentile };
