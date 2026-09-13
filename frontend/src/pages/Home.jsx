import React, { useState } from "react";
import { Link } from "react-router-dom";
import { ArrowDownToLine, ArrowUpFromLine, LayoutDashboard, ChevronDown, ArrowRight } from "lucide-react";
import EventCredit from "../components/EventCredit";
import AppMark from "../components/AppMark";
import { FullSeal, CLIENT_HAN, CLIENT_EN } from "../components/Tenant";

// ─────────────────────────────────────────────────────────────────────────────
// HOME (TASK-47, renamed TASK-48, renamed again TASK-50)
//
// The first screen, and the name we use for it in conversation. It was briefly
// called the Launchpad, after SAP Fiori and macOS, on the grounds that "home"
// is ambiguous once three workspaces exist. Stan chose Home, and he is right
// that the ambiguity is theoretical while the familiarity is not: every user
// already knows what Home means and nobody needs the distinction explained.
//
// Three ways into the same inventory, ordered the way stock actually moves: it
// arrives, it leaves, and somebody upstairs decides what to do about what is
// left. They are different jobs done by different people on different devices.
// A receiver on a loading dock and a manager reviewing working capital share a
// database and nothing else, so making them share a navigation would serve
// neither.
//
// Cards are deliberately SHORT. The description is the one thing a returning
// user never needs, and three paragraphs of it forced scrolling on a phone, so
// it collapses behind a tap. Not a hover tooltip: HoverHint is hover and focus
// only, which would put the text out of reach on exactly the small screens the
// change is for.
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

/**
 * The description, collapsed.
 *
 * A button rather than a hover target, because this exists for small screens
 * and a phone has no hover. stopPropagation keeps a tap on it from also
 * following the card's link, which would open the workspace instead of
 * explaining it.
 */
function Detail({ body }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ borderTop: "1px solid var(--border)", paddingTop: 10, marginTop: 2 }}>
      <button
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); setOpen((v) => !v); }}
        aria-expanded={open}
        style={{
          display: "inline-flex", alignItems: "center", gap: 5, padding: 0,
          background: "none", border: "none", cursor: "pointer",
          fontSize: "var(--text-xs)", fontWeight: 600, color: "var(--text-muted)",
        }}
      >
        <ChevronDown size={13} style={{ transform: open ? "rotate(180deg)" : "none", transition: "transform 0.15s ease" }} />
        {open ? "Less" : "What is this?"}
      </button>
      {open && (
        <p style={{ fontSize: "var(--text-sm)", color: "var(--text-secondary)", lineHeight: 1.55, marginTop: 8 }}>
          {body}
        </p>
      )}
    </div>
  );
}

export default function Home() {
  return (
    <div style={{
      minHeight: "100vh", background: "var(--bg)",
      display: "flex", alignItems: "center", justifyContent: "center", padding: "40px 20px",
    }}>
      <div style={{ width: "100%", maxWidth: 940 }}>
        {/* CLIENT-LED masthead. The company owns this screen and StockSense
            signs the bottom, which is how a deployed system actually presents
            itself. The trade is real and was made deliberately: the product
            being judged is no longer the largest thing on the first screen. It
            is mitigated by the foot of this page and by the Control Tower
            sidebar, which still leads with StockSense.

            Home is also the only surface with room for the full 2x2 chop. At
            56px each character has space; at the sidebar's 30px the same mark
            is texture. */}
        <div style={{ marginBottom: 26 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 22 }}>
            <FullSeal size={56} />
            <div>
              <h1 className="brush" style={{
                fontSize: "var(--text-xl)", fontWeight: 400, lineHeight: 1.15,
                color: "var(--text-primary)",
              }}>
                {CLIENT_HAN}
              </h1>
              <div style={{
                fontSize: "var(--text-xs)", fontWeight: 600, letterSpacing: "0.12em",
                textTransform: "uppercase", color: "var(--text-muted)", marginTop: 3,
              }}>
                {CLIENT_EN}
              </div>
            </div>
          </div>

          {/* The old copy was a sentence about inventory ("stock arrives, stock
              leaves..."). It read as a mission statement, which is the wrong
              job for the top of a portal: it described the domain instead of
              asking for a decision. A question plus a count tells the reader
              what this screen wants from them, and that there are exactly
              three answers. */}
          <h2 style={{ fontSize: "var(--text-lg)", fontWeight: 600, lineHeight: 1.25 }}>
            Where are you working today?
          </h2>
          <p style={{ fontSize: "var(--text-sm)", color: "var(--text-secondary)", marginTop: 4 }}>
            Three workspaces, one inventory. Pick one to begin.
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
                  gap: 9, padding: 20,
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
                    <span style={{ fontSize: "var(--text-lg)", fontWeight: 700, lineHeight: 1.2 }}>{m.label}</span>
                    {m.soon && (
                      <span style={{
                        fontSize: "var(--text-xs)", fontWeight: 700, letterSpacing: "0.04em", textTransform: "uppercase",
                        color: "var(--text-muted)", border: "1px solid var(--border)",
                        borderRadius: 99, padding: "2px 8px",
                      }}>
                        Next up
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: "var(--text-xs)", color: m.tint, fontWeight: 600, marginTop: 2 }}>{m.sub}</div>
                </div>

                {/* Naming the device and the place is the fastest way to tell
                    someone a screen is not meant for them, and it is two words
                    rather than three lines.

                    The arrow beside it is what makes the card read as a button
                    rather than a panel. A card with a title and a paragraph is
                    a description; the same card with a direction cue is an
                    invitation. The disabled one has no arrow, because it goes
                    nowhere and an arrow would promise that it does. */}
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                  <div style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)" }}>{m.who}</div>
                  {!m.soon && <ArrowRight size={17} style={{ color: m.tint, flexShrink: 0 }} />}
                </div>

                <Detail body={m.body} />
              </Card>
            );
          })}
        </div>

        <div style={{ marginTop: 28, paddingTop: 18, borderTop: "1px solid var(--border)" }}>
          {/* StockSense signs the foot of the page, the way a deployed system
              credits the platform it runs on. */}
          <div style={{
            display: "flex", alignItems: "center", justifyContent: "center", gap: 9,
            marginBottom: 12,
          }}>
            <AppMark size={26} />
            <span style={{ fontSize: "var(--text-sm)", color: "var(--text-secondary)", fontWeight: 600 }}>
              Running on <span style={{ color: "var(--text-primary)", fontWeight: 700 }}>StockSense</span>
            </span>
          </div>
          <EventCredit align="center" />
        </div>
      </div>
    </div>
  );
}
