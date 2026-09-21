import React, { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { ArrowDownToLine, ArrowUpFromLine, ArrowRight, PlayCircle } from "lucide-react";
import EventCredit from "../components/EventCredit";
import AppMark from "../components/AppMark";
import ColHint from "../components/ColHint";
import TowerIcon from "../components/TowerIcon";
import useDeviceClass from "../hooks/useDeviceClass";
import { FullSeal, CLIENT_HAN, CLIENT_EN } from "../components/Tenant";
import { api } from "../api/inventory";
import { enterDemoMode } from "../lib/demoMode";
import Onboarding from "./Onboarding";
import LoadingState from "../components/LoadingState";
import { isDismissed } from "../lib/onboardingResume";

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

const OFFICE = [{
  to: "/dashboard",
  icon: TowerIcon,
  tint: "var(--purple-text)",
  bg: "var(--purple-light)",
  label: "Control Tower",
  sub: "Analysis and decisions",
  who: "office, desktop",
  help: "See what needs a decision today, why it was flagged, and approve or reject what the system recommends.",
}];

const FLOOR = [
  {
    to: "/warehouse/inbound",
    icon: ArrowDownToLine,
    tint: "var(--green-text)",
    bg: "var(--green-light)",
    label: "Goods In",
    sub: "Receiving",
    who: "handheld",
    help: "Check a delivery against its purchase order, count what actually arrived, and record any shortfall.",
  },
  {
    to: "/warehouse/outbound",
    icon: ArrowUpFromLine,
    tint: "var(--blue-text)",
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
    <Link to={m.to} className="card home-card" data-tour={m.to === "/dashboard" ? "home-control-tower" : undefined} style={{
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

/**
 * A row of workspaces. The two-column grid applies only when there are two to
 * put in it: on a handheld the office group holds one card, and leaving it in
 * the grid stranded it at half width with empty space beside it.
 */
function Group({ items, style }) {
  if (items.length === 0) return null;
  return items.length === 1
    ? <div style={style}><Floor m={items[0]} /></div>
    : <div className="home-pair" style={style}>{items.map((m) => <Floor key={m.label} m={m} />)}</div>;
}

export default function Home() {
  const device = useDeviceClass();
  const handheld = device === "handheld";

  const primary = handheld ? FLOOR : OFFICE;
  const secondary = handheld ? OFFICE : FLOOR;
  const secondaryLabel = handheld ? "In the office" : "On the warehouse floor";

  // MVP2: a genuinely empty catalog gets the onboarding journey instead of
  // the workspace launcher, since there is nothing here yet to launch into.
  // null = still checking, so the launcher never flashes before the count is
  // known. Reachable on demand regardless of real data at /onboarding
  // (App.jsx), for demoing the flow without emptying the database.
  const [skuCount, setSkuCount] = useState(null);
  useEffect(() => {
    let cancelled = false;
    api.getSkus().then((list) => { if (!cancelled) setSkuCount(list.length); })
      .catch(() => { if (!cancelled) setSkuCount(-1); }); // -1: couldn't check, don't block the launcher on it
    return () => { cancelled = true; };
  }, []);

  // Demo-only: previewing onboarding used to take Home to Control Tower to
  // Settings to "Preview the onboarding journey", three screens deep, and
  // only reachable at all once inside the Control Tower. This puts the same
  // link where a demoing manager already is. Real (non-demo) visitors don't
  // get it: against the live database, emptying the catalog just to see the
  // wizard again is the destructive action rules.md already cuts elsewhere.
  // null until known, so neither demo link flashes for the wrong state.
  const [isDemo, setIsDemo] = useState(null);
  useEffect(() => { api.getDemoStatus().then((d) => setIsDemo(!!d.active)).catch(() => {}); }, []);

  if (skuCount === null) return <LoadingState label="Loading…" />;
  // Closing or finishing onboarding writes this flag specifically so a
  // still-empty catalog doesn't loop straight back into the wizard the
  // moment Home renders: the whole point of closing it is being able to
  // leave and set the catalog up later, the normal way, from Inventory or
  // Bulk edit.
  if (skuCount === 0 && !isDismissed()) return <Onboarding />;

  return (
    <div className="home-page" style={{
      minHeight: "calc(100vh - var(--demo-banner-height))", background: "var(--bg)",
      // flex-start, not centre. Centring a short page in a tall viewport put
      // 214px of nothing above the first pixel of content, so the eye landed
      // on empty space. The top padding (clamp, in the stylesheet) anchors it without crowding the edge.
      display: "flex", justifyContent: "center", alignItems: "flex-start",
    }}>
      {/* Entering demo mode is a presenter's action, not a workspace, so it sits apart from the workspaces, top
          right, where the demo banner's Exit sits once you are in. In the page, not fixed: a floating control
          always covers something (it once sat on top of Bulk edit). Hidden once in demo mode: the banner takes over. */}
      {isDemo === false && (
        <button type="button" className="home-demo-entry" onClick={() => enterDemoMode()}>
          <PlayCircle size={14} aria-hidden />
          Enter demo mode
        </button>
      )}
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

        {/* Which group leads is DETECTED, not assumed. "For this device" used
            to sit over a hardcoded Control Tower, so on a phone the page told
            the reader that the desktop workspace was the one for their phone.
            See hooks/useDeviceClass: it asks whether the primary input is a
            finger, which is the real question, rather than measuring width,
            which only says how much room there is.

            Detection changes the ORDER AND THE LABELS, never what is
            available. Both groups render either way, so a wrong guess costs a
            little scrolling rather than access to a workspace. */}
        <div className="home-rule">For this device</div>
        <Hero m={primary[0]} />
        {primary.length > 1 && (
          <Group items={primary.slice(1)} style={{ marginTop: "var(--space-3)" }} />
        )}

        <div className="home-rule">{secondaryLabel}</div>
        <Group items={secondary} />

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
          <EventCredit align="center" inline />
          {isDemo && (
            <div style={{ textAlign: "center", marginTop: "var(--space-3)" }}>
              <Link to="/onboarding" style={{
                display: "inline-flex", alignItems: "center", gap: 6, textDecoration: "none", minHeight: 44,
                fontSize: "var(--text-xs)", fontWeight: 600, color: "var(--text-muted)",
              }}>
                <PlayCircle size={14} />
                Preview the onboarding journey
              </Link>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
