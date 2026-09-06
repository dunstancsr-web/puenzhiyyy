import React from "react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Cell,
} from "recharts";
import {
  DollarSign, AlertTriangle, TrendingUp, Clock,
  ArrowRight, PackageX, Repeat, Target, ShieldCheck,
} from "lucide-react";
import StatCard from "../components/StatCard";
import Badge from "../components/Badge";
import { mockStats } from "../mock/statsData";
import { mockSkus } from "../mock/riceData";

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
function buildTodayActions() {
  const actions = [];

  mockSkus
    .filter((s) => s.stockout_gap_days > 0)
    .forEach((s) => {
      const qty = Math.max(s.min_order_qty, Math.round(s.target_stock - s.available_stock));
      actions.push({
        priority: 1,
        sku_id: s.sku_id,
        name: s.product_name,
        action: `Place PO — ${qty} MT`,
        reason: `${s.days_of_stock}d cover vs ${s.lead_time_days + s.safety_stock_days}d (lead + safety) · ${s.stockout_gap_days}d gap · ${s.on_order > 0 ? `${s.on_order} MT inbound` : "no PO inbound"}`,
        value: s.lost_margin_risk || s.lost_sales_value_risk,
        valueLabel: "lost margin",
        tag: "STOCKOUT RISK",
        tagColor: "#dc2626", tagBg: "#fef2f2",
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
        reason: `No sales 90+ days · ${s.available_stock} MT · ${s.obsolescence_risk_pct}% write-down risk`,
        value: s.eo_value_risk_adjusted,
        valueLabel: "risk-adj. value",
        tag: "IDLE STOCK",
        tagColor: "#b45309", tagBg: "#fffbeb",
      });
    });

  mockSkus
    .filter((s) => s.excess_mt > 0)
    .forEach((s) => {
      actions.push({
        priority: 3,
        sku_id: s.sku_id,
        name: s.product_name,
        action: "Suspend purchasing",
        reason: `${s.excess_mt} MT above max · ${s.abc_class}${s.xyz_class} class`,
        value: s.excess_carrying_cost,
        valueLabel: "carrying cost / yr",
        tag: "OVERSTOCK",
        tagColor: "#7c3aed", tagBg: "#f5f3ff",
      });
    });

  mockSkus
    .filter((s) => s.coverage_band === "below" && s.stockout_gap_days === 0 && s.available_stock <= s.reorder_point && s.movement_class !== "Idle")
    .forEach((s) => {
      actions.push({
        priority: 4,
        sku_id: s.sku_id,
        name: s.product_name,
        action: "Procurement review",
        reason: `Available ${s.available_stock} MT at reorder point ${s.reorder_point} MT`,
        value: s.available_stock * (s.unit_price_sgd - s.unit_cost_sgd),
        valueLabel: "margin exposed",
        tag: "REORDER",
        tagColor: "#c2410c", tagBg: "#fff7ed",
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
function buildCoverageData() {
  return [...mockSkus]
    .filter((s) => s.days_of_stock !== null)
    .sort((a, b) => {
      const aGap = a.days_of_stock - (a.lead_time_days + a.safety_stock_days);
      const bGap = b.days_of_stock - (b.lead_time_days + b.safety_stock_days);
      return aGap - bGap;
    })
    .slice(0, 7)
    .map((s) => ({
      name: s.product_name.replace(/ \d+KG$/, "").slice(0, 16),
      coverage: s.days_of_stock,
      threshold: s.lead_time_days + s.safety_stock_days,
      onOrder: s.on_order,
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
    <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8, padding: "10px 14px", fontSize: 12 }}>
      <div style={{ fontWeight: 700, marginBottom: 6 }}>{label}</div>
      <div style={{ color: "var(--text-secondary)", marginBottom: 3 }}>Days of cover: <strong>{d?.coverage}d</strong></div>
      <div style={{ color: "var(--text-secondary)", marginBottom: 3 }}>Lead + safety: <strong>{d?.threshold}d</strong></div>
      {d?.onOrder > 0 && (
        <div style={{ color: "var(--text-secondary)", marginBottom: 3 }}>
          On order: <strong>{d.onOrder} MT</strong>{d.eta != null ? ` · ETA ${d.eta}d` : ""}
        </div>
      )}
      <div style={{ color: gap < 0 && !d?.coveredByPo ? "#dc2626" : "#16a34a", fontWeight: 700 }}>
        {gap < 0
          ? d?.coveredByPo ? `⚠ ${Math.abs(gap)}d short — covered by inbound PO` : `⚠ ${Math.abs(gap)}d SHORTFALL`
          : `✓ ${gap}d buffer`}
      </div>
    </div>
  );
};

export default function Dashboard() {
  const s = mockStats;
  const t = s.trends;
  const todayActions = buildTodayActions();
  const coverageData = buildCoverageData();
  const ageingItems = s.ageingItems;

  return (
    <div>
      <PageHeader
        title="Inventory Dashboard"
        subtitle={`${new Date().toLocaleDateString("en-SG", { weekday: "long", year: "numeric", month: "long", day: "numeric" })} · ${s.totalSkus} active SKUs · data as of 06:00 SGT`}
      />

      {/* ── KPI cards — working-capital metrics paired with their service counter-metric ── */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))", gap: 14, marginBottom: 24 }}>
        <StatCard label="Inventory Value" value={`SGD ${fmt$(s.totalInventoryValue)}`} icon={DollarSign} color="blue"
          trend={moneyTrend(t.inventoryValue)} sub="Physical stock at cost" />
        <StatCard label="Inventory Turnover" value={`${s.turnover.toFixed(1)}×`} icon={Repeat} color="green"
          trend={numTrend(t.turnover)} sub={`${s.dio}d of supply · value-weighted`} target="6.0×" />
        <StatCard label="Service Level (Fill Rate)" value={`${s.fillRate}%`} icon={ShieldCheck} color="green"
          trend={ppTrend(t.fillRate)} sub={`${s.lostSales30d} MT unfilled / 30d`} target="≥ 98%" />
        <StatCard label="GMROI" value={`$${s.gmroi.toFixed(2)}`} icon={Target} color="blue"
          trend={numTrend(t.gmroi, "$")} sub="Gross margin per $1 of stock" target="≥ $1.50" />
        <StatCard label="Stockout-Risk Value" value={`SGD ${fmt$(s.stockoutRiskMargin)}`} icon={AlertTriangle} color="red"
          trend={moneyTrend(t.stockoutRiskMargin)} sub={`Lost margin · ${s.stockoutSkuCount} SKU · ${fmt$(s.stockoutRiskSales)} sales`} />
        <StatCard label="Excess Stock" value={`SGD ${fmt$(s.excessValue)}`} icon={TrendingUp} color="purple"
          trend={ppTrend(t.excessPct)} sub={`${s.excessPct}% of inventory · ${s.excessSkuCount} SKUs · ${fmt$(s.excessCarryingCost)}/yr to hold`} target="≤ 5%" />
        <StatCard label="Slow + Idle (E&O)" value={`SGD ${fmt$(s.eoValue)}`} icon={PackageX} color="yellow"
          trend={ppTrend(t.eoPct)} sub={`${s.eoPct}% of inventory · risk-adj. ${fmt$(s.eoValueRiskAdjusted)}`} target="≤ 15%" />
        <StatCard label="Coverage in Target Band" value={`${s.coverageInBandPct}%`} icon={Clock} color="blue"
          trend={ppTrend(t.coverageInBandPct)} sub={`${s.coverage.abovePct}% overstocked · ${s.coverage.belowPct}% at risk`} target="≥ 80%" />
      </div>

      {/* ── TODAY'S TOP ACTIONS ── */}
      <div style={{ marginBottom: 20 }}>
        <Card title="Today's Top Actions" subtitle="One row per SKU · ranked by urgency then financial exposure" accent="#3b82f6">
          {todayActions.length === 0 ? (
            <div style={{ padding: "16px 0", textAlign: "center", color: "#16a34a", fontWeight: 600, fontSize: 13 }}>
              ✓ No urgent actions required — portfolio is healthy.
            </div>
          ) : (
            <div>
              {todayActions.map((a, i) => (
                <div key={a.sku_id + a.tag} style={{
                  display: "flex", alignItems: "center", gap: 14, padding: "12px 0",
                  borderBottom: i < todayActions.length - 1 ? "1px solid var(--border)" : "none",
                }}>
                  <div style={{
                    width: 26, height: 26, borderRadius: "50%",
                    background: i === 0 ? "#fef2f2" : i === 1 ? "#fff7ed" : "var(--surface-2)",
                    color: i === 0 ? "#dc2626" : i === 1 ? "#c2410c" : "var(--text-muted)",
                    fontWeight: 700, fontSize: 12,
                    display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
                  }}>
                    {i + 1}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 3, flexWrap: "wrap" }}>
                      <span style={{ fontWeight: 700, fontSize: 13 }}>{a.name}</span>
                      <span style={{ fontSize: 11, fontWeight: 600, color: a.tagColor, background: a.tagBg, padding: "1px 8px", borderRadius: 99 }}>
                        {a.tag}
                      </span>
                    </div>
                    <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>
                      <span style={{ fontWeight: 600, color: "var(--text-primary)" }}>{a.action}</span>
                      {" · "}{a.reason}
                    </div>
                  </div>
                  <div style={{ textAlign: "right", flexShrink: 0 }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text-primary)" }}>SGD {fmt$(a.value)}</div>
                    <div style={{ fontSize: 11, color: "var(--text-muted)" }}>{a.valueLabel}</div>
                  </div>
                  <ArrowRight size={14} color="var(--text-muted)" />
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      {/* ── Health by value + Exceptions ── */}
      <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr", gap: 16, marginBottom: 20 }}>
        <Card title="Inventory Health by Value" subtitle="Share of working capital in each health status — not SKU count">
          <HealthByValueBar data={s.healthByValue} />
        </Card>

        <Card title="Open Exceptions" subtitle={`${s.openExceptions.count} SKUs · ${s.openExceptions.critical} critical`}>
          <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
            {s.primaryExceptions.map((a) => <ExceptionRow key={a.sku_id} alert={a} />)}
          </div>
        </Card>
      </div>

      {/* ── Coverage chart + ABC/XYZ matrix ── */}
      <div style={{ display: "grid", gridTemplateColumns: "1.6fr 1fr", gap: 16, marginBottom: 20 }}>
        <Card title="Cover vs Lead Time + Safety Stock" subtitle="Coloured bar = days of cover · grey outline = lead time + statistical safety stock">
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={coverageData} margin={{ top: 8, right: 16, bottom: 0, left: -10 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
              <XAxis dataKey="name" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} />
              <YAxis tick={{ fontSize: 10 }} tickLine={false} axisLine={false} unit="d" />
              <Tooltip content={<CoverageTooltip />} cursor={{ fill: "var(--surface-2)" }} />
              <Bar dataKey="coverage" radius={[4, 4, 0, 0]} name="Days of cover">
                {coverageData.map((e, i) => <Cell key={i} fill={e.fill} />)}
              </Bar>
              <Bar dataKey="threshold" fill="transparent" stroke="#94a3b8" strokeWidth={1.5}
                radius={[3, 3, 0, 0]} name="Lead + safety" />
            </BarChart>
          </ResponsiveContainer>
          <div style={{ display: "flex", gap: 16, marginTop: 8, fontSize: 11, color: "var(--text-muted)", flexWrap: "wrap" }}>
            {Object.entries(HEALTH_COLORS).map(([k, c]) => (
              <span key={k} style={{ display: "flex", alignItems: "center", gap: 4 }}>
                <span style={{ width: 8, height: 8, borderRadius: 2, background: c, display: "inline-block" }} />{HEALTH_LABEL[k]}
              </span>
            ))}
            <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <span style={{ width: 8, height: 8, borderRadius: 2, border: "1.5px solid #94a3b8", display: "inline-block" }} />Lead + safety stock
            </span>
          </div>
        </Card>

        <Card title="ABC × XYZ Segmentation" subtitle="Rows: value (Pareto). Columns: demand predictability. Cell = SKUs · stock value">
          <AbcXyzMatrix matrix={s.abcXyzMatrix} />
        </Card>
      </div>

      {/* ── Ageing inventory ── */}
      {ageingItems.length > 0 && (
        <Card title="Ageing Inventory" subtitle="Stock approaching maximum holding limit — action required">
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 10 }}>
            {ageingItems.map((it) => (
              <div key={it.sku_id} style={{
                padding: "12px 14px",
                background: it.ageing_status === "At Risk" ? "#fef2f2" : "#fffbeb",
                border: `1px solid ${it.ageing_status === "At Risk" ? "#fecaca" : "#fde68a"}`,
                borderRadius: "var(--radius)",
                display: "flex", justifyContent: "space-between", alignItems: "center",
              }}>
                <div>
                  <div style={{ fontWeight: 600, fontSize: 13 }}>{it.product_name}</div>
                  <div style={{ fontSize: 12, color: "var(--text-secondary)", marginTop: 2 }}>
                    {it.inventory_age_days}d held · {it.available_stock} MT · max {it.max_holding_days}d
                  </div>
                  <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>
                    {it.max_holding_days - it.inventory_age_days} days to limit
                  </div>
                </div>
                <Badge type={it.ageing_status} />
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function HealthByValueBar({ data }) {
  return (
    <div>
      <div style={{ display: "flex", height: 30, borderRadius: 8, overflow: "hidden", border: "1px solid var(--border)" }}>
        {data.filter((d) => d.pct > 0).map((d) => (
          <div key={d.status} title={`${HEALTH_LABEL[d.status]}: ${d.pct}%`}
            style={{ width: `${d.pct}%`, background: HEALTH_COLORS[d.status] }} />
        ))}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: 8, marginTop: 12 }}>
        {data.map((d) => (
          <div key={d.status} style={{ fontSize: 12 }}>
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
          <div key={c} style={{ textAlign: "center", fontSize: 11, fontWeight: 700, color: "var(--text-secondary)" }}>
            {c}<div style={{ fontWeight: 400, fontSize: 10, color: "var(--text-muted)" }}>{colHint[c]}</div>
          </div>
        ))}
        {rows.map((r) => (
          <React.Fragment key={r}>
            <div style={{ display: "flex", flexDirection: "column", justifyContent: "center", fontSize: 11, fontWeight: 700, color: "var(--text-secondary)", paddingRight: 6 }}>
              {r}<span style={{ fontWeight: 400, fontSize: 10, color: "var(--text-muted)" }}>{rowHint[r]}</span>
            </div>
            {cols.map((c) => {
              const cell = cells[`${r}${c}`];
              const intensity = cell.value / maxVal;
              return (
                <div key={c} style={{
                  background: cell.value > 0 ? `rgba(59,130,246,${0.08 + intensity * 0.32})` : "var(--surface-2)",
                  border: "1px solid var(--border)", borderRadius: 6,
                  padding: "10px 4px", textAlign: "center",
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
      <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 10, lineHeight: 1.5 }}>
        AZ / BZ / CZ carry the hardest-to-plan stock — set higher safety stock and shorter review cycles there.
      </div>
    </div>
  );
}

function ExceptionRow({ alert }) {
  const borderColor = { critical: "#ef4444", warning: "#f97316", info: "#3b82f6" }[alert.severity] || "#94a3b8";
  return (
    <div style={{
      padding: "9px 11px",
      borderLeft: `3px solid ${borderColor}`,
      background: "var(--surface-2)",
      borderRadius: "0 var(--radius) var(--radius) 0",
    }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <span style={{ fontWeight: 600, fontSize: 12, flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {alert.sku_name}
        </span>
        <Badge type={alert.severity} />
      </div>
      <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2, lineHeight: 1.4 }}>
        {alert.alert_type.replace(/_/g, " ")} · {alert.message.slice(0, 58)}…
      </div>
    </div>
  );
}

function PageHeader({ title, subtitle }) {
  return (
    <div style={{ marginBottom: 24 }}>
      <h1 style={{ fontSize: 22, fontWeight: 700, color: "var(--text-primary)" }}>{title}</h1>
      <p style={{ fontSize: 13, color: "var(--text-secondary)", marginTop: 4 }}>{subtitle}</p>
    </div>
  );
}

function Card({ title, subtitle, children, accent }) {
  return (
    <div style={{
      background: "var(--card-bg)",
      border: "1px solid var(--border)",
      borderTop: accent ? `3px solid ${accent}` : "1px solid var(--border)",
      borderRadius: "var(--radius-lg)",
      padding: "20px 22px",
      boxShadow: "var(--shadow)",
    }}>
      <div style={{ marginBottom: 14 }}>
        <div style={{ fontWeight: 600, fontSize: 15 }}>{title}</div>
        {subtitle && <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 2 }}>{subtitle}</div>}
      </div>
      {children}
    </div>
  );
}
