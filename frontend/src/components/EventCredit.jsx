import React from "react";

// ─────────────────────────────────────────────────────────────────────────────
// EVENT CREDIT (TASK-68)
//
// The footer signature, shared by the Home screen and the Control Tower
// sidebar. One component rather than the same two lines typed twice: a team
// name that appears in two places and is edited in one is exactly how a demo
// ends up crediting two slightly different teams.
//
// The team is the STRONGER line even though it sits second. Two lines of
// identical muted text read as one grey block nobody looks at, and of the two
// facts here the event is context a judge already has, while the team is the
// thing they are being asked to remember. Weight carries that, not size, so
// the block stays the same height as the single line it replaced.
// ─────────────────────────────────────────────────────────────────────────────

export const EVENT = "AWS NUS-ISS SMYA 2026";
export const TEAM = "Team Puenzhiyyy";

// `inline` puts both on one line with a separator. It is a prop rather than
// the default because the sidebar is 230px wide and the pair does not fit
// there: one row would wrap mid-name, which is worse than two tidy lines.
// Home has the width, so Home asks for it.
export default function EventCredit({ align = "left", inline = false }) {
  const event = (
    <span style={{ color: "var(--text-muted)" }}>{EVENT}</span>
  );
  const team = (
    <span style={{ color: "var(--text-secondary)", fontWeight: 600 }}>{TEAM}</span>
  );

  if (inline) {
    return (
      <div style={{
        display: "flex", flexWrap: "wrap", justifyContent: align === "center" ? "center" : "flex-start",
        alignItems: "baseline", gap: "0 7px",
        fontSize: "var(--text-xs)", lineHeight: 1.45, textAlign: align,
      }}>
        {event}
        <span aria-hidden="true" style={{ color: "var(--text-muted)", opacity: 0.6 }}>·</span>
        {team}
      </div>
    );
  }

  return (
    <div style={{ textAlign: align, fontSize: "var(--text-xs)", lineHeight: 1.45 }}>
      <div>{event}</div>
      <div>{team}</div>
    </div>
  );
}
