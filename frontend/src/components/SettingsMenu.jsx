import React, { useState, useEffect, useCallback, useRef } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { Settings, Cpu, Calculator, Cloud, AlertTriangle, Sun, Moon, Monitor, Check, KeyRound, PlayCircle } from "lucide-react";
import { useTheme, THEMES } from "../context/ThemeContext";
import { api } from "../api/inventory";
import { enterDemoMode } from "../lib/demoMode";
import { useLlmTier, effectiveTier, setTierChoice, setPass, clearPass } from "../lib/llmTier";

// ─────────────────────────────────────────────────────────────────────────────
// SETTINGS MENU (TASK-49)
//
// Every settings control the app has, behind one entry.
//
// The sidebar had grown three competing sections: four navigation links, three
// explanation-tier radio buttons with a caption, and two theme buttons. Twelve
// interactive elements, of which four were navigation and eight were settings
// nobody changes twice in a session.
//
// The pattern every well-made tool converges on is that a sidebar is for
// NAVIGATION and settings collapse into a single entry at its edge. Linear puts
// them behind the workspace menu, Notion behind one "Settings" row at the
// bottom, Stripe and Vercel move them out of the left nav entirely. None of
// them keep a theme switcher permanently expanded next to their page links.
//
// What is kept visible is the STATE, not the controls. The trigger reads
// "Local model · Light", so which engine is answering is still legible at a
// glance, which was the point of putting it in the sidebar in the first place.
// ─────────────────────────────────────────────────────────────────────────────

const MODE_ICON = { rules: Calculator, local: Cpu, cloud: Cloud };
const THEME_ICON = { auto: Monitor, light: Sun, dark: Moon };

export default function SettingsMenu({ align = "up", compact = false }) {
  const navigate = useNavigate();
  const { theme, resolved, setTheme } = useTheme();
  const [open, setOpen] = useState(false);
  // null until known, then true or false: whether THIS browser is in the demo sandbox.
  const [demoActive, setDemoActive] = useState(null);
  useEffect(() => { api.getDemoStatus().then((d) => setDemoActive(!!d?.active)).catch(() => setDemoActive(null)); }, []);
  const [state, setState] = useState(null);      // { mode, modes } from the server
  // null | "confirm" (dev: click again to spend) | "pin" (enter the demo PIN)
  const [pending, setPending] = useState(null);
  const [error, setError] = useState(null);
  const [pin, setPin] = useState("");
  const [unlocking, setUnlocking] = useState(false);
  // The tier is this visitor's own since TASK-90, read from the browser rather
  // than from the server. The server only says what it CAN offer.
  const { choice, pass } = useLlmTier();
  const wrapRef = useRef(null);
  const panelRef = useRef(null);
  const [rect, setRect] = useState(null);

  const load = useCallback(() => {
    api.getLlmMode().then(setState).catch(() => setState(null));
  }, []);
  useEffect(() => { load(); }, [load]);
  // Refetched on open too, so the paid-call count it shows is current rather
  // than whatever it was when the page first loaded.
  useEffect(() => { if (open) load(); }, [open, load]);

  // The compact panel is PORTALED to document.body, and that is not cosmetic.
  // Its ancestor .glass-surface sets backdrop-filter, which makes that ancestor
  // a backdrop root: a descendant's own backdrop-filter can then only sample
  // inside that root, which is empty, so it silently does nothing. The panel was
  // rendering with its gradient and no blur at all, which is why the page behind
  // it stayed perfectly readable. HoverHint portals for the same reason, which
  // is why the hint panel blurs correctly and this one did not.
  //
  // Portaling means position: fixed against the trigger's measured rect, so the
  // measurement has to follow scroll and resize.
  const place = useCallback(() => {
    if (wrapRef.current) setRect(wrapRef.current.getBoundingClientRect());
  }, []);

  useEffect(() => {
    if (!open || !compact) return;
    place();
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [open, compact, place]);

  // Close on outside click and on Escape. A popover that can only be dismissed
  // by pressing its own trigger again is a trap on a touch screen.
  useEffect(() => {
    if (!open) return;
    const onDown = (e) => {
      const inTrigger = wrapRef.current && wrapRef.current.contains(e.target);
      // Without this the portaled panel counts as "outside" and clicking any
      // control in it would close the menu before the click registered.
      const inPanel = panelRef.current && panelRef.current.contains(e.target);
      if (!inTrigger && !inPanel) { setOpen(false); setPending(null); }
    };
    const onKey = (e) => { if (e.key === "Escape") { setOpen(false); setPending(null); } };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, [open]);

  const current = effectiveTier(state, choice, pass);

  const choose = (m) => {
    if (!m.available) return;
    const locked = m.id === "cloud" && m.requiresPin && !pass;
    if (m.id === current && !locked) return;
    setError(null);
    if (m.cost === "metered") {
      // Where a PIN is required, typing it IS the confirmation, so there is
      // no second "are you sure" click on top. Without one (development) the
      // original click-again-to-spend step still applies.
      if (locked) { setPending("pin"); return; }
      if (!m.requiresPin && pending !== "confirm") { setPending("confirm"); return; }
    }
    setPending(null);
    setTierChoice(m.id);
  };

  const unlock = async (e) => {
    e.preventDefault();
    if (!pin.trim() || unlocking) return;
    setUnlocking(true); setError(null);
    try {
      setPass(await api.unlockLlm(pin.trim()));
      setTierChoice("cloud");
      setPending(null);
      load();
    } catch (err) {
      // The server's message is written to be shown: "2 tries left",
      // "try again in 15 min". Rephrasing it here would only lose the count.
      setError(err.message);
    } finally {
      // Cleared on failure too. Leaving a wrong PIN in the box invites
      // resubmitting it, and each resubmission spends one of five tries.
      setPin("");
      setUnlocking(false);
    }
  };

  const activeMode = state?.modes?.find((m) => m.id === current);
  // The visible label stays short, because it shares a truncating line with the
  // mode. Auto's resolved appearance goes in the tooltip, where there is room
  // to say "Auto (dark)" without pushing the mode out of view.
  const themeLabel = THEMES.find((t) => t.id === theme)?.label || theme;
  const themeTitle = theme === "auto" ? `Auto (${resolved})` : themeLabel;

  return (
    <div ref={wrapRef} style={{ position: "relative" }}>
      {/* The trigger carries the state. Collapsing the controls should not cost
          the operator the ability to see which engine is answering.

          Compact is the gear alone. In the top strip the state label was
          costing roughly 150px that navigation needed more, and the state moves
          into the tooltip and the aria-label rather than disappearing. The
          desktop sidebar has the room, so it keeps the text. */}
      <button
        onClick={() => { setOpen((v) => !v); setPending(null); }}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={compact ? `Settings. ${activeMode ? activeMode.label : ""}, ${themeTitle}` : undefined}
        title={compact && activeMode ? `${activeMode.label} · ${themeTitle}` : undefined}
        style={compact ? {
          display: "flex", alignItems: "center", justifyContent: "center",
          width: 38, height: 38, borderRadius: 999, flexShrink: 0,
          border: "none", background: open ? "var(--surface-2)" : "transparent",
          color: "var(--text-secondary)", cursor: "pointer",
        } : undefined}
        // Sidebar styling lives in .sidebar-settings so :hover can reach it;
        // the open state rides a data attribute rather than an inline
        // background, which would beat the hover rule.
        className={compact ? undefined : "sidebar-settings"}
        data-open={!compact && open ? "" : undefined}
      >
        <Settings size={compact ? 19 : 15} style={{ flexShrink: 0 }} />
        {!compact && (
          <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {activeMode ? activeMode.label : "Settings"}
            <span style={{ color: "var(--text-muted)", fontWeight: 500 }}> · {themeLabel}</span>
          </span>
        )}
      </button>

      {open && renderPanel()}
    </div>
  );

  function renderPanel() {
    /* Compact uses the same glass as the hint panel, including its blur and
       saturation, because Stan tuned those values and this should match what he
       tuned rather than approximate it. */
    const panel = (
      <div role="dialog" aria-label="Settings" ref={panelRef}
        className={compact ? "glass-surface glass-surface--floating" : undefined}
        style={{
          zIndex: 9999,
          ...(compact
            ? {
                position: "fixed",
                top: rect ? rect.bottom + 8 : -9999,
                // Right aligned to the trigger, which sits at the right edge of
                // the strip, so a left-aligned panel would open off screen.
                right: rect ? Math.max(8, window.innerWidth - rect.right) : 8,
                width: 256,
                // The hint panel's own blur, not the bar's heavier one. A
                // floating panel that is dismissed in a few seconds can afford
                // to be glassier than a strip you read all day.
                "--glass-surface-blur": "var(--hint-blur)",
                color: "var(--hint-text)",
              }
            : {
                position: "absolute",
                [align === "up" ? "bottom" : "top"]: "calc(100% + 8px)",
                left: 0, right: 0,
              }),
          // No minWidth. There was a 248px one, which only ever applied to the
          // sidebar variant (compact sets its own width), and the sidebar is
          // 230px with overflow: auto, so the panel's right 34px were clipped:
          // the check mark on the active tier, half of "Dark" and, once the
          // demo PIN form arrived, half of the Unlock button. left/right: 0
          // now sizes it to the sidebar exactly.
            // The desktop sidebar popover stays a solid card: it opens against
            // the sidebar's own flat panel, where glass has nothing interesting
            // to refract and just looks murky.
            ...(compact ? {} : {
              background: "var(--card-bg)", border: "1px solid var(--border)",
              boxShadow: "var(--shadow-md)",
            }),
          borderRadius: "var(--radius-lg)",
          padding: 14,
        }}>

          {/* Deliberately not called "Engines". This repo already uses that word
              for backend/src/engines, the deterministic maths that produces
              every figure, so labelling the AI tiers "engines" would tell a
              reader the opposite of the truth: that switching one changes the
              numbers. The second sentence exists to rule that out explicitly,
              since it is the single most likely misreading of this control. */}
          <Section title="Explanations" note={
            <>Who writes the <Em>Why?</Em> explanations in the <Em>Alerts</Em> tab.
            The figures are the same in all 3 options, only the wording changes.</>
          } />
          <div style={{ display: "flex", flexDirection: "column", gap: 5, marginBottom: 14 }}>
            {(state?.modes || []).map((m) => {
              const Icon = MODE_ICON[m.id] || Cpu;
              const active = current === m.id;
              const awaiting = m.cost === "metered" && (pending === "confirm" || pending === "pin");
              const locked = m.id === "cloud" && m.requiresPin && !pass;
              return (
                <button key={m.id} onClick={() => choose(m)} disabled={!m.available}
                  title={m.detail} aria-pressed={active}
                  style={{
                    display: "flex", alignItems: "center", gap: 8, padding: "8px 10px",
                    borderRadius: "var(--radius)", textAlign: "left", cursor: m.available ? "pointer" : "not-allowed",
                    border: `1px solid ${awaiting ? "var(--yellow)" : active ? "var(--blue-text)" : "transparent"}`,
                    background: awaiting ? "var(--yellow-light)" : active ? "var(--blue-light)" : "transparent",
                    color: !m.available ? "var(--text-muted)" : awaiting ? "var(--yellow)" : active ? "var(--blue-text)" : "var(--text-secondary)",
                    opacity: m.available ? 1 : 0.55,
                    fontSize: "var(--text-sm)", fontWeight: active || awaiting ? 600 : 400,
                  }}>
                  <Icon size={14} style={{ flexShrink: 0 }} />
                  <span style={{ flex: 1 }}>
                    {pending === "confirm" && awaiting ? "Spend credit?" : pending === "pin" && awaiting ? "Enter PIN" : m.label}
                  </span>
                  {/* A key, not a dollar sign, while locked: the first thing
                      to know about this option is that it needs a PIN. */}
                  {m.cost === "metered" && m.available && !awaiting && !active && (
                    locked
                      ? <KeyRound size={12} style={{ color: "var(--text-muted)" }} aria-label="Needs the demo PIN" />
                      : <span style={{ fontSize: "var(--text-xs)", fontWeight: 700, color: "var(--yellow)" }}>$</span>
                  )}
                  {awaiting && <AlertTriangle size={12} />}
                  {active && <Check size={13} />}
                </button>
              );
            })}
          </div>

          {pending === "confirm" && (
            <p style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)", lineHeight: 1.45, margin: "-8px 0 12px" }}>
              Click again to confirm. This tier bills the team's shared AWS credit on every new explanation.
            </p>
          )}

          {/* The PIN goes to the server and nowhere else: it is not stored,
              and only the two hour pass it returns is kept, in this tab. */}
          {pending === "pin" && (
            <form onSubmit={unlock} style={{ margin: "-8px 0 12px" }}>
              <p style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)", lineHeight: 1.45, margin: "0 0 8px" }}>
                Paid explanations use the team's shared AWS credit, so they need the demo PIN. It unlocks this tab for 2 hours.
              </p>
              <div style={{ display: "flex", gap: 6 }}>
                <input
                  type="password" inputMode="numeric" autoComplete="off" autoFocus
                  aria-label="Demo PIN" placeholder="PIN"
                  value={pin} onChange={(e) => setPin(e.target.value)}
                  style={{
                    flex: 1, minWidth: 0, padding: "7px 10px", borderRadius: "var(--radius)",
                    border: "1px solid var(--border)", background: "var(--card-bg)", color: "var(--text-primary)",
                    // --text-base, not smaller: iOS zooms the whole page into
                    // any input below 16px, which would throw the panel off.
                    fontSize: "var(--text-base)", letterSpacing: "0.15em",
                  }}
                />
                <button type="submit" disabled={!pin.trim() || unlocking}
                  style={{
                    padding: "7px 12px", borderRadius: "var(--radius)", border: "none",
                    background: "var(--blue-strong)", color: "#fff", fontSize: "var(--text-sm)", fontWeight: 600,
                    cursor: !pin.trim() || unlocking ? "default" : "pointer", opacity: !pin.trim() || unlocking ? 0.55 : 1,
                  }}>
                  {unlocking ? "Checking…" : "Unlock"}
                </button>
              </div>
            </form>
          )}

          {current === "cloud" && pass && !pending && (() => {
            const cloud = state?.modes?.find((x) => x.id === "cloud");
            const until = new Date(pass.expiresAt).toLocaleTimeString("en-SG", { hour: "numeric", minute: "2-digit" });
            return (
              <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8, margin: "-8px 0 12px", fontSize: "var(--text-xs)", color: "var(--text-muted)", lineHeight: 1.45 }}>
                <span>
                  Unlocked until {until}
                  {cloud?.usage?.dailyLimit ? ` · ${cloud.usage.usedToday} of ${cloud.usage.dailyLimit} paid calls today` : ""}
                </span>
                {cloud?.requiresPin && (
                  <button type="button" onClick={clearPass}
                    style={{ background: "none", border: "none", padding: 0, color: "var(--blue-text)", fontSize: "var(--text-xs)", fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap" }}>
                    Lock now
                  </button>
                )}
              </div>
            );
          })()}
          {error && (
            <p style={{ fontSize: "var(--text-xs)", color: "var(--red-text)", lineHeight: 1.45, margin: "-8px 0 12px" }}>{error}</p>
          )}

          <Section title="Theme" />
          {/* gap 4 and minWidth 0 on each button: in the 230px sidebar the three
              buttons' text widths add up to more than the row, and a flex
              item will not shrink below its content without minWidth 0, so
              "Dark" used to push past the panel's border. */}
          <div style={{ display: "flex", gap: 4 }}>
            {THEMES.map((t) => {
              const ThemeIcon = THEME_ICON[t.id] || Sun;
              const on = theme === t.id;
              return (
                <button key={t.id} onClick={() => setTheme(t.id)} aria-pressed={on}
                  title={t.id === "auto" ? "Follow this device's appearance setting" : undefined}
                  style={{
                    flex: 1, minWidth: 0, display: "flex", alignItems: "center", justifyContent: "center", gap: 4,
                    padding: "8px 2px", borderRadius: "var(--radius)", cursor: "pointer",
                    border: `1px solid ${on ? "var(--blue)" : "var(--border)"}`,
                    background: on ? "var(--blue-light)" : "transparent",
                    color: on ? "var(--blue-text)" : "var(--text-secondary)",
                    fontSize: "var(--text-xs)", fontWeight: on ? 600 : 400,
                  }}>
                  <ThemeIcon size={14} style={{ flexShrink: 0 }} />
                  {t.label}
                </button>
              );
            })}
          </div>

          {/* Reachable regardless of the live SKU count, so the onboarding
              journey can be demoed on demand without emptying the database
              first. Home itself still shows it automatically for a genuinely
              empty catalog. */}
          <div style={{ borderTop: "1px solid var(--border)", marginTop: 14, paddingTop: 10 }}>
            {demoActive === false && (
              <button onClick={() => enterDemoMode()} style={{
                display: "flex", alignItems: "center", gap: 8, width: "100%",
                padding: "7px 2px", background: "none", border: "none", cursor: "pointer",
                fontSize: "var(--text-xs)", fontWeight: 600, color: "var(--text-muted)",
              }}>
                <PlayCircle size={14} style={{ flexShrink: 0 }} />
                Enter demo mode (a sandbox, real data untouched)
              </button>
            )}
            <button onClick={() => { setOpen(false); navigate("/onboarding"); }} style={{
              display: "flex", alignItems: "center", gap: 8, width: "100%",
              padding: "7px 2px", background: "none", border: "none", cursor: "pointer",
              fontSize: "var(--text-xs)", fontWeight: 600, color: "var(--text-muted)",
            }}>
              <PlayCircle size={14} style={{ flexShrink: 0 }} />
              Preview the onboarding journey
            </button>
          </div>
      </div>
    );

    // document.body is outside every backdrop root, which is the whole point.
    return compact ? createPortal(panel, document.body) : panel;
  }
}

// Names of things on screen, marked as names. Stan's draft used square
// brackets for this; weight and colour say the same thing without adding
// punctuation the reader has to parse. currentColor rather than a token, so it
// works in both the solid sidebar popover and the glass one.
function Em({ children }) {
  return <span style={{ fontWeight: 700, color: "currentColor", opacity: 0.85 }}>{children}</span>;
}

function Section({ title, note }) {
  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{
        fontSize: "var(--text-xs)", fontWeight: 700, letterSpacing: "0.05em", textTransform: "uppercase",
        color: "var(--text-muted)",
      }}>
        {title}
      </div>
      {note && (
        <div style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)", marginTop: 3, lineHeight: 1.4 }}>{note}</div>
      )}
    </div>
  );
}
