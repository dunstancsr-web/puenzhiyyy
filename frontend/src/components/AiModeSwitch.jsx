import React, { useState, useEffect, useCallback } from "react";
import { Cpu, Calculator, Cloud, AlertTriangle } from "lucide-react";
import { api } from "../api/inventory";

// ─────────────────────────────────────────────────────────────────────────────
// AI MODE SWITCH (TASK-42)
//
// Which tier answers "Why?" on an alert, and what that tier costs. Always
// visible in the sidebar rather than buried in settings, for two reasons: a
// judge watching a demo should be able to see which engine produced what is on
// screen, and a tier that spends shared credit should never be something you
// are in without knowing.
//
// Entering the metered tier takes two clicks. The second click is a plain
// inline confirm rather than window.confirm, which blocks the page, cannot be
// styled, and reads as a browser error to anyone watching a recording.
// ─────────────────────────────────────────────────────────────────────────────

const ICONS = { rules: Calculator, local: Cpu, cloud: Cloud };

export default function AiModeSwitch() {
  const [state, setState] = useState(null);   // { mode, modes }
  const [pending, setPending] = useState(null); // mode id awaiting a confirm click
  const [error, setError] = useState(null);

  const load = useCallback(() => {
    api.getLlmMode().then(setState).catch(() => setState(null));
  }, []);

  useEffect(() => { load(); }, [load]);

  const choose = async (m) => {
    if (!m.available || m.id === state?.mode) return;

    // Free tiers switch immediately. The metered one asks first.
    if (m.cost === "metered" && pending !== m.id) {
      setPending(m.id);
      setError(null);
      return;
    }

    setPending(null);
    setError(null);
    try {
      setState(await api.setLlmMode(m.id));
    } catch (err) {
      setError(err.message);
    }
  };

  if (!state) return null;

  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{
        fontSize: 12, fontWeight: 600, color: "var(--text-muted)", padding: "0 8px",
        marginBottom: 8, letterSpacing: "0.06em", textTransform: "uppercase",
      }}>
        Explanations
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        {state.modes.map((m) => {
          const Icon = ICONS[m.id] || Cpu;
          const active = state.mode === m.id;
          const awaiting = pending === m.id;
          const metered = m.cost === "metered";

          return (
            <button
              key={m.id}
              onClick={() => choose(m)}
              disabled={!m.available}
              title={m.detail}
              aria-pressed={active}
              style={{
                display: "flex", alignItems: "center", gap: 8,
                padding: "7px 12px", borderRadius: "var(--radius)",
                border: `1px solid ${
                  awaiting ? "var(--yellow)" : active ? "var(--blue)" : "var(--border)"
                }`,
                background: awaiting ? "var(--yellow-light)" : active ? "var(--blue-light)" : "transparent",
                color: !m.available ? "var(--text-muted)"
                  : awaiting ? "var(--yellow)"
                  : active ? "var(--blue)" : "var(--text-secondary)",
                fontSize: 14, fontWeight: active || awaiting ? 600 : 400,
                cursor: m.available ? "pointer" : "not-allowed",
                opacity: m.available ? 1 : 0.55,
                textAlign: "left", transition: "all 0.15s",
              }}
            >
              <Icon size={14} style={{ flexShrink: 0 }} />
              <span style={{ flex: 1, minWidth: 0 }}>
                {awaiting ? "Spend credit?" : m.label}
              </span>

              {/* A metered tier is labelled as metered even when it is not the
                  active one, so the cost is visible before the click, not
                  discovered after it. */}
              {metered && m.available && !awaiting && !active && (
                <span style={{ fontSize: 10, fontWeight: 700, color: "var(--yellow)", letterSpacing: "0.04em" }}>
                  $
                </span>
              )}
              {awaiting && <AlertTriangle size={12} />}
              {active && (
                <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--blue)", flexShrink: 0 }} />
              )}
            </button>
          );
        })}
      </div>

      {pending && (
        <div style={{ fontSize: 11, color: "var(--text-muted)", padding: "6px 8px 0", lineHeight: 1.45 }}>
          Click again to confirm. This tier bills the team's shared AWS credit on every new explanation.
        </div>
      )}
      {error && (
        <div style={{ fontSize: 11, color: "var(--red)", padding: "6px 8px 0", lineHeight: 1.45 }}>
          {error}
        </div>
      )}
      {!pending && !error && (
        <div style={{ fontSize: 11, color: "var(--text-muted)", padding: "6px 8px 0", lineHeight: 1.45 }}>
          {state.modes.find((m) => m.id === state.mode)?.detail}
        </div>
      )}
    </div>
  );
}
