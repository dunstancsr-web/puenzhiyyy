import React, { useState, useEffect, useCallback, useRef } from "react";
import { Settings, Cpu, Calculator, Cloud, AlertTriangle, Sun, Moon, Check } from "lucide-react";
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

export default function SettingsMenu({ align = "up" }) {
  const { theme, setTheme } = useTheme();
  const [open, setOpen] = useState(false);
  const [state, setState] = useState(null);      // { mode, modes }
  const [pending, setPending] = useState(null);  // metered tier awaiting confirm
  const [error, setError] = useState(null);
  const wrapRef = useRef(null);

  const load = useCallback(() => {
    api.getLlmMode().then(setState).catch(() => setState(null));
  }, []);
  useEffect(() => { load(); }, [load]);

  // Close on outside click and on Escape. A popover that can only be dismissed
  // by pressing its own trigger again is a trap on a touch screen.
  useEffect(() => {
    if (!open) return;
    const onDown = (e) => { if (wrapRef.current && !wrapRef.current.contains(e.target)) { setOpen(false); setPending(null); } };
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
  const themeLabel = THEMES.find((t) => t.id === theme)?.label || theme;

  return (
    <div ref={wrapRef} style={{ position: "relative" }}>
      {/* The trigger carries the state. Collapsing the controls should not cost
          the operator the ability to see which engine is answering. */}
      <button
        onClick={() => { setOpen((v) => !v); setPending(null); }}
        aria-expanded={open}
        aria-haspopup="dialog"
        style={{
          display: "flex", alignItems: "center", gap: 9, width: "100%",
          padding: "9px 10px", borderRadius: "var(--radius)",
          border: "1px solid var(--sidebar-border)",
          background: open ? "var(--surface-2)" : "transparent",
          color: "var(--text-secondary)", cursor: "pointer",
          fontSize: 13, fontWeight: 600, textAlign: "left",
        }}
      >
        <Settings size={15} style={{ flexShrink: 0 }} />
        <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {activeMode ? activeMode.label : "Settings"}
          <span style={{ color: "var(--text-muted)", fontWeight: 500 }}> · {themeLabel}</span>
        </span>
      </button>

      {open && (
        <div role="dialog" aria-label="Settings"
          style={{
            position: "absolute", left: 0, right: 0, zIndex: 60,
            [align === "up" ? "bottom" : "top"]: "calc(100% + 8px)",
            minWidth: 248,
            background: "var(--card-bg)", border: "1px solid var(--border)",
            borderRadius: "var(--radius-lg)", boxShadow: "var(--shadow-md)",
            padding: 14,
          }}>

          <Section title="Explanations" note="Which engine answers Why? on an alert" />
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
                    fontSize: 13.5, fontWeight: active || awaiting ? 600 : 400,
                  }}>
                  <Icon size={14} style={{ flexShrink: 0 }} />
                  <span style={{ flex: 1 }}>{awaiting ? "Spend credit?" : m.label}</span>
                  {m.cost === "metered" && m.available && !awaiting && !active && (
                    <span style={{ fontSize: 10, fontWeight: 700, color: "var(--yellow)" }}>$</span>
                  )}
                  {awaiting && <AlertTriangle size={12} />}
                  {active && <Check size={13} />}
                </button>
              );
            })}
          </div>

          {pending && (
            <p style={{ fontSize: 11.5, color: "var(--text-muted)", lineHeight: 1.45, margin: "-8px 0 12px" }}>
              Click again to confirm. This tier bills the team's shared AWS credit on every new explanation.
            </p>
          )}
          {error && (
            <p style={{ fontSize: 11.5, color: "var(--red)", lineHeight: 1.45, margin: "-8px 0 12px" }}>{error}</p>
          )}

          <Section title="Theme" />
          <div style={{ display: "flex", gap: 6 }}>
            {THEMES.map((t) => (
              <button key={t.id} onClick={() => setTheme(t.id)} aria-pressed={theme === t.id}
                style={{
                  flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
                  padding: "8px 6px", borderRadius: "var(--radius)", cursor: "pointer",
                  border: `1px solid ${theme === t.id ? "var(--blue)" : "var(--border)"}`,
                  background: theme === t.id ? "var(--blue-light)" : "transparent",
                  color: theme === t.id ? "var(--blue)" : "var(--text-secondary)",
                  fontSize: 13, fontWeight: theme === t.id ? 600 : 400,
                }}>
                {t.id === "light" ? <Sun size={14} /> : <Moon size={14} />}
                {t.label}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function Section({ title, note }) {
  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{
        fontSize: 11, fontWeight: 700, letterSpacing: "0.05em", textTransform: "uppercase",
        color: "var(--text-muted)",
      }}>
        {title}
      </div>
      {note && (
        <div style={{ fontSize: 11.5, color: "var(--text-muted)", marginTop: 3, lineHeight: 1.4 }}>{note}</div>
      )}
    </div>
  );
}
