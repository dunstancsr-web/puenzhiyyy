import React, { useState, useEffect, useCallback } from "react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Cell,
} from "recharts";
import {
  AlertTriangle, TrendingUp, Clock, ArrowRight, PackageX, Repeat, Target,
  ShieldCheck, ChevronDown,
} from "lucide-react";
import StatCard from "../components/StatCard";
import Badge from "../components/Badge";
import LoadingState from "../components/LoadingState";
import ErrorState from "../components/ErrorState";
import { api } from "../api/inventory";

// Prior period (last month) — hand-set illustrative comparison, not derived from
// stored history (this project has no historical snapshots yet). Carried over
// unchanged from the mock era; feeds the trend arrows via delta() below.
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

// ── Money formatting — consistent M / K, never mixed ─────────────────────────
const fmt$ = (v) => {
  const n = Math.abs(v);
  if (n >= 1e6) return `$${(v / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `$${Math.round(v / 1e3)}K`;
  return `$${Math.round(v)}`;
};

// Trend chip builders (magnitude formatted for the metric type)
const moneyTrend = (d) => ({ dir: d.dir, good: d.good, text: fmt$(Math.abs(d.diff)) });
const ppTrend = (d) => ({ dir: d.dir, good: d.good, text: `${Math.abs(d.diff).toFixed(1)} pp` });
const numTrend = (d, p = "") => ({ dir: d.dir, good: d.good, text: `${p}${Math.abs(d.diff).toFixed(2)}` });

// ── Today's actions — ranked by urgency + financial exposure ─────────────────
function buildTodayActions(mockSkus) {
  const actions = [];

  mockSkus
    .filter((s) => s.stockout_gap_days > 0)
    .forEach((s) => {
      const qty = Math.max(s.min_order_qty, Math.round(s.target_stock - s.available_qty));
      actions.push({
        priority: 1,
        sku_id: s.sku_id,
        name: s.product_name,
        action: `Place PO — ${qty} MT`,
        reason: `${s.days_of_cover}d cover vs ${s.lead_time_days + s.safety_stock_days}d (lead + safety) · ${s.stockout_gap_days}d gap · ${s.expected_incoming_qty > 0 ? `${s.expected_incoming_qty} MT inbound` : "no PO inbound"}`,
        value: s.lost_margin_risk || s.lost_sales_value_risk,
        valueLabel: "lost margin",
        tag: "STOCKOUT RISK",
        tagColor: "var(--red)",
      });
    });

  mockSkus
    .filter((s) => s.movement_class === "Idle")
    .forEach((s) => {
      actions.push({
        priority: 2,
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

  mockSkus
    .filter((s) => s.overstock_qty > 0)
    .forEach((s) => {
      actions.push({
        priority: 3,
        sku_id: s.sku_id,
        name: s.product_name,
        action: "Suspend purchasing",
        reason: `${s.overstock_qty} MT above max · ${s.abc_class}${s.xyz_class} class`,
        value: s.overstock_carrying_cost,
        valueLabel: "carrying cost / yr",
        tag: "OVERSTOCK",
        tagColor: "var(--purple)",
      });
    });

  mockSkus
    .filter((s) => s.coverage_band === "below" && s.stockout_gap_days === 0 && s.available_qty <= s.reorder_point_policy && s.movement_class !== "Idle")
    .forEach((s) => {
      actions.push({
        priority: 4,
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

  // One row per SKU — keep its highest-priority (lowest number) action
  const bySku = {};
  actions
    .sort((a, b) => a.priority - b.priority || b.value - a.value)
    .forEach((a) => { if (!bySku[a.sku_id]) bySku[a.sku_id] = a; });

  return Object.values(bySku)
    .sort((a, b) => a.priority - b.priority || b.value - a.value)
    .slice(0, 5);
}

// ── Coverage vs (lead time + safety) chart data ─────────────────────────────
function buildCoverageData(mockSkus) {
  return [...mockSkus]
    .filter((s) => s.days_of_cover !== null)
    .sort((a, b) => {
      const aGap = a.days_of_cover - (a.lead_time_days + a.safety_stock_days);
      const bGap = b.days_of_cover - (b.lead_time_days + b.safety_stock_days);
      return aGap - bGap;
    })
    .slice(0, 7)
    .map((s) => ({
      name: s.product_name.replace(/ \d+KG$/, "").slice(0, 16),
      coverage: s.days_of_cover,
      threshold: s.lead_time_days + s.safety_stock_days,
      onOrder: s.expected_incoming_qty,
      eta: s.incoming_eta_days,
      coveredByPo: s.covered_by_po,
      fill: HEALTH_COLORS[s.health_status],
    }));
}

const CoverageTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  const d = payload[0]?.payload;
  const gap = (d?.coverage ?? 0) - (d?.threshold ?? 0);
  return (
    <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8, padding: "10px 14px", fontSize: "var(--text-sm)" }}>
      <div style={{ fontWeight: 700, marginBottom: 6 }}>{label}</div>
      <div style={{ color: "var(--text-secondary)", marginBottom: 3 }}>Days of cover: <strong>{d?.coverage}d</strong></div>
      <div style={{ color: "var(--text-secondary)", marginBottom: 3 }}>Lead + safety: <strong>{d?.threshold}d</strong></div>
      {d?.onOrder > 0 && (
        <div style={{ color: "var(--text-secondary)", marginBottom: 3 }}>
          On order: <strong>{d.onOrder} MT</strong>{d.eta != null ? ` · ETA ${d.eta}d` : ""}
        </div>
      )}
      <div style={{ color: gap < 0 && !d?.coveredByPo ? "var(--red)" : "var(--green)", fontWeight: 700 }}>
        {gap < 0
          ? d?.coveredByPo ? `⚠ ${Math.abs(gap)}d short — covered by inbound PO` : `⚠ ${Math.abs(gap)}d SHORTFALL`
          : `✓ ${gap}d buffer`}
      </div>
    </div>
  );
};

export default function Dashboard() {
  const [skus, setSkus] = useState(null);
  const [stats, setStats] = useState(null);
  const [error, setError] = useState(null);
  const [showMore, setShowMore] = useState(false);

  const load = useCallback(() => {
    setError(null);
    setSkus(null);
    setStats(null);
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
  const todayActions = buildTodayActions(skus);
  const coverageData = buildCoverageData(skus);
  const ageingItems = skus.filter((sk) => sk.ageing_status === "Ageing" || sk.ageing_status === "At Risk");

  return (
    <div>
      <PageHeader
        title="Inventory Dashboard"
        subtitle={`${new Date().toLocaleDateString("en-SG", { weekday: "long", year: "numeric", month: "long", day: "numeric" })} · ${s.totalSkus} active SKUs · data as of ${new Date(s.asOf).toLocaleTimeString("en-SG", { hour: "2-digit", minute: "2-digit" })}`}
      />

      {/* ── Hero: the one number that summarizes the business state ── */}
      <div className="divider" style={{ paddingBottom: "var(--space-5)", marginBottom: "var(--space-5)" }}>
        <div style={{ fontSize: "var(--text-sm)", color: "var(--text-secondary)", fontWeight: 500, marginBottom: 2 }}>
          Total Inventory Value
        </div>
        <div style={{ display: "flex", alignItems: "baseline", gap: "var(--space-3)", flexWrap: "wrap" }}>
          <div style={{ fontSize: "var(--text-2xl)", fontWeight: 700, color: "var(--text-primary)", lineHeight: 1.1 }}>
            SGD {fmt$(s.totalInventoryValue)}
          </div>
          <span style={{ fontSize: "var(--text-base)", fontWeight: 700, color: t.inventoryValue.good ? "var(--green)" : "var(--red)" }}>
            {t.inventoryValue.dir === "up" ? "▲" : t.inventoryValue.dir === "down" ? "▼" : "▬"} {moneyTrend(t.inventoryValue).text} vs last month
          </span>
        </div>
      </div>

      {/* ── Secondary strip: core numbers, demoted but never hidden ── */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: "var(--space-5)", marginBottom: "var(--space-3)" }}>
        <StatCard label="Turnover" value={`${s.turnover.toFixed(1)}×`} icon={Repeat}
          status={s.turnover < 6.0 ? "warn" : "ok"} trend={numTrend(t.turnover)} sub={`${s.dio}d of supply`} />
        <StatCard label="Fill Rate" value={`${s.fillRate}%`} icon={ShieldCheck}
          status={s.fillRate < 90 ? "bad" : s.fillRate < 98 ? "warn" : "ok"} trend={ppTrend(t.fillRate)} sub={`${s.lostSales30d} MT unfilled`} />
        <StatCard label="GMROI" value={`$${s.gmroi.toFixed(2)}`} icon={Target}
          status={s.gmroi < 1.5 ? "warn" : "ok"} trend={numTrend(t.gmroi, "$")} sub="per $1 of stock" />
        <StatCard label="Stockout Risk" value={`SGD ${fmt$(s.stockoutRiskMargin)}`} icon={AlertTriangle}
          status={s.stockoutSkuCount > 0 ? "bad" : "ok"} trend={moneyTrend(t.stockoutRiskMargin)} sub={`${s.stockoutSkuCount} SKU`} />
        <StatCard label="Overstock" value={`SGD ${fmt$(s.overstockValue)}`} icon={TrendingUp}
          status={s.overstockPct > 5 ? "warn" : "ok"} trend={ppTrend(t.overstockPct)} sub={`${s.overstockPct}% of inventory`} />
        <StatCard label="Excess & Obsolete" value={`SGD ${fmt$(s.eoValue)}`} icon={PackageX}
          status={s.eoPct > 15 ? "warn" : "ok"} trend={ppTrend(t.eoPct)} sub={`${s.eoPct}% of inventory`} />
      </div>

      {/* ── One real disclosure: situational numbers, not daily-glance ── */}
      <button
        onClick={() => setShowMore((v) => !v)}
        style={{
          display: "flex", alignItems: "center", gap: 6, background: "none", border: "none",
          color: "var(--text-muted)", fontSize: "var(--text-sm)", fontWeight: 500, cursor: "pointer",
          padding: "var(--space-2) 0", marginBottom: showMore ? "var(--space-3)" : "var(--space-5)",
        }}
      >
        <ChevronDown size={13} style={{ transform: showMore ? "rotate(180deg)" : "none", transition: "transform 0.15s" }} />
        {showMore ? "Hide" : "Show"} more metrics
      </button>
      {showMore && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "var(--space-5)", marginBottom: "var(--space-5)" }}>
          <StatCard label="Coverage in Target Band" value={`${s.coverageInBandPct}%`} icon={Clock}
            status={s.coverageInBandPct < 80 ? "warn" : "ok"} trend={ppTrend(t.coverageInBandPct)}
            sub={`${s.coverage.above.pct}% overstocked · ${s.coverage.below.pct}% at risk`} target="≥ 80%" />
          <StatCard label="Compliance Position" value={`${s.compliancePosition >= 0 ? "+" : ""}${fmt$(s.compliancePosition)}`}
            icon={ShieldCheck} status={s.compliancePosition < 0 ? "bad" : "ok"}
            sub="Illustrative rice-stockpile buffer · pending governance approval" />
        </div>
      )}

      {/* ── TODAY'S TOP ACTIONS ── */}
      <div style={{ marginBottom: "var(--space-5)" }}>
        <Section title="Today's Top Actions" subtitle="One row per SKU · ranked by urgency then financial exposure">
          {todayActions.length === 0 ? (
            <div style={{ padding: "var(--space-4) 0", textAlign: "center", color: "var(--green)", fontWeight: 600, fontSize: "var(--text-base)" }}>
              ✓ No urgent actions required — portfolio is healthy.
            </div>
          ) : (
            <div>
              {todayActions.map((a, i) => (
                <div key={a.sku_id + a.tag} style={{
                  display: "flex", alignItems: "center", gap: "var(--space-4)", padding: "var(--space-3) 0",
                  borderBottom: i < todayActions.length - 1 ? "1px solid var(--border)" : "none",
                }}>
                  <div style={{ fontSize: "var(--text-sm)", fontWeight: 700, color: "var(--text-muted)", width: 14, flexShrink: 0 }}>
                    {i + 1}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", marginBottom: 3, flexWrap: "wrap" }}>
                      <span style={{ fontWeight: 700, fontSize: "var(--text-base)" }}>{a.name}</span>
                      <span style={{ fontSize: "var(--text-xs)", fontWeight: 600, color: a.tagColor }}>{a.tag}</span>
                    </div>
                    <div style={{ fontSize: "var(--text-sm)", color: "var(--text-secondary)" }}>
                      <span style={{ fontWeight: 600, color: "var(--text-primary)" }}>{a.action}</span>
                      {" · "}{a.reason}
                    </div>
                  </div>
                  <div style={{ textAlign: "right", flexShrink: 0 }}>
                    <div style={{ fontSize: "var(--text-sm)", fontWeight: 700, color: "var(--text-primary)" }}>SGD {fmt$(a.value)}</div>
                    <div style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)" }}>{a.valueLabel}</div>
                  </div>
                  <ArrowRight size={14} color="var(--text-muted)" />
                </div>
              ))}
            </div>
          )}
        </Section>
      </div>

      {/* ── Health by value + Exceptions ── */}
      <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr", gap: "var(--space-5)", marginBottom: "var(--space-5)" }}>
        <Section title="Inventory Health by Value" subtitle="Share of working capital in each health status — not SKU count">
          <HealthByValueBar data={s.healthByValue} />
        </Section>

        <Section title="Open Exceptions" subtitle={`${s.openExceptions.count} SKUs · ${s.openExceptions.critical} critical`}>
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
            {s.primaryExceptions.map((a) => <ExceptionRow key={a.sku_id} alert={a} />)}
          </div>
        </Section>
      </div>

      {/* ── Coverage chart + ABC/XYZ matrix ── */}
      <div style={{ display: "grid", gridTemplateColumns: "1.6fr 1fr", gap: "var(--space-5)", marginBottom: "var(--space-5)" }}>
        <Section title="Cover vs Lead Time + Safety Stock" subtitle="Coloured bar = days of cover · grey outline = lead time + statistical safety stock">
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={coverageData} margin={{ top: 8, right: 16, bottom: 0, left: -10 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
              <XAxis dataKey="name" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} />
              <YAxis tick={{ fontSize: 10 }} tickLine={false} axisLine={false} unit="d" />
              <Tooltip content={<CoverageTooltip />} cursor={{ fill: "var(--surface-2)" }} />
              <Bar dataKey="coverage" radius={[4, 4, 0, 0]} name="Days of cover">
                {coverageData.map((e, i) => <Cell key={i} fill={e.fill} />)}
              </Bar>
              <Bar dataKey="threshold" fill="transparent" stroke="var(--text-muted)" strokeWidth={1.5}
                radius={[3, 3, 0, 0]} name="Lead + safety" />
            </BarChart>
          </ResponsiveContainer>
          <div style={{ display: "flex", gap: "var(--space-4)", marginTop: "var(--space-2)", fontSize: "var(--text-xs)", color: "var(--text-muted)", flexWrap: "wrap" }}>
            {Object.entries(HEALTH_COLORS).map(([k, c]) => (
              <span key={k} style={{ display: "flex", alignItems: "center", gap: 4 }}>
                <span style={{ width: 8, height: 8, borderRadius: 2, background: c, display: "inline-block" }} />{HEALTH_LABEL[k]}
              </span>
            ))}
            <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <span style={{ width: 8, height: 8, borderRadius: 2, border: "1.5px solid var(--text-muted)", display: "inline-block" }} />Lead + safety stock
            </span>
          </div>
        </Section>

        <Section title="ABC × XYZ Segmentation" subtitle="Rows: value (Pareto). Columns: demand predictability. Cell = SKUs · stock value">
          <AbcXyzMatrix matrix={s.abcXyzMatrix} />
        </Section>
      </div>

      {/* ── Ageing inventory ── */}
      {ageingItems.length > 0 && (
        <Section title="Ageing Inventory" subtitle="Stock approaching maximum holding limit — action required">
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: "var(--space-3)" }}>
            {ageingItems.map((it) => (
              <div key={it.sku_id} style={{
                padding: "var(--space-3) var(--space-4)",
                borderLeft: `2px solid ${it.ageing_status === "At Risk" ? "var(--red)" : "var(--yellow)"}`,
                background: "var(--surface-2)",
                display: "flex", justifyContent: "space-between", alignItems: "center",
              }}>
                <div>
                  <div style={{ fontWeight: 600, fontSize: "var(--text-base)" }}>{it.product_name}</div>
                  <div style={{ fontSize: "var(--text-sm)", color: "var(--text-secondary)", marginTop: 2 }}>
                    {it.inventory_age_days}d held · {it.available_qty} MT · max {it.max_holding_days}d
                  </div>
                  <div style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)", marginTop: 2 }}>
                    {it.max_holding_days - it.inventory_age_days} days to limit
                  </div>
                </div>
                <Badge type={it.ageing_status} />
              </div>
            ))}
          </div>
        </Section>
      )}
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function HealthByValueBar({ data }) {
  return (
    <div>
      <div style={{ display: "flex", height: 8, borderRadius: 4, overflow: "hidden" }}>
        {data.filter((d) => d.pct > 0).map((d) => (
          <div key={d.status} title={`${HEALTH_LABEL[d.status]}: ${d.pct}%`}
            style={{ width: `${d.pct}%`, background: HEALTH_COLORS[d.status] }} />
        ))}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: "var(--space-2)", marginTop: "var(--space-4)" }}>
        {data.map((d) => (
          <div key={d.status} style={{ fontSize: "var(--text-sm)" }}>
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

function AbcXyzMatrix({ matrix }) {
  const { rows, cols, cells } = matrix;
  const maxVal = Math.max(...Object.values(cells).map((c) => c.value), 1);
  const rowHint = { A: "high value", B: "medium", C: "low value" };
  const colHint = { X: "steady", Y: "variable", Z: "erratic" };

  return (
    <div>
      <div style={{ display: "grid", gridTemplateColumns: "auto repeat(3, 1fr)", gap: 4 }}>
        <div />
        {cols.map((c) => (
          <div key={c} style={{ textAlign: "center", fontSize: "var(--text-xs)", fontWeight: 700, color: "var(--text-secondary)" }}>
            {c}<div style={{ fontWeight: 400, fontSize: 10, color: "var(--text-muted)" }}>{colHint[c]}</div>
          </div>
        ))}
        {rows.map((r) => (
          <React.Fragment key={r}>
            <div style={{ display: "flex", flexDirection: "column", justifyContent: "center", fontSize: "var(--text-xs)", fontWeight: 700, color: "var(--text-secondary)", paddingRight: 6 }}>
              {r}<span style={{ fontWeight: 400, fontSize: 10, color: "var(--text-muted)" }}>{rowHint[r]}</span>
            </div>
            {cols.map((c) => {
              const cell = cells[`${r}${c}`];
              const intensity = cell.value / maxVal;
              return (
                <div key={c} style={{
                  background: cell.value > 0 ? `rgba(59,130,246,${0.08 + intensity * 0.32})` : "var(--surface-2)",
                  borderRadius: 6, padding: "var(--space-3) 4px", textAlign: "center",
                }}>
                  <div style={{ fontSize: 15, fontWeight: 800, color: cell.count ? "var(--text-primary)" : "var(--text-muted)" }}>
                    {cell.count}
                  </div>
                  <div style={{ fontSize: 10, color: "var(--text-muted)" }}>{cell.value > 0 ? fmt$(cell.value) : "—"}</div>
                </div>
              );
            })}
          </React.Fragment>
        ))}
      </div>
      <div style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)", marginTop: "var(--space-3)", lineHeight: 1.5 }}>
        AZ / BZ / CZ carry the hardest-to-plan stock — set higher safety stock and shorter review cycles there.
      </div>
    </div>
  );
}

function ExceptionRow({ alert }) {
  const borderColor = { critical: "var(--red)", warning: "var(--yellow)", info: "var(--blue)" }[alert.severity] || "var(--text-muted)";
  return (
    <div style={{ padding: "var(--space-2) var(--space-3)", borderLeft: `2px solid ${borderColor}` }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <span style={{ fontWeight: 600, fontSize: "var(--text-sm)", flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {alert.sku_name}
        </span>
        <Badge type={alert.severity} />
      </div>
      <div style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)", marginTop: 2, lineHeight: 1.4 }}>
        {alert.alert_type.replace(/_/g, " ")} · {alert.message.slice(0, 58)}…
      </div>
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

// Renamed from `Card` — no border/shadow/accent-stripe; a labelled section that
// separates from its neighbors via spacing, matching the rest of the page.
function Section({ title, subtitle, children }) {
  return (
    <div>
      <div style={{ marginBottom: "var(--space-4)" }}>
        <div style={{ fontWeight: 600, fontSize: "var(--text-md)" }}>{title}</div>
        {subtitle && <div style={{ fontSize: "var(--text-sm)", color: "var(--text-muted)", marginTop: 2 }}>{subtitle}</div>}
      </div>
      {children}
    </div>
  );
}
