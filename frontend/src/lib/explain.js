// ─────────────────────────────────────────────────────────────────────────────
// EXPLANATION BUILDER (TASK-37)
//
// What "Ask AI" used to return was `alert.message` + `alert.recommended_action`
// concatenated, which is exactly the two lines already printed on the card the
// button sits on. Clicking it added nothing at all: the same sentence, then the
// same sentence, then the quantity a third time.
//
// A useful answer to "why?" is not a restatement of the conclusion, it is the
// chain that produced it. So this builds a four-step trace from fields the
// engines already computed:
//
//   1. What was measured   the inputs, with the windows they came from
//   2. How it was derived  the arithmetic, so the number can be checked by hand
//   3. What happens next   the consequence of doing nothing, priced
//   4. Why this action     the trade-off, and what it costs to be wrong
//
// Two reasons this is not throwaway work pending a real model (TASK-11). The
// structure IS the prompt context: these are precisely the facts a model needs
// to write a good explanation, and assembling them is the part that has to be
// deterministic anyway. And a reader can check every figure against the
// Inventory page, which is the property that makes the explanation trustworthy
// whether a model wrote the prose or not.
//
// Everything here is defensive about missing fields. An alert can outlive a
// change to what the engines compute, and a half-rendered explanation is worse
// than a short one.
// ─────────────────────────────────────────────────────────────────────────────

// Number(null) is 0, and Number("") is 0. Both are finite, so a naive
// Number.isFinite guard lets a MISSING value render as a confident "0 MT" or
// "0 days". A visibly absent sentence is recoverable; a plausible wrong zero in
// an explanation a manager is about to act on is not.
const isNum = (n) => n !== null && n !== undefined && n !== "" && Number.isFinite(Number(n));

const mt = (n) => (isNum(n) ? `${Math.round(Number(n)).toLocaleString("en-SG")} MT` : null);
const sgd = (n) => {
  if (!isNum(n)) return null;
  const v = Number(n);
  const a = Math.abs(v);
  // Thresholds match fmt$ in pages/Dashboard.jsx deliberately. The same figure
  // appearing as "$26.2K" on the dashboard and "$26K" here reads as two
  // different numbers to anyone comparing the two screens.
  if (a >= 1e6) return `SGD $${(v / 1e6).toFixed(2)}M`;
  if (a >= 1e5) return `SGD $${Math.round(v / 1e3).toLocaleString("en-SG")}K`;
  if (a >= 1e3) return `SGD $${(v / 1e3).toFixed(1).replace(/\.0$/, "")}K`;
  return `SGD $${Math.round(v)}`;
};
const day = (n) => (isNum(n) ? `${Math.round(Number(n))} day${Math.round(Number(n)) === 1 ? "" : "s"}` : null);
// Adjectival form, for "a 270-day limit" rather than "a 270 days limit".
const dayAdj = (n) => (isNum(n) ? `${Math.round(Number(n))}-day` : null);

// Drop any sentence that came back null because its input was missing, then
// join. Keeps a section coherent instead of printing "undefined".
const para = (...parts) => parts.filter(Boolean).join(" ");

function stockoutRisk(s) {
  const needed = Math.round((s.lead_time_days || 0) + (s.safety_stock_days || 0));
  return [
    {
      heading: "What was measured",
      body: para(
        `${mt(s.available_qty)} available right now, against demand running at ${s.blended_daily_usage} MT a day.`,
        `That blended rate comes from three windows which currently agree closely: ${s.avg_daily_usage_30d} over 30 days, ${s.avg_daily_usage_60d} over 60, ${s.avg_daily_usage_90d} over 90.`,
        s.velocity_trend ? `The trend is ${s.velocity_trend}, so the rate is unlikely to rescue this on its own.` : null
      ),
    },
    {
      heading: "How it was derived",
      body: para(
        // Guarded: a SKU with no demand has no days of cover, and this sentence
        // used to divide by it and print a confident figure anyway.
        s.days_of_cover != null
          ? `${mt(s.available_qty)} divided by ${s.blended_daily_usage} MT a day is ${day(s.days_of_cover)} of cover.`
          : `Demand is currently zero, so days of cover is Not Applicable rather than a number.`,
        `Replacing it takes ${day(s.lead_time_days)} from ${s.supplier || "the supplier"}, and policy holds ${day(s.safety_stock_days)} of safety stock on top, so ${day(needed)} of cover is the minimum this SKU should ever sit at.`,
        `Cover is short of that by ${day(s.stockout_gap_days)}, which is the projected length of the stockout.`
      ),
    },
    {
      heading: "If nothing changes",
      body: para(
        s.lost_units_risk > 0
          ? `About ${mt(s.lost_units_risk)} of demand goes unfilled, worth ${sgd(s.lost_sales_value_risk)} in revenue and ${sgd(s.lost_margin_risk)} in margin.`
          : `The shelf goes empty before replenishment lands.`,
        s.lost_30d > 0
          ? `This is not hypothetical: ${mt(s.lost_30d)} of demand was already lost in the last 30 days.`
          : null,
        s.abc_class === "A" ? "This is an A-class SKU, so it is among the ones the portfolio can least afford to miss." : null
      ),
    },
    {
      heading: "Why this action",
      body: para(
        `Ordering ${mt(s.suggested_order_qty)} restores the ${mt(s.target_stock)} target measured at the moment the shipment lands, not today.`,
        `Ordering only enough to top up today's shelf would arrive already short, because roughly ${mt((s.blended_daily_usage || 0) * (s.lead_time_days || 0))} gets consumed while the order is in transit.`,
        s.stockout_gap_days > 0 ? `Expediting is worth pricing against the ${sgd(s.lost_margin_risk)} of margin at risk.` : null,
        s.min_order_qty > 0 ? `The supplier minimum is ${mt(s.min_order_qty)}.` : null
      ),
    },
  ];
}

function reorder(s) {
  return [
    {
      heading: "What was measured",
      body: para(
        `Inventory position is ${mt(s.inventory_position)}: ${mt(s.available_qty)} available plus ${mt(s.expected_incoming_qty)} already on order.`,
        // The approved point FIRST, because it is the one this alert fired on
        // (TASK-95). This step used to lead with the calculated value, so the
        // trace named a threshold the alert card beside it did not use.
        `The approved reorder point is ${mt(s.reorder_point_policy)}, and the position has reached it.`
      ),
    },
    {
      heading: "How it was derived",
      body: para(
        `The system's own calculation is lead-time demand plus safety stock: ${mt(s.lead_time_demand_mt)} consumed over the ${day(s.lead_time_days)} wait, plus ${mt(s.safety_stock_mt)} of buffer, which comes to ${mt(s.reorder_point_suggested)}.`,
        `That buffer is sized for a ${Math.round((s.target_service_level || 0) * 100)}% service level against demand variability of ${s.demand_cv} and lead-time variability of ${day(s.lead_time_std_days)}.`,
        // "Alerts and health status follow the approved value" was half true:
        // health status does not use a reorder point at all, it uses days of
        // cover. Only the claim that is true stays.
        Math.abs((s.reorder_point_policy || 0) - (s.reorder_point_suggested || 0)) >= 1
          ? `That calculation differs from the approved ${mt(s.reorder_point_policy)}. This alert follows the approved value, which a manager sets on the Inventory page; the gap between the two is worth a policy review.`
          : null
      ),
    },
    {
      heading: "If nothing changes",
      body: `Position keeps falling at ${s.blended_daily_usage} MT a day. Once cover drops below the ${day(s.lead_time_days)} lead time this becomes a stockout risk rather than a reorder, and at that point expediting is the only remaining lever.`,
    },
    {
      heading: "Why this action",
      body: para(
        `${mt(s.suggested_order_qty)} restores the ${mt(s.target_stock)} target measured at the point the shipment lands.`,
        `There is still time to order at normal freight rates, which is the entire advantage of acting on a reorder alert rather than waiting for the stockout one.`
      ),
    },
  ];
}

function idle(s) {
  return [
    {
      heading: "What was measured",
      body: para(
        `No sales at all for ${day(s.days_since_last_sale ?? 90)}, against a 90-day threshold.`,
        `${mt(s.available_qty)} is sitting in the warehouse, ${sgd(s.eo_value)} of capital.`,
        s.last_sale_date ? `The last recorded sale was ${s.last_sale_date}.` : null
      ),
    },
    {
      heading: "How it was derived",
      body: para(
        `Movement class is assigned on throughput, not on coverage. Zero sales in 90 days is Idle regardless of how much or how little is held.`,
        `Days of cover is reported as Not Applicable here rather than as a number, because dividing by zero demand has no meaningful answer.`,
        s.abc_class ? `Separately, this is a ${s.abc_class}-class SKU by annual consumption value, which is what decides how much the idleness costs.` : null
      ),
    },
    {
      heading: "If nothing changes",
      body: para(
        `Write-down risk is ${sgd(s.eo_value_risk_adjusted)}, which is ${s.obsolescence_risk_pct}% of the value tied up.`,
        s.overstock_qty > 0 ? `The position is also ${mt(s.overstock_qty)} above the maximum stock level, so it carries storage cost on top.` : null,
        s.inventory_age_days && s.max_holding_days
          ? `Stock has been held ${day(s.inventory_age_days)} of a ${dayAdj(s.max_holding_days)} limit, leaving ${day(s.max_holding_days - s.inventory_age_days)} before quality becomes the binding constraint rather than demand.`
          : null
      ),
    },
    {
      heading: "Why this action",
      body: para(
        `No replenishment can help a SKU with no demand, so the only useful decisions are about disposition: discount, move it to a different channel, or donate it.`,
        `Every one of those recovers less than cost. They are being compared against the write-down, not against a profit.`,
        `The choice gets worse the longer it waits, which is why this is flagged as critical despite having no deadline of its own.`
      ),
    },
  ];
}

function overstock(s) {
  return [
    {
      heading: "What was measured",
      body: para(
        `${mt(s.on_hand_qty)} on hand against a maximum of ${mt(s.max_stock)}, so ${mt(s.overstock_qty)} above the ceiling.`,
        s.expected_incoming_qty > 0 ? `A further ${mt(s.expected_incoming_qty)} is already inbound.` : null
      ),
    },
    {
      heading: "How it was derived",
      body: para(
        `The maximum is a policy value on the SKU, not a warehouse capacity limit.`,
        `Carrying cost is ${sgd(s.overstock_carrying_cost)} a year, which is the overage valued at cost and charged at the ${s.annual_carrying_rate_pct}% annual carrying rate.`
      ),
    },
    {
      heading: "If nothing changes",
      body: para(
        `The carrying cost accrues whether or not the stock moves.`,
        s.days_of_cover_text ? `At the current rate this is ${s.days_of_cover_text} of cover.` : null,
        // Split on whether demand will actually drain this, not on Fast alone.
        // A Normal mover with months of cover still clears; it is the policy
        // ceiling that is wrong, not the demand. Telling a manager that stock
        // selling 3 MT a day is "unlikely to clear on demand alone" points them
        // at a discount they do not need.
        s.movement_class
          ? `Movement class is ${s.movement_class}, so ${
              s.movement_class === "Fast Moving" || s.movement_class === "Normal"
                ? "demand will drain this on its own, just slower than the stock policy assumes. The question is the ceiling, not the sell-through"
                : "demand alone is unlikely to clear it, and the position needs an active decision"
            }.`
          : null
      ),
    },
    {
      heading: "Why this action",
      body: para(
        `Overstock is not automatically a mistake. A bulk discount or a hedge against a supply disruption can justify it.`,
        `The point of the alert is that it should be a decision someone made, not a position the system drifted into. Suspending purchasing stops it growing while that is established.`,
        s.expected_incoming_qty > 0 ? `The inbound PO is the first thing to look at, since deferring it is cheaper than disposing of what it delivers.` : null
      ),
    },
  ];
}

function slowMoving(s) {
  return [
    {
      heading: "What was measured",
      body: para(
        s.days_of_cover_text
          ? `${s.days_of_cover_text} of cover on hand, against a 120 day threshold.`
          : `${mt(s.available_qty)} on hand with no measurable demand, so cover cannot be expressed in days.`,
        `Demand is ${s.velocity_trend}.`
      ),
    },
    {
      heading: "How it was derived",
      body: para(
        `Cover is ${mt(s.available_qty)} divided by ${s.blended_daily_usage} MT a day.`,
        `The 30, 60 and 90-day rates are ${s.avg_daily_usage_30d}, ${s.avg_daily_usage_60d} and ${s.avg_daily_usage_90d}, and the trend flag comes from comparing the 30-day rate against the 90-day one.`
      ),
    },
    {
      heading: "If nothing changes",
      body: para(
        `${sgd(s.inventory_value)} stays committed to this SKU for months.`,
        s.velocity_trend === "decelerating" ? `Demand is decelerating, so the real figure is likely worse than the one shown.` : null,
        `Slow moving is the stage before idle. It is cheaper to act on now, while there is still demand to sell into.`
      ),
    },
    {
      heading: "Why this action",
      body: para(
        `Reducing the next order is the lever with no downside: it slows accumulation without touching stock already paid for.`,
        `A promotion is the more aggressive option and is worth it only if the margin given away is less than the carrying cost avoided.`
      ),
    },
  ];
}

function ageing(s) {
  const remaining = (s.max_holding_days || 0) - (s.inventory_age_days || 0);
  return [
    {
      heading: "What was measured",
      body: para(
        `Held ${day(s.inventory_age_days)} against a ${dayAdj(s.max_holding_days)} limit, which is ${Math.round(((s.inventory_age_days || 0) / (s.max_holding_days || 1)) * 100)}% of the way through.`,
        `Status is ${s.ageing_status}.`
      ),
    },
    {
      heading: "How it was derived",
      body: para(
        `Age is measured from the last receipt date${s.last_received_date ? ` (${s.last_received_date})` : ""}, at SKU level.`,
        `This is a documented simplification: without batch-level tracking, a recent delivery resets the clock on the whole position, so genuinely old stock underneath can be masked.`
      ),
    },
    {
      heading: "If nothing changes",
      body: para(
        remaining > 0 ? `${day(remaining)} remain before the holding limit.` : `The holding limit has been reached.`,
        `Rice does not spoil abruptly, but quality and sellability decline, and past the limit the decision moves from commercial to quality control.`
      ),
    },
    {
      heading: "Why this action",
      body: `QA and commercial need to agree a route before the deadline rather than after it. Moving stock while it is still sellable at a discount recovers more than a quality-driven write-off does.`,
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

/**
 * Build the reasoning trace for one alert.
 *
 * @param {object} alert  the alert row
 * @param {object} [sku]  the enriched SKU it concerns, from GET /api/skus
 * @returns {{ sections: Array<{heading: string, body: string}>, degraded: boolean }}
 *
 * `degraded` is true when the SKU could not be matched, in which case the
 * caller gets the old restated-alert behaviour. That is an honest fallback
 * rather than a silent one: the UI says so.
 */
export function buildExplanation(alert, sku) {
  if (!sku || !BY_TYPE[alert.alert_type]) {
    return {
      degraded: true,
      sections: [
        { heading: "What was measured", body: alert.message },
        { heading: "Recommended action", body: alert.recommended_action },
      ],
    };
  }

  const sections = BY_TYPE[alert.alert_type](sku).filter((s) => s.body && s.body.trim());
  return { degraded: false, sections };
}
