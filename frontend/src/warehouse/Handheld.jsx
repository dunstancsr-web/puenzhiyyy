import React, { useState } from "react";
import { Link } from "react-router-dom";
import { ChevronLeft, HelpCircle, LogOut, X } from "lucide-react";

// ─────────────────────────────────────────────────────────────────────────────
// HANDHELD SHELL AND CONTROLS (TASK-47)
//
// Shared furniture for the warehouse floor screens. The design constraints are
// physical rather than aesthetic: the operator is standing, holding the device
// in one hand, possibly wearing gloves, and is interrupted constantly. So every
// screen shows one action, states in plain language what to do, and can be
// completed with large taps rather than typing.
//
// Light theme by default. An industrial tool invites a dark treatment, but this
// project is designed and demoed in light, so the device character comes from
// scale and focus instead of from inverting the palette.
// ─────────────────────────────────────────────────────────────────────────────

/** Top bar: where you are, who you are, and a way back out. */
export function HandheldHeader({ title, operator, onBack, onSignOut, steps, step }) {
  return (
    <div style={{
      padding: "14px 16px 12px",
      borderBottom: "1px solid var(--border)",
      background: "var(--card-bg)",
      position: "sticky", top: 0, zIndex: 5,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: steps ? 12 : 0 }}>
        {onBack ? (
          <button onClick={onBack} aria-label="Back"
            style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-secondary)", padding: 4, marginLeft: -4 }}>
            <ChevronLeft size={22} />
          </button>
        ) : (
          <Link to="/" aria-label="All modes"
            style={{ color: "var(--text-secondary)", display: "flex", padding: 4, marginLeft: -4 }}>
            <ChevronLeft size={22} />
          </Link>
        )}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 16, fontWeight: 700, lineHeight: 1.2 }}>{title}</div>
          {operator && (
            <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 1 }}>
              Signed in as {operator.name}
            </div>
          )}
        </div>
        {onSignOut && (
          <button onClick={onSignOut} aria-label="Sign out"
            style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)", padding: 6 }}>
            <LogOut size={18} />
          </button>
        )}
      </div>

      {/* A progress rail, not a number alone. "Step 2 of 4" tells you where you
          are; the rail also shows how much is left, which is what stops someone
          abandoning a task halfway. */}
      {steps && (
        <>
          <div className="hh-steps" aria-hidden>
            {Array.from({ length: steps }, (_, i) => <span key={i} data-on={i < step} />)}
          </div>
          <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 7 }}>
            Step {step} of {steps}
          </div>
        </>
      )}
    </div>
  );
}

/** The instruction for the current screen, in plain language, always first. */
export function Instruction({ children, detail }) {
  return (
    <div>
      <h2 style={{ fontSize: 20, fontWeight: 700, lineHeight: 1.3 }}>{children}</h2>
      {detail && (
        <p style={{ fontSize: 14, color: "var(--text-secondary)", marginTop: 6, lineHeight: 1.5 }}>
          {detail}
        </p>
      )}
    </div>
  );
}

/**
 * A numeric keypad, not a text input.
 *
 * It cannot receive a letter, it needs no on-screen keyboard to appear over the
 * content, and it is the control every warehouse terminal already uses, so an
 * operator needs no instruction to work it.
 */
export function Keypad({ value, onChange, suffix = "MT", max }) {
  const press = (k) => {
    if (k === "back") return onChange(value.slice(0, -1));
    if (k === "." && value.includes(".")) return;
    if (k === "." && value === "") return onChange("0.");
    const next = value + k;
    // Two decimals is the precision the rest of the app stores. Allowing more
    // invites a figure that cannot round trip through the database.
    if (/\.\d{3,}$/.test(next)) return;
    if (max != null && Number(next) > max * 10) return;
    onChange(next);
  };

  const keys = ["7", "8", "9", "4", "5", "6", "1", "2", "3", ".", "0", "back"];
  return (
    <div>
      <div style={{
        border: "1px solid var(--border)", borderRadius: 14, background: "var(--surface-2)",
        padding: "18px 16px", textAlign: "center", marginBottom: 14,
      }}>
        <div style={{
          fontSize: 40, fontWeight: 700, lineHeight: 1.1, fontVariantNumeric: "tabular-nums",
          color: value ? "var(--text-primary)" : "var(--text-muted)",
        }}>
          {value || "0"}
          <span style={{ fontSize: 18, fontWeight: 600, color: "var(--text-muted)", marginLeft: 6 }}>{suffix}</span>
        </div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10 }}>
        {keys.map((k) => (
          <button key={k} className="hh-key" onClick={() => press(k)}
            aria-label={k === "back" ? "Delete last digit" : k}>
            {k === "back" ? "⌫" : k}
          </button>
        ))}
      </div>
    </div>
  );
}

/** A labelled fact. Used wherever the operator has to check a screen against a
 *  physical pallet, which is most screens. */
export function Fact({ label, value, strong, tone }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12, padding: "7px 0" }}>
      <span style={{ fontSize: 14, color: "var(--text-secondary)" }}>{label}</span>
      <span style={{
        fontSize: strong ? 17 : 15,
        fontWeight: strong ? 700 : 600,
        color: tone || "var(--text-primary)",
        textAlign: "right",
        fontVariantNumeric: "tabular-nums",
      }}>
        {value}
      </span>
    </div>
  );
}

/**
 * The whole procedure, on demand.
 *
 * Two kinds of help are needed and they are not the same. The per screen
 * instruction answers "what do I press now". This answers "what am I doing and
 * how much is left", which is what a new starter needs before they begin and
 * what anyone needs after an interruption. Collapsed by default so it never
 * competes with the step in front of them.
 */
export function HowThisWorks({ title, steps }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ marginTop: "auto", paddingTop: 12 }}>
      <button onClick={() => setOpen((v) => !v)} aria-expanded={open}
        style={{
          display: "flex", alignItems: "center", gap: 7, width: "100%",
          background: "none", border: "none", padding: "10px 0", cursor: "pointer",
          color: "var(--text-muted)", fontSize: 14, fontWeight: 600,
        }}>
        {open ? <X size={15} /> : <HelpCircle size={15} />}
        {open ? "Hide the steps" : "How this works"}
      </button>

      {open && (
        <div style={{
          border: "1px solid var(--border)", borderRadius: 14,
          background: "var(--surface-2)", padding: "14px 16px",
        }}>
          <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 10 }}>{title}</div>
          <ol style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 11 }}>
            {steps.map((s, i) => (
              <li key={s} style={{ display: "flex", gap: 10, fontSize: 13, lineHeight: 1.5, color: "var(--text-secondary)" }}>
                <span style={{
                  flexShrink: 0, width: 20, height: 20, borderRadius: "50%",
                  background: "var(--card-bg)", border: "1px solid var(--border)",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 11, fontWeight: 700, color: "var(--text-muted)",
                }}>
                  {i + 1}
                </span>
                <span>{s}</span>
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}

/** An error the operator can act on, never a raw failure. */
export function FloorError({ message }) {
  if (!message) return null;
  return (
    <div style={{
      background: "var(--red-light)", border: "1px solid var(--border)",
      borderRadius: 12, padding: "12px 14px", fontSize: 14, lineHeight: 1.5,
      color: "var(--text-primary)",
    }}>
      {message}
    </div>
  );
}
