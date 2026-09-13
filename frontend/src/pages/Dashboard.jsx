import React, { useState, useEffect, useCallback } from "react";
import {
  BarChart, Bar, XAxis, Tooltip, ResponsiveContainer, Cell, LabelList,
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

// Reference baseline - hand-set illustrative comparison, not derived from
// stored history (this project has no historical snapshots yet). Carried over
// unchanged from the mock era; feeds the trend arrows via delta() below.
// Deliberately labeled "vs baseline" everywhere in the UI, not "vs last
// month" - the latter asserts a real, live month-over-month feed that
// doesn't exist yet, and would silently go stale the moment a real month
// passes without this constant being hand-updated.
const PRIOR = {
  totalInventoryValue: 3_560_000,
  turnover: 3.3,
  gmroi: 0.62,
  fillRate: 96.1,
  stockoutRiskMargin: 12_000,
  overstockPct: 6.1,
  eoPct: 34.0,
  coverageInBandPct: 41.0,
};

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
const ppTrend = (d) => ({ dir: d.dir, good: d.good, text: `${Math.abs(d.diff).toFixed(1)} pp` });
const numTrend = (d, p = "") => ({ dir: d.dir, good: d.good, text: `${p}${Math.abs(d.diff).toFixed(2)}` });

// ── Plain-language help text (ELI18: assume zero prior inventory-ops
// knowledge, but not childish) for every ColHint on this page ─────────────────
const HINTS = {
  heroValue: {
    what: "The total dollar value of every bag of rice currently sitting in the warehouse, valued at what it cost to buy - not what it would sell for.",
    how: "The number next to it compares to a fixed reference baseline, not a live month-over-month feed - this project doesn't store historical snapshots yet, so treat it as illustrative until that's built. Going up isn't automatically good or bad either way - check Overstock and Excess & Obsolete below to see whether it's deliberate stocking up or stock quietly piling up unsold.",
  },
  turnover: {
    what: "How many times your entire stock would sell out and get fully replaced in a year, at the current sales pace.",
    how: "Higher is usually better - it means cash isn't sitting on a shelf as unsold rice. A low number alongside a high Excess & Obsolete number means stock is piling up faster than it sells.",
  },
  fillRate: {
    what: "Of everything customers wanted to buy, what percentage did you actually have in stock to sell them?",
    how: "Should be close to 100%. A drop means real sales were turned away somewhere in the portfolio because of a stockout - check Needs Attention for which SKU.",
  },
  gmroi: {
    what: "Gross Margin Return on Inventory - for every $1 of stock sitting in the warehouse, how many dollars of profit did it generate?",
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
    what: "Excess & Obsolete - stock that's slow-moving or hasn't sold in a long time, and may need discounting, redirecting, or writing off.",
    how: "A rising percentage here is money sitting on the shelf that isn't earning its keep. Compare against Turnover: low turnover + high E&O is the clearest warning sign.",
  },
  coverageBand: {
    what: "The share of your portfolio sitting in the sweet spot - not so low you risk running out, not so high you're wasting money holding it.",
    how: "Target is 80% or higher. Below that, too much of the portfolio is either running low or piled up above what's needed.",
  },
  needsAttention: {
    what: "Every SKU with an open problem right now - running low, sitting idle, overstocked, or ageing past its shelf-life target - combined into one list instead of three separate ones.",
    how: "Ranked with the most urgent, highest-value problems at the top. Click a bar or cell in the charts on this page to filter this table down to just the SKUs in that category - click it again to clear the filter.",
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

// Display cap for the Needs Attention table - applied AFTER filtering, so a
// filter always searches the full exception list, not just what fit on
// screen. Any rows beyond this are surfaced via a "+N more" note rather than
// disappearing without a trace.
const NEEDS_ATTENTION_CAP = 8;

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
  const [showMore, setShowMore] = useState(false);
  // Single active cross-filter, PowerBI-style: click a bar/cell/row in any
  // chart on this page to filter Needs Attention to just those SKUs; click
  // the same one again to clear it. Only one filter active at a time.
  const [filter, setFilter] = useState(null);

  const load = useCallback(() => {
    setError(null);
    setSkus(null);
    setStats(null);
    setFilter(null);
    Promise.all([api.getSkus(), api.getDashboardStats()])
      .then(([skusData, statsData]) => { setSkus(skusData); setStats(statsData); })
      .catch((err) => setError(err.message || "Failed to load dashboard"));
  }, []);

  useEffect(() => { load(); }, [load]);

  if (error) return <ErrorState message={error} onRetry={load} />;
  if (!skus || !stats) return <LoadingState label="Loading dashboard…" />;

  const s = stats;
  const t = {
    inventoryValue: delta(s.totalInventoryValue, PRIOR.totalInventoryValue, { higherIsBetter: false, unit: "$" }),
    turnover: delta(s.turnover, PRIOR.turnover, { higherIsBetter: true }),
    gmroi: delta(s.gmroi, PRIOR.gmroi, { higherIsBetter: true, unit: "$" }),
    fillRate: delta(s.fillRate, PRIOR.fillRate, { higherIsBetter: true, pp: true }),
    stockoutRiskMargin: delta(s.stockoutRiskMargin, PRIOR.stockoutRiskMargin, { higherIsBetter: false, unit: "$" }),
    overstockPct: delta(s.overstockPct, PRIOR.overstockPct, { higherIsBetter: false, pp: true }),
    eoPct: delta(s.eoPct, PRIOR.eoPct, { higherIsBetter: false, pp: true }),
    coverageInBandPct: delta(s.coverageInBandPct, PRIOR.coverageInBandPct, { higherIsBetter: true, pp: true }),
  };
  const attention = buildNeedsAttention(skus);
  const coverageData = buildCoverageData(skus);
  const skuIndex = new Map(skus.map((sk) => [sk.sku_id, sk]));
  // Filter first, cap for display second - a filter must search every real
  // exception, not just the top slice that happened to fit on screen.
  const filteredAttention = attention.filter((a) => matchesFilter(a, filter, skuIndex));
  const shownAttention = filteredAttention.slice(0, NEEDS_ATTENTION_CAP);
  const hiddenAttentionCount = filteredAttention.length - shownAttention.length;
  // "Baseline"/"Now" rather than "Last month"/"This month": the comparison
  // point is a fixed hand-set constant, not a real previous month.
  const monthTrendData = [
    { name: "Baseline", value: PRIOR.totalInventoryValue },
    { name: "Now", value: s.totalInventoryValue },
  ];

  return (
    <div>
      <PageHeader
        title="Inventory Dashboard"
        subtitle={`${new Date().toLocaleDateString("en-SG", { weekday: "long", year: "numeric", month: "long", day: "numeric" })} · ${s.totalSkus} active SKUs · data as of ${new Date(s.asOf).toLocaleTimeString("en-SG", { hour: "2-digit", minute: "2-digit" })}`}
      />

      {/* ── Summary card: hero value, month comparison, and the core KPI strip.
          One card, because these are one thought ("state of the portfolio
          right now"), separated internally by a hairline rather than being
          five floating islands on the page background. ── */}
      <div className="card" style={{ marginBottom: "var(--space-5)" }}>
        {/* No justifyContent: space-between here. It pinned the chart to the
            far edge of a ~1300px card, leaving ~700px of gap between a number
            and the chart that exists to explain that number - which reads as
            two unrelated elements (Gestalt proximity). The standard KPI +
            sparkline treatment keeps the chart tight against the value it
            describes and simply lets the leftover width be leftover. */}
        <div className="divider" style={{ paddingBottom: "var(--space-5)", marginBottom: "var(--space-5)", display: "flex", alignItems: "flex-end", flexWrap: "wrap", gap: "var(--space-6)" }}>
          <div>
            <div style={{ fontSize: "var(--text-sm)", color: "var(--text-secondary)", fontWeight: 500, marginBottom: 2, display: "flex", alignItems: "center", gap: 5 }}>
              Total Inventory Value
              <ColHint label="Total Inventory Value" what={HINTS.heroValue.what} how={HINTS.heroValue.how} />
            </div>
            <div style={{ display: "flex", alignItems: "baseline", gap: "var(--space-3)", flexWrap: "wrap" }}>
              <div style={{ fontSize: "var(--text-2xl)", fontWeight: 700, color: "var(--text-primary)", lineHeight: 1.1 }}>
                SGD {fmt$(s.totalInventoryValue)}
              </div>
              {/* Deliberately NOT coloured good/bad. A rising inventory value
                  is genuinely ambiguous (deliberate stock-up vs stock piling
                  up unsold) and this metric's own hint says exactly that, so
                  painting it red asserted a judgement the copy disclaims. */}
              <span title="vs a fixed reference baseline - not a live month-over-month feed yet"
                style={{ fontSize: "var(--text-base)", fontWeight: 700, color: "var(--text-secondary)" }}>
                {t.inventoryValue.dir === "up" ? "▲" : t.inventoryValue.dir === "down" ? "▼" : "▬"} {moneyTrend(t.inventoryValue).text} vs baseline
              </span>
            </div>
          </div>
          <MonthTrendChart data={monthTrendData} />
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
        <StatCard label="Fill Rate" value={`${s.fillRate}%`} icon={ShieldCheck} hint={HINTS.fillRate}
          status={s.fillRate < 90 ? "bad" : s.fillRate < 98 ? "warn" : "ok"} trend={ppTrend(t.fillRate)} sub={`${s.lostSales30d} MT unfilled`} />
        <StatCard label="Stockout Risk" value={`SGD ${fmt$(s.stockoutRiskMargin)}`} icon={AlertTriangle} hint={HINTS.stockoutRisk}
          status={s.stockoutSkuCount > 0 ? "bad" : "ok"} trend={moneyTrend(t.stockoutRiskMargin)} sub={`${s.stockoutSkuCount} SKU`} />
        {/* Sits with service because the half that matters most here is the
            "below band" share, which is a stockout signal. Its sub-line names
            both sides, since the metric genuinely straddles the two groups. */}
        <StatCard label="Coverage in Target Band" value={`${s.coverageInBandPct}%`} icon={Clock} hint={HINTS.coverageBand}
          status={s.coverageInBandPct < 50 ? "bad" : s.coverageInBandPct < 80 ? "warn" : "ok"} trend={ppTrend(t.coverageInBandPct)}
          sub={`${s.coverage.above.pct}% overstocked · ${s.coverage.below.pct}% at risk`} target="≥ 80%" />
      </div>

      <div className="divider" style={{ margin: "var(--space-5) 0" }} />

      <KpiGroup label="Working capital" note="Is cash tied up in the right stock?" />
      <div className="kpi-grid">
        <StatCard label="Turnover" value={`${s.turnover.toFixed(1)}×`} icon={Repeat} hint={HINTS.turnover}
          status={s.turnover < 2.5 ? "bad" : s.turnover < 4.0 ? "warn" : "ok"} trend={numTrend(t.turnover)} sub={`${s.dio}d of supply`} />
        <StatCard label="GMROI" value={`$${s.gmroi.toFixed(2)}`} icon={Target} hint={HINTS.gmroi}
          status={s.gmroi < 1.0 ? "bad" : s.gmroi < 1.5 ? "warn" : "ok"} trend={numTrend(t.gmroi, "$")} sub="per $1 of stock" />
        <StatCard label="Overstock" value={`SGD ${fmt$(s.overstockValue)}`} icon={TrendingUp} hint={HINTS.overstock}
          status={s.overstockPct > 10 ? "bad" : s.overstockPct > 5 ? "warn" : "ok"} trend={ppTrend(t.overstockPct)} sub={`${s.overstockPct}% of inventory`} />
        {/* Gross E&O is the headline, but the risk-adjusted figure is what the
            Needs Attention rows below actually use. Showing only the gross
            number up here meant the same concept appeared as $1.36M in one
            place and $273K in another with nothing explaining the gap. */}
        <StatCard label="Excess & Obsolete" value={`SGD ${fmt$(s.eoValue)}`} icon={PackageX} hint={HINTS.eo}
          status={s.eoPct > 30 ? "bad" : s.eoPct > 15 ? "warn" : "ok"} trend={ppTrend(t.eoPct)}
          sub={`${s.eoPct}% of inventory · ${fmt$(s.eoValueRiskAdjusted)} risk-adjusted`} />
      </div>

      {/* ── One real disclosure: Compliance Position is the only genuinely
          situational number here (illustrative, pending governance approval)
          - Coverage in Target Band moved above since it's a real daily-glance
          figure, not a duplicate of Health-by-Value (different taxonomy:
          below/in/above/idle days-of-cover vs RED/ORANGE/YELLOW/GREEN rules). ── */}
      <button
        onClick={() => setShowMore((v) => !v)}
        style={{
          display: "flex", alignItems: "center", gap: 6, background: "none", border: "none",
          color: "var(--text-muted)", fontSize: "var(--text-sm)", fontWeight: 500, cursor: "pointer",
          padding: "var(--space-2) 0", marginBottom: showMore ? "var(--space-3)" : "var(--space-5)",
        }}
      >
        <ChevronDown size={13} style={{ transform: showMore ? "rotate(180deg)" : "none", transition: "transform 0.15s" }} />
        {showMore ? "Hide" : "Show"} compliance position
      </button>
      {showMore && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "var(--space-5)" }}>
          {/* compliancePosition is a QUANTITY in metric tonnes (eligible on-hand
              minus required buffer, see financials.js), not money. It used to
              render through fmt$ and displayed "+$1K" for what is actually
              +1,058 MT of rice - wrong unit and, via the K-rounding, wrong
              magnitude too. */}
          <StatCard label="Compliance Position"
            value={`${s.compliancePosition >= 0 ? "+" : ""}${fmtMt(s.compliancePosition)} MT`}
            icon={ShieldCheck} status={s.compliancePosition < 0 ? "bad" : "ok"}
            sub={`${fmtMt(s.complianceEligibleQty)} MT eligible vs ${fmtMt(s.complianceRequiredQty)} MT required · illustrative, pending governance approval`} />
        </div>
      )}
      </div>

      {/* ── Command Deck: four purpose-built widgets, each independently
          collapsible (persisted), each a live filter source for Needs
          Attention - click a bar/cell/row, click again to clear.

          Row order is deliberate: "what needs doing today" (coverage gaps +
          the exception list) sits above the fold, and the portfolio-structure
          analysis (health mix, ABC x XYZ) sits below it. It used to be the
          other way round, which pushed the single most actionable widget on
          the page off-screen behind a segmentation matrix. ── */}
      <div className="dash-row dash-row--wide-right" style={{ marginBottom: "var(--space-5)" }}>
        <Section title="Cover vs Lead + Safety" subtitle="Worst gap first - click a row to filter" hint={HINTS.coverage}
          collapsible storageKey="coverage" defaultOpen>
          <CoverageBullets data={coverageData} selected={filter?.type === "sku" ? filter.value : null}
            onSelect={(skuId) => toggleFilter(setFilter, "sku", skuId)} />
        </Section>

        <Section title="Needs Attention" subtitle="Every open exception, ranked by urgency then financial exposure" hint={HINTS.needsAttention}
          collapsible storageKey="needs-attention" defaultOpen>
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
          {filteredAttention.length === 0 ? (
            <div style={{ padding: "var(--space-4) 0", textAlign: "center", color: attention.length === 0 ? "var(--green)" : "var(--text-muted)", fontWeight: 600, fontSize: "var(--text-base)" }}>
              {attention.length === 0 ? "✓ No open exceptions - portfolio is healthy." : "No open exceptions match this filter."}
            </div>
          ) : (
            <div style={{ overflowX: "auto" }}>
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
                      <td style={{ padding: "10px 8px 10px 10px", borderLeft: `3px solid ${a.tagColor}`, fontWeight: 700 }}>{a.name}</td>
                      <td style={{ padding: "10px 8px" }}>
                        <span style={{
                          fontSize: "var(--text-xs)", fontWeight: 700, letterSpacing: "0.02em", whiteSpace: "nowrap",
                          color: a.tagColor, background: a.tagColor.replace(")", "-light)"), padding: "2px 8px", borderRadius: 99,
                        }}>{a.tag}</span>
                      </td>
                      <td style={{ padding: "10px 8px", color: "var(--text-secondary)" }}>
                        <span style={{ fontWeight: 600, color: "var(--text-primary)" }}>{a.action}</span> - {a.reason}
                      </td>
                      <td style={{ padding: "10px 8px", textAlign: "right", whiteSpace: "nowrap" }}>
                        <div style={{ fontWeight: 700 }}>SGD {fmt$(a.value)}</div>
                        <div style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)" }}>{a.valueLabel}</div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {hiddenAttentionCount > 0 && (
                <div style={{ padding: "var(--space-3) 8px 0", fontSize: "var(--text-sm)", color: "var(--text-muted)" }}>
                  +{hiddenAttentionCount} more - showing the {NEEDS_ATTENTION_CAP} highest-priority exceptions{filter ? " matching this filter" : ""}.
                </div>
              )}
            </div>
          )}
        </Section>
      </div>

      <div className="dash-row dash-row--even" style={{ marginBottom: "var(--space-5)" }}>
        <Section title="Inventory Health" subtitle="Share of working capital by status - click a colour to filter" hint={HINTS.health}
          collapsible storageKey="health" defaultOpen>
          <HealthStack data={s.healthByValue} selected={filter?.type === "health" ? filter.value : null}
            onSelect={(status) => toggleFilter(setFilter, "health", status)} />
        </Section>

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
function MonthTrendChart({ data }) {
  return (
    <div style={{ width: 200, height: 92, flexShrink: 0 }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 18, right: 6, bottom: 0, left: 6 }}>
          <Tooltip
            cursor={{ fill: "var(--surface-2)" }}
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const d = payload[0].payload;
              return (
                <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8, padding: "6px 10px", fontSize: 12, boxShadow: "var(--shadow)" }}>
                  <strong>{d.name}</strong>: SGD {fmt$(d.value)}
                </div>
              );
            }}
          />
          <XAxis dataKey="name" axisLine={false} tickLine={false}
            tick={{ fontSize: 11, fill: "var(--text-muted)" }} />
          <Bar dataKey="value" radius={[3, 3, 0, 0]} isAnimationActive={false}>
            <LabelList dataKey="value" position="top" formatter={(v) => fmt$(v)}
              style={{ fontSize: 11, fontWeight: 700, fill: "var(--text-secondary)" }} />
            {data.map((d, i) => <Cell key={i} fill={i === data.length - 1 ? "var(--blue)" : "var(--border)"} />)}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

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
              {d.pct > 12 && <span style={{ color: "#fff", fontSize: 12, fontWeight: 700 }}>{d.pct}%</span>}
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
            {c}<div style={{ fontWeight: 400, fontSize: 11, color: "var(--text-muted)" }}>{MOVE_NOTE[c]}</div>
          </div>
        ))}
        {rows.map((r) => (
          <React.Fragment key={r}>
            <div style={{ display: "flex", flexDirection: "column", justifyContent: "center", fontSize: "var(--text-xs)", fontWeight: 700, color: "var(--text-secondary)", paddingRight: 6 }}>
              {r}<span style={{ fontWeight: 400, fontSize: 11, color: "var(--text-muted)" }}>{ABC_NOTE[r]}</span>
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
                    <div style={{ fontSize: 16, fontWeight: 800, color: cell.count ? "var(--text-primary)" : "var(--text-muted)" }}>
                      {cell.count}
                    </div>
                    <div style={{ fontSize: 11, color: "var(--text-muted)" }}>{cell.value > 0 ? fmt$(cell.value) : "-"}</div>
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
function Section({ title, subtitle, children, hint, collapsible = false, storageKey, defaultOpen = true }) {
  const [storedOpen, setStoredOpen] = useCollapsed(storageKey || title, defaultOpen);
  const open = collapsible ? storedOpen : true;
  return (
    <div className="card">
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 8, marginBottom: open ? "var(--space-4)" : 0 }}>
        <div style={{ minWidth: 0 }}>
          {/* Card titles are the role --text-lg names, and until now nothing
              used it. Weight drops to 600 from the old 700 because at 22px the
              size already carries the emphasis. */}
          <div style={{ fontWeight: 600, fontSize: "var(--text-lg)", display: "flex", alignItems: "center", gap: 5 }}>
            {title}
            {hint && <ColHint label={title} what={hint.what} how={hint.how} />}
          </div>
          {subtitle && open && <div style={{ fontSize: "var(--text-sm)", color: "var(--text-muted)", marginTop: 2 }}>{subtitle}</div>}
        </div>
        {collapsible && (
          <button type="button" onClick={() => setStoredOpen((v) => !v)} aria-expanded={open}
            aria-label={open ? `Collapse ${title}` : `Expand ${title}`}
            style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)", display: "flex", padding: 2, flexShrink: 0 }}>
            <ChevronDown size={15} style={{ transform: open ? "none" : "rotate(-90deg)", transition: "transform 0.15s" }} />
          </button>
        )}
      </div>
      {open && children}
    </div>
  );
}
