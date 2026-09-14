import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  BarChart, Bar, XAxis, Tooltip, ResponsiveContainer, Cell, LabelList, ReferenceLine,
} from "recharts";
import {
  AlertTriangle, TrendingUp, Clock, PackageX, Repeat, Target,
  ShieldCheck, ChevronDown, X,
} from "lucide-react";
import StatCard from "../components/StatCard";
import ColHint from "../components/ColHint";
import HoverHint from "../components/HoverHint";
import LoadingState from "../components/LoadingState";
import ErrorState from "../components/ErrorState";
import { useCollapsed } from "../hooks/useCollapsed";
import { api } from "../api/inventory";

// The hand-set PRIOR baseline that used to live here is GONE (TASK-85). It was
// eight constants driving every trend arrow on this page, and the dashboard now
// reads real month-end figures from inventory_history instead.
//
// Only ONE arrow survived that change, and the reason is worth keeping: of the
// eight, inventory value is the only metric with a like-for-like historical
// basis. Today's figure is the sum of on-hand times cost, and a past month's is
// the sum of that month's closing times the cost recorded for it: the same
// measurement. Every other KPI on this page is built from rolling 30 and 90 day
// velocity, from current reservations, or from today's policy thresholds, none
// of which are stored per month. Back-computing them would mean comparing a
// rolling window against a calendar month and calling the difference a trend.
//
// So seven arrows were removed rather than faked. The way to get them back is
// to snapshot the KPIs monthly from here on, not to reconstruct them.
function delta(cur, prev, { higherIsBetter = true, unit = "", pp = false } = {}) {
  const diff = +(cur - prev).toFixed(2);
  const dir = diff > 0 ? "up" : diff < 0 ? "down" : "flat";
  const good = diff === 0 ? true : higherIsBetter ? diff > 0 : diff < 0;
  const mag = Math.abs(diff);
  const text = pp ? `${mag} pp` : `${unit}${mag}`;
  return { dir, good, text, diff };
}

const HEALTH_COLORS = { GREEN: "#22c55e", YELLOW: "#f59e0b", ORANGE: "#f97316", RED: "#ef4444" };
const HEALTH_LABEL = { RED: "Critical", ORANGE: "Action", YELLOW: "Watch", GREEN: "Healthy" };
// The same four colours as tokens. HEALTH_COLORS feeds Recharts, which needs a
// resolved value; this feeds the tag pills in Needs Attention, which derive
// their background by appending "-light" and therefore need the token form.
const HEALTH_TOKEN = { RED: "var(--red)", ORANGE: "var(--orange)", YELLOW: "var(--yellow)", GREEN: "var(--green)" };

// Movement axis of the ABC x movement matrix. Must mirror MOVEMENT_COLS in
// backend/src/engines/segmentation.js - the cell keys are built from these.
const MOVE_CODE = { "Fast Moving": "Fast", "Normal": "Normal", "Slow Moving": "Slow", "Idle": "Idle" };
const MOVE_NOTE = { Fast: "high velocity", Normal: "steady", Slow: "low velocity", Idle: "no sales 90d+" };
const ABC_NOTE = { A: "top 80% of value", B: "next 15%", C: "the rest" };

// ── Money formatting - consistent M / K, never mixed ─────────────────────────
// Thousands keep one decimal below $100K. Rounding to whole thousands turned
// $26,217 of carrying cost into "$26K" on a Needs Attention row, which reads as
// a suspiciously round estimate rather than a measured figure, and threw away
// real money at exactly the magnitudes these rows deal in. Above $100K the
// decimal stops earning its place, so it is dropped. A trailing ".0" is trimmed
// so an exact $1,000 still reads "$1K" rather than "$1.0K".
const fmt$ = (v) => {
  const n = Math.abs(v);
  if (n >= 1e6) return `$${(v / 1e6).toFixed(2)}M`;
  if (n >= 1e5) return `$${Math.round(v / 1e3)}K`;
  if (n >= 1e3) return `$${(v / 1e3).toFixed(1).replace(/\.0$/, "")}K`;
  return `$${Math.round(v)}`;
};

// Tonnage, NOT money. Kept separate from fmt$ on purpose: the two were
// conflated once already (Compliance Position is metric tonnes and was being
// rendered as dollars), so quantities get their own formatter with real
// thousands separators and no K/M abbreviation.
const fmtMt = (v) => Math.round(v).toLocaleString("en-SG");

// Trend chip builders (magnitude formatted for the metric type)
const moneyTrend = (d) => ({ dir: d.dir, good: d.good, text: fmt$(Math.abs(d.diff)) });
// ppTrend and numTrend went with the seven arrows they formatted. moneyTrend
// stays: inventory value is the one metric with a real month-on-month basis.

// ── Plain-language help text (ELI18: assume zero prior inventory-ops
// knowledge, but not childish) for every ColHint on this page ─────────────────
//
// `term` is the industry name for a metric whose LABEL is now plain English.
// Six of the eight Key Metrics were named in trade jargon that means nothing
// to the SME owner this project is built for, so the label answers "what risk
// is this?" and the tooltip footer keeps the real term one hover away. Two
// labels, Stockout Risk and Overstock, carry no `term` because they were
// already the plain words and renaming them for symmetry would have traded
// precision for nothing.
//
// Worth knowing, because it is the reason the E&O copy below is as long as it
// is: the five risks a rice trader actually thinks in do NOT map one-to-one
// onto these eight cards. Slow moving and idle are two risks fused into one
// number, and ageing has no card at all - it is a per-SKU status that surfaces
// in Needs Attention. The copy says so rather than letting the reader assume a
// missing risk is an absent one.
const HINTS = {
  heroValue: {
    what: "The total dollar value of every bag of rice currently sitting in the warehouse, valued at what it cost to buy - not what it would sell for.",
    how: "The figure beside it is the change against last month's closing stock, read from stored month-end history rather than a fixed reference. Going up isn't automatically good or bad - check Overstock and Stock That Is Not Selling below to see whether it's deliberate stocking up or stock quietly piling up unsold.\n\nEach bar is split in two. The pale top band is stock that arrived that month; the solid bottom band was already in the warehouse. A bar that stays the same height while the pale band shrinks means you are living off old stock and buying less of it.",
  },
  turnover: {
    term: "Inventory Turnover",
    what: "How many times your entire stock would sell out and get fully replaced in a year, at the current sales pace.",
    how: "Higher is usually better - it means cash isn't sitting on a shelf as unsold rice. A low number alongside a high Stock That Is Not Selling figure means stock is piling up faster than it sells.",
  },
  fillRate: {
    term: "Fill Rate",
    what: "Of everything customers wanted to buy, what percentage did you actually have in stock to sell them? This is stockout risk that has already cost you money, rather than a warning about the future.",
    how: "Should be close to 100%. A drop means real sales were turned away somewhere in the portfolio because of a stockout - check Needs Attention for which SKU.",
  },
  gmroi: {
    term: "GMROI (Gross Margin Return on Inventory)",
    what: "For every $1 of stock sitting in the warehouse, how many dollars of profit did it generate?",
    how: "Above $1 means the inventory earns more than it costs to hold. Below $1 means it's tying up more cash than it's returning.",
  },
  stockoutRisk: {
    what: "The profit you'd lose if the SKUs currently projected to run out actually do run out before the next shipment arrives.",
    how: "Ideally $0. Any number here points to a specific SKU in Needs Attention that needs a purchase order placed now.",
  },
  overstock: {
    what: "The value of stock sitting above the maximum level set for it - more on hand than normal operations need.",
    how: "Overstock ties up cash and warehouse space. It isn't automatically a mistake (e.g. a bulk discount), but it should be a deliberate choice, not a surprise.",
  },
  eo: {
    term: "Excess & Obsolete (E&O)",
    what: "Two risks in one number: stock that is barely selling (slow moving) and stock that hasn't sold at all in 90+ days (idle). Both may need discounting, redirecting, or writing off. The figures underneath split it so you can see which of the two you actually have.",
    how: "A rising share here is money sitting on the shelf not earning its keep. Compare against Times Stock Sold a Year: slow turnover plus a large figure here is the clearest warning sign. The dot beside the label turns amber past 15% of total stock value and red past 30%.\n\nAgeing stock is a third, separate risk and is not in this number. A SKU can be selling perfectly well and still be creeping towards its holding-day limit, so ageing is tracked per SKU and shows up in Needs Attention below.",
  },
  coverageBand: {
    term: "Coverage in Target Band",
    what: "The share of your money sitting at a sensible stock level - not so low you risk running out, not so high you're paying to hold rice nobody has ordered yet.",
    how: "Target is 80% or higher. Below that, too much of the portfolio is either running low or piled up above what's needed. The two figures underneath say which way it is going wrong.",
  },
  compliance: {
    term: "Compliance Position",
    what: "How much rice you are holding above (or below) the buffer a stockpile mandate requires you to keep on hand at all times.",
    how: "A positive figure means you are covered with room to spare. Negative means the buffer is short and needs topping up regardless of what demand looks like. This one is illustrative: the real scheme is company-wide and the required quantity here is a stand-in.",
  },
  needsAttention: {
    what: "Every SKU with an open problem right now - running low, sitting idle, overstocked, or ageing past its shelf-life target - combined into one list instead of three separate ones.",
    how: "Ranked with the most urgent, highest-value problems at the top. Click a bar or cell in the charts on this page to filter this table down to just the SKUs in that category - click it again to clear the filter.\n\nSwitch to All SKUs to include the ones with nothing wrong. They sort to the bottom, so the urgent work stays at the top either way. That is the view to use after clicking the green band in Inventory Health, since healthy SKUs have no exception to list.",
  },
  health: {
    what: "Every SKU sorted into one of four health buckets by real rules - about to run out, needs action soon, worth watching, or genuinely fine - shown by dollar value, not just a headcount.",
    how: "A big red or amber share means a lot of your money is sitting in problem stock, even if it's only a couple of SKUs. Click a colour to filter Needs Attention to just that bucket.",
  },
  abcMovement: {
    what: "Splits every SKU two ways at once: how much of your money it represents (A is the top 80% of annual value, C the last few percent) and how fast it actually sells, from Fast Moving down to Idle, meaning no sales in 90+ days.",
    how: "The corner that costs you is A + Idle: your most valuable stock, not moving. Stop buying it and start a disposition review. A + Fast is the opposite problem, worth tight availability control so it never runs dry. C + Idle is low-priority clearance. Click a cell to filter Needs Attention to those SKUs.",
  },
  coverage: {
    what: "For each SKU: how many days the stock on hand will last (the coloured bar) compared to how many days it takes to get more from the supplier (the tick mark).",
    how: "If the bar doesn't reach the tick mark, you'll run out before the next shipment arrives - a real stockout risk, not just \"low stock\". Click a row to filter Needs Attention to that SKU.",
  },
};

// ── Needs Attention - ranked by urgency + financial exposure ─────────────────
// Merges what used to be three separate, overlapping sections (Today's Top
// Actions, Open Exceptions, Ageing Inventory) into one ranked list. Ageing
// folds onto an existing row's tag/reason for the same SKU (Japonica reads
// as one row tagged "IDLE STOCK · AGEING", not two rows), or gets its own
// row when no other exception applies.
//
// Priority scale, ordered by DEADLINE first and exposure second:
//   1 STOCKOUT RISK  service failure already in progress
//   2 REORDER        has a clock on it, set by supplier lead time
//   3 IDLE STOCK     capital trapped, large, but no deadline
//   4 OVERSTOCK      carrying cost, no deadline
//   5 SLOW MOVING    inefficiency, no deadline
//   6 AGEING         usually folds onto a row above rather than standing alone
// The two working-capital items used to outrank REORDER, which meant a SKU
// about to run out could be pushed off the list by stock that had been sitting
// still for months and would still be sitting still tomorrow. Working capital
// is the more expensive problem; it is never the more urgent one.
function buildNeedsAttention(skus) {
  const actions = [];

  skus
    .filter((s) => s.stockout_gap_days > 0)
    .forEach((s) => {
      // Reads the engine's suggested_order_qty rather than recomputing
      // target_stock - available_qty here. That proxy ignores everything
      // consumed while the order is in transit, and this row used to print a
      // different quantity from the Alerts page for the same SKU.
      // See the orderQty note in backend/src/engines/alerts.js.
      const qty = Math.max(s.min_order_qty, Math.round(s.suggested_order_qty));
      actions.push({
        priority: 1,
        sku_id: s.sku_id,
        name: s.product_name,
        action: `Place PO - ${qty} MT`,
        reason: `${s.days_of_cover}d cover vs ${s.lead_time_days + s.safety_stock_days}d (lead + safety) · ${s.stockout_gap_days}d gap · ${s.expected_incoming_qty > 0 ? `${s.expected_incoming_qty} MT inbound` : "no PO inbound"}`,
        value: s.lost_margin_risk || s.lost_sales_value_risk,
        valueLabel: "lost margin",
        tag: "STOCKOUT RISK",
        tagColor: "var(--red)",
      });
    });

  skus
    // available_qty > 0 matches health.js's RED rule and alerts.js's IDLE
    // alert: a SKU truly at zero stock isn't "idle inventory tying up
    // capital" - it's just empty, and flagging it here contradicted the
    // SKU's own "Healthy, no action required" recommendation.
    .filter((s) => s.movement_class === "Idle" && s.available_qty > 0)
    .forEach((s) => {
      actions.push({
        priority: 3,
        sku_id: s.sku_id,
        name: s.product_name,
        action: "Initiate disposition review",
        reason: `No sales 90+ days · ${s.available_qty} MT · ${s.obsolescence_risk_pct}% write-down risk`,
        value: s.eo_value_risk_adjusted,
        valueLabel: "risk-adj. value",
        tag: "IDLE STOCK",
        tagColor: "var(--yellow)",
      });
    });

  skus
    .filter((s) => s.overstock_qty > 0)
    .forEach((s) => {
      actions.push({
        priority: 4,
        sku_id: s.sku_id,
        name: s.product_name,
        action: "Suspend purchasing",
        reason: `${s.overstock_qty} MT above max · ${s.abc_class} class, ${s.movement_class}`,
        value: s.overstock_carrying_cost,
        valueLabel: "carrying cost / yr",
        tag: "OVERSTOCK",
        tagColor: "var(--purple)",
      });
    });

  skus
    .filter((s) => s.coverage_band === "below" && s.stockout_gap_days === 0 && s.available_qty <= s.reorder_point_policy && s.movement_class !== "Idle")
    .forEach((s) => {
      actions.push({
        priority: 2,
        sku_id: s.sku_id,
        name: s.product_name,
        action: "Procurement review",
        reason: `Available ${s.available_qty} MT at reorder point ${s.reorder_point_policy} MT`,
        value: s.available_qty * (s.unit_price_sgd - s.unit_cost_sgd),
        valueLabel: "margin exposed",
        tag: "REORDER",
        tagColor: "var(--yellow)",
      });
    });

  // Matches alerts.js's SLOW_MOVING rule.
  skus
    .filter((s) => s.movement_class === "Slow Moving" && s.days_of_cover != null && s.days_of_cover > 120)
    .forEach((s) => {
      actions.push({
        priority: 5,
        sku_id: s.sku_id,
        name: s.product_name,
        action: "Reduce next order",
        reason: `${s.days_of_cover_text} of cover · demand ${s.velocity_trend}`,
        value: s.inventory_value,
        valueLabel: "inventory value",
        tag: "SLOW MOVING",
        tagColor: "var(--yellow)",
      });
    });

  // One row per SKU - keep its highest-priority (lowest number) action as
  // the row's action/reason/value, but a SKU can genuinely trip more than
  // one condition at once (e.g. Overstock AND Slow Moving). Don't silently
  // drop the second condition the way a plain first-match-wins dedup would -
  // fold its tag onto the existing row, same idea as the Ageing merge below.
  const bySku = {};
  actions
    .sort((a, b) => a.priority - b.priority || b.value - a.value)
    .forEach((a) => {
      const existing = bySku[a.sku_id];
      if (!existing) {
        bySku[a.sku_id] = { ...a };
      } else if (!existing.tag.includes(a.tag)) {
        existing.tag += ` · ${a.tag}`;
      }
    });
  const rows = Object.values(bySku);

  // Ageing: append onto an existing row for the same SKU, or add its own
  // lowest-priority row when the SKU has no other open exception.
  skus
    .filter((s) => s.ageing_status === "Ageing" || s.ageing_status === "At Risk")
    .forEach((s) => {
      const daysToLimit = s.max_holding_days - s.inventory_age_days;
      const existing = rows.find((r) => r.sku_id === s.sku_id);
      if (existing) {
        existing.tag += " · AGEING";
        existing.reason += ` · ${daysToLimit}d to holding limit`;
      } else {
        rows.push({
          priority: 6,
          sku_id: s.sku_id,
          name: s.product_name,
          action: "Escalate to QA and commercial",
          reason: `Held ${s.inventory_age_days}d against a ${s.max_holding_days}-day limit · ${daysToLimit}d remain`,
          value: s.eo_value_risk_adjusted || 0,
          valueLabel: "risk-adj. value",
          tag: "AGEING",
          tagColor: "var(--yellow)",
        });
      }
    });

  // Full sorted list - deliberately NOT capped here. Capping before the
  // caller's filter is applied would silently hide a real exception whose
  // category just didn't make this function's cut (see NEEDS_ATTENTION_CAP
  // at the call site, applied after filtering).
  return rows.sort((a, b) => a.priority - b.priority || b.value - a.value);
}

// ── The other SKUs: everything with nothing wrong with it ────────────────────
//
// Why this exists. Every chart on this page is a filter source for the table
// above, and Inventory Health is the one whose categories do not all map onto
// an exception. Clicking the GREEN band asked "show me the healthy stock" and
// got back "No open exceptions match this filter", which is technically true
// and completely useless: the four SKUs are healthy, that is the whole point
// of the band, and the table had no way to say so.
//
// So the table gains a second scope rather than a special case for green. The
// rows are deliberately shaped like exception rows (same columns, same stripe,
// same value cell) because they are the same objects seen at a different
// threshold, and a healthy SKU whose stripe is green beside an urgent one
// whose stripe is red is exactly the comparison the toggle exists to allow.
//
// Priority 9 keeps them last under the shared sort, so switching scope APPENDS
// to the worklist rather than reshuffling it. The urgent row stays row one.
function buildNoActionRows(skus, attention) {
  const flagged = new Set(attention.map((a) => a.sku_id));
  return skus
    .filter((s) => s.active !== 0 && !flagged.has(s.sku_id))
    .map((s) => ({
      priority: 9,
      sku_id: s.sku_id,
      name: s.product_name,
      action: "No action required",
      // Real figures, not a reassuring phrase. "Healthy" is a conclusion, and
      // a row that only states the conclusion gives the reader nothing to
      // disagree with. These are the three numbers the health rules actually
      // read, so a sceptical operator can check the verdict rather than
      // trust it.
      reason: `${s.days_of_cover != null ? `${s.days_of_cover}d cover` : "no cover figure"} · ${s.movement_class} · ${fmtMt(s.available_qty)} MT available`,
      // Stock value, not risk. Every other row in this table values a PROBLEM,
      // so the column header "Value" changes meaning here and the label under
      // the figure has to say so.
      value: s.inventory_value,
      valueLabel: "stock value",
      // The tag reads the SKU's OWN health verdict rather than always saying
      // "healthy". Having no open exception and being GREEN are not the same
      // test: a SKU can sit on WATCH for a reason the exception rules do not
      // raise a row for, and painting it green here would have this table
      // contradict the health chart that filtered into it.
      tag: HEALTH_LABEL[s.health_status]?.toUpperCase() || "NO EXCEPTION",
      tagColor: HEALTH_TOKEN[s.health_status] || "var(--green)",
    }))
    .sort((a, b) => b.value - a.value);
}

// How many exception rows show before the reveal - applied AFTER filtering, so
// a filter always searches the full exception list, not just what fit on
// screen.
//
// PARTIAL REVEAL, not collapse-by-default (TASK-57). Collapsing this section
// behind a count was considered and rejected: "7 SKUs need attention" is
// strictly less information than five rows naming which SKUs and what to do
// about them, and operators of dense tools resent a dashboard that hides the
// answer behind a click. Five rows keep the page short while the urgent work
// stays readable without interaction, and the rest is one button away.
// Collapse-by-default is right for a section that is long, situational or
// usually irrelevant, which is why the compliance position is folded. This is
// none of those.
//
// Three rows read in full, and a fourth rendered underneath a fade. The fade
// row is the honest version of a scroll cue: it shows that the list continues
// and roughly how, where a hard cut at row three implies the list simply ends.
// It is decoration over real content, never a fake row, so the count in the
// button still describes rows nobody has read yet.
//
// Tuned 2026-09-13 in frontend/tuners/table-density.html. Kept as one block
// with the tuner's own key names, so its export maps onto this file line for
// line and re-tuning is a paste rather than a hunt through inline styles.
const NA_DENSITY = {
  previewRows: 2,    // rows read in full
  teaseRow:    true, // render one more under the fade
  fadeH:       132,  // px, gradient height
  rowPadY:     9,    // px, vertical cell padding
  cardPad:     22,   // px, card padding
  btnBottom:   0,    // px, under the floating button
  btnPadY:     10,   // px
  btnPadX:     24,   // px
  btnMinW:     208,  // px
  expGap:      3,    // px, above the expanded button
};

const NEEDS_ATTENTION_PREVIEW = NA_DENSITY.previewRows;
const NEEDS_ATTENTION_TEASE = NA_DENSITY.teaseRow ? 1 : 0;

// Cell padding, built once. The SKU cell carries the severity stripe so it
// needs its own left inset, but its vertical padding must match the rest or
// the row's baselines drift apart.
const NA_CELL = `${NA_DENSITY.rowPadY}px 8px`;
const NA_CELL_SKU = `${NA_DENSITY.rowPadY}px 8px ${NA_DENSITY.rowPadY}px 10px`;

// ── Coverage vs (lead time + safety) - one row per SKU, worst gap first ──────
function buildCoverageData(skus) {
  return [...skus]
    .filter((s) => s.days_of_cover !== null)
    .sort((a, b) => {
      const aGap = a.days_of_cover - (a.lead_time_days + a.safety_stock_days);
      const bGap = b.days_of_cover - (b.lead_time_days + b.safety_stock_days);
      return aGap - bGap;
    })
    .slice(0, 7)
    .map((s) => ({
      sku_id: s.sku_id,
      name: s.product_name,
      coverage: s.days_of_cover,
      threshold: s.lead_time_days + s.safety_stock_days,
      onOrder: s.expected_incoming_qty,
      eta: s.incoming_eta_days,
      coveredByPo: s.covered_by_po,
      fill: HEALTH_COLORS[s.health_status],
    }));
}

const toggleFilter = (setFilter, type, value) =>
  setFilter((f) => (f && f.type === type && f.value === value ? null : { type, value }));

function matchesFilter(row, filter, skuIndex) {
  if (!filter) return true;
  const sku = skuIndex.get(row.sku_id);
  if (filter.type === "sku") return row.sku_id === filter.value;
  if (filter.type === "health") return sku?.health_status === filter.value;
  if (filter.type === "segment") return sku && `${sku.abc_class}:${MOVE_CODE[sku.movement_class]}` === filter.value;
  return true;
}

function filterLabel(filter, skuIndex) {
  if (filter.type === "health") return HEALTH_LABEL[filter.value];
  if (filter.type === "segment") return filter.value.replace(":", " · ");
  if (filter.type === "sku") return skuIndex.get(filter.value)?.product_name || filter.value;
  return "";
}

export default function Dashboard() {
  const [skus, setSkus] = useState(null);
  const [stats, setStats] = useState(null);
  const [error, setError] = useState(null);
  // Single active cross-filter, PowerBI-style: click a bar/cell/row in any
  // chart on this page to filter Needs Attention to just those SKUs; click
  // the same one again to clear it. Only one filter active at a time.
  const [filter, setFilter] = useState(null);
  // Deliberately NOT persisted, unlike the collapse state. Collapsing a whole
  // widget is a standing preference; expanding a list to see two more rows is
  // a momentary thing, and restoring it on the next visit would quietly undo
  // the short page it exists to protect.
  const [history, setHistory] = useState(null);
  const [showAllAttention, setShowAllAttention] = useState(false);
  // "exceptions" (the worklist) or "all" (every SKU, healthy ones included).
  // Defaults to exceptions and is not persisted: this table's job is to be the
  // day's worklist, and a reader who opened it up yesterday to inspect a
  // healthy SKU should not find tomorrow's urgent row buried under nine quiet
  // ones. Same reasoning as showAllAttention above.
  const [attentionScope, setAttentionScope] = useState("exceptions");

  // Needs Attention now sits ABOVE the charts that filter it, so clicking a
  // health colour or a matrix cell changes something off screen. Scrolling the
  // table back into view is what keeps that feedback visible, and it is the
  // one real cost of putting the worklist first.
  //
  // Only on SET, never on clear: clearing usually happens at the table's own
  // chip, where the user is already looking, and yanking the page at that
  // moment would be motion with nothing to show for it.
  const attentionRef = useRef(null);
  useEffect(() => {
    if (!filter || !attentionRef.current) return;
    const still = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
    attentionRef.current.scrollIntoView({ behavior: still ? "auto" : "smooth", block: "start" });
  }, [filter]);

  const load = useCallback(() => {
    setError(null);
    setSkus(null);
    setStats(null);
    setFilter(null);
    // 36, the API's own cap, not 24. The chart's ALL window has to mean
    // "everything stored", and asking for exactly as many months as happen to
    // exist today would quietly start lying the first time history grows.
    Promise.all([api.getSkus(), api.getDashboardStats(), api.getDashboardHistory(36)])
      .then(([skusData, statsData, historyData]) => {
        setSkus(skusData); setStats(statsData); setHistory(historyData);
      })
      .catch((err) => setError(err.message || "Failed to load dashboard"));
  }, []);

  useEffect(() => { load(); }, [load]);

  if (error) return <ErrorState message={error} onRetry={load} />;
  if (!skus || !stats) return <LoadingState label="Loading dashboard…" />;

  const s = stats;
  // One trend, and it is measured rather than assumed. `prior` is last month's
  // closing value straight from inventory_history; when there is no prior
  // period the arrow simply does not render, which is the honest result of
  // having nothing to compare against.
  const priorValue = history?.prior?.closing_value_sgd ?? null;
  const t = {
    inventoryValue: priorValue == null
      ? null
      : delta(s.totalInventoryValue, priorValue, { higherIsBetter: false, unit: "$" }),
  };
  const attention = buildNeedsAttention(skus);
  const coverageData = buildCoverageData(skus);
  const skuIndex = new Map(skus.map((sk) => [sk.sku_id, sk]));
  // Filter first, cap for display second - a filter must search every real
  // exception, not just the top slice that happened to fit on screen.
  const filteredAttention = attention.filter((a) => matchesFilter(a, filter, skuIndex));
  // The full list under the current scope. "all" appends the no-action rows
  // rather than building a different table, so the two scopes share one sort,
  // one filter and one set of columns.
  const allRows = attentionScope === "all"
    ? [...attention, ...buildNoActionRows(skus, attention)]
    : attention;
  const filteredRows = allRows.filter((a) => matchesFilter(a, filter, skuIndex));
  const shownAttention = showAllAttention
    ? filteredRows
    : filteredRows.slice(0, NEEDS_ATTENTION_PREVIEW + NEEDS_ATTENTION_TEASE);
  // Counted against the rows READ IN FULL, not against the rows rendered. The
  // teased fourth row is half legible behind the fade, so counting it as seen
  // would make the button under-report what is left.
  const hiddenAttentionCount = showAllAttention
    ? 0
    : Math.max(0, filteredRows.length - NEEDS_ATTENTION_PREVIEW);
  const teasing = !showAllAttention && filteredRows.length > NEEDS_ATTENTION_PREVIEW;
  // The badge counts EXCEPTIONS in both scopes, never the rows on screen. It
  // is the alarm number, and switching to All SKUs must not make the alarm go
  // up: "4" turning into "10" because four healthy rows were revealed would
  // report a portfolio getting worse when nothing changed.
  const attentionTone = filteredAttention.length > 0 ? filteredAttention[0].tagColor : null;
  // How many SKUs the current filter selects, regardless of whether any of
  // them has an exception. This is what makes the empty state able to say
  // "these 4 are healthy" instead of "nothing here".
  const filterSkuCount = filter
    ? skus.filter((sk) => matchesFilter({ sku_id: sk.sku_id }, filter, skuIndex)).length
    : skus.length;


  return (
    <div>
      <PageHeader
        title="Inventory Dashboard"
        subtitle={`${new Date().toLocaleDateString("en-SG", { weekday: "long", year: "numeric", month: "long", day: "numeric" })} · ${s.totalSkus} active SKUs · data as of ${new Date(s.asOf).toLocaleTimeString("en-SG", { hour: "2-digit", minute: "2-digit" })}`}
      />

      {/* ── KEY METRICS ────────────────────────────────────────────────────
          Stan's name for this block, and the one to use when talking about it:
          hero value, baseline comparison, and the two labelled KPI groups.
          Everything in it answers "how are we doing right now" in numbers, and
          nothing in it is a list or a chart, which is what makes it one thing.

          One card, because these are one thought, separated internally by a
          hairline rather than being five floating islands on the page
          background.

          It now carries the heading too. I had argued it did not need one,
          being the first thing on the page, but a name you can only find in a
          source comment is not much of a shared name: seeing "Key Metrics" on
          screen is what makes it usable in conversation. ── */}
      <div className="card" style={{ marginBottom: "var(--space-5)" }}>
        {/* Matches the Section heading treatment exactly, so this card reads as
            a peer of Needs Attention and the rest rather than as a different
            kind of object. No subtitle: the two group labels inside already
            carry the questions this card answers. */}
        <div style={{ fontWeight: 600, fontSize: "var(--text-lg)", marginBottom: "var(--space-4)" }}>
          Key Metrics
        </div>
        {/* The chart FILLS the remaining width rather than sitting at a fixed
            200px with the rest of the card left blank.
 
            An earlier note here rejected justify-content: space-between, and
            it was right at the time: a 200px chart pinned to the right edge of
            a 1300px card left a 700px gap between a number and the chart that
            exists to explain it, reading as two unrelated things. Letting the
            chart grow removes the gap instead of the alignment, so the two stay
            adjacent AND the card stops being 46% empty (measured: content ended
            at 1135px inside a 1605px card).

            This costs no vertical space, which matters: the alternative of
            stacking the chart under the value would push Needs Attention down
            by roughly a chart's height, and that table was deliberately
            promoted to sit as high as possible. */}
        {/* align-items: center, not flex-end. Bottom alignment made sense when
            the chart was a 92px sparkline of the same visual weight as the
            number. The chart now carries a toggle above it and a caption below
            it, so its bars sit in the middle of a 167px block, and bottom
            aligning put the number level with the caption instead of with the
            data. Centring lines the number up with the bars. */}
        <div className="divider" style={{ paddingBottom: "var(--space-5)", marginBottom: "var(--space-5)", display: "flex", alignItems: "center", flexWrap: "wrap", gap: "var(--space-6)" }}>
          <div>
            <div style={{ fontSize: "var(--text-sm)", color: "var(--text-secondary)", fontWeight: 500, marginBottom: 2, display: "flex", alignItems: "center", gap: 5 }}>
              Total Inventory Value
              <ColHint label="Total Inventory Value" what={HINTS.heroValue.what} how={HINTS.heroValue.how} />
            </div>
            {/* Stacked, not inline beside the figure. Baseline-aligned next to
                a 40px number the delta was a 17px tail that read as part of
                the value itself, so "SGD $3.71M" and "$151K" sat on one line
                as two money figures of very different meaning. On its own line
                it reads as a caption to the number, which is what it is. */}
            <div style={{ fontSize: "var(--text-2xl)", fontWeight: 700, color: "var(--text-primary)", lineHeight: 1.1 }}>
              SGD {fmt$(s.totalInventoryValue)}
            </div>
            {/* Deliberately NOT coloured good/bad. A rising inventory value is
                genuinely ambiguous (deliberate stock-up vs stock piling up
                unsold) and this metric's own hint says exactly that, so
                painting it red asserted a judgement the copy disclaims. */}
            {t.inventoryValue && (
              <div title={`Closing stock at ${history?.prior?.period}, valued at the cost recorded for that month`}
                style={{ fontSize: "var(--text-base)", fontWeight: 700, color: "var(--text-secondary)", marginTop: 6 }}>
                {t.inventoryValue.dir === "up" ? "▲" : t.inventoryValue.dir === "down" ? "▼" : "▬"} {moneyTrend(t.inventoryValue).text} vs last month
              </div>
            )}
          </div>
          <HeroChart history={history} />
        </div>

      {/* ── Secondary strip: core numbers, demoted but never hidden. Every
          threshold below has real headroom on both ends (a "bad" tier, not
          just warn/ok) so the status color can actually move instead of
          sitting permanently on one shade - GMROI's line is set at $1 to
          match its own hint text below. ── */}
      {/* Seven loose metrics in one undifferentiated row gave no reason why any
          number sat next to any other. They are grouped here into the two
          competing objectives this project is actually built around (see
          .kiro/steering/project-context.md: "Customer fulfilment (avoid
          stockouts)" vs "Working capital efficiency"). Nearly every decision
          on this dashboard is a trade-off between those two, so the grouping
          is the real framing, not decoration.

          Both rows share one 4-column grid so the cards line up vertically
          between groups; row 1 simply leaves its last cell empty. */}
      <KpiGroup label="Service & availability" note="Can we supply what customers order?" />
      <div className="kpi-grid">
        {/* Plain-English labels since 2026-09-13. The industry term for each
            lives in its hint's `term` field and renders as an "Also called:"
            footer in the tooltip, so nothing is lost, it is one hover away.
            Stockout Risk and Overstock below keep their names: they were
            already plain words. */}
        <StatCard label="Orders We Could Fill" value={`${s.fillRate}%`} icon={ShieldCheck} hint={HINTS.fillRate}
          status={s.fillRate < 90 ? "bad" : s.fillRate < 98 ? "warn" : "ok"} sub={`${s.lostSales30d} MT unfilled`} />
        <StatCard label="Stockout Risk" value={`SGD ${fmt$(s.stockoutRiskMargin)}`} icon={AlertTriangle} hint={HINTS.stockoutRisk}
          status={s.stockoutSkuCount > 0 ? "bad" : "ok"} sub={`${s.stockoutSkuCount} SKU`} />
        {/* Sits with service because the half that matters most here is the
            "below band" share, which is a stockout signal. Its sub-line names
            both sides, since the metric genuinely straddles the two groups. */}
        <StatCard label="Stock Level Just Right" value={`${s.coverageInBandPct}%`} icon={Clock} hint={HINTS.coverageBand}
          status={s.coverageInBandPct < 50 ? "bad" : s.coverageInBandPct < 80 ? "warn" : "ok"}
          sub={`${s.coverage.above.pct}% overstocked · ${s.coverage.below.pct}% at risk`} target="≥ 80%" />
        {/* Fourth column of the service row since 2026-09-14, rather than a
            disclosure of its own below the card. It belongs here on the
            merits: the question it answers is "are we holding enough to meet
            the mandate", which is an availability question, and the row had
            an empty fourth cell that made it look like something was missing.
            Standing alone under a toggle it read as an afterthought.

            compliancePosition is a QUANTITY in metric tonnes (eligible on-hand
            minus required buffer, see financials.js), not money. It used to
            render through fmt$ and displayed "+$1K" for what is actually
            +1,058 MT of rice - wrong unit and, via the K-rounding, wrong
            magnitude too. */}
        <StatCard label="Stockpile Buffer"
          value={`${s.compliancePosition >= 0 ? "+" : ""}${fmtMt(s.compliancePosition)} MT`}
          icon={ShieldCheck} hint={HINTS.compliance} status={s.compliancePosition < 0 ? "bad" : "ok"}
          sub={`${fmtMt(s.complianceEligibleQty)} MT eligible vs ${fmtMt(s.complianceRequiredQty)} MT required · illustrative`} />
      </div>

      <div className="divider" style={{ margin: "var(--space-5) 0" }} />

      <KpiGroup label="Working capital" note="Is cash tied up in the right stock?" />
      <div className="kpi-grid">
        <StatCard label="Times Stock Sold a Year" value={`${s.turnover.toFixed(1)}×`} icon={Repeat} hint={HINTS.turnover}
          status={s.turnover < 2.5 ? "bad" : s.turnover < 4.0 ? "warn" : "ok"} sub={`${s.dio}d of supply`} />
        <StatCard label="Profit per $1 of Stock" value={`$${s.gmroi.toFixed(2)}`} icon={Target} hint={HINTS.gmroi}
          status={s.gmroi < 1.0 ? "bad" : s.gmroi < 1.5 ? "warn" : "ok"} sub="per $1 of stock" />
        <StatCard label="Overstock" value={`SGD ${fmt$(s.overstockValue)}`} icon={TrendingUp} hint={HINTS.overstock}
          status={s.overstockPct > 10 ? "bad" : s.overstockPct > 5 ? "warn" : "ok"} sub={`${s.overstockPct}% of inventory`} />
        {/* Gross E&O is the headline, but the risk-adjusted figure is what the
            Needs Attention rows below actually use. Showing only the gross
            number up here meant the same concept appeared as $1.36M in one
            place and $273K in another with nothing explaining the gap.

            The sub-line now SPLITS the headline rather than restating it as a
            percentage. This card is two distinct risks added together, slow
            moving and idle, and "36.7% of inventory" said nothing about which
            one you have - a portfolio that is all slow moving needs a pricing
            conversation, one that is all idle needs a disposition decision.
            eoPct is dropped from the line rather than squeezed in: three
            dollar figures and a percentage do not fit, the split is the more
            actionable half, and eoPct still drives the status dot with its
            thresholds named in the hint.
            Both figures come from portfolioStats(), which partitions the same
            eoSkus array it summed for the headline, so they add back to it. */}
        <StatCard label="Stock That Is Not Selling" value={`SGD ${fmt$(s.eoValue)}`} icon={PackageX} hint={HINTS.eo}
          status={s.eoPct > 30 ? "bad" : s.eoPct > 15 ? "warn" : "ok"}
          sub={`${fmt$(s.eoSlowValue)} slow moving · ${fmt$(s.eoIdleValue)} idle · ${fmt$(s.eoValueRiskAdjusted)} risk-adjusted`} />
      </div>

      {/* ── One real disclosure: Compliance Position is the only genuinely
          situational number here (illustrative, pending governance approval)
          - Coverage in Target Band moved above since it's a real daily-glance
          figure, not a duplicate of Health-by-Value (different taxonomy:
          below/in/above/idle days-of-cover vs RED/ORANGE/YELLOW/GREEN rules). ── */}
      </div>

      {/* ── Command Deck: four purpose-built widgets, each independently
          collapsible (persisted), each a live filter source for Needs
          Attention - click a bar/cell/row, click again to clear.

          Row order is deliberate: "what needs doing today" (coverage gaps +
          the exception list) sits above the fold, and the portfolio-structure
          analysis (health mix, ABC x XYZ) sits below it. It used to be the
          other way round, which pushed the single most actionable widget on
          the page off-screen behind a segmentation matrix. ── */}
      <div ref={attentionRef} className="dash-row dash-row--full" style={{ marginBottom: "var(--space-5)", scrollMarginTop: "var(--space-5)" }}>
        <Section title="Needs Attention"
          subtitle={attentionScope === "all"
            ? "Every SKU, exceptions first by urgency and exposure, then the ones with nothing wrong"
            : "Every open exception, ranked by urgency then financial exposure"}
          hint={HINTS.needsAttention}
          badge={filteredAttention.length} badgeTone={attentionTone} pad={NA_DENSITY.cardPad}
          collapsible storageKey="needs-attention" defaultOpen
          actions={
            <ScopeToggle value={attentionScope} onChange={(v) => { setAttentionScope(v); setShowAllAttention(false); }}
              counts={{ exceptions: attention.length, all: skus.filter((sk) => sk.active !== 0).length }} />
          }>
          {filter && (
            <div style={{
              display: "inline-flex", alignItems: "center", gap: 6, fontSize: "var(--text-sm)", fontWeight: 600,
              background: "var(--blue-light)", color: "var(--blue)", padding: "4px 10px 4px 12px",
              borderRadius: 99, marginBottom: "var(--space-3)",
            }}>
              Filtering by {filterLabel(filter, skuIndex)}
              <button type="button" onClick={() => setFilter(null)} aria-label="Clear filter"
                style={{ background: "none", border: "none", cursor: "pointer", color: "inherit", display: "flex", padding: 2 }}>
                <X size={13} />
              </button>
            </div>
          )}
          {filteredRows.length === 0 ? (
            // A dead end used to live here. Clicking the GREEN health band set
            // a filter that matched real SKUs, none of which had an exception,
            // and the table said "No open exceptions match this filter" as if
            // the click had been a mistake. It was not: healthy is a real
            // answer, and the reader had asked a reasonable question.
            //
            // So the empty state now names what the filter actually selected
            // and offers the one control that shows it. The button is the same
            // action as the toggle in the header, placed where the reader is
            // looking when they need it.
            <div style={{ padding: "var(--space-4) 0", textAlign: "center", color: attention.length === 0 ? "var(--green)" : "var(--text-muted)", fontWeight: 600, fontSize: "var(--text-base)" }}>
              {attention.length === 0
                ? "✓ No open exceptions - portfolio is healthy."
                : filter && filterSkuCount > 0
                  ? `${filterSkuCount} ${filterSkuCount === 1 ? "SKU matches" : "SKUs match"} this filter, and none of them has an open exception.`
                  : "No open exceptions match this filter."}
              {filter && filterSkuCount > 0 && attentionScope === "exceptions" && (
                <div style={{ marginTop: "var(--space-3)" }}>
                  <button type="button" onClick={() => setAttentionScope("all")}
                    style={{
                      padding: "7px 16px", borderRadius: 99, cursor: "pointer",
                      border: "1px solid var(--blue)", background: "var(--blue-light)",
                      color: "var(--blue)", fontSize: "var(--text-sm)", fontWeight: 600,
                    }}>
                    Show {filterSkuCount === 1 ? "it" : "them"} anyway
                  </button>
                </div>
              )}
            </div>
          ) : (
            <div style={{ overflowX: "auto" }}>
              {/* The fade is anchored to a wrapper around the TABLE ALONE, not
                  around the table plus the button. A first version put both in
                  one relative container, so bottom: 0 was below the button and
                  the fade washed out the very control it exists to advertise. */}
              <div style={{ position: "relative" }}>
              {teasing && (
                <div aria-hidden="true" style={{
                  position: "absolute", left: 0, right: 0, bottom: 0, height: NA_DENSITY.fadeH,
                  pointerEvents: "none",
                  background: "linear-gradient(to bottom, transparent, var(--card-bg) 86%)",
                }} />
              )}
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "var(--text-sm)" }}>
                <thead>
                  <tr>
                    {["SKU", "Type", "Action", "Value"].map((h, i) => (
                      <th key={h} style={{
                        textAlign: i === 3 ? "right" : "left", fontSize: "var(--text-xs)", fontWeight: 700,
                        textTransform: "uppercase", letterSpacing: "0.03em", color: "var(--text-muted)",
                        padding: "0 8px 8px", whiteSpace: "nowrap",
                      }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {shownAttention.map((a) => (
                    <tr key={a.sku_id} style={{ borderTop: "1px solid var(--border)" }}>
                      <td style={{ padding: NA_CELL_SKU, borderLeft: `3px solid ${a.tagColor}`, fontWeight: 700 }}>{a.name}</td>
                      <td style={{ padding: NA_CELL }}>
                        <span style={{
                          fontSize: "var(--text-xs)", fontWeight: 700, letterSpacing: "0.02em", whiteSpace: "nowrap",
                          color: a.tagColor, background: a.tagColor.replace(")", "-light)"), padding: "2px 8px", borderRadius: 99,
                        }}>{a.tag}</span>
                      </td>
                      <td style={{ padding: NA_CELL, color: "var(--text-secondary)" }}>
                        <span style={{ fontWeight: 600, color: "var(--text-primary)" }}>{a.action}</span> - {a.reason}
                      </td>
                      <td style={{ padding: NA_CELL, textAlign: "right", whiteSpace: "nowrap" }}>
                        <div style={{ fontWeight: 700 }}>SGD {fmt$(a.value)}</div>
                        <div style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)" }}>{a.valueLabel}</div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {/* Sits ON the faded row, so the reveal costs the card no height
                  of its own. The label names what is behind it rather than
                  saying "Show more", so pressing it is an informed choice. */}
              {teasing && (
                <RevealButton floating showAll={false} count={hiddenAttentionCount}
                  onToggle={() => setShowAllAttention(true)} />
              )}
              </div>
              {showAllAttention && (
                <div style={{ display: "flex", justifyContent: "center", paddingTop: NA_DENSITY.expGap }}>
                  <RevealButton showAll count={0} onToggle={() => setShowAllAttention(false)} />
                </div>
              )}
            </div>
          )}
        </Section>
      </div>

      {/* Diagnosis, below the worklist. Both of these are filter sources for
          Needs Attention above, which is the one cost of putting the table
          first: clicking a colour here scrolls its own effect out of view. The
          filter chip at the top of the table is what makes that recoverable. */}
      <div className="dash-row dash-row--even" style={{ marginBottom: "var(--space-5)" }}>
        <Section title="Cover vs Lead + Safety" subtitle="Worst gap first - click a row to filter" hint={HINTS.coverage}
          collapsible storageKey="coverage" defaultOpen>
          <CoverageBullets data={coverageData} selected={filter?.type === "sku" ? filter.value : null}
            onSelect={(skuId) => toggleFilter(setFilter, "sku", skuId)} />
        </Section>

        <Section title="Inventory Health" subtitle="Share of working capital by status - click a colour to filter" hint={HINTS.health}
          collapsible storageKey="health" defaultOpen>
          <HealthStack data={s.healthByValue} selected={filter?.type === "health" ? filter.value : null}
            onSelect={(status) => toggleFilter(setFilter, "health", status)} />
        </Section>
      </div>

      <div className="dash-row dash-row--full" style={{ marginBottom: "var(--space-5)" }}>
        <Section title="Value × Movement" subtitle="Economic value tier × how fast it sells - click a cell to filter" hint={HINTS.abcMovement}
          collapsible storageKey="abcxyz" defaultOpen>
          <AbcMovementMatrix matrix={s.abcMovementMatrix} selected={filter?.type === "segment" ? filter.value : null}
            onSelect={(key) => toggleFilter(setFilter, "segment", key)} />
        </Section>
      </div>
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

// Small hero-side chart: only two real data points exist (no historical
// snapshots are stored yet), so this stays an honest two-bar comparison
// rather than a fabricated multi-point trend line.
//
// It carries value labels and axis labels rather than being two bare
// rectangles: the two figures are only ~4% apart, so on a zero baseline the
// bars are near-identical in height and the picture alone says nothing. The
// zero baseline stays (truncating it to exaggerate a 4% move is the classic
// misleading-bar-chart trick); the labels are what make it readable, and the
// near-equal heights are themselves the honest message.
// ── Hero chart ──────────────────────────────────────────────────────────────
//
// Inventory value at each month end, read from inventory_history. This used to
// be two bars, a hand-set "Baseline" against "Now", because no history existed
// to draw. It does now: 24 stored month-end closings per SKU, and the figure
// for the newest period equals stats.totalInventoryValue exactly, because both
// are the same sum over the same quantities.
//
// The window buttons pick how far back to look rather than switching what is
// measured. Consumption has not been dropped, it has moved into the tooltip:
// the month's stock level and what left the warehouse that month belong
// together, and a second chart to hold one extra number was never worth the
// control it cost.
//
// Each bar is STACKED into the stock that arrived that month and the stock
// carried over from before it. The total was never the interesting part: over
// 24 months inventory value only ranges SGD 2.77M to 3.71M, so on an honest
// zero baseline every bar sits between 75% and 100% height and the picture
// reads as flat. The split is what moves (measured: 15% to 31% new), and it
// answers a question the total cannot - whether a steady stock level is being
// held by fresh buying or by old stock that is not leaving.
//
// The zero baseline stays. Truncating the axis to make a 30% range look
// dramatic is the classic misleading-bar-chart trick, and the fix for "the
// bars look similar" is more information inside them, not less axis.
//
// Windows are objects rather than month counts because YTD is a DATE FILTER,
// not a lookback: in September it means 9 months, in January it means 1, and
// no integer expresses that. Ordered by the span each covers so the row reads
// as a progression.
//
// There is no 24M button. With 24 months stored it would draw exactly the same
// chart as ALL, and a control that provably does nothing is worse than one
// fewer control. ALL also stays correct as history grows.
const WINDOWS = [
  { key: "6M", label: "6M", slice: (rows) => rows.slice(-6) },
  { key: "YTD", label: "YTD", slice: (rows) => rows.filter((r) => r.period >= `${new Date().getFullYear()}-01`) },
  { key: "12M", label: "12M", slice: (rows) => rows.slice(-12) },
  { key: "ALL", label: "ALL", slice: (rows) => rows },
];
const CHART_H = 122;

// How the CURRENT month is drawn differently from a finished one.
//
// This used to be a diagonal hatch fill, and that no longer works: the bar is
// now two coloured segments, and a hatch over both erases the very split the
// chart exists to show. So the marker has to be something that layers ON TOP
// of a fill rather than replacing it.
//
// What makes this month different is real but mild. Its closing figure is
// today's actual stock rather than a month-end position, so it is a true
// number read at a different moment, not an incomplete one. Consumption for
// the month genuinely is partial, and that lives in the tooltip.
//
// Returns props spread onto a <Cell>, so it can reach fillOpacity, stroke,
// strokeWidth, strokeDasharray - anything SVG takes.
function partialCellProps(partial) {
  if (!partial) return {};
  // Dimmed, not outlined. Opacity keeps both hues and the split readable, and
  // needs no legend entry of its own; the tooltip carries the actual caveat.
  return { fillOpacity: 0.55 };
}

function HeroChart({ history }) {
  const [windowKey, setWindowKey] = useState("6M");

  if (!history?.months?.length) {
    return <div style={{ height: CHART_H + 34 }} />;
  }
  const win = WINDOWS.find((w) => w.key === windowKey) || WINDOWS[0];
  const rows = win.slice(history.months).map((d) => ({ ...d, name: MONTH_LABEL(d.period) }));
  // Value labels only while there is room. Past a year they collide into a
  // grey band and the axis carries the story on its own.
  const showLabels = rows.length <= 12;

  return (
    <div style={{ flex: "1 1 380px", minWidth: 300, maxWidth: 860 }}>
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 4, marginBottom: 4 }}>
        {WINDOWS.map((w) => {
          const on = w.key === windowKey;
          return (
            <button key={w.key} type="button" onClick={() => setWindowKey(w.key)} aria-pressed={on}
              style={{
                padding: "3px 9px", borderRadius: 99, cursor: "pointer",
                border: `1px solid ${on ? "var(--blue)" : "var(--border)"}`,
                background: on ? "var(--blue-light)" : "transparent",
                color: on ? "var(--blue)" : "var(--text-muted)",
                fontSize: "var(--text-xs)", fontWeight: on ? 700 : 500,
              }}>
              {w.label}
            </button>
          );
        })}
      </div>

      <div style={{ height: CHART_H }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={rows} margin={{ top: 18, right: 6, bottom: 0, left: 6 }}>
            <Tooltip
              cursor={{ fill: "var(--surface-2)" }}
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null;
                const d = payload[0].payload;
                return (
                  <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8, padding: "8px 11px", fontSize: "var(--text-xs)", boxShadow: "var(--shadow)", lineHeight: 1.55 }}>
                    <strong>{d.name}</strong>: SGD {fmt$(d.closing_value_sgd)} closing
                    <div style={{ color: "var(--text-muted)" }}>
                      {fmt$(d.new_value_sgd)} arrived this month · {fmt$(d.carried_value_sgd)} carried over
                    </div>
                    <div style={{ color: "var(--text-muted)" }}>
                      {fmtMt(d.closing_qty_mt)} MT on hand · {fmtMt(d.consumed_qty_mt)} MT consumed
                      {d.partial && " · month still in progress"}
                    </div>
                  </div>
                );
              }}
            />
            <XAxis dataKey="name" axisLine={false} tickLine={false}
              tick={{ fontSize: 11, fill: "var(--text-muted)" }} interval="preserveStartEnd" />
            {/* Bottom of the stack: what was already in the warehouse. Drawn
                first so the layers sit the way stock physically does, old
                underneath and new on top. Square corners, since this segment
                is never the top of the bar. */}
            <Bar dataKey="carried_value_sgd" stackId="v" isAnimationActive={false} maxBarSize={96}>
              {rows.map((d, i) => (
                <Cell key={i} fill="var(--blue)" {...partialCellProps(d.partial)} />
              ))}
            </Bar>
            {/* Top of the stack: what arrived that month. */}
            <Bar dataKey="new_value_sgd" stackId="v" radius={[3, 3, 0, 0]} isAnimationActive={false} maxBarSize={96}>
              {/* The label sits on the top segment but must read the TOTAL.
                  LabelList's default dataKey behaviour would print the
                  new-arrivals figure alone, with nothing on screen saying it
                  is a part rather than the whole, which is a worse failure
                  than no label: it would contradict the hero number beside it
                  by roughly 70%. `content` reads the row instead. */}
              {showLabels && (
                <LabelList dataKey="new_value_sgd" position="top"
                  content={({ x, y, width, index }) => (
                    <text x={x + width / 2} y={y - 5} textAnchor="middle"
                      style={{ fontSize: 10, fontWeight: 700, fill: "var(--text-secondary)" }}>
                      {fmt$(rows[index].closing_value_sgd)}
                    </text>
                  )} />
              )}
              {rows.map((d, i) => (
                <Cell key={i} fill="var(--blue-soft)" {...partialCellProps(d.partial)} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Two shades of one hue are not self-explaining, so the split needs a
          key. It joins the caption line that already existed rather than
          taking a row of its own, which costs no vertical space. */}
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "flex-end", flexWrap: "wrap",
        gap: "0 12px", fontSize: "var(--text-xs)", color: "var(--text-muted)", marginTop: 3,
      }}>
        <Swatch fill="var(--blue-soft)" label="arrived that month" />
        <Swatch fill="var(--blue)" label="carried over" />
        <span>At cost · {history.coverage?.periods} months stored</span>
      </div>
    </div>
  );
}

function Swatch({ fill, label }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
      <span aria-hidden="true" style={{ width: 9, height: 9, borderRadius: 2, background: fill, flexShrink: 0 }} />
      {label}
    </span>
  );
}

const MONTH_LABEL = (m) =>
  new Date(`${m}-01T00:00:00`).toLocaleDateString("en-SG", { month: "short" });

// Labeled 100%-stacked bar. Each segment is a real <button> - clickable
// (filters Needs Attention to that health status) and keyboard-reachable.
// Detail lives in a HoverHint (focus + hover + Escape-to-close, visible on
// touch via focus), not a native `title` - title tooltips don't fire on
// tap, so touch users would otherwise get zero detail on this widget.
function HealthStack({ data, selected, onSelect }) {
  return (
    <div>
      <div style={{ display: "flex", height: 34, borderRadius: 6, overflow: "hidden", gap: 2 }}>
        {data.filter((d) => d.pct > 0).map((d) => (
          <HoverHint key={d.status} content={`${HEALTH_LABEL[d.status]}: ${fmt$(d.value)} · ${d.pct}% · ${d.count} SKU${d.count === 1 ? "" : "s"} - click to filter`}>
            <button type="button" onClick={() => onSelect(d.status)}
              aria-label={`${HEALTH_LABEL[d.status]}: ${d.pct}% of inventory value`}
              style={{
                width: `${d.pct}%`, background: HEALTH_COLORS[d.status], border: "none", cursor: "pointer", padding: 0,
                outline: selected === d.status ? "2px solid var(--text-primary)" : "none", outlineOffset: -2,
                display: "flex", alignItems: "center", justifyContent: "center",
                opacity: selected && selected !== d.status ? 0.55 : 1,
              }}>
              {d.pct > 12 && <span style={{ color: "#fff", fontSize: "var(--text-xs)", fontWeight: 700 }}>{d.pct}%</span>}
            </button>
          </HoverHint>
        ))}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: "var(--space-2)", marginTop: "var(--space-4)" }}>
        {data.map((d) => (
          <div key={d.status} style={{ fontSize: "var(--text-sm)", opacity: selected && selected !== d.status ? 0.55 : 1 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 2 }}>
              <span style={{ width: 8, height: 8, borderRadius: 2, background: HEALTH_COLORS[d.status] }} />
              <span style={{ fontWeight: 600 }}>{HEALTH_LABEL[d.status]}</span>
            </div>
            <div style={{ color: "var(--text-secondary)" }}>
              {fmt$(d.value)} · {d.pct}% · {d.count} SKU{d.count === 1 ? "" : "s"}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ABC (economic value) × movement class (velocity). This is the pairing the
// domain spec prescribes - Step 8A item 7, "Combine ABC class with
// Fast/Normal/Slow/Idle for management action" - replacing an earlier
// ABC × XYZ matrix whose second axis appears in no source domain doc and
// which left 5 of 9 cells empty on a 10-SKU portfolio.
function AbcMovementMatrix({ matrix, selected, onSelect }) {
  const { rows, cols, cells } = matrix;
  const maxVal = Math.max(...Object.values(cells).map((c) => c.value), 1);

  return (
    <div>
      <div style={{ display: "grid", gridTemplateColumns: "auto repeat(4, 1fr)", gap: 4 }}>
        <div />
        {cols.map((c) => (
          <div key={c} style={{ textAlign: "center", fontSize: "var(--text-xs)", fontWeight: 700, color: "var(--text-secondary)" }}>
            {c}<div style={{ fontWeight: 400, fontSize: "var(--text-xs)", color: "var(--text-muted)" }}>{MOVE_NOTE[c]}</div>
          </div>
        ))}
        {rows.map((r) => (
          <React.Fragment key={r}>
            <div style={{ display: "flex", flexDirection: "column", justifyContent: "center", fontSize: "var(--text-xs)", fontWeight: 700, color: "var(--text-secondary)", paddingRight: 6 }}>
              {r}<span style={{ fontWeight: 400, fontSize: "var(--text-xs)", color: "var(--text-muted)" }}>{ABC_NOTE[r]}</span>
            </div>
            {cols.map((c) => {
              const key = `${r}:${c}`;
              const cell = cells[key];
              const intensity = cell.value / maxVal;
              const clickable = cell.count > 0;
              const isSel = selected === key;
              const name = `${r} · ${c}`;   // "A:Fast" reads badly to a human or a screen reader
              return (
                <HoverHint key={c} content={clickable ? `${name}: ${cell.count} SKU${cell.count === 1 ? "" : "s"} · ${fmt$(cell.value)} - click to filter` : `${name}: no SKUs`}>
                  <button type="button" disabled={!clickable} onClick={() => onSelect(key)}
                    aria-label={clickable ? `${name}: ${cell.count} SKUs, ${fmt$(cell.value)}` : `${name}: no SKUs`}
                    style={{
                      background: cell.value > 0 ? `rgba(59,130,246,${0.08 + intensity * 0.32})` : "var(--surface-2)",
                      borderRadius: 6, padding: "var(--space-3) 4px", textAlign: "center", font: "inherit",
                      border: isSel ? "2px solid var(--blue)" : "2px solid transparent",
                      cursor: clickable ? "pointer" : "default",
                      opacity: selected && !isSel ? 0.55 : 1,
                    }}>
                    <div style={{ fontSize: "var(--text-base)", fontWeight: 800, color: cell.count ? "var(--text-primary)" : "var(--text-muted)" }}>
                      {cell.count}
                    </div>
                    <div style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)" }}>{cell.value > 0 ? fmt$(cell.value) : "-"}</div>
                  </button>
                </HoverHint>
              );
            })}
          </React.Fragment>
        ))}
      </div>
      {/* The cell tint encodes inventory value, which was nowhere stated -
          readers had no way to know the blue meant anything at all. */}
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: "var(--space-3)", fontSize: "var(--text-xs)", color: "var(--text-muted)" }}>
        <span>Shade = inventory value</span>
        <span style={{ display: "flex", flex: 1, maxWidth: 120, height: 7, borderRadius: 99, overflow: "hidden" }}>
          {[0.08, 0.16, 0.24, 0.32, 0.4].map((a) => (
            <span key={a} style={{ flex: 1, background: `rgba(59,130,246,${a})` }} />
          ))}
        </span>
        <span>less → more</span>
      </div>
      {/* Wording follows the spec's own interpretation table (Step 8A), and
          reads off the live data rather than prescribing action in a cell
          that may be empty - which is exactly what the previous caption did
          when it pointed at AZ / BZ. */}
      <div style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)", marginTop: "var(--space-2)", lineHeight: 1.5 }}>
        {cells["A:Idle"] && cells["A:Idle"].count > 0
          ? `A · Idle is the expensive corner and you have ${cells["A:Idle"].count} there: high value trapped in weak demand. Stop purchasing and open a disposition review.`
          : "A · Idle is the expensive corner, high value trapped in weak demand, and it is clear right now. A · Fast earns tight availability control; C · Idle is low-priority clearance."}
      </div>
    </div>
  );
}

// Bullet-style rows (Stephen Few pattern): a thin fill bar for actual days of
// cover, a tick mark for the required lead+safety threshold. Each row is a
// real button - clickable (filters Needs Attention to that SKU) - with the
// exact numbers in a HoverHint (focus/touch-reachable), not a native title
// tooltip, which never fires on tap.
function CoverageBullets({ data, selected, onSelect }) {
  const max = Math.max(...data.map((d) => Math.max(d.coverage, d.threshold))) * 1.08;
  return (
    <div>
      {data.map((d) => {
        const isSel = selected === d.sku_id;
        const fillPct = Math.min(100, (d.coverage / max) * 100);
        const tickPct = Math.min(100, (d.threshold / max) * 100);
        const gap = d.coverage - d.threshold;
        const gapText = gap < 0
          ? d.coveredByPo ? `${Math.abs(gap)}d short - covered by inbound PO` : `${Math.abs(gap)}d SHORTFALL`
          : `${gap}d buffer`;
        return (
          <HoverHint key={d.sku_id} content={`${d.name}: ${d.coverage}d cover vs ${d.threshold}d lead+safety - ${gapText}${d.onOrder > 0 ? ` · ${d.onOrder} MT on order (ETA ${d.eta}d)` : ""}`}>
            <button type="button" onClick={() => onSelect(d.sku_id)}
              aria-label={`${d.name}: ${d.coverage} days of cover vs ${d.threshold} days needed`}
              style={{
                display: "grid", gridTemplateColumns: "128px 1fr 68px", gap: "var(--space-3)", alignItems: "center",
                width: "100%", padding: "6px 8px", marginBottom: 2, borderRadius: "var(--radius)", font: "inherit", textAlign: "left",
                background: isSel ? "var(--blue-light)" : "transparent",
                border: `1px solid ${isSel ? "var(--blue)" : "transparent"}`,
                cursor: "pointer", opacity: selected && !isSel ? 0.6 : 1,
              }}>
              <span style={{ fontSize: "var(--text-sm)", color: "var(--text-secondary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {d.name}
              </span>
              <span style={{ position: "relative", height: 12, background: "var(--surface-2)", borderRadius: 3 }}>
                <span style={{ position: "absolute", top: 0, bottom: 0, left: 0, width: `${fillPct}%`, background: d.fill, borderRadius: 3 }} />
                <span style={{ position: "absolute", top: -3, bottom: -3, left: `${tickPct}%`, width: 2, background: "var(--text-primary)", opacity: 0.55 }} />
              </span>
              <span style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)", textAlign: "right" }}>{d.coverage}d / {d.threshold}d</span>
            </button>
          </HoverHint>
        );
      })}
    </div>
  );
}

// Small caps heading over a KPI group, with a one-line plain-language note
// saying what question that group answers.
function KpiGroup({ label, note }) {
  return (
    <div style={{ display: "flex", alignItems: "baseline", gap: "var(--space-2)", flexWrap: "wrap", marginBottom: "var(--space-3)" }}>
      <span style={{ fontSize: "var(--text-xs)", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--text-secondary)" }}>
        {label}
      </span>
      {note && <span style={{ fontSize: "var(--text-sm)", color: "var(--text-muted)" }}>{note}</span>}
    </div>
  );
}

function PageHeader({ title, subtitle }) {
  return (
    <div style={{ marginBottom: "var(--space-5)" }}>
      <h1 style={{ fontSize: "var(--text-xl)", fontWeight: 700, color: "var(--text-primary)" }}>{title}</h1>
      <p style={{ fontSize: "var(--text-base)", color: "var(--text-secondary)", marginTop: 4 }}>{subtitle}</p>
    </div>
  );
}

// `collapsible` sections persist their open/closed state per-browser
// (localStorage) - the "optional decluttering" a user can set once and
// forget, rather than a per-visit toggle. Defaults to open.
// The Needs Attention reveal. Two placements, one component, because the
// label and behaviour are identical and only the position differs.
//
// `floating` lays it over the faded fourth row rather than below the table.
// That is what keeps the section compact: an in-flow button added its own
// height plus a gap to a card whose whole point is to stay short, and the
// faded row is dead space already. Expanded, it goes back into the flow,
// because there is no fade to sit on and nothing left to overlap.
function RevealButton({ showAll, count, onToggle, floating = false }) {
  return (
    <button type="button" onClick={onToggle}
      style={{
        display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8,
        minWidth: NA_DENSITY.btnMinW,
        padding: floating ? `${NA_DENSITY.btnPadY}px ${NA_DENSITY.btnPadX}px` : "12px 26px",
        background: "var(--card-bg)",
        border: "1px solid var(--border)",
        borderRadius: 99, cursor: "pointer",
        color: "var(--blue)", fontSize: "var(--text-sm)", fontWeight: 600,
        // Floating needs the shadow to read as ABOVE the row it covers rather
        // than as another faded table element.
        boxShadow: floating ? "var(--shadow-md)" : "none",
        ...(floating ? {
          position: "absolute", left: "50%", bottom: NA_DENSITY.btnBottom,
          transform: "translateX(-50%)", zIndex: 2,
        } : {}),
      }}>
      <ChevronDown size={17} style={{ transform: showAll ? "rotate(180deg)" : "none", transition: "transform 0.15s" }} />
      {showAll ? "Show fewer" : `Show ${count} more`}
    </button>
  );
}

// `badge` is a count shown beside the title, and `badgeTone` a CSS colour
// variable to tint it with. It stays visible when the section is COLLAPSED,
// which is the whole point: a folded section that gives no sign there are
// seven open exceptions inside it is worse than no section at all.
// ── Needs Attention scope toggle ─────────────────────────────────────────────
//
// A segmented control, not a checkbox reading "include healthy SKUs". Two
// named states with their counts on them say what each one will show BEFORE it
// is pressed, where a checkbox only says what it does to the current view.
//
// It borrows the hero chart's window-button styling on purpose. Both are the
// same kind of control, "which slice of the data am I looking at", and giving
// the page one visual language for that is worth more than a bespoke look for
// each. Counts are muted rather than bold: they are the size of each option,
// not an alarm, and the alarm is already the badge beside the title.
function ScopeToggle({ value, onChange, counts }) {
  const OPTS = [
    { key: "exceptions", label: "Needs action", count: counts.exceptions },
    { key: "all", label: "All SKUs", count: counts.all },
  ];
  return (
    <div role="group" aria-label="Which rows to show" style={{ display: "flex", gap: 4 }}>
      {OPTS.map((o) => {
        const on = o.key === value;
        return (
          <button key={o.key} type="button" onClick={() => onChange(o.key)} aria-pressed={on}
            style={{
              padding: "3px 10px", borderRadius: 99, cursor: "pointer", whiteSpace: "nowrap",
              border: `1px solid ${on ? "var(--blue)" : "var(--border)"}`,
              background: on ? "var(--blue-light)" : "transparent",
              color: on ? "var(--blue)" : "var(--text-muted)",
              fontSize: "var(--text-xs)", fontWeight: on ? 700 : 500,
            }}>
            {o.label}
            <span style={{ opacity: 0.65, marginLeft: 5, fontWeight: 500 }}>{o.count}</span>
          </button>
        );
      })}
    </div>
  );
}

// `actions` is an optional control that belongs to the section itself rather
// than to its content - a scope toggle, a unit switch. It sits in the header
// beside the collapse chevron, and only while the section is open, because a
// control for content nobody can see is a control that cannot be understood.
function Section({ title, subtitle, children, hint, badge = null, badgeTone = null,
                  pad = null, collapsible = false, storageKey, defaultOpen = true, actions = null }) {
  const [storedOpen, setStoredOpen] = useCollapsed(storageKey || title, defaultOpen);
  const open = collapsible ? storedOpen : true;
  return (
    // `pad` overrides .card's padding for one section. Only Needs Attention
    // uses it, and only because its density was tuned as a whole; every other
    // card stays on --space-5 so they line up with each other.
    <div className="card" style={pad ? { padding: pad } : undefined}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 8, marginBottom: open ? "var(--space-4)" : 0 }}>
        <div style={{ minWidth: 0 }}>
          {/* Card titles are the role --text-lg names, and until now nothing
              used it. Weight drops to 600 from the old 700 because at 22px the
              size already carries the emphasis. */}
          <div style={{ fontWeight: 600, fontSize: "var(--text-lg)", display: "flex", alignItems: "center", gap: 5 }}>
            {title}
            {badge > 0 && (
              <span style={{
                fontSize: "var(--text-xs)", fontWeight: 700, lineHeight: 1,
                padding: "4px 9px", borderRadius: 99, flexShrink: 0,
                color: badgeTone || "var(--text-secondary)",
                background: badgeTone ? badgeTone.replace(")", "-light)") : "var(--surface-2)",
              }}>
                {badge}
              </span>
            )}
            {hint && <ColHint label={title} what={hint.what} how={hint.how} />}
          </div>
          {subtitle && open && <div style={{ fontSize: "var(--text-sm)", color: "var(--text-muted)", marginTop: 2 }}>{subtitle}</div>}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
        {actions && open && actions}
        {collapsible && (
          <button type="button" onClick={() => setStoredOpen((v) => !v)} aria-expanded={open}
            aria-label={open ? `Collapse ${title}` : `Expand ${title}`}
            style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)", display: "flex", padding: 2, flexShrink: 0 }}>
            <ChevronDown size={15} style={{ transform: open ? "none" : "rotate(-90deg)", transition: "transform 0.15s" }} />
          </button>
        )}
        </div>
      </div>
      {open && children}
    </div>
  );
}
