import React from "react";
import ColHint from "./ColHint";

// Redesigned 2026-09 - no decorative per-metric icon color, no box/shadow.
// `status` ("ok" | "warn" | "bad", default "ok") is the ONLY thing that
// introduces color, and only when the metric itself is actually a problem -
// color reserved for state and meaning, never decoration. Icon is muted in
// the neutral case; label/value use standard text tokens. Separates from
// neighbors via the caller's own hairline divider, not a border+shadow box.
// `hint` (optional {what, how}) adds a ColHint ⓘ next to the label - plain-
// language help for jargon terms like "GMROI" or "turnover".
export default function StatCard({ label, value, icon: Icon, sub, target, trend, status = "ok", hint }) {
  // Only a genuine "bad" recolours the number itself. "warn" gets a small
  // amber dot next to the label instead: with this portfolio, six of seven
  // KPIs resolve to warn or bad, and painting every one of them a loud colour
  // left the strip with no focal point at all - the reader cannot tell which
  // two numbers are the emergency. The dot keeps the signal without the shout.
  const statusColor = status === "bad" ? "var(--red)" : "var(--text-primary)";
  // EVERY status gets a dot, healthy included (2026-09-14). Previously "ok"
  // rendered nothing, which made absence ambiguous: a reader could not tell
  // whether a metric with no dot was healthy or simply not assessed. A green
  // dot says "checked, fine", and that is a different statement from silence.
  // It does not cost the focal point the dots were introduced to protect,
  // because the colours still separate: green reads as background, red does
  // not.
  const dotColor = { ok: "var(--green)", warn: "var(--yellow)", bad: "var(--red)" }[status];
  const dotLabel = { ok: "Healthy", warn: "Needs watching", bad: "Critical" }[status];

  return (
    <div style={{ display: "flex", alignItems: "flex-start", gap: "var(--space-3)" }}>
      {Icon && (
        <Icon size={16} color="var(--text-muted)" style={{ flexShrink: 0, marginTop: 2 }} />
      )}
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: "var(--text-sm)", color: "var(--text-secondary)", fontWeight: 500, display: "flex", alignItems: "center", gap: 5 }}>
          {dotColor && (
            <span
              aria-label={dotLabel}
              title={dotLabel}
              style={{ width: 7, height: 7, borderRadius: "50%", background: dotColor, flexShrink: 0 }}
            />
          )}
          {label}
          {hint && <ColHint label={label} what={hint.what} how={hint.how} />}
        </div>
        <div style={{ display: "flex", alignItems: "baseline", gap: "var(--space-2)", marginTop: 2, flexWrap: "wrap" }}>
          <div style={{ fontSize: "var(--text-xl)", fontWeight: 700, color: statusColor, lineHeight: 1.2 }}>
            {value}
          </div>
          {trend && (
            <span
              title="vs a fixed reference baseline - not a live month-over-month feed yet"
              style={{ fontSize: "var(--text-xs)", fontWeight: 700, color: trend.good ? "var(--green)" : "var(--red)", whiteSpace: "nowrap" }}
            >
              {trend.dir === "up" ? "▲" : trend.dir === "down" ? "▼" : "▬"} {trend.text}
            </span>
          )}
          {/* Beside the value, not on its own line. Only one card in the strip
              carries a target, and as a third line it made that card taller
              than its neighbours, so a row of otherwise identical KPIs sat on
              two different baselines. Every card is now exactly three rows
              high: label, value, sub. */}
          {target && (
            <span style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)", whiteSpace: "nowrap" }}>
              target&nbsp;{target}
            </span>
          )}
        </div>
        {sub && (
          <div style={{ fontSize: "var(--text-sm)", color: "var(--text-muted)", marginTop: 3 }}>{sub}</div>
        )}
      </div>
    </div>
  );
}
