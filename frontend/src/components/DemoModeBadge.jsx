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
//
// Top edge only, and structural rather than an overlay: setting the
// --demo-banner-height CSS variable (declared in index.css) does two things
// at once - body's own padding-top shifts every page's content below the
// fixed banner, AND every full-height layout (Layout.jsx, Sidebar.jsx,
// Onboarding.jsx, Home.jsx) subtracts the same variable from its own 100vh,
// so the app's usable area actually shrinks to fit rather than overflowing
// past the visible window. That overflow was a real bug in the first version
// of this banner: the sidebar's own bottom items ran off-screen because
// Layout.jsx assumed the full viewport height independently of the banner
// reserving space above it. Left, right and bottom edges are untouched on
// purpose, so nothing outside the top strip needs any of this accounted for.
// ─────────────────────────────────────────────────────────────────────────────

const BANNER_HEIGHT = 40;

// `compact` and `bannerOnly` are for the handheld screens. A phone has no room for
// the long sentence, and no room for a floating "Enter demo mode" button over the
// header, so there the badge is a short banner shown only while in demo mode.
// Its absence then reads as "on the real database", which is what makes a phone
// and a desktop that disagree about the mode obvious at a glance.
export default function DemoModeBadge({ compact = false, bannerOnly = false }) {
  const [active, setActive] = useState(null); // null = not checked yet
  const [busy, setBusy] = useState(false);

  // The join link. Opening any page that carries this badge with ?demo=1 puts
  // THIS browser into the demo sandbox, which is what a second device needs: the
  // sandbox is one shared database, but each browser has to opt in with its own
  // cookie. Open the link on the phone (or scan it) and it lands in the same
  // sandbox as the desktop. The param is stripped on the way out so a reload or
  // a bookmark does not re-enter after someone presses Exit.
  useEffect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.get("demo") !== "1") return;
    // &sample=1 (added by the handheld's own "Join the demo" prompt) also fills an
    // EMPTY sandbox with the sample catalog, so the phone has purchase and sales
    // orders to work against. Plain ?demo=1 never seeds: a presenter who wants the
    // empty-portfolio onboarding story must not have it spoilt by someone joining.
    const wantSample = url.searchParams.get("sample") === "1";
    url.searchParams.delete("demo");
    url.searchParams.delete("sample");
    api.enterDemoMode()
      .then(async () => {
        if (!wantSample) return;
        const skus = await api.getSkus();
        if (!skus || skus.length === 0) await api.seedSampleData();
      })
      .catch(() => {})
      .finally(() => window.location.replace(url.pathname + url.search + url.hash));
  }, []);

  useEffect(() => {
    api.getDemoStatus().then((d) => setActive(d.active)).catch(() => setActive(false));
  }, []);

  useEffect(() => {
    if (active) {
      document.documentElement.style.setProperty("--demo-banner-height", BANNER_HEIGHT + "px");
      return () => document.documentElement.style.removeProperty("--demo-banner-height");
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
        <span>
          {compact
            ? "DEMO MODE. Sandbox data"
            : "DEMO MODE. Sandbox data only, nothing here is real and nothing you do here touches the live database."}
        </span>
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

  if (bannerOnly) return null;

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
