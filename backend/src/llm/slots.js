// ─────────────────────────────────────────────────────────────────────────────
// SLOT FILLING (TASK-45)
//
// The engines already compute every figure, and the model is already told never
// to calculate. But it still had to RETYPE the numbers into a sentence, and
// every numeric failure we measured happened in that retyping: 26217 written as
// "26000", an invented 190, "9 months and 8 days" restated as "nearly a year".
// The maths was hard coded and the typing was not.
//
// So the model no longer writes figures at all. It writes prose with named
// placeholders, and this module substitutes the engine's values afterwards. The
// raw output is rejected if it contains a digit anywhere, which means stating a
// number the engine did not compute is not merely detectable, it is
// unrepresentable.
//
// That is the difference between a test and a type. The verifier in explain.js
// is still applied to the rendered text, because slots cannot prevent the model
// calling a margin figure "sales" or hedging with "nearly": those are the words
// AROUND the number, and they remain the model's own.
// ─────────────────────────────────────────────────────────────────────────────

// Slot names deliberately contain no digits, so "the raw output must contain no
// digits" stays a simple and total rule.
const PLACEHOLDER = /\{([a-z_]+)\}/g;

// ── The trigger, as one engine-written clause ────────────────────────────────
//
// Slots guarantee every FIGURE is real. They do not guarantee the model puts
// the right figures side by side, and that gap produced three wrong sentences
// in two days, every figure in each one real:
//
//   "{available_stock} exceeds the maximum policy level of {max_stock} by
//    {overstock_amount}"                    580 vs 400 "by" 220; 580 is not on-hand
//   "the approved reorder point ({reorder_point})"   alert fired on another value
//   "inventory position has reached {reorder_point}"  position 230, not 250
//
// The first two were fixed by withholding one misleading placeholder each.
// The third showed that is whack-a-mole: as long as the figures of a
// comparison are separate placeholders, a model can attach any of them to the
// wrong phrase. So since TASK-96 the comparison that TRIGGERED each alert is
// offered as ONE clause the engine writes, {alert_trigger}, and the separate
// placeholders it is built from are withheld for that alert type. The model
// decides where the reason goes in its prose; it can no longer decide which
// number goes with which name. Same move as {recommended_action}.
//
// Each clause restates the alert card's own comparison with the same values,
// worded to read naturally after "because". If the model reaches for a
// withheld placeholder, validateSlotted rejects it as unknown and the retry
// loop asks again; if it still writes a contradiction in its own words,
// src/llm/semantic.js catches it in the verifier.
//
// WHO WRITES THE SENTENCE. A first version offered the clause as a
// placeholder, {alert_trigger}, and required the model to use it. On llama3
// that requirement failed the placeholder format so often that 28 of 32
// answers fell back to free text at 2.91 calls each, against 2.03 without it:
// correct, but half as much again in paid calls. So the system writes the
// opening sentence itself (triggerSentence below) and the model is asked only
// for what it means and what to do. The reason and its figures are then
// guaranteed present, and the model has one fewer thing to get wrong.
const TRIGGERS = {
  STOCKOUT_RISK: {
    clause: (s, a, f) => `its ${s.days_of_cover} days of cover are shorter than the ${s.lead_time_days} day supplier lead time, so it is projected to run out ${s.stockout_gap_days} days before a new order could arrive`,
    // Plus figures a stockout explanation has no use for. The benchmark caught
    // "our current 240 MT and 80 MT combined" (on-hand plus reserved) here.
    // min_order: the recommended action already carries "(min 20 MT)", and on
    // its own llama3 turned it into "order at least that amount" against a
    // suggested 597 MT.
    // safety_stock too: "The 10 days is insufficient to cover the time it
    // takes for a new shipment to arrive" presented the buffer as cover.
    withhold: ["days_of_cover", "lead_time", "stockout_gap", "on_hand_stock", "reserved_stock", "max_stock", "reorder_point", "min_order", "safety_stock"],
  },
  REORDER: {
    clause: (s, a, f) => `its inventory position of ${f.mt(s.inventory_position)} (stock available now plus stock already on order) is at or below the approved reorder point of ${f.mt(s.reorder_point_policy)}`,
    // Position is available plus inbound, so available alone beside the reorder
    // point is wrong whenever anything is inbound. On-hand includes
    // reservations. A low-stock alert has no use for a maximum.
    // min_order and safety_stock produced "a crucial consideration" and "an
    // order that covers the buffer, which is 10 days": noise around the one
    // quantity that matters, which the recommended action already states.
    withhold: ["inventory_position", "reorder_point", "available_stock", "on_hand_stock", "max_stock", "reserved_stock", "min_order", "safety_stock"],
  },
  OVERSTOCK: {
    clause: (s, a, f) => `its on-hand stock of ${f.mt(s.on_hand_qty)} is ${f.mt(s.overstock_qty)} above the maximum stock level of ${f.mt(s.max_stock)}`,
    withhold: ["on_hand_stock", "max_stock", "overstock_amount", "available_stock", "reserved_stock", "reorder_point", "suggested_order", "min_order"],
  },
  IDLE: {
    clause: (s, a, f) => `it has had no sales for ${s.days_since_last_sale_text || "over 90 days"} while ${f.mt(s.available_qty)} is still in stock`,
    // The IDLE brief already says never to mention reorder points or ordering.
    // supplier: idle stock is a disposal decision, and a supplier name invites
    // a story about the supplier.
    withhold: ["time_since_sale", "available_stock", "reorder_point", "suggested_order", "min_order", "max_stock", "lead_time", "safety_stock", "supplier"],
  },
  SLOW_MOVING: {
    clause: (s, a, f) => `at its current sales pace, the stock it holds would take ${s.days_of_cover_text} to sell`,
    withhold: ["days_of_cover", "reorder_point", "suggested_order", "min_order"],
  },
  AGEING: {
    clause: (s, a, f) => `it has been held for ${s.inventory_age_text}, against a holding limit of ${f.duration(s.max_holding_days)}`,
    // lead_time too: "consider Supplier JKL Japan's lead time" has nothing to
    // do with stock that needs moving out.
    // supplier: produced "The supplier has been informed of the situation", an
    // action nobody took (15 Sep benchmark).
    withhold: ["stock_age", "holding_limit", "reorder_point", "suggested_order", "min_order", "max_stock", "lead_time", "safety_stock", "supplier"],
  },
};

/**
 * The opening sentence of every explanation: why this alert fired, with its
 * figures, written by the system. Null for an alert type without a trigger
 * clause, in which case the model states the reason itself as before.
 */
function triggerSentence(sku, alert) {
  const trigger = TRIGGERS[alert?.alert_type];
  if (!trigger) return null;
  const mt = (n) => (Number.isFinite(Number(n)) ? `${Math.round(Number(n)).toLocaleString("en-SG")} MT` : null);
  const days = (n) => (Number.isFinite(Number(n)) ? `${Math.round(Number(n))} days` : null);
  const duration = (n) => (n ? require("../engines/duration").humanDuration(n) : null);
  return `${sku.product_name} was flagged because ${trigger.clause(sku, alert, { mt, days, duration })}.`;
}

// Reuse the engine's own formatted strings wherever they exist rather than
// re-deriving presentation here. days_of_cover_text and friends are attached in
// engines/index.js precisely so every surface renders a duration identically.
function buildSlots(sku, alert) {
  const money = (n) => {
    const v = Number(n);
    if (!Number.isFinite(v)) return null;
    const a = Math.abs(v);
    if (a >= 1e6) return `SGD $${(v / 1e6).toFixed(2)}M`;
    if (a >= 1e5) return `SGD $${Math.round(v / 1e3)}K`;
    if (a >= 1e3) return `SGD $${(v / 1e3).toFixed(1).replace(/\.0$/, "")}K`;
    return `SGD $${Math.round(v)}`;
  };
  const mt = (n) => (Number.isFinite(Number(n)) ? `${Math.round(Number(n)).toLocaleString("en-SG")} MT` : null);
  const days = (n) => (Number.isFinite(Number(n)) ? `${Math.round(Number(n))} days` : null);
  const duration = (n) => (n ? require("../engines/duration").humanDuration(n) : null);
  const trigger = TRIGGERS[alert?.alert_type];

  // value is what gets substituted; describes is what the prompt tells the model
  // the placeholder means. Naming the meaning is what stops "in sales" appearing
  // beside a capital figure.
  const raw = {
    product:            { value: sku.product_name, describes: "the product name" },
    // The alert's own sentences, offered as placeholders rather than pasted
    // into the prompt. Both contain engine-computed figures, and a prompt that
    // says "never write a digit" while displaying digits is asking the model to
    // ignore the only numbers in front of it. As slots their values are
    // injected after validation, so they stay correct and stay out of reach.
    recommended_action: { value: alert.recommended_action, describes: "the full action already decided for this SKU, a complete sentence, to be stated on its own at the end" },
    stockout_gap:       { value: sku.stockout_gap_days > 0 ? `${sku.stockout_gap_days} days` : null, describes: "how long the shelf is empty before replenishment lands" },
    available_stock:    { value: mt(sku.available_qty), describes: "stock available to sell right now" },
    // Deliberately neutral again (TASK-95). A 14 Sep version added "the figure
    // the maximum stock level is measured against" for the overstock fix, and
    // because descriptions are shared by every alert type, that word
    // "maximum" leaked into a REORDER explanation as "reaching its maximum
    // capacity". The overstock relationship lives in overstock_amount instead,
    // which only an overstocked SKU is ever offered.
    on_hand_stock:      { value: mt(sku.on_hand_qty), describes: "total physical stock in the warehouse, including stock already promised to orders" },

    reserved_stock:     { value: sku.reserved_qty > 0 ? mt(sku.reserved_qty) : null, describes: "stock already promised to confirmed orders" },
    inbound_stock:      { value: sku.expected_incoming_qty > 0 ? mt(sku.expected_incoming_qty) : null, describes: "stock already ordered and on its way" },
    demand_rate:        { value: sku.avg_daily_usage_30d > 0 ? `${sku.avg_daily_usage_30d} MT per day` : null, describes: "how fast this sells" },
    days_of_cover:      { value: sku.days_of_cover_text, describes: "how long current stock will last at that demand rate" },
    lead_time:          { value: days(sku.lead_time_days), describes: "how long the supplier takes to deliver a new order" },
    safety_stock:       { value: sku.safety_stock_days > 0 ? days(sku.safety_stock_days) : null, describes: "the buffer held on top of lead time demand" },
    max_stock:          { value: mt(sku.max_stock), describes: "the maximum stock level policy allows" },
    // Offered to NO alert type (TASK-96). OVERSTOCK's system-written opening
    // sentence already states it, and on IDLE and AGEING alerts, where an
    // idle SKU can also sit above its maximum, llama3 used it as "write down
    // the 18 MT" when 78 MT was idle. Kept here only so an alert type without
    // a trigger clause still has it.
    overstock_amount:   { value: sku.overstock_qty > 0 && !TRIGGERS[alert?.alert_type] ? mt(sku.overstock_qty) : null, describes: "how far on-hand stock sits above the maximum, i.e. on-hand stock minus the maximum" },
    // The approved value, which is what the REORDER alert fires on since TASK-95.
    reorder_point:      { value: mt(sku.reorder_point_policy), describes: "the approved reorder point: a normal order is due when inventory position falls to or below it" },
    suggested_order:    { value: sku.suggested_order_qty > 0 ? mt(sku.suggested_order_qty) : null, describes: "how much to order, measured at the moment the shipment lands" },
    min_order:          { value: sku.min_order_qty > 0 ? mt(sku.min_order_qty) : null, describes: "the supplier's minimum order quantity" },
    value_class:        { value: sku.abc_class, describes: "the ABC value class, A being the most valuable" },
    movement_class:     { value: sku.movement_class, describes: "how fast this moves: Fast, Normal, Slow or Idle" },
    demand_trend:       { value: sku.velocity_trend, describes: "whether demand is accelerating, stable or decelerating" },
    time_since_sale:    { value: sku.days_since_last_sale_text, describes: "how long since this last sold" },
    stock_age:          { value: sku.inventory_age_text, describes: "how long this stock has been held" },
    holding_limit:      { value: sku.max_holding_days ? require("../engines/duration").humanDuration(sku.max_holding_days) : null, describes: "the maximum time this may be held" },
    margin_at_risk:     { value: sku.lost_margin_risk > 0 ? money(sku.lost_margin_risk) : null, describes: "gross MARGIN lost if this stocks out, which is not revenue and not sales" },
    writedown_risk:     { value: sku.eo_value_risk_adjusted > 0 ? money(sku.eo_value_risk_adjusted) : null, describes: "the likely WRITE DOWN if this stays unsold" },
    carrying_cost:      { value: sku.overstock_carrying_cost > 0 ? money(sku.overstock_carrying_cost) : null, describes: "the yearly COST of holding the excess" },
    capital_tied_up:    { value: sku.eo_value > 0 ? money(sku.eo_value) : null, describes: "CAPITAL sitting in this stock at cost price, which is not sales and not revenue" },
    supplier:           { value: sku.supplier, describes: "the supplier name" },
  };

  // A slot with no value must not be offered, or the model will reach for it and
  // the sentence will render with a hole in it.
  const withheld = new Set(trigger ? trigger.withhold : []);
  const slots = {};
  for (const [k, v] of Object.entries(raw)) {
    if (withheld.has(k)) continue;
    if (v.value !== null && v.value !== undefined && v.value !== "") slots[k] = v;
  }
  return slots;
}

// The placeholder menu, as the prompt presents it.
function describeSlots(slots) {
  return Object.entries(slots)
    .map(([k, v]) => `  {${k}} ${v.describes}`)
    .join("\n");
}

/**
 * Check the model's RAW output before any substitution.
 * @returns {{ ok: boolean, issues: string[] }}
 */
function validateSlotted(raw, slots, { requireFigures = true } = {}) {
  const issues = [];

  // The whole guarantee rests on this one rule. If no digit can survive, no
  // figure can be invented, rounded or converted.
  //
  // Except in the product's own name and in pack sizes. Every SKU name in the
  // catalogue carries a digit ("Japonica Short Grain 5KG"), the prompt header
  // shows that name, and a model that writes it out is naming the product, not
  // stating a figure. Treating it as one rejected answers on EVERY alert type:
  // the 15 Sep diagnosis found IDLE failing placeholder mode 3 runs out of 3 on
  // "wrote figures directly: 5KG" alone, which is most of why llama3 needed
  // 2 to 3 calls per explanation. Pack sizes are the only thing this app
  // measures in KG (stock is in MT), so a KG token cannot be a stock claim.
  const name = slots.product && slots.product.value;
  const withoutNames = (name ? raw.split(name).join(" ") : raw).replace(/\b\d+(?:\.\d+)?\s?KG\b/gi, " ");
  const digits = withoutNames.match(/\d/g);
  if (digits) {
    const sample = withoutNames.match(/[^\s]*\d[^\s]*/g) || [];
    issues.push(`wrote figures directly instead of using placeholders: ${[...new Set(sample)].slice(0, 4).join(", ")}`);
  }

  const used = [...raw.matchAll(PLACEHOLDER)].map((m) => m[1]);
  // ANY brace-wrapped token, not only lowercase ones. "{Product}" is not
  // matched by PLACEHOLDER, so it used to pass validation and reach the reader
  // as literal braces (15 Sep benchmark, TASK-96).
  const tokens = [...raw.matchAll(/\{([^{}]*)\}/g)].map((m) => m[1]);
  const unknown = [...new Set(tokens.filter((n) => !slots[n]))];
  if (unknown.length) issues.push(`used placeholders that do not exist: ${unknown.map((u) => `{${u}}`).join(", ")}`);

  // Only when nothing else supplies figures. With a system-written opening
  // sentence the figures that matter are already present, and rejecting prose
  // that adds none of its own would spend a paid retry for nothing.
  if (!used.length && requireFigures) issues.push("used no placeholders at all, so the explanation states no figures");

  // Placeholder values already carry their unit, so "{days_of_cover} days"
  // renders as "28 days days". Observed on the first real run.
  const doubled = [...raw.matchAll(/\{([a-z_]+)\}\s*('?s?\s*)?(days?|months?|weeks?|years?|MT|SGD|tonnes?)\b/gi)];
  if (doubled.length) {
    issues.push(`repeated a unit after a placeholder: ${[...new Set(doubled.map((m) => `{${m[1]}} ${m[3]}`))].slice(0, 3).join(", ")}`);
  }

  return { ok: issues.length === 0, issues };
}

/**
 * Remove a model's lead-in such as "Here's the explanation:" or "Here is the
 * rewritten alert:". Small models add one whenever a correction pass mentions
 * rewriting. It used to be stripped in placeholder mode only, so free-text
 * fallbacks shipped with it (seen in the 15 Sep benchmark). Shared so both
 * paths strip the same forms.
 */
function stripPreamble(text) {
  return String(text).replace(
    // Also "Here's another attempt at explaining the alert:", seen on 15 Sep
    // after a correction pass.
    /^\s*here(?:'s|\s+is)\s+(?:the\s+|an?\s+|my\s+|another\s+)?(?:revised|rewritten|updated|corrected|new|final|second|better)?\s*(?:explanation|alert|summary|version|answer|attempt|try)\b[^:\n]{0,50}:\s*/i,
    ""
  );
}

/** Substitute values in. Only called once validateSlotted has passed. */
function renderSlots(raw, slots) {
  let out = raw.replace(PLACEHOLDER, (whole, name) => (slots[name] ? slots[name].value : whole));

  // Small models open with "Here is the revised explanation:" whenever the
  // prompt mentions rewriting, which the correction pass always does.
  out = stripPreamble(out);

  // Slot values are complete sentences ending in a full stop, so a model that
  // adds its own produces "...can arrive..". Cosmetic, but it reads as broken.
  out = out.replace(/\.\s*\./g, ".").replace(/\.\s*,/g, ",").replace(/\.\s*:\s*/g, ". ");

  // "This alert was flagged because {product} was flagged because
  // {alert_trigger}": the model wraps the clause's own example in a lead-in of
  // its own. Collapse the repeat rather than print it.
  out = out.replace(/\b(?:this alert|it|this)\s+was flagged because\s+(.{1,80}?)\s+was flagged because\b/gi, "$1 was flagged because");

  // "Vietnam Fragrant Vietnam Fragrant 10KG": the product name appears in the
  // prompt header AND in {product}, and the model writes a prefix of it before
  // the placeholder. Collapse the immediate repeat rather than remove the
  // header, which the model needs in order to know what it is describing.
  const name = slots.product && slots.product.value;
  if (name) {
    const words = name.split(/\s+/);
    for (let n = words.length - 1; n >= 1; n--) {
      const prefix = words.slice(0, n).join(" ");
      out = out.split(`${prefix} ${name}`).join(name);
    }
  }

  return out.trim();
}

module.exports = { buildSlots, describeSlots, validateSlotted, renderSlots, stripPreamble, triggerSentence };
