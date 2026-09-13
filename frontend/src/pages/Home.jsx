import React from "react";
import { Link } from "react-router-dom";
import { ArrowDownToLine, ArrowUpFromLine, ArrowRight } from "lucide-react";
import EventCredit from "../components/EventCredit";
import AppMark from "../components/AppMark";
import ColHint from "../components/ColHint";
import TowerIcon from "../components/TowerIcon";
import { FullSeal, CLIENT_HAN, CLIENT_EN } from "../components/Tenant";

// ─────────────────────────────────────────────────────────────────────────────
// HOME (TASK-47, renamed TASK-48 and TASK-50, rebuilt TASK-74 and TASK-78)
//
// The first screen, and the name we use for it in conversation. It was briefly
// called the Launchpad, after SAP Fiori and macOS; Stan chose Home, on the
// grounds that the ambiguity is theoretical while the familiarity is not.
//
// Three ways into the same inventory, ordered the way stock actually moves: it
// arrives, it leaves, and somebody upstairs decides what to do about what is
// left. Different jobs, different people, different devices. A receiver on a
// loading dock and a manager reviewing working capital share a database and
// nothing else, so making them share a navigation would serve neither.
//
// LAYOUT. One centre axis, with the workspaces grouped by the device they need
// rather than listed flat. The grouping is done by LABELLED RULES, not by
// splitting the page into columns: a rule with a word in it costs one line of
// height and leaves the centre line unbroken, where a split makes the reader
// look in two places for a single decision.
//
// Wide and narrow are the same markup. The pair goes from two columns to one
// and the column narrows, which is the entire difference between the two
// layouts Stan picked. See .home-shell and .home-pair in index.css: those are
// classes rather than inline styles, because an inline grid-template-columns
// beats a stylesheet rule and the breakpoint could never reach it.
//
// HELP. An ⓘ beside each name, the same ColHint used on every table header in
// this app: muted until hovered or focused, and reachable by tap because it
// responds to focus too. It replaces three repeated "What is this?" buttons,
// which read as chrome and nested a button inside a link.
// ─────────────────────────────────────────────────────────────────────────────

const HERE = {
  to: "/dashboard",
  icon: TowerIcon,
  tint: "var(--purple)",
  bg: "var(--purple-light)",
  label: "Control Tower",
  sub: "Analysis and decisions",
  who: "office, desktop",
  help: "See what needs a decision today, why it was flagged, and approve or reject what the system recommends.",
};

const FLOOR = [
  {
    to: "/warehouse/inbound",
    icon: ArrowDownToLine,
    tint: "var(--green)",
    bg: "var(--green-light)",
    label: "Goods In",
    sub: "Receiving",
    who: "handheld",
    help: "Check a delivery against its purchase order, count what actually arrived, and record any shortfall.",
  },
  {
    to: null,
    soon: true,
    icon: ArrowUpFromLine,
    tint: "var(--blue)",
    bg: "var(--blue-light)",
    label: "Goods Out",
    sub: "Picking and dispatch",
    who: "handheld",
    help: "Pick a customer order, confirm what leaves the building, and release the stock that was reserved for it.",
  },
];

function Glyph({ m, size }) {
  const I = m.icon;
  return (
    <span style={{
      width: size, height: size, borderRadius: Math.round(size * 0.26),
      background: m.bg, display: "grid", placeItems: "center", flexShrink: 0,
      opacity: m.soon ? 0.5 : 1,
    }}>
      <I size={Math.round(size * 0.56)} color={m.tint} />
    </span>
  );
}

function Name({ m, size, muted }) {
  return (
    <span style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
      <span style={{
        fontSize: size, fontWeight: 700, lineHeight: 1.2,
        color: muted ? "var(--text-muted)" : "var(--text-primary)",
      }}>
        {m.label}
      </span>
      {/* Beside the name, where someone wondering "what is this" is already
          looking. Deliberately not a visible button: 12px and muted until
          hovered or focused, so it costs the card no weight. */}
      <ColHint label={m.label} what={m.help} />
      {/* On the name row. "Building in progress" was too long to sit here and
          had to go underneath, which pushed the card taller than its partner;
          "Coming soon" fits beside the name, where a status about the card
          reads as part of its title rather than as another line of detail. */}
      {m.soon && (
        <span style={{
          fontSize: "var(--text-xs)", fontWeight: 700, letterSpacing: "0.03em",
          textTransform: "uppercase", color: "var(--text-secondary)",
          border: "1px solid var(--border)", background: "var(--surface-2)",
          borderRadius: 99, padding: "2px 8px", whiteSpace: "nowrap",
        }}>
          Coming soon
        </span>
      )}
    </span>
  );
}

/** The workspace this device can actually use, as one wide card. */
function Hero({ m }) {
  return (
    <Link to={m.to} className="card home-card" style={{
      display: "flex", alignItems: "center", gap: "var(--space-4)",
      padding: "var(--space-5)", textDecoration: "none", color: "inherit",
      textAlign: "left", borderColor: m.tint,
    }}>
      <Glyph m={m} size={62} />
      <span style={{ flex: 1, minWidth: 0 }}>
        <Name m={m} size="var(--text-lg)" />
        <span style={{ display: "block", fontSize: "var(--text-sm)", color: m.tint, fontWeight: 600, marginTop: 2 }}>
          {m.sub}
          <span style={{ color: "var(--text-muted)", fontWeight: 400 }}> · {m.who}</span>
        </span>
      </span>
      <span style={{
        display: "flex", alignItems: "center", gap: 7, flexShrink: 0,
        fontSize: "var(--text-base)", fontWeight: 700, color: m.tint,
      }}>
        Open <ArrowRight size={18} />
      </span>
    </Link>
  );
}

/**
 * A floor workspace. Rendered as a div when it goes nowhere, so it cannot be
 * tabbed into or clicked by accident, and with no arrow, because an arrow
 * promises a destination.
 */
function Floor({ m }) {
  const Card = m.soon ? "div" : Link;
  return (
    <Card {...(m.soon ? {} : { to: m.to })} className={`card${m.soon ? "" : " home-card"}`} style={{
      display: "flex", alignItems: "center", gap: "var(--space-3)",
      padding: "var(--space-4)", textDecoration: "none", color: "inherit",
      textAlign: "left", cursor: m.soon ? "default" : "pointer",
    }}>
      <Glyph m={m} size={50} />
      <span style={{ flex: 1, minWidth: 0 }}>
        <Name m={m} size="var(--text-base)" muted={m.soon} />
        <span style={{ display: "block", fontSize: "var(--text-xs)", color: "var(--text-muted)", marginTop: 1 }}>
          {m.sub} · {m.who}
        </span>
      </span>
      {!m.soon && <ArrowRight size={17} style={{ color: m.tint, flexShrink: 0 }} />}
    </Card>
  );
}

export default function Home() {
  return (
    <div style={{
      minHeight: "100vh", background: "var(--bg)",
      // flex-start, not centre. Centring a short page in a tall viewport put
      // 214px of nothing above the first pixel of content, so the eye landed
      // on empty space. clamp anchors it without crowding the top edge.
      display: "flex", justifyContent: "center", alignItems: "flex-start",
      padding: "clamp(40px, 9vh, 96px) 20px 48px",
    }}>
      <div className="home-shell">

        <div style={{
          display: "flex", alignItems: "center", gap: "var(--space-4)",
          justifyContent: "center", marginBottom: "var(--space-5)",
        }}>
          <FullSeal size={56} />
          <div style={{ textAlign: "left" }}>
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

        {/* Both sizes moved together. Taking the sub-line two steps up on its
            own would have landed it on --text-lg, the same step as the
            question, and two lines of identical size read as a paragraph
            rather than as an ask and its answer. */}
        <h2 style={{ fontSize: "var(--text-xl)", fontWeight: 700, lineHeight: 1.2 }}>
          Where are you working today?
        </h2>
        <p style={{ fontSize: "var(--text-lg)", color: "var(--text-secondary)", marginTop: 6, lineHeight: 1.35 }}>
          Pick a workspace to begin.
        </p>

        <div className="home-rule">For this device</div>
        <Hero m={HERE} />

        <div className="home-rule">On the warehouse floor</div>
        <div className="home-pair">
          {FLOOR.map((m) => <Floor key={m.label} m={m} />)}
        </div>

        <div style={{
          marginTop: "var(--space-6)", paddingTop: "var(--space-4)",
          borderTop: "1px solid var(--border)",
        }}>
          <div style={{
            display: "flex", alignItems: "center", justifyContent: "center", gap: 9,
            marginBottom: "var(--space-3)",
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
