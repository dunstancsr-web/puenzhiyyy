import React, { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { RefreshCw, CheckCircle2 } from "lucide-react";
import { api } from "../api/inventory";
import { subscribe, isStale, getAppliedAt, resetBaseline } from "../lib/dataVersion";

// Tells the person at the Control Tower that the warehouse has moved stock since
// the page they are looking at was loaded. Mounted once in the Control Tower
// layout, so every page gets it.
//
//   live  : "New stock movements. Refresh". The numbers do not change until the
//           reader chooses, so nothing shifts under someone mid-review.
//   demo  : the page has already updated itself (useLiveRefresh), so this only
//           says so, briefly, which is what makes the update visible on camera.
//
// Sits at the bottom centre, clear of the top banner and the sidebar.

const FLASH_MS = 4000;

export default function NewDataPill() {
  const [demo, setDemo] = useState(null);
  const [, force] = useState(0);
  const { pathname } = useLocation();

  useEffect(() => {
    api.getDemoStatus().then((d) => setDemo(!!d?.active)).catch(() => setDemo(false));
    return subscribe(() => force((n) => n + 1));
  }, []);

  // Moving to another page loads that page's data fresh, so whatever the server
  // holds now counts as seen. Without this the pill would offer to refresh a page
  // that had only just loaded.
  useEffect(() => { resetBaseline(); }, [pathname]);

  // Demo mode: hide the "Updated" note once it has been on screen long enough.
  const appliedAt = getAppliedAt();
  const flashing = demo && appliedAt > 0 && Date.now() - appliedAt < FLASH_MS;
  useEffect(() => {
    if (!flashing) return undefined;
    const t = setTimeout(() => force((n) => n + 1), FLASH_MS - (Date.now() - appliedAt) + 50);
    return () => clearTimeout(t);
  }, [flashing, appliedAt]);

  const stale = demo === false && isStale();
  const visible = stale || flashing;

  // While the pill is on screen, leave room under the page for it, so the last line of any
  // page can still be scrolled clear of it instead of sitting underneath.
  useEffect(() => {
    if (!visible) return undefined;
    const prev = document.body.style.paddingBottom;
    document.body.style.paddingBottom = "84px";
    return () => { document.body.style.paddingBottom = prev; };
  }, [visible]);

  if (!visible) return null;

  const base = {
    position: "fixed", left: "50%", transform: "translateX(-50%)", bottom: 22, zIndex: 250,
    display: "flex", alignItems: "center", gap: 9, padding: "10px 16px", borderRadius: 99,
    fontSize: "var(--text-sm)", fontWeight: 600, boxShadow: "var(--shadow-md)",
    border: "1px solid var(--border)", whiteSpace: "nowrap", maxWidth: "calc(100vw - 32px)",
  };

  if (flashing) {
    return (
      <div role="status" style={{ ...base, background: "var(--green-light)", color: "var(--text-primary)" }}>
        <CheckCircle2 size={16} color="var(--green-text)" /> Updated with new stock movements
      </div>
    );
  }

  return (
    <button type="button" onClick={() => window.location.reload()}
      style={{ ...base, background: "var(--blue-strong)", color: "#fff", cursor: "pointer", borderColor: "var(--blue-strong)", minHeight: 44 }}>
      <RefreshCw size={15} /> New stock movements. Refresh
    </button>
  );
}
