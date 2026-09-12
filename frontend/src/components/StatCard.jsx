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
  const statusColor = { ok: "var(--text-primary)", warn: "var(--yellow)", bad: "var(--red)" }[status];

  return (
    <div style={{ display: "flex", alignItems: "flex-start", gap: "var(--space-3)" }}>
      {Icon && (
        <Icon size={16} color="var(--text-muted)" style={{ flexShrink: 0, marginTop: 2 }} />
      )}
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: "var(--text-sm)", color: "var(--text-secondary)", fontWeight: 500, display: "flex", alignItems: "center", gap: 5 }}>
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
        </div>
        {sub && (
          <div style={{ fontSize: "var(--text-sm)", color: "var(--text-muted)", marginTop: 3 }}>{sub}</div>
        )}
        {target && (
          <div style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)", marginTop: 2 }}>
            Target&nbsp;{target}
          </div>
        )}
      </div>
    </div>
  );
}
