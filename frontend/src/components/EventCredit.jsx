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

export default function EventCredit({ align = "left" }) {
  return (
    <div style={{ textAlign: align }}>
      <div style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)", lineHeight: 1.45 }}>
        {EVENT}
      </div>
      <div style={{
        fontSize: "var(--text-xs)", color: "var(--text-secondary)",
        fontWeight: 600, lineHeight: 1.45,
      }}>
        {TEAM}
      </div>
    </div>
  );
}
