import React, { useState, useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import { ChevronLeft, Delete } from "lucide-react";
import { api } from "../api/inventory";
import { FloorError } from "./Handheld";

// ─────────────────────────────────────────────────────────────────────────────
// PIN SIGN IN (TASK-47)
//
// A shared rugged terminal sits on a charging cradle by the dock and is used by
// whoever picks it up. A four digit PIN is what that situation actually calls
// for: it works with gloves, needs no keyboard, takes under two seconds, and
// still attributes every movement to a named person, which is the part the
// audit trail cares about.
//
// The demo PINs are printed on screen. That is a prototype affordance, and it
// is labelled as one so nobody mistakes it for a design.
// ─────────────────────────────────────────────────────────────────────────────

export default function Login({ onSignedIn, purpose }) {
  const [pin, setPin] = useState("");
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [operators, setOperators] = useState([]);

  useEffect(() => { api.getOperators().then(setOperators).catch(() => {}); }, []);

  // Submitting on the fourth digit removes a whole button press. There is no
  // ambiguity about when the PIN is complete, so asking for confirmation would
  // be asking a question whose answer is already known.
  //
  // The in flight guard is a ref, not state, and that is load bearing. A first
  // version had `busy` in the dependency array AND set it inside the effect, so
  // setting it re-ran the effect, whose cleanup cancelled the very request it
  // had just started: four dots filled and nothing ever happened. A ref does not
  // trigger a render, so it cannot retrigger the effect.
  const submitting = useRef(false);
  useEffect(() => {
    if (pin.length !== 4 || submitting.current) return;
    submitting.current = true;
    setBusy(true);
    setError(null);
    api.warehouseLogin(pin)
      .then((op) => onSignedIn(op))
      .catch((err) => { setError(err.message); setPin(""); })
      .finally(() => { submitting.current = false; setBusy(false); });
  }, [pin, onSignedIn]);

  const press = (k) => {
    if (busy) return;
    if (k === "back") return setPin((p) => p.slice(0, -1));
    setPin((p) => (p.length >= 4 ? p : p + k));
  };

  const keys = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "back"];

  return (
    <div className="hh-screen">
      <div style={{ padding: "14px 16px", borderBottom: "1px solid var(--border)" }}>
        <Link to="/" aria-label="All modes"
          style={{ color: "var(--text-secondary)", display: "inline-flex", padding: 4, marginLeft: -4 }}>
          <ChevronLeft size={22} />
        </Link>
      </div>

      <div className="hh-body" style={{ justifyContent: "center", gap: 22 }}>
        <div style={{ textAlign: "center" }}>
          <h1 style={{ fontSize: "var(--text-lg)", fontWeight: 700, lineHeight: 1.25 }}>Who is {purpose}?</h1>
          <p style={{ fontSize: "var(--text-sm)", color: "var(--text-secondary)", marginTop: 6 }}>
            Enter your four digit PIN
          </p>
        </div>

        {/* Four dots rather than a text field: it shows progress without ever
            showing the PIN to whoever is standing behind you. */}
        <div style={{ display: "flex", justifyContent: "center", gap: 14 }} aria-live="polite"
          aria-label={`${pin.length} of 4 digits entered`}>
          {[0, 1, 2, 3].map((i) => (
            <span key={i} style={{
              width: 15, height: 15, borderRadius: "50%",
              background: i < pin.length ? "var(--blue)" : "transparent",
              border: `2px solid ${i < pin.length ? "var(--blue)" : "var(--border)"}`,
              transition: "background 0.12s ease, border-color 0.12s ease",
            }} />
          ))}
        </div>

        <FloorError message={error} />

        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 11 }}>
          {keys.map((k, i) =>
            k === "" ? <span key={i} /> : (
              <button key={i} className="hh-key" onClick={() => press(k)} disabled={busy}
                aria-label={k === "back" ? "Delete last digit" : k}
                style={{ height: 66, fontSize: "var(--text-lg)" }}>
                {k === "back" ? <Delete size={20} style={{ verticalAlign: "middle" }} /> : k}
              </button>
            )
          )}
        </div>

        {/* Prototype affordance, labelled as one. */}
        {operators.length > 0 && (
          <div style={{
            border: "1px dashed var(--border)", borderRadius: 12,
            padding: "12px 14px", background: "var(--surface-2)",
          }}>
            <div style={{
              fontSize: "var(--text-xs)", fontWeight: 700, letterSpacing: "0.05em", textTransform: "uppercase",
              color: "var(--text-muted)", marginBottom: 8,
            }}>
              Demo PINs
            </div>
            {operators.map((o) => (
              <button key={o.id} onClick={() => setPin(o.pin)} disabled={busy}
                style={{
                  display: "flex", width: "100%", justifyContent: "space-between", alignItems: "center",
                  background: "none", border: "none", padding: "5px 0", cursor: "pointer",
                  fontSize: "var(--text-xs)", color: "var(--text-secondary)",
                }}>
                <span>{o.name}<span style={{ color: "var(--text-muted)" }}> · {o.role}</span></span>
                <span style={{ fontFamily: "monospace", fontWeight: 700, color: "var(--text-primary)" }}>{o.pin}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
