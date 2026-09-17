import React, { useState, useEffect } from "react";
import { PlayCircle, LogOut, TriangleAlert } from "lucide-react";
import { api } from "../api/inventory";

// ─────────────────────────────────────────────────────────────────────────────
// DEMO MODE (MVP2 Day 7). Mounted once at the App root, visible on every page.
//
// A full page reload on enter/exit, deliberately: every page in this app
// fetches its own data on mount with no shared cache, so a reload is the
// simplest way to guarantee every already-rendered page (Dashboard, Inventory,
// whatever was open) re-fetches against the new database rather than showing
// stale state from the one that was just swapped out from under it.
//
// A labelled top banner, not an ambient glow: tried a screen-edge glow first
// (flat, then an Apple Intelligence-style rotating gradient), through several
// rounds of tuning, and it never actually solved the problem - a colour cue
// only works once someone has already learned what it means, which nobody
// demoing this for the first time has. A banner with the word "DEMO" on it is
// the industry-standard pattern for exactly this (Stripe's test mode, most
// staging environments) because it's recognised on sight, not associated.
// ─────────────────────────────────────────────────────────────────────────────

const BANNER_HEIGHT = 40;

export default function DemoModeBadge() {
  const [active, setActive] = useState(null); // null = not checked yet
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.getDemoStatus().then((d) => setActive(d.active)).catch(() => setActive(false));
  }, []);

  // Reserves space at the top of the page for the fixed banner so it never
  // covers real content - set on <body> rather than in Layout.jsx, so every
  // page (including ones outside the Control Tower's own layout) gets it for
  // free without each one needing to know demo mode exists.
  useEffect(() => {
    if (active) {
      document.body.style.paddingTop = BANNER_HEIGHT + "px";
      return () => { document.body.style.paddingTop = ""; };
    }
  }, [active]);

  const enter = async () => {
    setBusy(true);
    try {
      await api.enterDemoMode();
      window.location.href = "/";
    } catch {
      setBusy(false);
    }
  };

  const exit = async () => {
    setBusy(true);
    try {
      await api.exitDemoMode();
      window.location.href = "/";
    } catch {
      setBusy(false);
    }
  };

  if (active === null) return null; // avoid a flash of the wrong control before the first check resolves

  if (active) {
    return (
      <div role="status" style={{
        position: "fixed", top: 0, left: 0, right: 0, height: BANNER_HEIGHT, zIndex: 300,
        display: "flex", alignItems: "center", justifyContent: "center", gap: 10,
        background: "var(--yellow)", color: "#3d2c00",
        fontSize: "var(--text-sm)", fontWeight: 700, letterSpacing: "0.01em",
        boxShadow: "var(--shadow-md)",
      }}>
        <TriangleAlert size={16} />
        <span>DEMO MODE. Sandbox data only, nothing here is real and nothing you do here touches the live database.</span>
        <button onClick={exit} disabled={busy} style={{
          display: "flex", alignItems: "center", gap: 5, marginLeft: 8, padding: "4px 11px", borderRadius: 99,
          border: "1px solid #3d2c00", background: "transparent", color: "#3d2c00",
          fontSize: "var(--text-xs)", fontWeight: 700, cursor: busy ? "default" : "pointer",
        }}>
          <LogOut size={13} /> {busy ? "Exiting…" : "Exit"}
        </button>
      </div>
    );
  }

  return (
    <div style={{ position: "fixed", top: 14, right: 14, zIndex: 200 }}>
      <button onClick={enter} disabled={busy} title="Switch to an empty sandbox database, the real data is never touched" style={{
        display: "flex", alignItems: "center", gap: 7, padding: "8px 14px", borderRadius: 99,
        border: "1px solid var(--border)", background: "var(--card-bg)", color: "var(--text-secondary)",
        fontSize: "var(--text-xs)", fontWeight: 700, cursor: busy ? "default" : "pointer", boxShadow: "var(--shadow)",
      }}>
        <PlayCircle size={14} /> {busy ? "Entering…" : "Enter demo mode"}
      </button>
    </div>
  );
}
