import React, { useEffect, useState } from "react";
import { AlertTriangle, XCircle, TrendingDown, TrendingUp, RefreshCw } from "lucide-react";
import Badge from "../components/Badge";
import { api } from "../api/inventory";

const TYPE_META = {
  out_of_stock: { icon: XCircle,      color: "var(--red)",    label: "Out of Stock",  border: "#fecaca", bg: "#fff5f5" },
  low_stock:    { icon: AlertTriangle, color: "#b45309",       label: "Low Stock",     border: "#fde68a", bg: "#fffbeb" },
  overstock:    { icon: TrendingUp,    color: "var(--purple)", label: "Overstock",     border: "#ddd6fe", bg: "#f5f3ff" },
  slow_moving:  { icon: TrendingDown,  color: "var(--blue)",   label: "Slow Moving",   border: "#bfdbfe", bg: "#eff6ff" },
};

const SEVERITY_ORDER = { critical: 0, warning: 1, info: 2 };

export default function Alerts() {
  const [alerts, setAlerts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("all");

  const fetchAlerts = () => {
    setLoading(true);
    api.getAlerts().then((r) => setAlerts(r.data)).finally(() => setLoading(false));
  };

  useEffect(() => { fetchAlerts(); }, []);

  const filtered = alerts
    .filter((a) => filter === "all" || a.type === filter)
    .sort((a, b) => (SEVERITY_ORDER[a.severity] ?? 3) - (SEVERITY_ORDER[b.severity] ?? 3));

  const counts = alerts.reduce((acc, a) => {
    acc[a.type] = (acc[a.type] || 0) + 1;
    return acc;
  }, {});

  const tabs = [
    { key: "all", label: "All", count: alerts.length },
    { key: "out_of_stock", label: "Out of Stock", count: counts.out_of_stock || 0 },
    { key: "low_stock", label: "Low Stock", count: counts.low_stock || 0 },
    { key: "overstock", label: "Overstock", count: counts.overstock || 0 },
    { key: "slow_moving", label: "Slow Moving", count: counts.slow_moving || 0 },
  ];

  return (
    <div>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700 }}>Alerts</h1>
          <p style={{ fontSize: 14, color: "var(--text-secondary)", marginTop: 4 }}>
            {alerts.length} active alerts across your inventory
          </p>
        </div>
        <button
          onClick={fetchAlerts}
          style={{
            display: "flex", alignItems: "center", gap: 6,
            padding: "9px 14px", border: "1px solid var(--border)",
            borderRadius: "var(--radius)", background: "var(--surface)",
            fontSize: 13, color: "var(--text-secondary)", fontWeight: 500,
          }}
        >
          <RefreshCw size={13} /> Refresh
        </button>
      </div>

      {/* Summary cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 14, marginBottom: 24 }}>
        {Object.entries(TYPE_META).map(([type, meta]) => {
          const Icon = meta.icon;
          return (
            <div
              key={type}
              onClick={() => setFilter(type === filter ? "all" : type)}
              style={{
                background: filter === type ? meta.bg : "var(--surface)",
                border: `1px solid ${filter === type ? meta.border : "var(--border)"}`,
                borderRadius: "var(--radius-lg)", padding: "16px 20px",
                cursor: "pointer", transition: "all 0.15s",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                <Icon size={16} color={meta.color} />
                <span style={{ fontSize: 12, fontWeight: 600, color: meta.color }}>{meta.label}</span>
              </div>
              <div style={{ fontSize: 28, fontWeight: 700, color: "var(--text-primary)" }}>
                {counts[type] || 0}
              </div>
            </div>
          );
        })}
      </div>

      {/* Filter tabs */}
      <div style={{ display: "flex", gap: 6, marginBottom: 20, flexWrap: "wrap" }}>
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setFilter(t.key)}
            style={{
              padding: "6px 14px", borderRadius: 99,
              border: "1px solid",
              borderColor: filter === t.key ? "var(--blue)" : "var(--border)",
              background: filter === t.key ? "var(--blue-light)" : "var(--surface)",
              color: filter === t.key ? "var(--blue)" : "var(--text-secondary)",
              fontSize: 13, fontWeight: 500, cursor: "pointer",
              display: "flex", alignItems: "center", gap: 6,
            }}
          >
            {t.label}
            <span
              style={{
                background: filter === t.key ? "var(--blue)" : "var(--border)",
                color: filter === t.key ? "#fff" : "var(--text-secondary)",
                borderRadius: 99, padding: "0 7px", fontSize: 11, fontWeight: 700,
              }}
            >
              {t.count}
            </span>
          </button>
        ))}
      </div>

      {/* Alert list */}
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {loading ? (
          <div style={{ padding: 40, textAlign: "center", color: "var(--text-muted)" }}>Loading…</div>
        ) : filtered.length === 0 ? (
          <div
            style={{
              background: "var(--surface)", border: "1px solid var(--border)",
              borderRadius: "var(--radius-lg)", padding: 48,
              textAlign: "center", color: "var(--text-muted)", fontSize: 14,
            }}
          >
            No alerts in this category.
          </div>
        ) : (
          filtered.map((alert, i) => {
            const meta = TYPE_META[alert.type] || TYPE_META.slow_moving;
            const Icon = meta.icon;
            return (
              <AlertRow key={i} alert={alert} meta={meta} Icon={Icon} />
            );
          })
        )}
      </div>
    </div>
  );
}

function AlertRow({ alert, meta, Icon }) {
  return (
    <div
      style={{
        background: "var(--surface)", border: "1px solid var(--border)",
        borderLeft: `4px solid ${meta.color}`,
        borderRadius: "var(--radius-lg)",
        padding: "16px 20px",
        display: "flex", alignItems: "center",
        gap: 16, boxShadow: "var(--shadow)",
      }}
    >
      <div
        style={{
          width: 38, height: 38, borderRadius: 10,
          background: meta.bg, border: `1px solid ${meta.border}`,
          display: "flex", alignItems: "center", justifyContent: "center",
          flexShrink: 0,
        }}
      >
        <Icon size={17} color={meta.color} />
      </div>

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4, flexWrap: "wrap" }}>
          <span style={{ fontWeight: 700, fontSize: 14 }}>{alert.name}</span>
          <span style={{ fontSize: 11, fontFamily: "monospace", color: "var(--text-muted)", background: "var(--surface-2)", padding: "1px 7px", borderRadius: 4 }}>
            {alert.sku}
          </span>
          <Badge type={alert.severity} />
        </div>
        <p style={{ fontSize: 13, color: "var(--text-secondary)" }}>{alert.message}</p>
      </div>

      <div style={{ textAlign: "right", flexShrink: 0 }}>
        <div style={{ fontSize: 22, fontWeight: 700, color: "var(--text-primary)" }}>
          {alert.currentStock}
        </div>
        <div style={{ fontSize: 11, color: "var(--text-muted)" }}>units</div>
      </div>
    </div>
  );
}
