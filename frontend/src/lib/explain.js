// ─────────────────────────────────────────────────────────────────────────────
// RULE-BASED WHY? EXPLANATIONS: concise and plain English (TASK-37, TASK-97)
//
// The four-step trace shown under Why? on every alert, and the fallback when
// the model is off, locked or rejected. Rewritten in TASK-97 as a shorter
// version of the TASK-37 original, reviewed by Stan before it replaced it on
// 15 Sep. Side-by-side comparison of old and new wording with real figures:
// docs/(Stan) 2 To review/Reviewed/(Stan) ELI18 EXPLANATIONS DRAFT.md
//
// The brief: explain like the reader is a smart 18-year-old who has never run
// a warehouse. Short sentences, everyday words, every figure still exact and
// still the engine's own. Specifically:
//   - one or two sentences per step, down from three or four
//   - no trade jargon ("blended rate", "throughput", "disposition",
//     "binding constraint", "service level")
//   - "profit" for gross margin only where the figure IS margin, never for
//     revenue; the explanation layer's rule against renaming money still holds
//
// One factual fix over the TASK-37 version, found while drafting. Its stockout step
// said "55 days of cover is the minimum ... Cover is short of that by 17
// days", but 17 is cover against the 45 day LEAD TIME (stockout_gap_days in
// engines/financials.js), not against lead time plus safety stock, where the
// gap is 27. Two true figures, wrongly paired. This version states each against
// what it is actually measured from.
// ─────────────────────────────────────────────────────────────────────────────

const isNum = (n) => n !== null && n !== undefined && n !== "" && Number.isFinite(Number(n));
const mt = (n) => (isNum(n) ? `${Math.round(Number(n)).toLocaleString("en-SG")} MT` : null);
const sgd = (n) => {
  if (!isNum(n)) return null;
  const v = Number(n);
  const a = Math.abs(v);
  if (a >= 1e6) return `SGD $${(v / 1e6).toFixed(2)}M`;
  if (a >= 1e5) return `SGD $${Math.round(v / 1e3).toLocaleString("en-SG")}K`;
  if (a >= 1e3) return `SGD $${(v / 1e3).toFixed(1).replace(/\.0$/, "")}K`;
  return `SGD $${Math.round(v)}`;
};
const days = (n) => (isNum(n) ? `${Math.round(Number(n))} day${Math.round(Number(n)) === 1 ? "" : "s"}` : null);
const dayAdj = (n) => (isNum(n) ? `${Math.round(Number(n))}-day` : null);
// A sentence built from a missing value is dropped, never printed. The
// template literals below turn a missing figure into the word "null" or
// "undefined" rather than failing, so every sentence passes through here: an
// empty SKU record produced "null is available and undefined MT sells each day"
// until it did. A shorter explanation is recoverable; a sentence with a hole in
// it, shown to a manager about to act, is not.
const safe = (str) => (typeof str === "string" && !/\b(null|undefined|NaN)\b/.test(str) ? str : null);
const para = (...parts) => parts.map(safe).filter(Boolean).join(" ");

// The engine's trend flags, in everyday words.
const TREND = { accelerating: "picking up", decelerating: "slowing down", stable: "steady" };
const trend = (t) => TREND[t] || t;

// The order quantity exactly as the alert card states it (alerts.js orderQty):
// the suggested order, but never below the supplier minimum.
const orderQty = (s) => Math.round(Math.max(Number(s.min_order_qty) || 0, Number(s.suggested_order_qty) || 0));

// Plainer headings. The four-step order is unchanged, because it IS the
// reasoning chain: what we see, how, what follows, what to do.
const H = {
  seen: "What we see",
  how: "How we worked it out",
  next: "If we do nothing",
  act: "What to do, and why",
};

function stockoutRisk(s) {
  const needed = Math.round((s.lead_time_days || 0) + (s.safety_stock_days || 0));
  return [
    {
      heading: H.seen,
      body: para(
        `${mt(s.available_qty)} is available and ${s.avg_daily_usage_30d} MT sells each day.`,
        s.days_of_cover != null ? `That lasts ${days(s.days_of_cover)}.` : `Nothing is selling right now, so there is no "days left" figure.`
      ),
    },
    {
      heading: H.how,
      body: para(
        `A new order takes ${days(s.lead_time_days)} to arrive from ${s.supplier || "the supplier"}, so the shelf runs empty ${days(s.stockout_gap_days)} before it lands.`,
        isNum(s.safety_stock_days) && s.safety_stock_days > 0 ? `Adding the ${dayAdj(s.safety_stock_days)} safety buffer, this product should never drop below ${days(needed)} of stock.` : null
      ),
    },
    {
      heading: H.next,
      body: para(
        s.lost_units_risk > 0
          ? `About ${mt(s.lost_units_risk)} of orders go unfilled, losing ${sgd(s.lost_margin_risk)} of gross profit.`
          : `The shelf goes empty before the new stock arrives.`,
        s.lost_30d > 0 ? `This is already happening: ${mt(s.lost_30d)} of orders were missed in the last 30 days.` : null,
        s.abc_class === "A" ? `It is one of your most valuable products.` : null
      ),
    },
    {
      heading: H.act,
      body: para(
        `Order ${mt(orderQty(s))} now. That puts stock back on target when the delivery lands, after counting what sells while you wait.`,
        s.stockout_gap_days > 0 && isNum(s.lost_margin_risk) && s.lost_margin_risk > 0 ? `Faster shipping is worth pricing against the ${sgd(s.lost_margin_risk)} at risk.` : null
      ),
    },
  ];
}

function reorder(s) {
  const differs = Math.abs((s.reorder_point_policy || 0) - (s.reorder_point_suggested || 0)) >= 1;
  return [
    {
      heading: H.seen,
      body: para(
        // Incoming named only when there is some: "plus 0 MT already ordered"
        // reads like a figure worth noticing when it is an absence.
        s.expected_incoming_qty > 0
          ? `${mt(s.inventory_position)} is in stock or on the way (${mt(s.available_qty)} available plus ${mt(s.expected_incoming_qty)} already ordered).`
          : `${mt(s.inventory_position)} is available, with nothing already on order.`,
        `That is at or below the approved reorder point of ${mt(s.reorder_point_policy)}.`
      ),
    },
    {
      heading: H.how,
      body: para(
        `The reorder point is the stock needed to cover sales during the ${dayAdj(s.lead_time_days)} delivery wait, plus a safety buffer.`,
        differs
          ? `The system's own estimate is ${mt(s.reorder_point_suggested)}. Alerts follow the approved ${mt(s.reorder_point_policy)} you set on the Inventory page, so the gap is worth a look.`
          : null
      ),
    },
    {
      heading: H.next,
      body: para(`Stock keeps falling by ${s.avg_daily_usage_30d} MT a day. Once it cannot last the ${dayAdj(s.lead_time_days)} wait, this becomes a stockout alert, and only paying for faster shipping helps.`),
    },
    {
      heading: H.act,
      body: para(`Order ${mt(orderQty(s))}. There is still time to use normal shipping, which is the whole point of ordering now.`),
    },
  ];
}

function idle(s) {
  return [
    {
      heading: H.seen,
      body: para(
        `No sales for ${days(s.days_since_last_sale ?? 90)}.`,
        `${mt(s.available_qty)} is sitting in the warehouse, worth ${sgd(s.eo_value)}.`
      ),
    },
    {
      heading: H.how,
      body: para(`Idle is decided by sales alone: zero sales in 90 days is idle, however much or little is in stock.`),
    },
    {
      heading: H.next,
      body: para(
        isNum(s.eo_value_risk_adjusted) ? `It could lose ${sgd(s.eo_value_risk_adjusted)} of value, ${s.obsolescence_risk_pct}% of what is tied up.` : null,
        s.overstock_qty > 0 ? `It is also ${mt(s.overstock_qty)} over its maximum, so storage costs keep adding up.` : null,
        s.inventory_age_days && s.max_holding_days ? `It has been stored ${days(s.inventory_age_days)} of its ${dayAdj(s.max_holding_days)} limit.` : null
      ),
    },
    {
      heading: H.act,
      body: para(`Buying more cannot help when nobody is buying. The choice is how to clear it: discount it, sell it somewhere else, or donate it. Each gets back less than it cost, so compare them with the write-down, not with a profit, and decide soon, because waiting makes every option worse.`),
    },
  ];
}

function overstock(s) {
  const clears = s.movement_class === "Fast Moving" || s.movement_class === "Normal";
  return [
    {
      heading: H.seen,
      body: para(
        `${mt(s.on_hand_qty)} is on hand, but the maximum is ${mt(s.max_stock)}, so it is ${mt(s.overstock_qty)} over.`,
        s.expected_incoming_qty > 0 ? `Another ${mt(s.expected_incoming_qty)} is already on the way.` : null
      ),
    },
    {
      heading: H.how,
      body: para(
        `The maximum is a limit you set, not the size of the warehouse.`,
        isNum(s.overstock_carrying_cost) ? `Holding the extra stock costs ${sgd(s.overstock_carrying_cost)} a year (${s.annual_carrying_rate_pct}% of its value each year).` : null
      ),
    },
    {
      heading: H.next,
      body: para(
        `That cost keeps adding up while the stock sits there.`,
        s.days_of_cover_text ? `At today's sales pace it lasts ${s.days_of_cover_text}.` : null,
        s.movement_class
          ? clears
            ? `It does sell, so it will clear on its own, just slowly. The real question is whether the maximum is set right.`
            : `It is not selling fast enough to clear on its own, so someone needs to decide what to do with it.`
          : null
      ),
    },
    {
      heading: H.act,
      body: para(
        `Stop buying until someone confirms the extra stock was on purpose, for example to get a bulk discount.`,
        s.expected_incoming_qty > 0 ? `Look at the incoming order first: delaying it is cheaper than dealing with the stock after it arrives.` : null
      ),
    },
  ];
}

function slowMoving(s) {
  return [
    {
      heading: H.seen,
      body: para(
        s.days_of_cover_text
          ? `At today's sales pace, current stock would take ${s.days_of_cover_text} to sell. More than 120 days counts as slow.`
          : `${mt(s.available_qty)} is on hand with almost no sales, so there is no "days left" figure.`,
        s.velocity_trend ? `Sales are ${trend(s.velocity_trend)}.` : null
      ),
    },
    {
      heading: H.how,
      body: para(`That is ${mt(s.available_qty)} of stock divided by the ${s.avg_daily_usage_30d} MT that sells each day.`),
    },
    {
      heading: H.next,
      body: para(
        `${sgd(s.inventory_value)} stays tied up in this product for months.`,
        s.velocity_trend === "decelerating" ? `Because sales are slowing, it may take even longer.` : null,
        `Slow comes before idle, and it is easier to fix while people are still buying.`
      ),
    },
    {
      heading: H.act,
      body: para(`Buy less next time: it costs nothing and stops the pile growing. Run a promotion only if the discount costs less than keeping the stock.`),
    },
  ];
}

function ageing(s) {
  const remaining = (s.max_holding_days || 0) - (s.inventory_age_days || 0);
  const pct = Math.round(((s.inventory_age_days || 0) / (s.max_holding_days || 1)) * 100);
  return [
    {
      heading: H.seen,
      body: para(`Stored for ${days(s.inventory_age_days)} of its ${dayAdj(s.max_holding_days)} limit, ${pct}% of the way there.`),
    },
    {
      heading: H.how,
      body: para(`Age counts from the last delivery. A new delivery resets the clock for the whole product, so older stock underneath can look younger than it is.`),
    },
    {
      heading: H.next,
      body: para(
        remaining > 0 ? `${days(remaining)} left before the limit.` : `The limit has been reached.`,
        `Rice does not go bad overnight, but it gets harder to sell, and past the limit it becomes a quality problem instead of a sales one.`
      ),
    },
    {
      heading: H.act,
      body: para(`Quality and sales should agree a plan before the deadline. Selling at a discount now gets back more than writing it off later.`),
    },
  ];
}

const BY_TYPE = {
  STOCKOUT_RISK: stockoutRisk,
  REORDER: reorder,
  IDLE: idle,
  OVERSTOCK: overstock,
  SLOW_MOVING: slowMoving,
  AGEING: ageing,
};

export function buildExplanation(alert, sku) {
  if (!sku || !BY_TYPE[alert.alert_type]) {
    return {
      degraded: true,
      sections: [
        { heading: H.seen, body: alert.message },
        { heading: "What to do", body: alert.recommended_action },
      ],
    };
  }
  const sections = BY_TYPE[alert.alert_type](sku).filter((s) => s.body && s.body.trim());
  return { degraded: false, sections };
}
