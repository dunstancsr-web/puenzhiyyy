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
const { buildSlots, describeSlots, validateSlotted, renderSlots } = require("./slots");
const { EVENTS, logEvent } = require("../db/audit");

const SYSTEM = `You are an inventory analyst at a rice importer and distributor in Singapore.

You are explaining ONE alert to a warehouse manager who knows the business but not
the maths. Your job is to make the reasoning legible, not to do the reasoning.

HARD RULES. Breaking any of these makes the answer useless, because a manager is
about to commit money based on it.

1. COPY, NEVER COMPUTE. Every number you write must appear, digit for digit, in
   the figures you were given. Do not add, subtract, average, round, or restate
   a figure in different units.
   Given "Days since last sale: 97 days" you may write "97 days".
   You may NOT write "about 3 months", "over 3 months", or "roughly 100 days".
2. NEVER CONVERT UNITS. Days stay days, MT stays MT, SGD stays SGD.
3. NEVER RENAME WHAT A FIGURE MEASURES. Copy the label you were given.
   "Gross margin at risk" is margin. It is NOT revenue, NOT sales, NOT profit,
   NOT turnover. "Days of cover" is cover, NOT days until a stockout.
4. If a figure was not supplied, do not mention it. Never estimate.
5. Four short paragraphs at most, no paragraph longer than two sentences.
6. Plain English prose. No bullets, no headings, no markdown.
7. Never use an em dash or an en dash. Use a comma, a colon, or a new sentence.
8. End with the single action you would take, stated plainly.

Worked example of the difference:
  Figures:  Days since last sale: 97 days. Gross margin at risk: 26217 SGD.
  CORRECT:  "There have been no sales for 97 days, putting 26217 SGD of gross
             margin at risk."
  WRONG:    "There have been no sales for almost three months, risking about
             26000 SGD in potential sales."
             (converted 97 days into months, rounded the figure, and renamed
             margin as sales)`;

// What each alert actually means, in words, with no digits. Without this the
// model reasoned from the alert NAME and got it backwards: on an IDLE alert it
// wrote "the stock level has fallen below the reorder point, immediately place
// an order", which is the exact opposite of the right call. Slots guarantee the
// figures; only this guarantees the meaning.
const ALERT_BRIEF = {
  STOCKOUT_RISK: "This SKU will run out before a replacement order could arrive. The problem is too little stock. Ordering more, quickly, is the answer.",
  REORDER: "This SKU has reached the level where a normal replenishment order should be placed. There is still time to order at normal freight rates.",
  OVERSTOCK: "This SKU holds more than its maximum policy level. The problem is too much stock. Do NOT suggest ordering more. The answer is to stop or defer buying.",
  IDLE: "This SKU has had no sales at all for a long period. The problem is that capital is trapped in stock nobody is buying. Do NOT suggest ordering more and do NOT mention reorder points. Replenishing is the wrong answer entirely: the decision is how to dispose of what is already held.",
  SLOW_MOVING: "This SKU is selling, but far too slowly for the quantity held. The problem is too much stock relative to demand. Do NOT suggest ordering more. The answer is to buy less next time.",
  AGEING: "This SKU has been in the warehouse a long time and is approaching its holding limit. The problem is time, not quantity. The answer is to move it before quality becomes the binding constraint.",
};

const SLOT_SYSTEM = `You are an inventory analyst at a rice importer and distributor in Singapore.

You are explaining ONE alert to a warehouse manager who knows the business but not
the maths. Your job is to make the reasoning legible, not to do the reasoning.

THE ONE RULE THAT MATTERS: you may not write any digit, anywhere. Every quantity,
duration, price and percentage must be inserted with a placeholder from the list
you are given, written exactly as {placeholder_name}. The real values are
substituted after you finish, and they already include their units, so never
write a unit next to a placeholder.

  CORRECT:  "Stock will last {days_of_cover}, but {supplier} needs {lead_time}."
  WRONG:    "Stock will last 28 days."              (wrote a figure)
  WRONG:    "Stock will last {days_of_cover} days." (added a unit)
  WRONG:    "Stock will last {cover_remaining}."    (invented a placeholder)

The other rules:
1. Use only placeholders from the list. Nothing else is available to you.
2. Never rename what a placeholder measures. The list says what each one is.
   Margin is not revenue. Capital tied up is not sales.
3. Do not hedge. No "about", "roughly", "almost", "nearly", "approximately".
   The substituted values are exact, so an approximation word makes them wrong.
4. Four short paragraphs at most, no paragraph longer than two sentences.
5. Plain English prose. No bullets, no headings, no markdown.
6. Never use an em dash or an en dash. Use a comma, a colon, or a new sentence.
7. End with the single action you would take, stated plainly.`;

// The facts block. Deliberately labelled rather than raw JSON: naming the unit
// beside every number is what stops a model calling margin "sales".
function buildFacts(sku, alert) {
  const L = [];
  const add = (label, value, unit = "") => {
    if (value === null || value === undefined || value === "") return;
    L.push(`${label}: ${value}${unit}`);
  };
  const addIf = (cond, label, value, unit = "") => { if (cond) add(label, value, unit); };

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
  // Same treatment as days since last sale, for the field that fix missed. The
  // slow movers carry 200 to 300 days of cover, and models reached for "nearly
  // a year" or "several weeks" because months only appeared buried inside the
  // alert sentence rather than as a figure of its own. A labelled figure anchors
  // where prose does not.
  // The engine's own formatted string, never a recomputation. A first version
  // divided by 30.44 and produced "9.1 months" beside an alert sentence already
  // saying "9.3 months": the same one-question-two-answers defect as the
  // suggested order quantity, and it would have handed the model two conflicting
  // figures and then penalised it for picking either.
  add("Days of cover remaining, written out", sku.days_of_cover_text);
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

  // Long day counts also get their month equivalent. Models reach for "about
  // three months" because that is how a person says 97 days, and forbidding the
  // conversion did not stop it: llama3.1 converted this exact figure in 4 runs
  // out of 4. Supplying the conversion removes the reason to perform one, which
  // works better than a rule telling it not to.
  add("Days since last sale, written out", sku.days_since_last_sale_text);

  // Money figures, only when non zero. "Gross margin at risk: 0 SGD" on an idle
  // SKU is noise the model then has to decide what to do with.
  addIf(sku.lost_margin_risk > 0, "Gross margin at risk if it stocks out", sku.lost_margin_risk, " SGD");
  addIf(sku.eo_value_risk_adjusted > 0, "Write down risk if it stays unsold", sku.eo_value_risk_adjusted, " SGD");
  addIf(sku.overstock_carrying_cost > 0, "Overstock carrying cost per year", sku.overstock_carrying_cost, " SGD");

  // The alert message quotes a figure like "SGD 250K tied up" with no labelled
  // fact anywhere saying what it is, so the model had to guess and guessed
  // "sales". qwen3 renamed it on 3 of 4 runs. Naming it, and naming what it is
  // NOT, is the fix: the label does the work the rule could not.
  addIf(sku.eo_value > 0,
    "Capital tied up in this stock, valued at cost (this is NOT sales, NOT revenue)",
    sku.eo_value, " SGD");

  add("Supplier", sku.supplier);

  return L.join("\n");
}

// ── Drift verification ───────────────────────────────────────────────────────
//
// Prompting alone does not make a small model reliable, it only makes it more
// often right. This is the deterministic half: check what the model wrote
// against the figures it was given, and treat any mismatch as drift.
//
// Four checks, each aimed at a failure actually observed from llama3 on this
// data rather than at a hypothetical one.

function normaliseNumber(raw) {
  const m = String(raw).replace(/,/g, "").match(/^(\d+(?:\.\d+)?)([km])?$/i);
  if (!m) return null;
  const n = parseFloat(m[1]);
  if (!Number.isFinite(n)) return null;
  return n * (m[2] ? (m[2].toLowerCase() === "k" ? 1e3 : 1e6) : 1);
}

function numbersIn(text) {
  const out = [];
  for (const m of String(text).matchAll(/\b(\d[\d,]*(?:\.\d+)?)\s*([km])?\b/gi)) {
    const n = normaliseNumber(m[1] + (m[2] || ""));
    if (n !== null) out.push(n);
  }
  return out;
}

// Tolerance covers PRESENTATION only. 26217 rendered as 26.2K is the same fact
// (0.06% apart); rendered as 26000 it is a rounded claim (0.83% apart), which
// rule 1 forbids. An earlier 1% tolerance let exactly that through, so the
// threshold sits below the gap between those two cases.
function isSupported(n, allowed) {
  return allowed.some((a) => {
    if (a === n) return true;
    const scale = Math.max(Math.abs(a), Math.abs(n));
    return scale > 0 && Math.abs(a - n) / scale <= 0.003;
  });
}

// Hedging is rounding done in words. "About 26000" and "almost three months"
// are the same failure as writing a wrong number.
const HEDGES = /\b(about|roughly|almost|nearly|approximately|around|circa|ballpark)\b/i;

// How "97 days" became "three months": a duration written as a word plus a unit
// nobody supplied.
const WORD_DURATION = /\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|a|an)\s+(month|week|year|quarter)s?\b/i;

// A money amount described as sales, revenue, profit or turnover. The only
// currency figures supplied are margin at risk, write down risk and carrying
// cost. Matched as a window around the amount rather than as a bare word,
// because "no sales for 97 days" is legitimate and must not trip this.
const RENAMED_MONEY = /(?:SGD|\$)\s*[\d.,]+\s*[KM]?\b(?:\W+\w+){0,3}\W+(sales|revenue|profit|turnover)\b/i;

/**
 * @returns {{ ok: boolean, issues: string[] }}
 */
function verifyExplanation(text, facts) {
  const issues = [];

  const allowed = numbersIn(facts);
  // Small integers are how prose counts things ("the two options"), not claims
  // about inventory, so they are not treated as figures.
  const invented = [...new Set(numbersIn(text).filter((n) => n > 12 && !isSupported(n, allowed)))];
  if (invented.length) issues.push(`figures not in the source data: ${invented.join(", ")}`);

  const hedge = text.match(HEDGES);
  if (hedge) issues.push(`approximated a figure with "${hedge[1]}"`);

  const dur = text.match(WORD_DURATION);
  if (dur && !new RegExp(dur[2], "i").test(facts)) {
    issues.push(`converted a duration into ${dur[2]}s, a unit that was not supplied`);
  }

  const renamed = text.match(RENAMED_MONEY);
  if (renamed) issues.push(`described a money figure as "${renamed[1]}"`);

  return { ok: issues.length === 0, issues };
}

const MAX_ATTEMPTS = 2;

// Not every rule break is equally harmful, and the benchmark showed the split
// clearly. Across 28 runs llama3 broke a rule 5 times and every single one was
// a hedge word: "almost 78 MT" where the figure itself was correct. llama3.1
// and qwen3, by contrast, invented a figure and renamed money as sales or
// revenue, which puts a wrong number in front of someone about to commit cash.
//
// So the policy splits on harm rather than on count:
//
//   dangerous  a wrong number, or a right number under the wrong name. Retry,
//              and if the second attempt is still wrong the loop rejects it and
//              the reader falls back to the audited trace. Never shown.
//   cosmetic   hedging. The figure is right, the wording is loose. Worth one
//              cheap correction, not worth failing over, and definitely not
//              worth a third paid call to delete the word "almost".
//
// Rejecting is not failing. The deterministic four step trace is a complete,
// correct explanation on its own, so the cost of refusing a bad summary is that
// the reader sees slightly drier prose.
const DANGEROUS = [
  "figures not in the source data",  // invented or rounded a number
  "described a money figure as",     // margin called revenue, capital called sales
  "converted a duration",            // 97 days restated as three months
];

// Shared so the retry policy and scripts/bench-models.js cannot disagree about
// what counts as serious.
function isDangerous(issues) {
  return issues.some((i) => DANGEROUS.some((d) => i.startsWith(d)));
}

function onDriftDetected({ attempt, issues }) {
  // Hedging alone is accepted immediately, with no retry at all. Measured
  // reason: after the facts fix, hedging rose from 12 occurrences to 21 while
  // every dangerous category fell to zero, and in each of those cases the FIGURE
  // was correct and only the wording was loose. Retrying to delete the word
  // "nearly" would have spent a paid call on every one of those 21, to change
  // nothing a manager would act on differently.
  if (!isDangerous(issues)) return "accept";
  return "retry";
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
  const slots = buildSlots(sku, alert);
  const started = Date.now();

  // Two modes, tried in order of how strong a guarantee they give.
  //
  //   slots      the model writes prose with named placeholders and no digits
  //              at all, and the engine's values are substituted afterwards.
  //              Stating a figure the engine did not compute is not merely
  //              detectable here, it is unrepresentable.
  //   freetext   the original path, where the model writes figures itself and
  //              verifyExplanation checks them afterwards. Kept as a fallback
  //              so a model that cannot follow the placeholder format still
  //              produces something, rather than the feature disappearing.
  //
  // Below both sits the deterministic trace in frontend/src/lib/explain.js,
  // which is a complete and correct explanation on its own.
  let result = null;
  let rendered = null;
  let check = { ok: true, issues: [] };
  let attempts = 0;
  let mode = "slots";

  // Deliberately contains no digits. The alert message and the recommended
  // action are offered as placeholders instead of being pasted in, because a
  // prompt that forbids digits while displaying them is a contradiction the
  // model resolves by copying.
  const slotUser = `Here is the alert.\n\nProduct: ${sku.product_name}\nAlert type: ${alert.alert_type}\nSeverity: ${alert.severity}\n\nPlaceholders available to you:\n${describeSlots(slots)}\n\nWhat this alert means: ${ALERT_BRIEF[alert.alert_type] || "Review this SKU."}\n\nExplain why this was flagged and what the manager should do. End with one sentence that states {recommended_action} on its own.`;
  const freeUser = `Here are the figures for this alert.\n\n${facts}\n\nExplain why this was flagged and what the manager should do.`;

  for (attempts = 1; attempts <= MAX_ATTEMPTS + 1; attempts++) {
    // After MAX_ATTEMPTS of placeholder mode, drop to the free text path for a
    // final try rather than giving up on a written explanation entirely.
    if (attempts > MAX_ATTEMPTS) mode = "freetext";

    const correction = check.issues.length
      ? `\n\nYour previous answer broke the rules: ${check.issues.join("; ")}.\nWrite it again, correctly.`
      : "";
    const system = mode === "slots" ? SLOT_SYSTEM : SYSTEM;
    const user = (mode === "slots" ? slotUser : freeUser) + correction;

    result = await chat({ system, user });

    if (mode === "slots") {
      // Structural check on the RAW output, before substitution. This is the
      // step that makes a wrong figure impossible rather than merely caught.
      const structural = validateSlotted(result.text, slots);
      if (!structural.ok) {
        check = structural;
        continue;
      }
      rendered = renderSlots(result.text, slots);
    } else {
      // Free text mode has no placeholders, but a model that has just been
      // corrected in slot mode sometimes carries the habit over and emits
      // "{days since last sale}". Strip anything brace-wrapped rather than
      // print it.
      rendered = result.text.replace(/\{[^{}]*\}/g, "").replace(/\s{2,}/g, " ").trim();
    }

    // Slots cannot stop the model calling a margin figure "sales" or hedging
    // with "nearly": those are the words around the number, and they stay the
    // model's own. So the verifier still runs, on the rendered text.
    check = verifyExplanation(rendered, facts);
    if (check.ok) break;

    const action = onDriftDetected({ attempt: attempts, issues: check.issues, text: rendered });
    if (action === "accept") break;
    if (attempts === MAX_ATTEMPTS + 1) {
      throw new LlmUnavailable(
        `The model's answer did not match the source figures after ${attempts} attempts (${check.issues.join("; ")}).`
      );
    }
  }

  if (!rendered) {
    throw new LlmUnavailable(
      `The model could not produce a usable explanation (${check.issues.join("; ")}).`
    );
  }

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
      mode,
      slots_offered: Object.keys(slots).length,
    },
    output: {
      explanation: rendered,
      raw_template: mode === "slots" ? result.text : null,
      latency_ms: ms,
      attempts,
      verified: check.ok,
      drift_issues: check.issues.length ? check.issues : null,
      input_tokens: result.usage?.input_tokens ?? null,
      output_tokens: result.usage?.output_tokens ?? null,
    },
  });

  const value = { text: rendered, mode, model: result.model, provider: result.provider, usage: result.usage };
  if (key) cache.set(key, { at: Date.now(), value });
  return { ...value, cached: false };
}

module.exports = { explainAlert, providerInfo, LlmUnavailable, buildFacts, cacheKey, verifyExplanation, isDangerous, SYSTEM };
