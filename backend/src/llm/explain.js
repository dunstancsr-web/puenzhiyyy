// ─────────────────────────────────────────────────────────────────────────────
// LLM EXPLANATION LAYER (TASK-11)
//
// The model NARRATES, it does not compute. Every figure in the prompt was
// already produced by the engines and is checkable on the Inventory page, and
// the system prompt forbids inventing or deriving numbers. This is not caution
// for its own sake: a local llama3 smoke test described SGD 26,217 of margin as
// "potential sales" and misread a 17 day shortfall, so a model left to
// interpret raw figures gets them subtly wrong in ways a manager would not
// catch.
//
// If the model is unavailable, unconfigured, or over budget, the caller falls
// back to the deterministic trace in frontend/src/lib/explain.js. The feature
// degrades to what it was, never to an error.
// ─────────────────────────────────────────────────────────────────────────────

const { chat, providerInfo, LlmUnavailable } = require("./provider");
const { EVENTS, logEvent } = require("../db/audit");

const SYSTEM = `You are an inventory analyst at a rice importer and distributor in Singapore.

You are explaining ONE alert to a warehouse manager who knows the business but not
the maths. Your job is to make the reasoning legible, not to do the reasoning.

Rules, in priority order:
1. Use ONLY the figures given to you. Never invent, estimate, extrapolate or
   recompute a number. If a figure is not supplied, do not mention it.
2. Do not rename what a figure measures. Margin is not revenue. Days of cover is
   not days until a stockout. Copy the label you were given.
3. Four short paragraphs at most, and no paragraph longer than two sentences.
4. Plain English. No bullet points, no headings, no markdown.
5. Never use an em dash or an en dash. Use a comma, a colon, or a second
   sentence instead.
6. End with the single action you would take, stated plainly.`;

// The facts block. Deliberately labelled rather than raw JSON: naming the unit
// beside every number is what stops a model calling margin "sales".
function buildFacts(sku, alert) {
  const L = [];
  const add = (label, value, unit = "") => {
    if (value === null || value === undefined || value === "") return;
    L.push(`${label}: ${value}${unit}`);
  };

  add("Product", sku.product_name);
  add("SKU", sku.sku_id);
  add("Alert type", alert.alert_type);
  add("Severity", alert.severity);
  add("What the alert says", alert.message);
  add("Rule based recommended action", alert.recommended_action);

  add("Available stock", sku.available_qty, " MT");
  add("On hand stock", sku.on_hand_qty, " MT");
  add("Reserved for confirmed orders", sku.reserved_qty, " MT");
  add("Already on order and inbound", sku.expected_incoming_qty, " MT");
  add("Demand rate (blended)", sku.blended_daily_usage, " MT per day");
  add("Days of cover remaining", sku.days_of_cover, " days");
  add("Supplier lead time", sku.lead_time_days, " days");
  add("Safety stock held", sku.safety_stock_days, " days");
  add("Maximum stock level", sku.max_stock, " MT");
  add("Approved reorder point", sku.reorder_point_policy, " MT");
  add("Suggested order quantity", sku.suggested_order_qty, " MT");
  add("Supplier minimum order", sku.min_order_qty, " MT");
  add("Value class (ABC)", sku.abc_class);
  add("Movement class", sku.movement_class);
  add("Demand trend", sku.velocity_trend);
  add("Days since last sale", sku.days_since_last_sale, " days");
  add("Gross margin at risk if it stocks out", sku.lost_margin_risk, " SGD");
  add("Write down risk if it stays unsold", sku.eo_value_risk_adjusted, " SGD");
  add("Overstock carrying cost per year", sku.overstock_carrying_cost, " SGD");
  add("Supplier", sku.supplier);

  return L.join("\n");
}

// ── Response cache ───────────────────────────────────────────────────────────
// In memory, so a server restart clears it. That is acceptable because the
// default development provider is free: only the paid path has a cost to
// re-spend, and that path does not restart on every file save.
const cache = new Map();
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;

// Reuse a saved explanation while the situation is materially the same, and ask
// again once it is not. Chosen over both extremes deliberately:
//
//   keying on sku_id alone      cheapest, but a manager can be shown prose
//                               quoting stock that has since moved, which is
//                               worse than showing no explanation at all
//   keying on exact quantities  always correct, but one tonne of movement
//                               invalidates the entry, so every click is a
//                               fresh paid call and the gateway starts
//                               answering 403
//
// So the volatile figures are BUCKETED. Small drift lands in the same bucket
// and reuses the answer; a material change crosses a boundary and re-asks.
// Only figures that actually appear in the prose are included: `supplier` and
// `unit_cost_sgd` cannot make an explanation stale, so they are left out and
// changing them costs nothing.
//
// Bucket sizes are per unit-of-measure, not one global number, because 10 MT of
// drift and 10 days of drift are not comparable amounts of "different".
//
// Only INDEPENDENT inputs go in the key, never figures derived from them. The
// first version of this function also keyed on days_of_cover and
// suggested_order_qty, and a test of the intended behaviour (160 MT drifting to
// 158 MT should be free) failed: both are computed from available_qty, so a
// single stock movement got two independent chances to cross a bucket boundary,
// and cover falling 28 to 27 straddled the 27.5 line on its own. Keying on
// stock and demand instead covers the same ground with one boundary rather than
// three, because if both are in the same bucket then cover is necessarily
// similar too.
const bucket = (n, size) => (Number.isFinite(Number(n)) ? Math.round(Number(n) / size) : "na");

function cacheKey(sku, alert) {
  if (!sku || !alert?.alert_type) return null;
  return [
    sku.sku_id,
    alert.alert_type,
    alert.severity,
    // Stock on hand and inbound, to the nearest 10 MT.
    `av${bucket(sku.available_qty, 10)}`,
    `in${bucket(sku.expected_incoming_qty, 10)}`,
    // Demand rate, to the nearest 1 MT per day. Together with stock this is
    // what days of cover is made of, so it does not need its own entry.
    `dd${bucket(sku.blended_daily_usage, 1)}`,
    // Idle and ageing alerts lead on these two, and neither is derived from
    // stock, so they are genuinely independent.
    `ls${bucket(sku.days_since_last_sale, 5)}`,
    `ag${bucket(sku.inventory_age_days, 5)}`,
    // Classifications are already coarse. They change rarely, but when they do
    // the explanation genuinely should change.
    sku.movement_class,
    sku.abc_class,
  ].join("|");
}

function fromCache(key) {
  if (!key) return null;
  const hit = cache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > CACHE_TTL_MS) {
    cache.delete(key);
    return null;
  }
  return hit.value;
}

/**
 * Produce a model written explanation for one alert.
 * Throws LlmUnavailable when no model answered, so the route can fall back.
 *
 * @returns {{ text, model, provider, cached, usage }}
 */
async function explainAlert(sku, alert) {
  const key = cacheKey(sku, alert);
  const cached = fromCache(key);
  if (cached) return { ...cached, cached: true };

  const facts = buildFacts(sku, alert);
  const user = `Here are the figures for this alert.\n\n${facts}\n\nExplain why this was flagged and what the manager should do.`;

  const started = Date.now();
  const result = await chat({ system: SYSTEM, user });
  const ms = Date.now() - started;

  // The LLM_CALL event that db/audit.js reserved from the start. Records what
  // the model was given and what it returned, so a model written explanation is
  // as auditable as a computed one. The key itself is never logged, and neither
  // is any credential.
  logEvent(EVENTS.LLM_CALL, {
    skuId: sku.sku_id,
    input: {
      alert_type: alert.alert_type,
      provider: result.provider,
      model: result.model,
      fact_count: facts.split("\n").length,
    },
    output: {
      explanation: result.text,
      latency_ms: ms,
      input_tokens: result.usage?.input_tokens ?? null,
      output_tokens: result.usage?.output_tokens ?? null,
    },
  });

  const value = { text: result.text, model: result.model, provider: result.provider, usage: result.usage };
  if (key) cache.set(key, { at: Date.now(), value });
  return { ...value, cached: false };
}

module.exports = { explainAlert, providerInfo, LlmUnavailable, buildFacts, cacheKey };
