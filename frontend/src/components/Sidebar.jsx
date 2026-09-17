import React, { useState, useEffect } from "react";
import { NavLink, Link, useLocation } from "react-router-dom";
import { LayoutDashboard, PackageSearch, Bell, History, Home as HomeIcon } from "lucide-react";
import { api } from "../api/inventory";
import SettingsMenu from "./SettingsMenu";
import EventCredit from "./EventCredit";
import { Seal, CLIENT_HAN } from "./Tenant";
import TowerIcon from "./TowerIcon";
import AppMark from "./AppMark";

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
// island also placed a grid icon for Home immediately beside the Dashboard
// grid icon: two near-identical glyphs one tap apart. Home is a house now. The top row now holds the
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
          height: "calc(100vh - var(--demo-banner-height))", // see index.css's :root note on this token
          // The panel gained a masthead, a section header and a larger exit
          // control, so it is taller than it was. It fits a 929px viewport
          // with room to spare, but a 13 inch laptop in landscape is nearer
          // 700px, and a credit line disappearing off the bottom edge is a
          // silent failure. Scrolling is the cheap insurance.
          overflowY: "auto",
        }}
      >
        {/* CLIENT-LED, matching Home (TASK-81). This header used to read
            StockSense over "Control Tower", with the company below it labelled
            ACCOUNT, which meant the identity INVERTED as you walked from Home
            into this screen: Home says "Four Seas Rice's system, running on
            StockSense" and this said "StockSense, one of whose accounts is
            Four Seas Rice". Both are defensible; having both is not.

            The ACCOUNT label is gone with it. That label existed to explain a
            company name sitting under a product name. At the top it needs no
            explaining: it is the masthead, exactly as on Home. */}
        <div style={{ display: "flex", alignItems: "center", gap: 11, padding: "0 6px", marginBottom: 16 }}>
          {/* The single 米, not the full chop. Four characters in a 40px
              square gives each glyph about 17px and the seal reads as texture;
              one character holds. The full seal keeps Home, where 56px gives
              it the room it needs. */}
          <Seal size={40} />
          <div style={{ minWidth: 0 }}>
            <div className="brush" style={{
              fontSize: "var(--text-base)", lineHeight: 1.15, color: "var(--text-primary)",
            }}>
              {CLIENT_HAN}
            </div>
            <div style={{
              fontSize: "var(--text-xs)", fontWeight: 600, letterSpacing: "0.08em",
              textTransform: "uppercase", color: "var(--text-muted)", marginTop: 1,
              whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
            }}>
              Four Seas Rice
            </div>
          </div>
        </div>

        {/* Names the screen you are on, with the icon that marks it on Home.
            The repetition is the point: an icon is learnable when the same
            mark names the door and the room behind it. */}
        <div className="section-id">
          {/* Neutral at rest, purple on hover. The tint is wayfinding on Home,
              where three workspaces have to be told apart; here there is one,
              so spending the colour permanently buys nothing and competes with
              the alert badge. The icon takes `currentColor` from its wrapper,
              which is what lets one property carry the transition. */}
          <span className="section-id__mark"><TowerIcon size={26} /></span>
          <span style={{ fontSize: "var(--text-base)", fontWeight: 700, color: "var(--text-primary)" }}>
            Control Tower
          </span>
        </div>

        <nav style={{ flex: 1, paddingTop: 6 }}>
          {navItems.map(({ to, label, icon: Icon, badge }) => (
            // All styling is in .nav-item (index.css). NavLink's own `active`
            // class carries the selected state, so the hover rule can sit
            // beside it in the cascade instead of losing to an inline prop.
            <NavLink key={to} to={to}
              className={({ isActive }) => `nav-item${isActive ? " active" : ""}`}>
              {({ isActive }) => (
                <>
                  {/* 20px, up from 17. Home's glyphs grew and the two screens
                      should scale alike. */}
                  <Icon size={20} />
                  <span style={{ flex: 1 }}>{label}</span>
                  {badge > 0 && (
                    <span style={{
                      background: isActive ? "rgba(255,255,255,0.25)" : "var(--red)",
                      color: "#fff", fontSize: "var(--text-xs)", fontWeight: 700,
                      minWidth: 21, height: 21, borderRadius: 99,
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

        {/* The way out, and deliberately the largest control down here. Someone
            who opened the Control Tower by mistake needs to find this without
            hunting, so it is full width, taller than a nav row, and says where
            it goes rather than just "Home". */}
        <Link to="/" className="sidebar-exit" style={{ marginBottom: 10 }}>
          <HomeIcon size={19} style={{ flexShrink: 0 }} />
          All workspaces
        </Link>

        <SettingsMenu align="up" />

        {/* StockSense signs the foot, as it does on Home. */}
        <div style={{
          padding: "12px 6px 0", marginTop: 12, borderTop: "1px solid var(--sidebar-border)",
        }}>
          <div className="credit-mark" style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 9, width: "fit-content" }}>
            <AppMark size={22} />
            <span style={{ fontSize: "var(--text-xs)", color: "var(--text-secondary)", fontWeight: 600 }}>
              Running on <span style={{ color: "var(--text-primary)", fontWeight: 700 }}>StockSense</span>
            </span>
          </div>
          <EventCredit />
        </div>
      </aside>

      {/* ── Narrow: one row at the top, three groups ─────────────────────────
          Home, navigation, settings. The settings trigger collapses to a gear,
          which is what freed the roughly 150px that let this fit on one row. */}
      <div className="app-topbar-glass">
        <div className="app-topbar-glass__island glass-surface">
          <Link to="/" aria-label="Home" style={{
            display: "flex", alignItems: "center", gap: 7, textDecoration: "none",
            color: "var(--text-primary)", fontSize: "var(--text-sm)", fontWeight: 600, padding: "0 4px",
          }}>
            <HomeIcon size={19} />
            Home
          </Link>
        </div>

        <nav className="app-topbar-glass__nav glass-surface" aria-label="Primary">
          {navItems.map(({ to, label, icon: Icon, badge }) => (
            <NavLink key={to} to={to} title={label}
              style={({ isActive }) => ({
                flex: 1, minWidth: 0,
                display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
                padding: "9px 6px", borderRadius: 999, textDecoration: "none",
                background: isActive ? "var(--blue)" : "transparent",
                color: isActive ? "#fff" : "var(--text-secondary)",
                transition: "background 0.15s, color 0.15s",
              })}>
              {({ isActive }) => (
                <>
                  <span style={{ position: "relative", display: "flex", flexShrink: 0 }}>
                    <Icon size={19} strokeWidth={isActive ? 2.4 : 2} />
                    {badge > 0 && !isActive && (
                      <span style={{
                        position: "absolute", top: -4, right: -6,
                        background: "var(--red)", color: "#fff",
                        fontSize: "var(--text-xs)", fontWeight: 700, minWidth: 18, height: 18,
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
                    fontSize: "var(--text-xs)", fontWeight: isActive ? 700 : 500,
                    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                  }}>
                    {label}
                  </span>
                  {badge > 0 && isActive && (
                    <span className="tab-badge" style={{
                      background: "rgba(255,255,255,0.28)", color: "#fff",
                      fontSize: "var(--text-xs)", fontWeight: 700, minWidth: 20, height: 20,
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

        <div className="app-topbar-glass__island app-topbar-glass__island--settings glass-surface">
          <SettingsMenu align="down" compact />
        </div>
      </div>
    </>
  );
}
