// ─────────────────────────────────────────────────────────────────────────────
// VELOCITY ENGINE
// Rolling sales consumption over 30 / 60 / 90 / 180-day windows, a blended
// daily rate, the demand coefficient of variation (for XYZ), and a trend flag.
// Only status = 'fulfilled' rows count as consumption; 'lost' rows are demand
// that was not met and feed the fill-rate calc in financials.js.
// ─────────────────────────────────────────────────────────────────────────────

const DAY_MS = 86_400_000;

function daysAgo(n, now = Date.now()) {
  return new Date(now - n * DAY_MS).toISOString().slice(0, 10);
}

/**
 * @param {import('better-sqlite3').Database} db
 * @param {string} skuId
 * @param {Date|number} [asOf]  evaluation date (defaults to now)
 */
function computeVelocity(db, skuId, asOf = Date.now()) {
  const now = asOf instanceof Date ? asOf.getTime() : asOf;

  const rows = db
    .prepare(
      `SELECT quantity_mt, sale_date, status
         FROM sales_transactions
        WHERE sku_id = ? AND sale_date >= ?
        ORDER BY sale_date`
    )
    .all(skuId, daysAgo(200, now));

  const fulfilled = rows.filter((r) => r.status === "fulfilled");

  const sumSince = (days) => {
    const cutoff = daysAgo(days, now);
    return fulfilled
      .filter((r) => r.sale_date >= cutoff)
      .reduce((s, r) => s + r.quantity_mt, 0);
  };

  const sales_30d = round(sumSince(30));
  const sales_60d = round(sumSince(60));
  const sales_90d = round(sumSince(90));
  const sales_180d = round(sumSince(180));

  const avg_daily_30d = round(sales_30d / 30);
  const avg_daily_60d = round(sales_60d / 60);
  const avg_daily_90d = round(sales_90d / 90);

  // Blended rate: 50/50 of the 30d and 90d rates smooths a noisy 30d window.
  const blended_daily = round(0.5 * avg_daily_30d + 0.5 * avg_daily_90d);

  // Demand CV from weekly buckets over the last 12 weeks.
  const weekly = bucketWeekly(fulfilled, now, 12);
  const demand_cv = coefficientOfVariation(weekly);

  // Trend: 30d rate vs 90d rate, ±10% band.
  let velocity_trend = "stable";
  if (avg_daily_90d > 0) {
    if (avg_daily_30d > avg_daily_90d * 1.1) velocity_trend = "accelerating";
    else if (avg_daily_30d < avg_daily_90d * 0.9) velocity_trend = "decelerating";
  }

  const lastSale = fulfilled.length ? fulfilled[fulfilled.length - 1].sale_date : null;
  const days_since_last_sale = lastSale
    ? Math.floor((now - new Date(lastSale).getTime()) / DAY_MS)
    : null;

  return {
    sales_30d, sales_60d, sales_90d, sales_180d,
    avg_daily_usage_30d: avg_daily_30d,
    avg_daily_usage_60d: avg_daily_60d,
    avg_daily_usage_90d: avg_daily_90d,
    blended_daily_usage: blended_daily,
    demand_cv: round(demand_cv),
    velocity_trend,
    last_sale_date: lastSale,
    days_since_last_sale,
  };
}

function bucketWeekly(rows, now, weeks) {
  const buckets = new Array(weeks).fill(0);
  for (const r of rows) {
    const age = (now - new Date(r.sale_date).getTime()) / DAY_MS;
    const wk = Math.floor(age / 7);
    if (wk >= 0 && wk < weeks) buckets[wk] += r.quantity_mt;
  }
  return buckets;
}

function coefficientOfVariation(values) {
  if (!values.length) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  if (mean === 0) return 0;
  const variance =
    values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance) / mean;
}

const round = (n) => Math.round(n * 100) / 100;

module.exports = { computeVelocity, daysAgo };
