import React from "react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Cell, ReferenceLine,
} from "recharts";
import {
  DollarSign, AlertTriangle, TrendingDown, TrendingUp, Clock,
  ArrowRight, ShoppingCart, PackageX, Zap,
} from "lucide-react";
import StatCard from "../components/StatCard";
import Badge from "../components/Badge";
import { mockStats } from "../mock/statsData";
import { mockAlerts } from "../mock/alertsData";
import { mockSkus } from "../mock/riceData";

const HEALTH_COLORS = { GREEN: "#22c55e", YELLOW: "#f59e0b", ORANGE: "#f97316", RED: "#ef4444" };

// ── Today's actions — ranked by urgency + financial impact ────────────────────
function buildTodayActions() {
  const actions = [];

  // Stockout risks first (critical)
  mockSkus
    .filter((s) => s.health_status === "RED" && s.movement_class !== "Idle")
    .forEach((s) => {
      const gap = (s.days_of_stock ?? 0) - s.lead_time_days;
      actions.push({
        priority: 1,
        sku_id: s.sku_id,
        name: s.product_name,
        action: "Place replenishment order",
        reason: `${s.days_of_stock ?? 0}d stock vs ${s.lead_time_days}d lead time — ${Math.abs(gap)}d gap`,
        value: s.available_stock * s.unit_cost_sgd,
        tag: "STOCKOUT RISK",
        tagColor: "#dc2626",
        tagBg: "#fef2f2",
      });
    });

  // Idle stock (RED, no demand)
  mockSkus
    .filter((s) => s.movement_class === "Idle")
    .forEach((s) => {
      actions.push({
        priority: 2,
        sku_id: s.sku_id,
        name: s.product_name,
        action: "Initiate disposition review",
        reason: `No sales in 90+ days · ${s.available_stock} MT at risk of ageing`,
        value: s.available_stock * s.unit_cost_sgd,
        tag: "IDLE STOCK",
        tagColor: "#b45309",
        tagBg: "#fffbeb",
      });
    });

  // Overstock (ORANGE, physical > max)
  mockSkus
    .filter((s) => s.physical_stock > s.max_stock)
    .forEach((s) => {
      const excessMT = s.physical_stock - s.max_stock;
      actions.push({
        priority: 3,
        sku_id: s.sku_id,
        name: s.product_name,
        action: "Suspend purchasing",
        reason: `${excessMT} MT above max stock · SGD $${(excessMT * s.unit_cost_sgd / 1000).toFixed(0)}K locked`,
        value: excessMT * s.unit_cost_sgd,
        tag: "OVERSTOCK",
        tagColor: "#7c3aed",
        tagBg: "#f5f3ff",
      });
    });

  // Approaching reorder (ORANGE, within lead time buffer)
  mockSkus
    .filter((s) => s.health_status === "ORANGE" && s.available_stock <= s.reorder_point && s.movement_class !== "Idle" && s.physical_stock <= s.max_stock)
    .forEach((s) => {
      actions.push({
        priority: 4,
        sku_id: s.sku_id,
        name: s.product_name,
        action: "Initiate procurement review",
        reason: `Available stock (${s.available_stock} MT) at reorder point (${s.reorder_point} MT)`,
        value: s.available_stock * s.unit_cost_sgd,
        tag: "REORDER",
        tagColor: "#c2410c",
        tagBg: "#fff7ed",
      });
    });

  return actions
    .sort((a, b) => a.priority - b.priority || b.value - a.value)
    .slice(0, 5);
}

// ── Coverage vs Lead Time chart data ─────────────────────────────────────────
function buildCoverageData() {
  return [...mockSkus]
    .sort((a, b) => {
      const aGap = (a.days_of_stock ?? 0) - a.lead_time_days;
      const bGap = (b.days_of_stock ?? 0) - b.lead_time_days;
      return aGap - bGap;
    })
    .slice(0, 7)
    .map((s) => ({
      name: s.product_name.replace(/ \d+KG$/, "").slice(0, 16),
      coverage: s.days_of_stock ?? 0,
      leadTime: s.lead_time_days,
      gap: (s.days_of_stock ?? 0) - s.lead_time_days,
      fill: HEALTH_COLORS[s.health_status],
      sku_id: s.sku_id,
    }));
}

// ── Custom tooltip for coverage chart ────────────────────────────────────────
const CoverageTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  const d = payload[0]?.payload;
  const gap = d?.gap ?? 0;
  return (
    <div style={{ background: "#fff", border: "1px solid var(--border)", borderRadius: 8, padding: "10px 14px", fontSize: 12 }}>
      <div style={{ fontWeight: 700, marginBottom: 6 }}>{label}</div>
      <div style={{ color: "var(--text-secondary)", marginBottom: 3 }}>Days of stock: <strong>{d?.coverage}d</strong></div>
      <div style={{ color: "var(--text-secondary)", marginBottom: 3 }}>Lead time: <strong>{d?.leadTime}d</strong></div>
      <div style={{ color: gap < 0 ? "#dc2626" : "#16a34a", fontWeight: 700 }}>
        {gap < 0 ? `⚠ ${Math.abs(gap)}d SHORTFALL` : `✓ ${gap}d buffer`}
      </div>
    </div>
  );
};

export default function Dashboard() {
  const s = mockStats;
  const topAlerts = mockAlerts.filter((a) => !a.acknowledged).slice(0, 6);
  const todayActions = buildTodayActions();
  const coverageData = buildCoverageData();
  const ageingItems = mockStats.ageingItems;

  return (
    <div>
      <PageHeader
        title="Inventory Dashboard"
        subtitle={new Date().toLocaleDateString("en-SG", { weekday: "long", year: "numeric", month: "long", day: "numeric" })}
      />

      {/* ── KPI cards — only actionable metrics ── */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(185px, 1fr))", gap: 14, marginBottom: 24 }}>
        <StatCard label="Inventory Value"    value={`SGD $${(s.totalInventoryValue / 1e6).toFixed(2)}M`} icon={DollarSign}   color="green" sub="Physical stock × unit cost" />
        <StatCard label="Avg Stock Coverage" value={`${s.avgDaysOfStock}d`}                               icon={Clock}        color="blue"  sub="Portfolio average" />
        <StatCard label="Critical (RED)"     value={s.redCount}                                            icon={AlertTriangle} color="red"  sub="Stockout or idle risk" />
        <StatCard label="Action Required"    value={s.orangeCount}                                         icon={TrendingDown}  color="yellow" sub="Reorder or overstock" />
        <StatCard label="Overstock Exposure" value={`SGD $${(s.overstockedValue / 1000).toFixed(0)}K`}    icon={TrendingUp}   color="purple" sub="Capital locked above max" />
        <StatCard label="Slow + Idle Value"  value={`SGD $${(s.slowIdleValue / 1000).toFixed(0)}K`}       icon={PackageX}     color="yellow" sub="At risk of ageing" />
      </div>

      {/* ── TODAY'S TOP ACTIONS — most important panel ── */}
      <div style={{ marginBottom: 20 }}>
        <Card
          title="Today's Top Actions"
          subtitle="Ranked by urgency and financial impact"
          accent="#3b82f6"
        >
          {todayActions.length === 0 ? (
            <div style={{ padding: "16px 0", textAlign: "center", color: "#16a34a", fontWeight: 600, fontSize: 13 }}>
              ✓ No urgent actions required — portfolio is healthy.
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
              {todayActions.map((a, i) => (
                <div key={a.sku_id} style={{
                  display: "flex", alignItems: "center", gap: 14,
                  padding: "12px 0",
                  borderBottom: i < todayActions.length - 1 ? "1px solid var(--border)" : "none",
                }}>
                  {/* Priority number */}
                  <div style={{
                    width: 26, height: 26, borderRadius: "50%",
                    background: i === 0 ? "#fef2f2" : i === 1 ? "#fff7ed" : "var(--surface-2)",
                    color: i === 0 ? "#dc2626" : i === 1 ? "#c2410c" : "var(--text-muted)",
                    fontWeight: 700, fontSize: 12,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    flexShrink: 0,
                  }}>
                    {i + 1}
                  </div>

                  {/* Action details */}
                  <div style={{ flex: 1 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 3 }}>
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

                  {/* Value at risk */}
                  <div style={{ textAlign: "right", flexShrink: 0 }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text-primary)" }}>
                      SGD ${(a.value / 1000).toFixed(0)}K
                    </div>
                    <div style={{ fontSize: 11, color: "var(--text-muted)" }}>at risk</div>
                  </div>

                  <ArrowRight size={14} color="var(--text-muted)" />
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      {/* ── Charts row ── */}
      <div style={{ display: "grid", gridTemplateColumns: "1.6fr 1fr", gap: 16, marginBottom: 20 }}>

        {/* Coverage vs Lead Time — the key chart */}
        <Card
          title="Stock Coverage vs Lead Time"
          subtitle="Days of stock (coloured) against supplier lead time (grey line) — gap shows risk"
        >
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={coverageData} margin={{ top: 8, right: 16, bottom: 0, left: -10 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
              <XAxis dataKey="name" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} />
              <YAxis tick={{ fontSize: 10 }} tickLine={false} axisLine={false} unit="d" />
              <Tooltip content={<CoverageTooltip />} />
              {/* Lead time as a reference band per bar — approximated with a line at median lead time */}
              <Bar dataKey="coverage" radius={[4, 4, 0, 0]} name="Days of Stock">
                {coverageData.map((e, i) => <Cell key={i} fill={e.fill} />)}
              </Bar>
              <Bar dataKey="leadTime" fill="transparent" stroke="#94a3b8" strokeWidth={1.5}
                radius={[3, 3, 0, 0]} name="Lead Time" fillOpacity={0.08} />
            </BarChart>
          </ResponsiveContainer>
          <div style={{ display: "flex", gap: 16, marginTop: 8, fontSize: 11, color: "var(--text-muted)" }}>
            {Object.entries(HEALTH_COLORS).map(([k, c]) => (
              <span key={k} style={{ display: "flex", alignItems: "center", gap: 4 }}>
                <span style={{ width: 8, height: 8, borderRadius: 2, background: c, display: "inline-block" }} />{k}
              </span>
            ))}
            <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <span style={{ width: 8, height: 8, borderRadius: 2, background: "#94a3b8", display: "inline-block" }} />Lead time
            </span>
          </div>
        </Card>

        {/* Active alerts — trimmed to 6 */}
        <Card title="Active Alerts" subtitle={`${topAlerts.length} requiring attention`}>
          <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
            {topAlerts.map((a) => <AlertRow key={a.id} alert={a} />)}
          </div>
        </Card>
      </div>

      {/* ── Ageing inventory ── */}
      {ageingItems.length > 0 && (
        <Card title="Ageing Inventory" subtitle="Stock approaching maximum holding limit — action required">
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 10 }}>
            {ageingItems.map((s) => (
              <div key={s.sku_id} style={{
                padding: "12px 14px",
                background: s.ageing_status === "At Risk" ? "#fef2f2" : "#fffbeb",
                border: `1px solid ${s.ageing_status === "At Risk" ? "#fecaca" : "#fde68a"}`,
                borderRadius: "var(--radius)",
                display: "flex", justifyContent: "space-between", alignItems: "center",
              }}>
                <div>
                  <div style={{ fontWeight: 600, fontSize: 13 }}>{s.product_name}</div>
                  <div style={{ fontSize: 12, color: "var(--text-secondary)", marginTop: 2 }}>
                    {s.inventory_age_days}d held · {s.available_stock} MT · max {s.max_holding_days}d
                  </div>
                  <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>
                    {s.max_holding_days - s.inventory_age_days} days remaining before limit
                  </div>
                </div>
                <Badge type={s.ageing_status} />
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function AlertRow({ alert }) {
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
        {alert.alert_type.replace(/_/g, " ")} · {alert.message.slice(0, 60)}…
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
      background: "#ffffff",
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
