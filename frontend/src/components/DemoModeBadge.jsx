import React, { useState, useEffect } from "react";
import { PlayCircle, LogOut } from "lucide-react";
import { api } from "../api/inventory";
import { useTheme } from "../context/ThemeContext";

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

// `resolved`, not `theme` — theme can be "auto", and a colour decision has to
// pick a real appearance rather than silently taking the light branch on a
// dark page (see rules.md's own note on this exact trap).
const GLOW_RGB = { light: "37, 99, 235", dark: "255, 255, 255" };

export default function DemoModeBadge() {
  const { resolved } = useTheme();
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
    <>
      {active && (
        // A screen-edge frame, the same idea as a Zoom screen-share border: a
        // constant, peripheral cue that survives navigating anywhere in the
        // app, so a manager can't lose track of being in the sandbox and
        // mistake a demo action for a real one. Diffused and breathing
        // rather than a hard strip, tuned in frontend/tuners/demo-glow.html
        // (blue on light, white on dark, since blue reads as barely-there
        // against a dark page). The shape (ring/blur/spread) is fixed and
        // only opacity animates - the compositor-only property a browser
        // can animate with no repaint, so this costs nothing per frame.
        // Non-interactive and behind the badge itself (z-index), so it
        // never intercepts a click.
        <>
          <style>{`
            @keyframes demoGlowBreathe {
              0%, 100% { opacity: 0.17; }
              50% { opacity: 0.38; }
            }
          `}</style>
          <div aria-hidden="true" style={{
            position: "fixed", inset: 0, zIndex: 199, pointerEvents: "none",
            boxShadow: `inset 0 0 0 1.5px rgba(${GLOW_RGB[resolved]},1), inset 0 0 55px 22px rgba(${GLOW_RGB[resolved]},1)`,
            animation: "demoGlowBreathe 4.2s ease-in-out infinite",
          }} />
        </>
      )}
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
    </>
  );
}
