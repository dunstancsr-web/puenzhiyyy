import React, { useState, useEffect } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { LayoutDashboard, PackageSearch, Bell, TrendingUp } from "lucide-react";
import { useTheme, THEMES } from "../context/ThemeContext";
import { api } from "../api/inventory";

export default function Sidebar() {
  const { theme, setTheme } = useTheme();
  const location = useLocation();
  const [alertCount, setAlertCount] = useState(0);

  // Sidebar persists across page navigation (mounted once above <Routes> in
  // App.jsx) rather than remounting per page, so refetch on every route change
  // to stay live — e.g. dismissing an alert on /alerts should update the badge
  // the moment you navigate away, not just on a hard refresh.
  useEffect(() => {
    api.getAlerts().then((data) => setAlertCount(data.length)).catch(() => {});
  }, [location.pathname]);

  const navItems = [
    { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard, badge: null },
    { to: "/inventory", label: "Inventory",  icon: PackageSearch,  badge: null },
    { to: "/alerts",    label: "Alerts",     icon: Bell,           badge: alertCount },
  ];

  return (
    <aside
      className="glass-blur"
      style={{
        width: 230,
        background: "var(--sidebar-bg)",
        borderRight: "1px solid var(--sidebar-border)",
        padding: "24px 16px",
        display: "flex",
        flexDirection: "column",
        flexShrink: 0,
        position: "sticky",
        top: 0,
        height: "100vh",
      }}
    >
      {/* Logo */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "0 8px", marginBottom: 32 }}>
        <div style={{ width: 34, height: 34, background: "var(--blue)", borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
          <TrendingUp size={18} color="#fff" />
        </div>
        <div>
          <div style={{ fontWeight: 700, fontSize: 15, color: "var(--text-primary)" }}>StockSense</div>
          <div style={{ fontSize: 11, color: "var(--text-muted)" }}>Rice Inventory AI</div>
        </div>
      </div>

      {/* Nav */}
      <nav style={{ flex: 1 }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text-muted)", padding: "0 8px", marginBottom: 8, letterSpacing: "0.06em", textTransform: "uppercase" }}>
          Menu
        </div>
        {navItems.map(({ to, label, icon: Icon, badge }) => (
          <NavLink
            key={to}
            to={to}
            style={({ isActive }) => ({
              display: "flex", alignItems: "center", gap: 10,
              padding: "10px 16px", borderRadius: "var(--radius)",
              color: isActive ? "#fff" : "var(--text-secondary)",
              background: isActive ? "var(--blue)" : "transparent",
              fontWeight: 500, fontSize: 14,
              marginBottom: 4, transition: "all 0.15s",
              textDecoration: "none",
            })}
          >
            <Icon size={17} />
            <span style={{ flex: 1 }}>{label}</span>
            {badge > 0 && (
              <span style={{ background: "#ef4444", color: "#fff", borderRadius: 99, fontSize: 11, fontWeight: 700, padding: "1px 7px", lineHeight: 1.5 }}>
                {badge}
              </span>
            )}
          </NavLink>
        ))}
      </nav>

      {/* Theme switcher */}
      <div style={{ marginBottom: 12 }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text-muted)", padding: "0 8px", marginBottom: 8, letterSpacing: "0.06em", textTransform: "uppercase" }}>
          Theme
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          {THEMES.map((t) => (
            <button
              key={t.id}
              onClick={() => setTheme(t.id)}
              style={{
                display: "flex", alignItems: "center", gap: 8,
                padding: "7px 12px", borderRadius: "var(--radius)",
                border: `1px solid ${theme === t.id ? "var(--blue)" : "var(--border)"}`,
                background: theme === t.id ? "var(--blue-light)" : "transparent",
                color: theme === t.id ? "var(--blue)" : "var(--text-secondary)",
                fontSize: 13, fontWeight: theme === t.id ? 600 : 400,
                cursor: "pointer", textAlign: "left",
                transition: "all 0.15s",
              }}
            >
              <span style={{ fontSize: 14 }}>{t.icon}</span>
              {t.label}
              {theme === t.id && (
                <span style={{ marginLeft: "auto", width: 6, height: 6, borderRadius: "50%", background: "var(--blue)" }} />
              )}
            </button>
          ))}
        </div>
      </div>

      <div style={{ padding: "12px 8px", borderTop: "1px solid var(--sidebar-border)", fontSize: 12, color: "var(--text-muted)" }}>
        AWS NUS-ISS SMYA 2026
      </div>
    </aside>
  );
}
