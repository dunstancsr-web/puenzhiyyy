import React from "react";
import { NavLink } from "react-router-dom";
import {
  LayoutDashboard,
  PackageSearch,
  Bell,
  TrendingUp,
} from "lucide-react";

const navItems = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "/inventory", label: "Inventory", icon: PackageSearch },
  { to: "/alerts", label: "Alerts", icon: Bell },
];

const activeStyle = {
  background: "var(--blue)",
  color: "#fff",
};

const baseStyle = {
  display: "flex",
  alignItems: "center",
  gap: 10,
  padding: "10px 16px",
  borderRadius: "var(--radius)",
  color: "var(--text-secondary)",
  fontWeight: 500,
  fontSize: 14,
  transition: "all 0.15s",
  marginBottom: 4,
};

export default function Sidebar() {
  return (
    <aside
      style={{
        width: 230,
        background: "var(--surface)",
        borderRight: "1px solid var(--border)",
        padding: "24px 16px",
        display: "flex",
        flexDirection: "column",
        gap: 4,
        flexShrink: 0,
      }}
    >
      {/* Logo */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "0 8px",
          marginBottom: 32,
        }}
      >
        <div
          style={{
            width: 34,
            height: 34,
            background: "var(--blue)",
            borderRadius: 8,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <TrendingUp size={18} color="#fff" />
        </div>
        <div>
          <div style={{ fontWeight: 700, fontSize: 15, color: "var(--text-primary)" }}>
            StockSense
          </div>
          <div style={{ fontSize: 11, color: "var(--text-muted)" }}>Inventory Monitor</div>
        </div>
      </div>

      {/* Nav */}
      <nav style={{ flex: 1 }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text-muted)", padding: "0 8px", marginBottom: 8, letterSpacing: "0.06em", textTransform: "uppercase" }}>
          Menu
        </div>
        {navItems.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            style={({ isActive }) => ({
              ...baseStyle,
              ...(isActive ? activeStyle : {}),
            })}
          >
            <Icon size={17} />
            {label}
          </NavLink>
        ))}
      </nav>

      {/* Footer */}
      <div
        style={{
          padding: "12px 8px",
          borderTop: "1px solid var(--border)",
          fontSize: 12,
          color: "var(--text-muted)",
        }}
      >
        Hackathon Demo · 2026
      </div>
    </aside>
  );
}
