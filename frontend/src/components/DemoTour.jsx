import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useLocation, useNavigate } from "react-router-dom";
import { X } from "lucide-react";
import { api } from "../api/inventory";
import {
  TOUR_STEPS, getTourState, setTourState, getTourStep, setTourStep, isTourRunning, setTourRunning, onTourChange,
} from "../lib/tour";

// ─────────────────────────────────────────────────────────────────────────────
// THE DEMO TOUR (21 Sep, Stan's pick: a spotlight tour that starts by itself after onboarding).
//
// The page dims, one real control is lit, and a small card says what it is. The card holds every way out:
//   the X (top right), "Skip tour" (bottom left), and Esc. Clicking the dimmed page does nothing on purpose,
//   so a stray click cannot end the tour and a stray tap cannot press something underneath it.
// Back and Next sit bottom right, Next as the one primary button.
//
// The steps live in lib/tour.js. Each names a route and the element to light (a data-tour attribute).
// Next moves to the next step's route itself, and clicking the lit control instead does the same thing:
// a route change that matches a step moves the tour to that step. If the element cannot be found within
// three seconds (no alerts yet, say), the card is shown centred with nothing lit, so it never dead-ends.
//
// Entry points are Settings ("Take the tour") and the automatic start after onboarding, never a fixed
// button: a floating control always covers something (rules.md, "Code quirks").
// ─────────────────────────────────────────────────────────────────────────────

const PAD = 6;          // breathing room around the lit element
const CARD_W = 340;

function findTarget(selectors) {
  for (const sel of selectors || []) {
    const el = document.querySelector(sel);
    if (el) return el;
  }
  return null;
}

/** The lit element's box, kept current while the page scrolls or resizes. null while none is found. */
function useTargetRect(selectors, active, key) {
  const [rect, setRect] = useState(null);
  useEffect(() => {
    if (!active || !selectors?.length) {
      setRect(null);
      // A closing card with nothing to light: bring the page back to the top so nothing is left tucked under the bars.
      if (active) window.scrollTo(0, 0);
      return undefined;
    }
    let cancelled = false;
    let scrolled = false;
    let tries = 0;
    const measure = () => {
      const el = findTarget(selectors);
      if (!el) return false;
      if (!scrolled) {
        scrolled = true;
        // Only move the page when the element is not already fully on screen, clear of the fixed bars at the top.
        // Scrolling a visible element leaves other content half tucked under those bars for no reason.
        const r0 = el.getBoundingClientRect();
        const topInset = Math.max(0, ...[...document.querySelectorAll(".app-topbar-glass, .demo-banner")]
          .map((n) => n.getBoundingClientRect().bottom));
        if (r0.top < topInset + 8 || r0.bottom > window.innerHeight - 8) {
          const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
          el.scrollIntoView({ block: "center", behavior: reduce ? "auto" : "smooth" });
        }
      }
      const r = el.getBoundingClientRect();
      setRect({ top: r.top, left: r.left, width: r.width, height: r.height });
      return true;
    };
    // Poll while the page loads its data; keep following the element for a moment while a smooth scroll settles.
    const timer = setInterval(() => {
      if (cancelled) return;
      tries += 1;
      const found = measure();
      if (!found && tries > 20) { clearInterval(timer); setRect(null); }
      if (found && tries > 12) clearInterval(timer);
    }, 150);
    const follow = () => { if (!cancelled) measure(); };
    window.addEventListener("resize", follow);
    window.addEventListener("scroll", follow, true);
    return () => {
      cancelled = true;
      clearInterval(timer);
      window.removeEventListener("resize", follow);
      window.removeEventListener("scroll", follow, true);
    };
    // key changes when the step or the page does, which restarts the search
  }, [active, key]); // eslint-disable-line react-hooks/exhaustive-deps
  return rect;
}

export default function DemoTour() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [active, setActive] = useState(false);
  const [step, setStepState] = useState(0);
  const [note, setNote] = useState(false); // "tour closed" confirmation, shown for a few seconds
  const cardRef = useRef(null);
  const nextRef = useRef(null);
  const [cardH, setCardH] = useState(200);

  const go = useCallback((n) => {
    setStepState(n);
    setTourStep(n);
    const route = TOUR_STEPS[n]?.route;
    if (route && route !== window.location.pathname) navigate(route);
  }, [navigate]);

  const close = useCallback((state) => {
    setActive(false);
    setTourRunning(false);
    setTourState(state);
    if (state === "closed") { setNote(true); setTimeout(() => setNote(false), 6000); }
  }, []);

  // Begin when the state says so: right after onboarding (demo sandbox only) or when asked for in Settings.
  useEffect(() => {
    let live = true;
    const begin = () => {
      if (isTourRunning()) { setStepState(getTourStep()); setActive(true); return; }
      const state = getTourState();
      if (state !== "start" && state !== "start-demo") return;
      const start = () => {
        if (!live) return;
        setTourState(null);
        setTourRunning(true);
        setActive(true);
        go(0);
      };
      if (state === "start") { start(); return; }
      api.getDemoStatus().then((d) => { if (d?.active) start(); else setTourState(null); }).catch(() => {});
    };
    begin();
    const off = onTourChange(begin);
    return () => { live = false; off(); };
  }, [go]);

  // Clicking the lit control (or any link) instead of Next: a page that belongs to a step moves the tour to it.
  useEffect(() => {
    if (!active) return;
    const current = TOUR_STEPS[step];
    if (!current || current.route === null || current.route === pathname) return;
    const idx = TOUR_STEPS.findIndex((s) => s.route === pathname);
    if (idx >= 0) { setStepState(idx); setTourStep(idx); }
  }, [pathname, active]); // eslint-disable-line react-hooks/exhaustive-deps

  const current = TOUR_STEPS[step];
  const rect = useTargetRect(current?.targets, active, `${step}:${pathname}`);

  // Keyboard: Esc leaves, Tab stays inside the card. Focus lands on Next whenever the step changes.
  useEffect(() => {
    if (!active) return undefined;
    const onKey = (e) => {
      if (e.key === "Escape") { e.preventDefault(); close("closed"); return; }
      if (e.key === "Tab" && cardRef.current) {
        const items = [...cardRef.current.querySelectorAll("button, a[href]")].filter((n) => !n.disabled);
        if (!items.length) return;
        const first = items[0], last = items[items.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
        else if (!cardRef.current.contains(document.activeElement)) { e.preventDefault(); first.focus(); }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, close]);
  useEffect(() => { if (active) nextRef.current?.focus({ preventScroll: true }); }, [active, step]);
  useLayoutEffect(() => { if (cardRef.current) setCardH(cardRef.current.offsetHeight); });

  const closedNote = note && !active && createPortal(
    <div role="status" style={{
      position: "fixed", left: "50%", transform: "translateX(-50%)", zIndex: 1200,
      bottom: "calc(20px + env(safe-area-inset-bottom, 0px))",
      background: "var(--text-primary)", color: "var(--surface)", borderRadius: "var(--radius)",
      padding: "10px 16px", fontSize: "var(--text-sm)", boxShadow: "var(--shadow-md)", maxWidth: "calc(100vw - 32px)",
    }}>
      Tour closed. You can take it again from Settings, Take the tour.
    </div>,
    document.body,
  );

  if (!active || !current) return closedNote || null;

  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const narrow = vw < 640;
  const isLast = step === TOUR_STEPS.length - 1;

  // Where the card goes: a bottom sheet on a phone; otherwise below the lit element, else above, else at the bottom.
  let cardStyle;
  if (narrow) {
    cardStyle = { left: 12, right: 12, bottom: "calc(12px + env(safe-area-inset-bottom, 0px))" };
  } else if (rect && rect.height < vh * 0.55) {
    const below = rect.top + rect.height + PAD + 14;
    const above = rect.top - PAD - 14 - cardH;
    const top = below + cardH <= vh - 12 ? below : above >= 12 ? above : Math.max(12, vh - cardH - 20);
    cardStyle = { top, left: Math.min(Math.max(12, rect.left), vw - CARD_W - 12), width: CARD_W };
  } else if (rect) {
    cardStyle = { bottom: 24, left: "50%", transform: "translateX(-50%)", width: CARD_W };
  } else {
    cardStyle = { top: "50%", left: "50%", transform: "translate(-50%, -50%)", width: CARD_W };
  }

  // The dimming is ONE shadow around the lit element, so there is no seam to show. Four invisible panels sit on
  // top of it and stop clicks reaching the page outside the lit element, which itself stays clickable.
  const scrim = "rgba(15, 23, 42, 0.58)";
  const block = (s) => <div aria-hidden className="tour-scrim" style={{ position: "fixed", zIndex: 1190, ...s }} />;
  const hole = rect && {
    top: Math.round(Math.max(0, rect.top - PAD)), left: Math.round(Math.max(0, rect.left - PAD)),
    width: Math.round(rect.width + PAD * 2), height: Math.round(rect.height + PAD * 2),
  };

  const btn = { fontSize: "var(--text-sm)", fontWeight: 700, borderRadius: "var(--radius)", padding: "8px 14px", cursor: "pointer" };

  return createPortal(
    <>
      {hole ? (
        <>
          <div aria-hidden className="tour-scrim" style={{
            position: "fixed", zIndex: 1189, pointerEvents: "none", borderRadius: 12,
            boxShadow: `0 0 0 9999px ${scrim}`, outline: "2px solid var(--blue-strong)",
            top: hole.top, left: hole.left, width: hole.width, height: hole.height,
          }} />
          {block({ top: 0, left: 0, right: 0, height: hole.top })}
          {block({ top: hole.top + hole.height, left: 0, right: 0, bottom: 0 })}
          {block({ top: hole.top, left: 0, width: hole.left, height: hole.height })}
          {block({ top: hole.top, left: hole.left + hole.width, right: 0, height: hole.height })}
        </>
      ) : <div aria-hidden className="tour-scrim" style={{ position: "fixed", inset: 0, zIndex: 1190, background: scrim }} />}

      <div
        ref={cardRef} role="dialog" aria-modal="true" aria-labelledby="tour-title" aria-describedby="tour-body"
        style={{
          position: "fixed", zIndex: 1200, background: "var(--modal-bg)", color: "var(--text-primary)",
          border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", padding: "16px 18px",
          boxShadow: "var(--shadow-md)", ...cardStyle,
        }}
      >
        <button type="button" onClick={() => close("closed")} aria-label="Close tour" className="hit-44-icon" style={{
          position: "absolute", top: 14, right: 14, background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)",
        }}>
          <X size={18} />
        </button>

        <div aria-live="polite" style={{ fontSize: "var(--text-xs)", fontWeight: 700, letterSpacing: "0.05em", textTransform: "uppercase", color: "var(--text-muted)", marginBottom: 4 }}>
          Step {step + 1} of {TOUR_STEPS.length}
        </div>
        <div id="tour-title" style={{ fontSize: "var(--text-base)", fontWeight: 700, lineHeight: 1.3, marginBottom: 6, paddingRight: 28 }}>
          {current.title}
        </div>
        <p id="tour-body" style={{ fontSize: "var(--text-sm)", color: "var(--text-secondary)", lineHeight: 1.55, margin: "0 0 14px" }}>
          {current.body}
        </p>

        {current.links && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, margin: "0 0 14px" }}>
            {current.links.map((l) => (
              <button key={l.to} type="button" onClick={() => { close("done"); navigate(l.to); }} style={{
                ...btn, background: "var(--surface)", color: "var(--text-primary)", border: "1px solid var(--border)", fontWeight: 600,
              }}>
                {l.label}
              </button>
            ))}
          </div>
        )}

        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <button type="button" onClick={() => close("closed")} style={{
            background: "none", border: "none", cursor: "pointer", padding: "4px 2px", marginRight: "auto",
            fontSize: "var(--text-sm)", color: "var(--text-muted)", textDecoration: "underline",
          }}>
            Skip tour
          </button>
          <span aria-hidden style={{ display: "flex", gap: 4 }}>
            {TOUR_STEPS.map((_, i) => (
              <i key={i} style={{ width: 6, height: 6, borderRadius: "50%", background: i === step ? "var(--blue-strong)" : "var(--border)" }} />
            ))}
          </span>
          {step > 0 && (
            <button type="button" onClick={() => go(step - 1)} style={{ ...btn, background: "var(--surface)", color: "var(--text-primary)", border: "1px solid var(--border)" }}>
              Back
            </button>
          )}
          <button ref={nextRef} type="button" onClick={() => (isLast ? close("done") : go(step + 1))} style={{
            ...btn, background: "var(--blue-strong)", color: "#fff", border: "none",
          }}>
            {current.next}
          </button>
        </div>
      </div>
    </>,
    document.body,
  );
}
