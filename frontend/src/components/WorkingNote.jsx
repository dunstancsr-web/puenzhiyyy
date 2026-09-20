import React, { useEffect, useState } from "react";

// Feedback for anything that makes a person wait on a model or a slow request.
//
// What it does, and why (this is the usual practice for waits of a few seconds to a minute):
//  - Under about 2 seconds it shows the label alone. A timer for a wait that short is noise.
//  - After that it adds the seconds elapsed, so the wait is visibly moving and a person can tell
//    "working" from "frozen".
//  - If a typical duration is given and the wait runs past it, it says so plainly and tells the
//    person nothing is lost. It never draws a progress bar it cannot back with real progress,
//    because a bar that stalls at 90% is worse than no bar.
// Screen readers hear the label and any extra sentence once (role="status"); the ticking seconds
// are hidden from them so they are not read out every second.
//
// label: what is happening, in plain words ("Reading the news"). No trailing dots needed.
// expectedSeconds: optional, how long this usually takes. Leave it out when there is no honest figure.

const fmt = (s) => (s < 60 ? `${s}s` : `${Math.floor(s / 60)} min ${s % 60}s`);

export default function WorkingNote({ label, expectedSeconds }) {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const t0 = Date.now();
    const id = setInterval(() => setElapsed(Math.floor((Date.now() - t0) / 1000)), 1000);
    return () => clearInterval(id);
  }, []);

  let extra = null;
  if (expectedSeconds && elapsed >= expectedSeconds * 1.5) {
    extra = "Taking longer than usual. You can keep using the app. The result will appear here when it is ready.";
  } else if (expectedSeconds && elapsed >= 4) {
    extra = `This usually takes about ${expectedSeconds} seconds.`;
  }

  return (
    <div role="status" style={{ display: "flex", flexDirection: "column", gap: 2, fontSize: "var(--text-sm)", color: "var(--text-secondary)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span className="working-dot" aria-hidden="true" />
        <span>{label}</span>
        {elapsed >= 2 && <span aria-hidden="true" style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)" }}>{fmt(elapsed)}</span>}
      </div>
      {extra && <div style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)", paddingLeft: 18, lineHeight: 1.5 }}>{extra}</div>}
    </div>
  );
}
