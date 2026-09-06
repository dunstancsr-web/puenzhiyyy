import React, { useEffect, useState } from "react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend,
} from "recharts";
import {
  Package, AlertTriangle, TrendingDown, TrendingUp, DollarSign, ShoppingCart,
} from "lucide-react";
import StatCard from "../components/StatCard";
import Badge from "../components/Badge";
import { api } from "../api/inventory";

const PIE_COLORS = {
  in_stock: "#22c55e",
  low_stock: "#f59e0b",
  out_of_stock: "#ef4444",
  overstock: "#8b5cf6",
};

export default function Dashboard() {
  const [stats, setStats] = useState(null);
  const [products, setProducts] = useState([]);
  const [alerts, setAlerts] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([api.getStats(), api.getProducts(), api.getAlerts()])
      .then(([s, p, a]) => {
        setStats(s.data);
        setProducts(p.data);
        setAlerts(a.data);
      })
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <LoadingState />;

  const pieData = [
    { name: "In Stock", value: stats.inStock, key: "in_stock" },
    { name: "Low Stock", value: stats.lowStock, key: "low_stock" },
    { name: "Out of Stock", value: stats.outOfStock, key: "out_of_stock" },
    { name: "Overstock", value: stats.overstock, key: "overstock" },
  ].filter((d) => d.value > 0);

  // Top 5 by sales velocity
  const topSellers = [...products]
    .sort((a, b) => b.salesLast30Days - a.salesLast30Days)
    .slice(0, 5);

  // Top 5 slow-movers with stock
  const slowMovers = [...products]
    .filter((p) => p.currentStock > 0)
    .sort((a, b) => a.salesLast30Days - b.salesLast30Days)
    .slice(0, 5);

  return (
    <div>
      <PageHeader
        title="Dashboard"
        subtitle="Real-time overview of your inventory health"
      />

      {/* Stat cards */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
          gap: 16,
          marginBottom: 28,
        }}
      >
        <StatCard
          label="Total Products"
          value={stats.totalProducts}
          icon={Package}
          color="blue"
        />
        <StatCard
          label="Stock Value"
          value={`$${stats.totalStockValue.toLocaleString()}`}
          icon={DollarSign}
          color="green"
        />
        <StatCard
          label="Low Stock Items"
          value={stats.lowStock}
          icon={TrendingDown}
          color="yellow"
          sub="Need reordering soon"
        />
        <StatCard
          label="Out of Stock"
          value={stats.outOfStock}
          icon={AlertTriangle}
          color="red"
          sub="Immediate action needed"
        />
        <StatCard
          label="Overstocked"
          value={stats.overstock}
          icon={TrendingUp}
          color="purple"
          sub="Excess storage cost risk"
        />
      </div>

      {/* Charts row */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20, marginBottom: 28 }}>
        {/* Bar chart — top sellers */}
        <Card title="Top 5 Fast-Moving Products" subtitle="Sales in last 30 days">
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={topSellers} margin={{ top: 8, right: 8, bottom: 0, left: -10 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="name" tick={{ fontSize: 11 }} tickLine={false} axisLine={false}
                tickFormatter={(v) => v.split(" ").slice(0, 2).join(" ")} />
              <YAxis tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
              <Tooltip
                contentStyle={{ borderRadius: 8, border: "1px solid var(--border)", fontSize: 12 }}
                formatter={(v) => [`${v} units`, "Sales"]}
              />
              <Bar dataKey="salesLast30Days" fill="var(--blue)" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </Card>

        {/* Pie chart — stock distribution */}
        <Card title="Stock Status Distribution" subtitle="Products by current status">
          <ResponsiveContainer width="100%" height={220}>
            <PieChart>
              <Pie data={pieData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80} label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`} labelLine={false} fontSize={11}>
                {pieData.map((entry) => (
                  <Cell key={entry.key} fill={PIE_COLORS[entry.key]} />
                ))}
              </Pie>
              <Tooltip contentStyle={{ borderRadius: 8, border: "1px solid var(--border)", fontSize: 12 }} />
            </PieChart>
          </ResponsiveContainer>
        </Card>
      </div>

      {/* Bottom row */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
        {/* Recent alerts */}
        <Card title="Recent Alerts" subtitle={`${alerts.length} items need attention`}>
          {alerts.length === 0 ? (
            <EmptyState message="No alerts — all stock levels look good!" />
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {alerts.slice(0, 6).map((a, i) => (
                <div
                  key={i}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    padding: "10px 12px",
                    background: "var(--surface-2)",
                    borderRadius: "var(--radius)",
                    gap: 12,
                  }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: 13, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {a.name}
                    </div>
                    <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 2 }}>
                      {a.message}
                    </div>
                  </div>
                  <Badge type={a.severity} />
                </div>
              ))}
            </div>
          )}
        </Card>

        {/* Slow movers */}
        <Card title="Slow-Moving Stock" subtitle="Least sold in last 30 days">
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {slowMovers.map((p) => (
              <div
                key={p.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  padding: "10px 12px",
                  background: "var(--surface-2)",
                  borderRadius: "var(--radius)",
                }}
              >
                <div>
                  <div style={{ fontWeight: 600, fontSize: 13 }}>{p.name}</div>
                  <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
                    {p.currentStock} units · {p.salesLast30Days} sales / 30d
                  </div>
                </div>
                <Badge type={p.status} />
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}

function PageHeader({ title, subtitle }) {
  return (
    <div style={{ marginBottom: 24 }}>
      <h1 style={{ fontSize: 22, fontWeight: 700, color: "var(--text-primary)" }}>{title}</h1>
      <p style={{ fontSize: 14, color: "var(--text-secondary)", marginTop: 4 }}>{subtitle}</p>
    </div>
  );
}

function Card({ title, subtitle, children }) {
  return (
    <div
      style={{
        background: "var(--surface)",
        border: "1px solid var(--border)",
        borderRadius: "var(--radius-lg)",
        padding: "20px 24px",
        boxShadow: "var(--shadow)",
      }}
    >
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontWeight: 600, fontSize: 15 }}>{title}</div>
        {subtitle && (
          <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 2 }}>{subtitle}</div>
        )}
      </div>
      {children}
    </div>
  );
}

function LoadingState() {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: 300, color: "var(--text-muted)" }}>
      Loading dashboard…
    </div>
  );
}

function EmptyState({ message }) {
  return (
    <div style={{ padding: "24px 0", textAlign: "center", color: "var(--text-muted)", fontSize: 13 }}>
      {message}
    </div>
  );
}
