// ─────────────────────────────────────────────────────────────────────────────
// READ-ONLY TOOLS (19 Sep) - the domain doc's Step 14 ("Agent Explanation and
// Investigation") describes exactly this tier: "Balance and traceability
// [tool]: Read... Investigate movements/orders/supplier history/prior
// decisions through read tools." Everything below is that, and only that.
//
// Each function takes an argument the MODEL chooses (a sku_id, a month
// count) and returns a small, labelled fact block - never a raw row, never
// SQL the model wrote. Same guarantee as explain.js's buildFacts(), just
// fetched on demand instead of pre-loaded, because askDatabase.js (the
// caller) doesn't know in advance which SKU a free-form question is about.
//
// getDb()/getAnalytics() are passed in rather than required here, so this
// module has no opinion on which database it runs against - the caller
// (routes/inventory.js) already resolves that per request the same way
// every other route does.
// ─────────────────────────────────────────────────────────────────────────────

const round1 = (n) => Math.round(n * 10) / 10;

function skuFacts(analytics, sku_id) {
  const s = analytics.skus.find((x) => x.sku_id === sku_id);
  if (!s) return { ok: false, error: `No SKU found with id "${sku_id}".` };
  const facts = {};
  const add = (key, value, unit = "") => {
    if (value === null || value === undefined || value === "") return;
    facts[key] = `${value}${unit}`;
  };
  add("product", s.product_name);
  add("health", s.health_status);
  add("movement_class", s.movement_class);
  add("on_hand", s.on_hand_qty, " MT");
  add("available", s.available_qty, " MT");
  add("demand_rate", s.avg_daily_usage_30d > 0 ? s.avg_daily_usage_30d : null, " MT per day");
  add("days_of_cover", s.days_of_cover_text);
  add("lead_time", s.lead_time_days, " days");
  add("reorder_point", s.reorder_point_policy, " MT");
  add("suggested_order", s.suggested_order_qty > 0 ? s.suggested_order_qty : null, " MT");
  add("target_stock", s.target_stock, " MT");
  return { ok: true, product_name: s.product_name, facts };
}

function compareSkus(analytics, sku_id_a, sku_id_b) {
  const a = skuFacts(analytics, sku_id_a);
  const b = skuFacts(analytics, sku_id_b);
  if (!a.ok) return a;
  if (!b.ok) return b;
  return { ok: true, a, b };
}

// Monthly sold quantity, most recent `months` (default 6, capped at 24 - the
// same history window every other screen in this app uses). One combined
// string, not one slot per month: a model asking "{jan} {feb} {mar}..." for
// a placeholder that doesn't exist would just fail validation, and there is
// no way to pre-name every month in advance since the model picks the range.
function recentHistory(db, analytics, sku_id, months = 6) {
  const s = analytics.skus.find((x) => x.sku_id === sku_id);
  if (!s) return { ok: false, error: `No SKU found with id "${sku_id}".` };
  const n = Math.max(1, Math.min(24, Math.round(Number(months) || 6)));
  const rows = db.prepare(`
    SELECT strftime('%Y-%m', sale_date) AS month, SUM(quantity_mt) AS qty
      FROM sales_transactions
     WHERE sku_id = ? AND status = 'fulfilled'
     GROUP BY month
     ORDER BY month DESC
     LIMIT ?
  `).all(sku_id, n);
  if (!rows.length) return { ok: true, product_name: s.product_name, summary: "No sales recorded in this window." };
  const summary = rows.reverse().map((r) => `${r.month}: ${round1(r.qty)} MT`).join(", ");
  return { ok: true, product_name: s.product_name, summary };
}

// The whitelist askDatabase.js parses a model's "CALL:" line against. Adding
// a tool means adding it here AND to the system prompt's description of it -
// the model can never invoke anything not listed, regardless of what it asks
// for in its own text.
// Each description now ends with a worked example using a real-looking SKU
// id. Caught live (19 Sep): without one, the model sometimes called
// sku_facts("SKU_ID") - copying the description's placeholder word itself
// instead of substituting a real value, which always fails the lookup. A
// concrete example is what tells it SKU_ID is a stand-in, not a literal.
const TOOLS = {
  sku_facts: { arity: 1, describe: "sku_facts(SKU_ID) - key figures for one product: stock, demand rate, lead time, reorder point. Example: sku_facts(TJ-25KG)" },
  compare_skus: { arity: 2, describe: "compare_skus(SKU_ID, SKU_ID) - the same figures for two products side by side. Example: compare_skus(TJ-25KG, JP-5KG)" },
  recent_history: { arity: 1, describe: "recent_history(SKU_ID, MONTHS) - monthly sales totals for one product, MONTHS is optional (default 6, max 24). Example: recent_history(TJ-25KG, 3)" },
};

function runTool(db, analytics, name, args) {
  if (name === "sku_facts") return skuFacts(analytics, args[0]);
  if (name === "compare_skus") return compareSkus(analytics, args[0], args[1]);
  if (name === "recent_history") return recentHistory(db, analytics, args[0], args[1]);
  return { ok: false, error: `Unknown tool "${name}".` };
}

module.exports = { TOOLS, runTool };
