// ─────────────────────────────────────────────────────────────────────────────
// MARKET SIGNAL ENGINE
//
// Turns "something happened in the news" into "here is what it does to THIS
// stock, and what to order". Deterministic end to end, and it never calls a
// model. A model may be used upstream to READ a headline into the fixed shape
// below (event_type, severity, country, varieties); everything after that is
// arithmetic on figures the other engines already own.
//
//   signal (country, event_type, severity, varieties)
//        |  matchSignal            which SKUs does it touch      (plain filter)
//        |  playbookDays           how many days does it cost     (fixed table)
//        |  scenarioFor            what happens to cover and PO   (projection.js)
//        v  proposal               order by / order at least      (needs approval)
//
// Why days come from a table and not from the model or the article: a model
// that writes "expect a 3 week delay" is inventing a figure, which is the one
// thing this system promises never to do. The table is an editable, documented
// ASSUMPTION, deliberately in the same units and sizes as the seeded
// risk_events (21 days for an India-style restriction, 10 for port congestion),
// and every proposal shows the range it used so the manager can disagree.
//
// A signal is expressed as DELAYED SUPPLY (days), the same currency the existing
// risk buffer uses. An export ban and a port strike both mean "stock you expect
// arrives later, or costs more days of lead time to obtain".
// ─────────────────────────────────────────────────────────────────────────────

const { projectInventory } = require("./projection");

const DAY_MS = 86_400_000;

// [low, high] extra days of supply lost or delayed, by event type and severity.
// Assumptions, not measurements. Kept small and legible so a manager can argue
// with a row. `easing` events never reach this table: they release, not add.
const PLAYBOOK = Object.freeze({
  export_restriction:     { high: [21, 30], medium: [10, 21], low: [5, 10] },
  port_logistics:         { high: [14, 21], medium: [7, 14],  low: [3, 7] },
  availability_tightening:{ high: [14, 28], medium: [7, 14],  low: [3, 7] },
  weather_harvest:        { high: [14, 30], medium: [7, 14],  low: [3, 7] },
});

const EVENT_TYPES = Object.freeze(Object.keys(PLAYBOOK));
const SEVERITIES = Object.freeze(["low", "medium", "high"]);
const DIRECTIONS = Object.freeze(["tightens", "eases", "neutral"]);

const round1 = (n) => Math.round(n * 10) / 10;
const isoDay = (ms) => new Date(ms).toISOString().slice(0, 10);

/** The [low, high] day range for a signal, or null if it has no playbook row. */
function playbookDays(eventType, severity) {
  const row = PLAYBOOK[eventType];
  return row && row[severity] ? row[severity] : null;
}

// True when `variety` is the named kind of rice. A plain substring test gets rice
// wrong in exactly the case that matters: "Non-Basmati" contains "basmati", so
// asking whether a non-basmati SKU is basmati would say yes. The lookbehind makes
// "basmati" mean basmati and not the word left over after "non-".
function isVariety(variety, term) {
  const t = String(term).trim().toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?<!non[- ])\\b${t}\\b`, "i").test(String(variety || ""));
}

/**
 * Does this signal touch this SKU?
 *
 * By country of origin or by supplier, exactly as riskbuffer.js matches. Plus a
 * refinement that matters for honesty: a signal may name the varieties it affects
 * (`affects_varieties`) or exempts (`excludes_varieties`), and a SKU on the wrong
 * side is NOT flagged. India's 2023 ban was on NON-basmati white rice, so a
 * basmati SKU from India must not raise an alarm. A tool that cries wolf on the
 * first headline is a tool people stop reading.
 *
 * @returns {{ match: boolean, reason: string }}
 */
function matchSignal(signal, sku) {
  const byCountry = signal.country_of_origin && signal.country_of_origin === sku.country_of_origin;
  const bySupplier = signal.supplier && signal.supplier === sku.supplier;
  if (!byCountry && !bySupplier) return { match: false, reason: "different origin and supplier" };

  const affected = signal.affects_varieties;
  if (Array.isArray(affected) && affected.length > 0 && !affected.some((v) => isVariety(sku.rice_variety, v))) {
    return { match: false, spared: true, reason: `${sku.rice_variety} is not one of the kinds covered` };
  }
  const excluded = signal.excludes_varieties;
  if (Array.isArray(excluded) && excluded.some((v) => isVariety(sku.rice_variety, v))) {
    return { match: false, spared: true, reason: `${sku.rice_variety} is exempt` };
  }
  return { match: true, reason: bySupplier ? "same supplier" : "same country of origin" };
}

/**
 * What one delay does to one SKU.
 *
 * Runs the existing projection twice, once as things stand and once with every
 * open purchase order pushed back by `delayDays`, and once more out to the point
 * a NEW order placed today would arrive (lead time plus the delay).
 *
 * @param {object} sku      an enriched SKU from buildAnalytics (needs the fields read below)
 * @param {number} delayDays
 * @param {number} asOf     ms
 */
function scenarioFor(sku, delayDays, asOf) {
  const daily = Number(sku.avg_daily_usage_30d) || 0;
  const available = Number(sku.available_qty) || 0;
  const lead = Math.max(0, Math.round(Number(sku.lead_time_days) || 0));
  const arrival = lead + delayDays;

  const delayedPos = (sku.open_pos || []).map((po) => ({
    ...po,
    eta: po.eta ? isoDay(new Date(po.eta).getTime() + delayDays * DAY_MS) : po.eta,
  }));

  const run = (openPos, days) =>
    projectInventory({ availableQty: available, dailyDemand: daily, openPos, days, asOf });

  // Where does the stock actually run out, if the open POs slip by the delay?
  // Looked at over a horizon long enough to include the delayed arrival.
  const horizon = Math.max(arrival, 30) + 30;
  const delayed = run(delayedPos, horizon);
  const baseline = run(sku.open_pos || [], horizon);

  const stockoutDelayed = delayed.first_stockout_date;
  const stockoutBaseline = baseline.first_stockout_date;
  const stockoutDay = stockoutDelayed
    ? Math.round((new Date(stockoutDelayed).getTime() - asOf) / DAY_MS)
    : null;

  // What would ALREADY be true with no signal at all. A SKU whose cover is shorter
  // than its lead time is short today, and blaming that on a headline would be
  // wrong and would make the tool look alarmist. The two are kept apart so the
  // screen can say "already short by A days; this news adds B more".
  const baselineStockoutDay = stockoutBaseline
    ? Math.round((new Date(stockoutBaseline).getTime() - asOf) / DAY_MS)
    : null;
  const gapWithoutSignal = baselineStockoutDay == null ? 0 : Math.max(0, lead - baselineStockoutDay);

  // Position on the day a new order, placed today, would land under the delay.
  const atArrival = run(delayedPos, arrival);
  const positionAtArrival = atArrival.curve[atArrival.curve.length - 1].projected_available;
  const target = Number(sku.target_stock) || 0;
  const orderQty = Math.max(0, round1(target - positionAtArrival));

  // Days between today and the last day an order can be placed and still land
  // before stock runs out. Negative or zero means: too late already.
  const latestOrderInDays = stockoutDay == null ? null : stockoutDay - arrival;

  return {
    delay_days: delayDays,
    new_order_arrives_in_days: arrival,
    stockout_date: stockoutDelayed,
    stockout_date_without_signal: stockoutBaseline,
    stockout_in_days: stockoutDay,
    // Days with nothing on the shelf between running out and the earliest
    // possible replenishment. 0 when stock lasts until a new order could land.
    days_without_stock: stockoutDay == null ? 0 : Math.max(0, arrival - stockoutDay),
    // The part of that gap that exists with no signal, and what the news adds on top.
    days_without_stock_without_signal: gapWithoutSignal,
    days_added_by_signal: Math.max(0, (stockoutDay == null ? 0 : Math.max(0, arrival - stockoutDay)) - gapWithoutSignal),
    latest_order_in_days: latestOrderInDays,
    latest_order_date: latestOrderInDays == null ? null : isoDay(asOf + Math.max(0, latestOrderInDays) * DAY_MS),
    position_at_arrival_mt: round1(positionAtArrival),
    order_qty_mt: orderQty,
    // Extra tonnes beyond what the normal (no signal) suggestion already asks for.
    extra_over_normal_mt: Math.max(0, round1(orderQty - (Number(sku.suggested_order_qty) || 0))),
  };
}

/**
 * Urgency of the proposal, from the WORSE end of the range so a manager is
 * warned by the plausible bad case rather than reassured by the good one.
 *   act_now   stock runs out before a new order could arrive even if placed today
 *   order_soon there is a window, but it closes within two weeks
 *   monitor   comfortable margin under both ends of the range
 */
function urgencyOf(worst) {
  if (worst.days_without_stock > 0) return "act_now";
  if (worst.latest_order_in_days != null && worst.latest_order_in_days <= 14) return "order_soon";
  return "monitor";
}

/**
 * The full assessment of one signal against the whole portfolio.
 *
 * @param {object} signal   a market_signals row (arrays already parsed)
 * @param {object[]} skus   buildAnalytics(db).skus
 * @param {number} asOf     ms
 * @returns {{ playbook: number[]|null, exposures: object[], not_affected: object[] }}
 */
function assessSignal(signal, skus, asOf = Date.now()) {
  const range = signal.direction === "tightens" ? playbookDays(signal.event_type, signal.severity) : null;
  const exposures = [];
  const notAffected = [];

  for (const sku of skus) {
    const m = matchSignal(signal, sku);
    if (!m.match) {
      // Only interesting to show when the origin DID match but something
      // excluded it: that is the "we did not cry wolf" evidence.
      if (m.spared) {
        notAffected.push({ sku_id: sku.sku_id, product_name: sku.product_name, reason: m.reason });
      }
      continue;
    }
    if (!range) {
      exposures.push({ sku_id: sku.sku_id, product_name: sku.product_name, match_reason: m.reason, urgency: "informational", low: null, high: null });
      continue;
    }
    const low = scenarioFor(sku, range[0], asOf);
    const high = scenarioFor(sku, range[1], asOf);
    exposures.push({
      sku_id: sku.sku_id,
      product_name: sku.product_name,
      match_reason: m.reason,
      days_of_cover: sku.days_of_cover,
      lead_time_days: sku.lead_time_days,
      available_qty: sku.available_qty,
      urgency: urgencyOf(high),
      low,
      high,
    });
  }

  const rank = { act_now: 0, order_soon: 1, monitor: 2, informational: 3 };
  exposures.sort((a, b) => rank[a.urgency] - rank[b.urgency]);
  return { playbook: range, exposures, not_affected: notAffected };
}

module.exports = {
  PLAYBOOK, EVENT_TYPES, SEVERITIES, DIRECTIONS,
  playbookDays, isVariety, matchSignal, scenarioFor, urgencyOf, assessSignal,
};
