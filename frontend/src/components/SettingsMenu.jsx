import React, { useState, useEffect, useCallback, useRef } from "react";
import { createPortal } from "react-dom";
import { Settings, Cpu, Calculator, Cloud, AlertTriangle, Sun, Moon, Monitor, Check } from "lucide-react";
import { useTheme, THEMES } from "../context/ThemeContext";
import { api } from "../api/inventory";

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
  const { theme, resolved, setTheme } = useTheme();
  const [open, setOpen] = useState(false);
  const [state, setState] = useState(null);      // { mode, modes }
  const [pending, setPending] = useState(null);  // metered tier awaiting confirm
  const [error, setError] = useState(null);
  const wrapRef = useRef(null);
  const panelRef = useRef(null);
  const [rect, setRect] = useState(null);

  const load = useCallback(() => {
    api.getLlmMode().then(setState).catch(() => setState(null));
  }, []);
  useEffect(() => { load(); }, [load]);

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

  const choose = async (m) => {
    if (!m.available || m.id === state?.mode) return;
    if (m.cost === "metered" && pending !== m.id) { setPending(m.id); setError(null); return; }
    setPending(null); setError(null);
    try { setState(await api.setLlmMode(m.id)); }
    catch (err) { setError(err.message); }
  };

  const activeMode = state?.modes?.find((m) => m.id === state.mode);
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
          minWidth: 248,
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
              const active = state.mode === m.id;
              const awaiting = pending === m.id;
              return (
                <button key={m.id} onClick={() => choose(m)} disabled={!m.available}
                  title={m.detail} aria-pressed={active}
                  style={{
                    display: "flex", alignItems: "center", gap: 8, padding: "8px 10px",
                    borderRadius: "var(--radius)", textAlign: "left", cursor: m.available ? "pointer" : "not-allowed",
                    border: `1px solid ${awaiting ? "var(--yellow)" : active ? "var(--blue)" : "transparent"}`,
                    background: awaiting ? "var(--yellow-light)" : active ? "var(--blue-light)" : "transparent",
                    color: !m.available ? "var(--text-muted)" : awaiting ? "var(--yellow)" : active ? "var(--blue)" : "var(--text-secondary)",
                    opacity: m.available ? 1 : 0.55,
                    fontSize: "var(--text-sm)", fontWeight: active || awaiting ? 600 : 400,
                  }}>
                  <Icon size={14} style={{ flexShrink: 0 }} />
                  <span style={{ flex: 1 }}>{awaiting ? "Spend credit?" : m.label}</span>
                  {m.cost === "metered" && m.available && !awaiting && !active && (
                    <span style={{ fontSize: "var(--text-xs)", fontWeight: 700, color: "var(--yellow)" }}>$</span>
                  )}
                  {awaiting && <AlertTriangle size={12} />}
                  {active && <Check size={13} />}
                </button>
              );
            })}
          </div>

          {pending && (
            <p style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)", lineHeight: 1.45, margin: "-8px 0 12px" }}>
              Click again to confirm. This tier bills the team's shared AWS credit on every new explanation.
            </p>
          )}
          {error && (
            <p style={{ fontSize: "var(--text-xs)", color: "var(--red)", lineHeight: 1.45, margin: "-8px 0 12px" }}>{error}</p>
          )}

          <Section title="Theme" />
          <div style={{ display: "flex", gap: 6 }}>
            {THEMES.map((t) => {
              const ThemeIcon = THEME_ICON[t.id] || Sun;
              const on = theme === t.id;
              return (
                <button key={t.id} onClick={() => setTheme(t.id)} aria-pressed={on}
                  title={t.id === "auto" ? "Follow this device's appearance setting" : undefined}
                  style={{
                    flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 5,
                    padding: "8px 4px", borderRadius: "var(--radius)", cursor: "pointer",
                    border: `1px solid ${on ? "var(--blue)" : "var(--border)"}`,
                    background: on ? "var(--blue-light)" : "transparent",
                    color: on ? "var(--blue)" : "var(--text-secondary)",
                    fontSize: "var(--text-xs)", fontWeight: on ? 600 : 400,
                  }}>
                  <ThemeIcon size={14} style={{ flexShrink: 0 }} />
                  {t.label}
                </button>
              );
            })}
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
