import React from "react";
import { Link } from "react-router-dom";
import { ArrowDownToLine, ArrowUpFromLine, LayoutDashboard } from "lucide-react";

// ─────────────────────────────────────────────────────────────────────────────
// LAUNCHER (TASK-47)
//
// The first screen. Three ways into the same inventory, ordered the way stock
// actually moves through a warehouse: it arrives, it leaves, and somebody
// upstairs decides what to do about what is left.
//
// This exists because the three are different jobs done by different people on
// different devices. A receiver on a loading dock and a manager reviewing
// working capital share a database and nothing else, and making them share a
// navigation would serve neither.
// ─────────────────────────────────────────────────────────────────────────────

const MODES = [
  {
    to: "/warehouse/inbound",
    icon: ArrowDownToLine,
    tint: "var(--green)",
    bg: "var(--green-light)",
    label: "Goods In",
    sub: "Receiving",
    body: "Check a delivery against its purchase order, count what actually arrived, and record any shortfall.",
    who: "Warehouse floor, handheld",
  },
  {
    to: null,
    soon: true,
    icon: ArrowUpFromLine,
    tint: "var(--blue)",
    bg: "var(--blue-light)",
    label: "Goods Out",
    sub: "Picking and dispatch",
    body: "Pick a customer order, confirm what leaves the building, and release the stock that was reserved for it.",
    who: "Warehouse floor, handheld",
  },
  {
    to: "/dashboard",
    icon: LayoutDashboard,
    tint: "var(--purple)",
    bg: "var(--purple-light)",
    label: "Control Tower",
    sub: "Analysis and decisions",
    body: "See what needs a decision today, why it was flagged, and approve or reject what the system recommends.",
    who: "Office, desktop",
  },
];

export default function Launcher() {
  return (
    <div style={{
      minHeight: "100vh", background: "var(--bg)",
      display: "flex", alignItems: "center", justifyContent: "center", padding: "40px 20px",
    }}>
      <div style={{ width: "100%", maxWidth: 940 }}>
        <div style={{ marginBottom: 30 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 11, marginBottom: 12 }}>
            <div style={{
              width: 40, height: 40, borderRadius: 11, background: "var(--blue)",
              display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
            }}>
              <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.4"
                strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <polyline points="22 7 13.5 15.5 8.5 10.5 2 17" />
                <polyline points="16 7 22 7 22 13" />
              </svg>
            </div>
            <div>
              <h1 style={{ fontSize: 26, fontWeight: 700, lineHeight: 1.1 }}>StockSense</h1>
              <div style={{ fontSize: 14, color: "var(--text-muted)" }}>Rice inventory, from the dock to the decision</div>
            </div>
          </div>
          <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.55, maxWidth: 620 }}>
            Stock arrives, stock leaves, and somebody has to decide what to do about what is left.
            Pick where you are.
          </p>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(270px, 1fr))", gap: 16 }}>
          {MODES.map((m) => {
            const Icon = m.icon;
            // A card that navigates to a blank screen is worse than one that
            // says it is not ready. Rendered as a div, not a Link, so it cannot
            // be tabbed into or clicked by accident.
            const Card = m.soon ? "div" : Link;
            return (
              <Card key={m.label} {...(m.soon ? {} : { to: m.to })} className="card"
                style={{
                  textDecoration: "none", color: "inherit", display: "flex", flexDirection: "column",
                  gap: 12, padding: 22, minHeight: 210,
                  opacity: m.soon ? 0.6 : 1,
                  cursor: m.soon ? "default" : "pointer",
                }}>
                <div style={{
                  width: 44, height: 44, borderRadius: 12, background: m.bg,
                  display: "flex", alignItems: "center", justifyContent: "center",
                }}>
                  <Icon size={21} color={m.tint} />
                </div>

                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                    <span style={{ fontSize: 19, fontWeight: 700, lineHeight: 1.2 }}>{m.label}</span>
                    {m.soon && (
                      <span style={{
                        fontSize: 11, fontWeight: 700, letterSpacing: "0.04em", textTransform: "uppercase",
                        color: "var(--text-muted)", border: "1px solid var(--border)",
                        borderRadius: 99, padding: "2px 8px",
                      }}>
                        Next up
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: 13, color: m.tint, fontWeight: 600, marginTop: 2 }}>{m.sub}</div>
                </div>

                <p style={{ fontSize: 14, color: "var(--text-secondary)", lineHeight: 1.55, flex: 1 }}>
                  {m.body}
                </p>

                {/* Naming the device and the place is the fastest way to tell
                    someone a screen is not meant for them. */}
                <div style={{ fontSize: 12, color: "var(--text-muted)", borderTop: "1px solid var(--border)", paddingTop: 11 }}>
                  {m.who}
                </div>
              </Card>
            );
          })}
        </div>

        <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 26, textAlign: "center" }}>
          AWS NUS-ISS SMYA 2026
        </div>
      </div>
    </div>
  );
}
