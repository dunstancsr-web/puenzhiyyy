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

// ── Slots withheld per alert type ────────────────────────────────────────────
//
// Slots guarantee every FIGURE is real. They do not guarantee the model puts
// the right two figures side by side, and that gap produced a wrong sentence on
// the first live gateway call (2026-09-14):
//
//   "{available_stock} exceeds the maximum policy level of {max_stock}
//    by {overstock_amount}"   ->   "580 MT exceeds ... 400 MT by 220 MT"
//
// Every value was correct and the sentence was verified. But overstock is
// measured on ON-HAND stock (620 - 400 = 220), available stock is on-hand minus
// reservations, and 580 - 400 is not 220. A reader doing the subtraction
// concludes the numbers are made up, which is exactly the doubt this whole
// module exists to rule out.
//
// Catching that pairing after the fact would mean parsing sentences. Instead
// the slot that cannot belong is not offered, so the pairing is unwritable,
// the same move the no-digits rule makes for invented figures. If the model
// reaches for it anyway, validateSlotted rejects it as an unknown placeholder
// and the retry loop in explain.js asks again.
//
// An entry belongs here only when an alert's TRIGGER is measured on a figure
// that a sibling slot looks interchangeable with. Withholding is not free: the
// model loses a fact, so it is reserved for facts that actively mislead.
const WITHHELD_BY_ALERT = {
  OVERSTOCK: ["available_stock"],
  // REORDER fires on inventory position (available plus inbound). On-hand
  // includes reservations, so it is the bigger, wrong figure to set beside the
  // reorder point, and llama3 used it to write "290 MT is reaching its maximum
  // capacity" on a low-stock alert (TASK-95). The maximum stock level goes for
  // the same reason: a low-stock alert has no use for a ceiling, and offering
  // one hands the model the exact word behind that error.
  REORDER: ["on_hand_stock", "max_stock"],
};

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
    // Only for REORDER, the alert that fires on it, so no other alert's
    // placeholder list grows by one.
    inventory_position: { value: alert?.alert_type === "REORDER" ? mt(sku.inventory_position) : null, describes: "stock available now plus stock already on order and inbound, the figure the reorder rule compares against the reorder point" },
    reserved_stock:     { value: sku.reserved_qty > 0 ? mt(sku.reserved_qty) : null, describes: "stock already promised to confirmed orders" },
    inbound_stock:      { value: sku.expected_incoming_qty > 0 ? mt(sku.expected_incoming_qty) : null, describes: "stock already ordered and on its way" },
    demand_rate:        { value: sku.blended_daily_usage > 0 ? `${sku.blended_daily_usage} MT per day` : null, describes: "how fast this sells" },
    days_of_cover:      { value: sku.days_of_cover_text, describes: "how long current stock will last at that demand rate" },
    lead_time:          { value: days(sku.lead_time_days), describes: "how long the supplier takes to deliver a new order" },
    safety_stock:       { value: sku.safety_stock_days > 0 ? days(sku.safety_stock_days) : null, describes: "the buffer held on top of lead time demand" },
    max_stock:          { value: mt(sku.max_stock), describes: "the maximum stock level policy allows" },
    overstock_amount:   { value: sku.overstock_qty > 0 ? mt(sku.overstock_qty) : null, describes: "how far on-hand stock sits above the maximum, i.e. on-hand stock minus the maximum" },
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
  const withheld = new Set(WITHHELD_BY_ALERT[alert?.alert_type] || []);
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
function validateSlotted(raw, slots) {
  const issues = [];

  // The whole guarantee rests on this one rule. If no digit can survive, no
  // figure can be invented, rounded or converted.
  const digits = raw.match(/\d/g);
  if (digits) {
    const sample = raw.match(/[^\s]*\d[^\s]*/g) || [];
    issues.push(`wrote figures directly instead of using placeholders: ${[...new Set(sample)].slice(0, 4).join(", ")}`);
  }

  const used = [...raw.matchAll(PLACEHOLDER)].map((m) => m[1]);
  const unknown = [...new Set(used.filter((n) => !slots[n]))];
  if (unknown.length) issues.push(`used placeholders that do not exist: ${unknown.map((u) => `{${u}}`).join(", ")}`);

  if (!used.length) issues.push("used no placeholders at all, so the explanation states no figures");

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
    /^\s*here(?:'s|\s+is)\s+(?:the\s+|an?\s+|my\s+)?(?:revised|rewritten|updated|corrected|new|final)?\s*(?:explanation|alert|summary|version|answer)\s*:?\s*/i,
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
  out = out.replace(/\.\s*\./g, ".").replace(/\.\s*,/g, ",");

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

module.exports = { buildSlots, describeSlots, validateSlotted, renderSlots, stripPreamble };
