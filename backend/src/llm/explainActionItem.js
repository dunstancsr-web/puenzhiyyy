// ─────────────────────────────────────────────────────────────────────────────
// ACTION ITEMS EXPLANATION (19 Sep) - the "Why?" for a Nearest Stockout or
// Blind Spot row. Same trust model as Alerts' explain.js (the model narrates,
// never computes, every figure is a substituted placeholder, never a digit
// the model wrote itself), reusing that file's generic pieces
// (validateSlotted/renderSlots/describeSlots/stripPreamble from slots.js,
// calmTone from tone.js, chat/resolveTier/providerInfo/LlmUnavailable from
// provider.js) rather than a parallel pipeline.
//
// Deliberately NOT reusing explain.js's verifyExplanation/semanticIssues:
// those are alert-specific contradiction checks, tuned against failures
// observed on the six alert types. Building an equally-tuned equivalent for
// two new item kinds on day one would be pretending to a rigour this hasn't
// earned yet. What IS reused - the placeholder ban - is the single highest-
// value guarantee anyway: a model literally cannot state a figure it was not
// handed, because there is no digit it is allowed to write. Good enough for
// a first version; a semantic layer can follow once real answers get read.
//
// Voice is deliberately different from Alerts' prose paragraphs (Stan's ask,
// 19 Sep): ELI18, short sentences, point form. That's why this is its own
// system prompt rather than a tweak to explain.js's SYSTEM/SLOT_SYSTEM -
// those were benchmarked against "plain English prose, no bullets" and
// changing that wording risks regressing an already-tuned feature.
// ─────────────────────────────────────────────────────────────────────────────

const { chat, providerInfo, resolveTier, LlmUnavailable } = require("./provider");
const { validateSlotted, renderSlots, describeSlots, stripPreamble, stripDoubledUnits } = require("./slots");
const { calmTone, stripSelfCommentary, tidy } = require("./tone");
const { EVENTS, logEvent } = require("../db/audit");
const { FIELD_GLOSSARY } = require("./fieldGlossary");

const MAX_ATTEMPTS = 2; // fewer than explain.js's - no freetext fallback here, see note above

// stripSelfCommentary moved to tone.js (19 Sep) once askDatabase.js needed
// the same three fixes - see that file for the full history of what each
// rule catches.

const ACTION_ITEM_SYSTEM = `You are explaining an inventory number to a small business owner who has
never seen a spreadsheet formula and does not want to. Explain it like you would to an
18 year old on their first day: simple words, short sentences, no jargon.

THE ONE RULE THAT MATTERS: you may not write any digit, anywhere. Every number,
date and duration must be a placeholder from the list you are given, written
exactly as {placeholder_name}. The real values are substituted after you
finish and already include their units, so never add a unit next to one.

  CORRECT:  "It sells about {demand_rate} on average."
  WRONG:    "It sells about 5 MT a day."          (wrote a figure)
  WRONG:    "It sells about {demand_rate} a day."  (added a unit)

Other rules:
1. Use only placeholders from the list. Nothing else exists.
2. Do not hedge: no "about", "roughly", "approximately" - substituted values are exact.
3. Write 3 to 5 short bullet points, one idea per line, plain text (a leading
   "-" for each line is fine; nothing fancier).
4. Each bullet no longer than one short sentence.
5. Never use an em dash or en dash. Use a comma or a full stop.
6. End with one bullet stating the single thing to do, if anything is being asked.`;

// Withheld per kind (same reasoning as explain.js's TRIGGERS.withhold): a
// figure irrelevant to the question at hand invites the model to misuse it.
const SLOT_DEFS = {
  stockout: (sku, item) => ({
    product:        { value: sku.product_name, describes: "the product name" },
    demand_rate:     { value: sku.avg_daily_usage_30d > 0 ? `${sku.avg_daily_usage_30d} MT per day` : null, describes: FIELD_GLOSSARY.avg_daily_usage_30d.label },
    available_stock: { value: fmtMt(sku.available_qty), describes: FIELD_GLOSSARY.available_qty.label },
    lead_time:       { value: sku.lead_time_days ? `${sku.lead_time_days} days` : null, describes: FIELD_GLOSSARY.lead_time_days.label },
    stockout_in:     { value: item.nearest?.days != null ? `${item.nearest.days} days` : null, describes: "how many days until this is projected to run out or breach its safety buffer" },
    covered:         { value: sku.covered_by_po ? "yes, an order already placed is due before then" : "no, nothing is currently due to arrive in time", describes: "whether an incoming order already covers this" },
    suggested_order: { value: sku.suggested_order_qty > 0 ? fmtMt(sku.suggested_order_qty) : null, describes: "how much the formula suggests ordering" },
  }),
  blindspot: (sku, item) => ({
    product:       { value: sku.product_name, describes: "the product name" },
    whats_missing: { value: item.reason?.whatsMissing, describes: "what data is missing or was left unset" },
    why_it_matters: { value: item.reason?.why, describes: "why that missing data matters" },
    fix:           { value: item.reason?.fix, describes: "what would fix it, in plain words" },
  }),
};

function fmtMt(n) {
  return Number.isFinite(Number(n)) ? `${Math.round(Number(n)).toLocaleString("en-SG")} MT` : null;
}

function buildSlots(kind, sku, item) {
  const def = SLOT_DEFS[kind];
  if (!def) return {};
  const raw = def(sku, item);
  const slots = {};
  for (const [k, v] of Object.entries(raw)) {
    if (v.value !== null && v.value !== undefined && v.value !== "") slots[k] = v;
  }
  return slots;
}

// System-written opening, same move as explain.js's triggerSentence: the
// COMPARISON that produces "28 days" is stated by code, never by the model,
// so the model cannot pair the wrong two numbers together.
function openingSentence(kind, sku, item) {
  if (kind === "stockout" && item.nearest?.days != null) {
    const what = item.isStockout ? "run out" : "breach its safety stock";
    return `${sku.product_name} is projected to ${what} in ${item.nearest.days} days: it sells about ${sku.avg_daily_usage_30d} MT a day, ${sku.available_qty} MT is available now, and the supplier needs ${sku.lead_time_days} days to deliver more.`;
  }
  if (kind === "blindspot" && item.reason) {
    return `${sku.product_name}: ${item.reason.whatsMissing}.`;
  }
  return null;
}

function cacheKey(kind, sku, item, tier) {
  const bucket = (n, step) => (Number.isFinite(Number(n)) ? Math.round(Number(n) / step) * step : "n");
  return [
    tier, kind, sku.sku_id,
    bucket(sku.avg_daily_usage_30d, 1), bucket(sku.available_qty, 10),
    item.nearest?.days ?? "n", item.reason?.whatsMissing ?? "n",
  ].join("|");
}

const cache = new Map();
const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // same 6h window as explain.js

async function explainActionItem({ kind, sku, item, tier }) {
  tier = resolveTier(tier);
  const key = cacheKey(kind, sku, item, tier);
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return { ...hit.value, cached: true };

  const slots = buildSlots(kind, sku, item);
  const opening = openingSentence(kind, sku, item);
  const started = Date.now();
  const spent = { model_calls: 0, input_tokens: 0, output_tokens: 0 };

  const user = `Here is the situation.\n\nPlaceholders available to you:\n${describeSlots(slots)}\n\n` +
    `The opening fact is already written and will appear before your text:\n"${opening}"\n\n` +
    `Do not restate that fact or its figures. In short bullet points, explain what it means for a small ` +
    `business owner and what they should do about it, if anything.`;

  let rendered = null;
  let check = { ok: true, issues: [] };
  let result = null;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const correction = check.issues.length
      ? `\n\nYour previous answer broke the rules: ${check.issues.join("; ")}. Write it again, correctly.`
      : "";
    try {
      result = await chat({ system: ACTION_ITEM_SYSTEM, user: user + correction, tier });
    } catch (err) {
      throw Object.assign(err, { spent });
    }
    spent.model_calls += 1;
    spent.input_tokens += result.usage?.input_tokens || 0;
    spent.output_tokens += result.usage?.output_tokens || 0;

    result = tidy(result); // markdown and dashes removed by rule; see tone.js
    if (result.cutOff) { check = { ok: false, issues: ["the answer was cut off before it finished"] }; continue; }

    result = { ...result, text: stripDoubledUnits(result.text, slots) }; // a doubled unit is fixed by rule, not retried
    const structural = validateSlotted(result.text, slots, { requireFigures: !opening });
    if (!structural.ok) { check = structural; continue; }
    rendered = stripSelfCommentary(renderSlots(result.text, slots));
    check = { ok: true, issues: [] };
    break;
  }

  if (!rendered) {
    logEvent(EVENTS.LLM_CALL, {
      skuId: sku.sku_id,
      input: { item_type: kind, provider: result?.provider, model: result?.model },
      output: { failed: true, reason: check.issues.join("; "), latency_ms: Date.now() - started, ...spent },
    });
    throw Object.assign(new LlmUnavailable(
      `The model's answer failed the explanation checks after ${spent.model_calls} attempts (${check.issues.join("; ")}).`
    ), { spent });
  }

  // Urgency stays allowed only for a real stockout, same URGENT_OK gate
  // tone.js already applies to Alerts - a data gap should never sound urgent.
  rendered = calmTone(stripPreamble(rendered), { alert_type: kind === "stockout" ? "STOCKOUT_RISK" : "BLIND_SPOT" }, slots).text;
  if (opening) rendered = `${opening}\n\n${rendered}`;

  const out = { text: rendered, provider: result.provider, model: result.model, mode: "slots" };

  logEvent(EVENTS.LLM_CALL, {
    skuId: sku.sku_id,
    input: { item_type: kind, provider: result.provider, model: result.model, slots_offered: Object.keys(slots).length },
    output: { explanation: rendered, latency_ms: Date.now() - started, ...spent },
  });

  cache.set(key, { at: Date.now(), value: out });
  return { ...out, cached: false };
}

// The same system-written sentence the model's answer starts with, offered on its own when no model is answering
// (rule-based tier, or a locked paid tier), so the Why? box is never an empty apology. It is computed from the
// row's own figures and states no more than the row does.
function ruleBasedExplanation({ kind, sku, item }) {
  return openingSentence(kind, sku, item);
}

module.exports = { explainActionItem, ruleBasedExplanation };
