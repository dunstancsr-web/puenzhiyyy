import React, { useState, useEffect } from "react";
import { NavLink, Link, useLocation } from "react-router-dom";
import { LayoutDashboard, PackageSearch, Bell, TrendingUp, Sun, Moon } from "lucide-react";
import { useTheme, THEMES } from "../context/ThemeContext";
import { api } from "../api/inventory";

export default function Sidebar() {
  const { theme, setTheme } = useTheme();
  const location = useLocation();
  const [alertCount, setAlertCount] = useState(0);

  // Sidebar persists across page navigation (mounted once above <Routes> in
  // App.jsx) rather than remounting per page, so refetch on every route change
  // to stay live - e.g. dismissing an alert on /alerts should update the badge
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
    <>
    {/* Full side panel - shown at 769px and up; hidden below that via CSS
        (see .app-sidebar-panel in index.css). */}
    <aside
      className="app-sidebar-panel"
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
          <div style={{ fontWeight: 700, fontSize: 16, color: "var(--text-primary)" }}>StockSense</div>
          <div style={{ fontSize: 12, color: "var(--text-muted)" }}>Rice Inventory AI</div>
        </div>
      </div>

      {/* Nav */}
      <nav style={{ flex: 1 }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-muted)", padding: "0 8px", marginBottom: 8, letterSpacing: "0.06em", textTransform: "uppercase" }}>
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
              fontWeight: 500, fontSize: 15,
              marginBottom: 4, transition: "all 0.15s",
              textDecoration: "none",
            })}
          >
            <Icon size={17} />
            <span style={{ flex: 1 }}>{label}</span>
            {badge > 0 && (
              <span style={{ background: "var(--red)", color: "#fff", borderRadius: 99, fontSize: 12, fontWeight: 700, padding: "1px 7px", lineHeight: 1.5 }}>
                {badge}
              </span>
            )}
          </NavLink>
        ))}
      </nav>

      {/* Theme switcher */}
      <div style={{ marginBottom: 12 }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-muted)", padding: "0 8px", marginBottom: 8, letterSpacing: "0.06em", textTransform: "uppercase" }}>
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
                fontSize: 14, fontWeight: theme === t.id ? 600 : 400,
                cursor: "pointer", textAlign: "left",
                transition: "all 0.15s",
              }}
            >
              <span style={{ fontSize: 15 }}>{t.icon}</span>
              {t.label}
              {theme === t.id && (
                <span style={{ marginLeft: "auto", width: 6, height: 6, borderRadius: "50%", background: "var(--blue)" }} />
              )}
            </button>
          ))}
        </div>
      </div>

      <div style={{ padding: "12px 8px", borderTop: "1px solid var(--sidebar-border)", fontSize: 13, color: "var(--text-muted)" }}>
        AWS NUS-ISS SMYA 2026
      </div>
    </aside>

    {/* Floating glass top bar - shown below 769px instead of the panel above
        (see .app-topbar-glass in index.css). A frosted, translucent strip
        pinned to the top of the screen: brand mark, icon-only nav with the
        alert badge, and a single tap to flip Light/Dark. This is a one-off
        visual treatment for this bar, not the removed "Liquid Glass" theme -
        it works the same way in both Light and Dark mode. */}
    <nav className="app-topbar-glass" aria-label="Primary">
      <div className="app-topbar-glass__inner">
        <Link to="/dashboard" aria-label="StockSense home" style={{ display: "flex", flexShrink: 0 }}>
          <div style={{ width: 30, height: 30, background: "var(--blue)", borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <TrendingUp size={16} color="#fff" />
          </div>
        </Link>

        <div style={{ display: "flex", alignItems: "center", gap: 2, flex: 1, justifyContent: "center" }}>
          {navItems.map(({ to, label, icon: Icon, badge }) => (
            <NavLink
              key={to}
              to={to}
              aria-label={label}
              style={({ isActive }) => ({
                position: "relative", display: "flex", alignItems: "center", justifyContent: "center",
                width: 42, height: 42, borderRadius: "50%",
                color: isActive ? "#fff" : "var(--text-secondary)",
                background: isActive ? "var(--blue)" : "transparent",
                transition: "all 0.15s",
              })}
            >
              <Icon size={19} />
              {badge > 0 && (
                <span style={{
                  position: "absolute", top: 3, right: 3, minWidth: 15, height: 15, padding: "0 3px",
                  borderRadius: 99, background: "var(--red)", color: "#fff", fontSize: 10, fontWeight: 700,
                  display: "flex", alignItems: "center", justifyContent: "center", lineHeight: 1,
                }}>
                  {badge}
                </span>
              )}
            </NavLink>
          ))}
        </div>

        <button
          type="button"
          onClick={() => setTheme(theme === "light" ? "dark" : "light")}
          aria-label={`Switch to ${theme === "light" ? "Dark" : "Light"} theme`}
          style={{
            display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
            width: 38, height: 38, borderRadius: "50%", background: "none", color: "var(--text-secondary)",
          }}
        >
          {theme === "light" ? <Sun size={18} /> : <Moon size={18} />}
        </button>
      </div>
    </nav>
    </>
  );
}
