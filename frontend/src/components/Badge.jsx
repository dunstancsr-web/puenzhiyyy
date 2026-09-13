import React from "react";

// Colours resolve from theme CSS vars so badges stay legible in Dark mode too.
// ORANGE keeps a fixed dark amber text (there is no --orange var).
const styles = {
  // Health statuses
  GREEN:        { bg: "var(--green-light)",  color: "var(--green)",          label: "Healthy" },
  YELLOW:       { bg: "var(--yellow-light)", color: "var(--yellow)",         label: "Watch" },
  ORANGE:       { bg: "var(--yellow-light)", color: "#c2410c",               label: "Action Required" },
  RED:          { bg: "var(--red-light)",    color: "var(--red)",            label: "Critical" },
  // Movement classes
  "Fast Moving":  { bg: "var(--blue-light)",   color: "var(--blue)",          label: "Fast Moving" },
  "Normal":       { bg: "var(--surface-2)",    color: "var(--text-secondary)", label: "Normal" },
  "Slow Moving":  { bg: "var(--yellow-light)", color: "var(--yellow)",        label: "Slow Moving" },
  "Idle":         { bg: "var(--red-light)",    color: "var(--red)",           label: "Idle" },
  // Ageing statuses
  Fresh:        { bg: "var(--green-light)",  color: "var(--green)",          label: "Fresh" },
  Normal_age:   { bg: "var(--surface-2)",    color: "var(--text-secondary)", label: "Normal" },
  Ageing:       { bg: "var(--yellow-light)", color: "var(--yellow)",         label: "Ageing" },
  "At Risk":    { bg: "var(--red-light)",    color: "var(--red)",            label: "At Risk" },
  // Alert severities
  critical:     { bg: "var(--red-light)",    color: "var(--red)",            label: "Critical" },
  warning:      { bg: "var(--yellow-light)", color: "var(--yellow)",         label: "Warning" },
  info:         { bg: "var(--blue-light)",   color: "var(--blue)",           label: "Info" },
  // Velocity trends
  accelerating: { bg: "var(--green-light)",  color: "var(--green)",          label: "↑ Accelerating" },
  stable:       { bg: "var(--surface-2)",    color: "var(--text-secondary)", label: "→ Stable" },
  decelerating: { bg: "var(--red-light)",    color: "var(--red)",            label: "↓ Decelerating" },
};

export default function Badge({ type, label: overrideLabel }) {
  const s = styles[type] || { bg: "var(--surface-2)", color: "var(--text-secondary)", label: type };
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        padding: "2px 10px",
        borderRadius: 99,
        background: s.bg,
        color: s.color,
        fontSize: "var(--text-xs)",
        fontWeight: 600,
        whiteSpace: "nowrap",
      }}
    >
      {overrideLabel || s.label}
    </span>
  );
}
