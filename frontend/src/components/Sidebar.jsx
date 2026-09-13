import React, { useState, useEffect } from "react";
import { NavLink, Link, useLocation } from "react-router-dom";
import { LayoutDashboard, PackageSearch, Bell, History, TrendingUp, LayoutGrid } from "lucide-react";
import { api } from "../api/inventory";
import SettingsMenu from "./SettingsMenu";

// ─────────────────────────────────────────────────────────────────────────────
// CONTROL TOWER NAVIGATION (TASK-49)
//
// Two presentations of the same four destinations.
//
// DESKTOP, a left panel carrying navigation and nothing else. The settings that
// used to sit expanded below the links (three explanation tiers, a caption, two
// theme buttons) now live behind one entry at the bottom, which is where
// Linear, Notion, Stripe and Vercel all put them. A sidebar is a map, and a map
// that also holds the car's controls is harder to read as either.
//
// NARROW, a two row strip at the top. Everything stays at the top because this
// is a desktop web app that can be viewed narrow, not a native mobile app, and
// the web convention is navigation at the top. An earlier version put the tabs
// along the bottom on thumb-reach grounds, which is the right answer for an app
// you install and the wrong one for a page you open.
//
// Two rows rather than one pill, because leaving the Control Tower, moving
// inside it, and changing a setting are three unrelated jobs. The old single
// island also placed the Home grid icon immediately beside the Dashboard
// grid icon: two near-identical glyphs one tap apart. The top row now holds the
// two things that are not navigation, pushed to opposite edges; the second row
// is navigation alone, and having it to itself is what buys room for labels.
// ─────────────────────────────────────────────────────────────────────────────

export default function Sidebar() {
  const location = useLocation();
  const [alertCount, setAlertCount] = useState(0);

  // Mounted once above <Routes>, so it never remounts on navigation. Refetching
  // per route keeps the badge live: dismissing an alert should update it the
  // moment you navigate away, not on a hard refresh.
  useEffect(() => {
    api.getAlerts().then((data) => setAlertCount(data.length)).catch(() => {});
  }, [location.pathname]);

  const navItems = [
    { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard, badge: null },
    { to: "/inventory", label: "Inventory", icon: PackageSearch, badge: null },
    { to: "/alerts", label: "Alerts", icon: Bell, badge: alertCount },
    // Last on purpose: Activity is a record to consult, not a queue to work.
    { to: "/activity", label: "Activity", icon: History, badge: null },
  ];

  return (
    <>
      {/* ── Desktop panel ────────────────────────────────────────────────────
          `display` and `flex-direction` live in .app-sidebar-panel, NOT in the
          inline style below. An inline display beats any stylesheet rule
          without !important, so the breakpoint's `display: none` could never
          hide this and both navigations rendered on top of each other. */}
      <aside
        className="app-sidebar-panel"
        style={{
          width: 230,
          background: "var(--sidebar-bg)",
          borderRight: "1px solid var(--sidebar-border)",
          padding: "24px 16px",
          flexShrink: 0,
          position: "sticky",
          top: 0,
          height: "100vh",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "0 8px", marginBottom: 22 }}>
          <div style={{
            width: 34, height: 34, background: "var(--blue)", borderRadius: 8,
            display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
          }}>
            <TrendingUp size={18} color="#fff" />
          </div>
          <div>
            <div style={{ fontWeight: 700, fontSize: 16, color: "var(--text-primary)" }}>StockSense</div>
            <div style={{ fontSize: 12, color: "var(--text-muted)" }}>Control Tower</div>
          </div>
        </div>

        {/* The way out, styled as leaving rather than as a fifth page. */}
        <Link to="/" style={{
          display: "flex", alignItems: "center", gap: 9,
          padding: "9px 10px", marginBottom: 18, borderRadius: "var(--radius)",
          border: "1px solid var(--sidebar-border)",
          color: "var(--text-secondary)", textDecoration: "none",
          fontSize: 13.5, fontWeight: 600,
        }}>
          <LayoutGrid size={15} />
          Home
          <span style={{ marginLeft: "auto", fontSize: 11, color: "var(--text-muted)", fontWeight: 500 }}>Switch</span>
        </Link>

        <nav style={{ flex: 1 }}>
          {navItems.map(({ to, label, icon: Icon, badge }) => (
            <NavLink key={to} to={to}
              style={({ isActive }) => ({
                display: "flex", alignItems: "center", gap: 11,
                padding: "10px 12px", marginBottom: 3, borderRadius: "var(--radius)",
                textDecoration: "none", fontSize: 15,
                fontWeight: isActive ? 600 : 400,
                background: isActive ? "var(--blue)" : "transparent",
                color: isActive ? "#fff" : "var(--text-secondary)",
                transition: "background 0.15s, color 0.15s",
              })}>
              {({ isActive }) => (
                <>
                  <Icon size={17} />
                  <span style={{ flex: 1 }}>{label}</span>
                  {badge > 0 && (
                    <span style={{
                      background: isActive ? "rgba(255,255,255,0.25)" : "var(--red)",
                      color: "#fff", fontSize: 11, fontWeight: 700,
                      minWidth: 19, height: 19, borderRadius: 99,
                      display: "flex", alignItems: "center", justifyContent: "center", padding: "0 5px",
                    }}>
                      {badge}
                    </span>
                  )}
                </>
              )}
            </NavLink>
          ))}
        </nav>

        <SettingsMenu align="up" />

        <div style={{
          padding: "12px 8px 0", marginTop: 12, borderTop: "1px solid var(--sidebar-border)",
          fontSize: 12, color: "var(--text-muted)",
        }}>
          AWS NUS-ISS SMYA 2026
        </div>
      </aside>

      {/* ── Narrow: one row at the top, three groups ─────────────────────────
          Home, navigation, settings. The settings trigger collapses to a gear,
          which is what freed the roughly 150px that let this fit on one row. */}
      <div className="app-topbar-glass">
        <div className="app-topbar-glass__island">
          <Link to="/" aria-label="Home" style={{
            display: "flex", alignItems: "center", gap: 7, textDecoration: "none",
            color: "var(--text-primary)", fontSize: 13.5, fontWeight: 600, padding: "0 4px",
          }}>
            <LayoutGrid size={16} />
            Home
          </Link>
        </div>

        <nav className="app-topbar-glass__nav" aria-label="Primary">
          {navItems.map(({ to, label, icon: Icon, badge }) => (
            <NavLink key={to} to={to} title={label}
              style={({ isActive }) => ({
                flex: 1, minWidth: 0,
                display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
                padding: "8px 4px", borderRadius: 999, textDecoration: "none",
                background: isActive ? "var(--blue)" : "transparent",
                color: isActive ? "#fff" : "var(--text-secondary)",
                transition: "background 0.15s, color 0.15s",
              })}>
              {({ isActive }) => (
                <>
                  <span style={{ position: "relative", display: "flex", flexShrink: 0 }}>
                    <Icon size={16} strokeWidth={isActive ? 2.4 : 2} />
                    {badge > 0 && !isActive && (
                      <span style={{
                        position: "absolute", top: -4, right: -6,
                        background: "var(--red)", color: "#fff",
                        fontSize: 9, fontWeight: 700, minWidth: 14, height: 14,
                        borderRadius: 99, display: "flex", alignItems: "center",
                        justifyContent: "center", padding: "0 3px",
                      }}>
                        {badge}
                      </span>
                    )}
                  </span>
                  {/* className, not an inline display, so the 560px rule can
                      hide it. See the note in index.css. */}
                  <span className="tab-label" style={{
                    fontSize: 12, fontWeight: isActive ? 700 : 500,
                    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                  }}>
                    {label}
                  </span>
                  {badge > 0 && isActive && (
                    <span className="tab-badge" style={{
                      background: "rgba(255,255,255,0.28)", color: "#fff",
                      fontSize: 10, fontWeight: 700, minWidth: 16, height: 16,
                      borderRadius: 99, alignItems: "center",
                      justifyContent: "center", padding: "0 4px", flexShrink: 0,
                    }}>
                      {badge}
                    </span>
                  )}
                </>
              )}
            </NavLink>
          ))}
        </nav>

        <div className="app-topbar-glass__island app-topbar-glass__island--settings">
          <SettingsMenu align="down" compact />
        </div>
      </div>
    </>
  );
}
