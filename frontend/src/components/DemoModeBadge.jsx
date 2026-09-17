import React, { useState, useEffect } from "react";
import { PlayCircle, LogOut } from "lucide-react";
import { api } from "../api/inventory";

// ─────────────────────────────────────────────────────────────────────────────
// DEMO MODE (MVP2 Day 7). A fixed top-right control, visible on every page
// (mounted once at the App root) rather than duplicated into Home and Layout
// separately — the plan's own wording was "top-right corner," not "on Home,"
// and exiting has to be reachable from wherever the demo wandered.
//
// A full page reload on enter/exit, deliberately: every page in this app
// fetches its own data on mount with no shared cache, so a reload is the
// simplest way to guarantee every already-rendered page (Dashboard, Inventory,
// whatever was open) re-fetches against the new database rather than showing
// stale state from the one that was just swapped out from under it.
// ─────────────────────────────────────────────────────────────────────────────

export default function DemoModeBadge() {
  const [active, setActive] = useState(null); // null = not checked yet
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.getDemoStatus().then((d) => setActive(d.active)).catch(() => setActive(false));
  }, []);

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

  if (active === null) return null; // avoid a flash of the wrong button before the first check resolves

  return (
    <div style={{ position: "fixed", top: 14, right: 14, zIndex: 200 }}>
      {active ? (
        <button onClick={exit} disabled={busy} title="Exit demo mode: drops the sandbox, returns to the real data" style={{
          display: "flex", alignItems: "center", gap: 7, padding: "8px 14px", borderRadius: 99,
          border: "1px solid var(--yellow)", background: "var(--yellow-light)", color: "#92610a",
          fontSize: "var(--text-xs)", fontWeight: 700, letterSpacing: "0.02em", cursor: busy ? "default" : "pointer",
          boxShadow: "var(--shadow-md)",
        }}>
          <LogOut size={14} /> {busy ? "Exiting…" : "DEMO MODE — Exit"}
        </button>
      ) : (
        <button onClick={enter} disabled={busy} title="Switch to an empty sandbox database — the real data is never touched" style={{
          display: "flex", alignItems: "center", gap: 7, padding: "8px 14px", borderRadius: 99,
          border: "1px solid var(--border)", background: "var(--card-bg)", color: "var(--text-secondary)",
          fontSize: "var(--text-xs)", fontWeight: 700, cursor: busy ? "default" : "pointer", boxShadow: "var(--shadow)",
        }}>
          <PlayCircle size={14} /> {busy ? "Entering…" : "Enter demo mode"}
        </button>
      )}
    </div>
  );
}
