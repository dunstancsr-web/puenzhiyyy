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
//
// iOS's own system colour set for each mode (Apple's actual light/dark
// palette, not an invented rainbow), used as a rotating conic-gradient for
// the Apple Intelligence-style edge glow: a hue that travels around the
// screen border rather than a flat colour that only breathes.
const GLOW_STOPS = {
  light: "#007AFF, #AF52DE, #FF2D55, #FF9500, #FFCC00, #34C759, #5AC8FA, #007AFF",
  dark:  "#0A84FF, #BF5AF2, #FF375F, #FF9F0A, #FFD60A, #32D74B, #64D2FF, #0A84FF",
};

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
        // mistake a demo action for a real one. Apple Intelligence-style: a
        // hue that travels around the border rather than a flat colour that
        // only breathes, built from the standard "gradient border" CSS trick
        // (two-layer mask, XOR'd, so only the padding ring is visible) with a
        // rotating conic-gradient underneath. Both moving parts (the
        // gradient's rotation, the ring's own opacity pulse) animate
        // transform/opacity only, the two properties a browser can composite
        // on the GPU with no repaint - the mask, the gradient stops and the
        // blur are all static once drawn, so the cost per frame is the same
        // as the flat version this replaces. Non-interactive and behind the
        // badge itself (z-index), so it never intercepts a click.
        <>
          <style>{`
            @keyframes demoGlowRotate { to { transform: rotate(360deg); } }
            @keyframes demoGlowBreathe { 0%, 100% { opacity: 0.55; } 50% { opacity: 0.9; } }
          `}</style>
          <div aria-hidden="true" style={{
            position: "fixed", inset: 0, zIndex: 199, pointerEvents: "none",
            padding: 3,
            // The origin/clip keyword (content-box) is only valid inside the
            // mask SHORTHAND, never inside mask-image alone - that mistake
            // silently drops the whole declaration, leaving nothing masked.
            WebkitMask: "linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0)",
            WebkitMaskComposite: "xor",
            mask: "linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0)",
            maskComposite: "exclude",
            overflow: "hidden",
            animation: "demoGlowBreathe 5s ease-in-out infinite",
          }}>
            <div style={{
              position: "absolute", inset: "-50%",
              background: `conic-gradient(from 0deg, ${GLOW_STOPS[resolved]})`,
              filter: "blur(18px)",
              animation: "demoGlowRotate 9s linear infinite",
            }} />
          </div>
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
