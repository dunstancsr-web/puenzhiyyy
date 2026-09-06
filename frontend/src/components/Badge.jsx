import React from "react";

const styles = {
  // Health statuses
  GREEN:        { bg: "#f0fdf4", color: "#16a34a", label: "Healthy" },
  YELLOW:       { bg: "#fffbeb", color: "#b45309", label: "Watch" },
  ORANGE:       { bg: "#fff7ed", color: "#c2410c", label: "Action Required" },
  RED:          { bg: "#fef2f2", color: "#dc2626", label: "Critical" },
  // Movement classes
  "Fast Moving":  { bg: "#eff6ff", color: "#2563eb", label: "Fast Moving" },
  "Normal":       { bg: "#f8fafc", color: "#475569", label: "Normal" },
  "Slow Moving":  { bg: "#fffbeb", color: "#b45309", label: "Slow Moving" },
  "Idle":         { bg: "#fef2f2", color: "#dc2626", label: "Idle" },
  // Ageing statuses
  Fresh:        { bg: "#f0fdf4", color: "#16a34a", label: "Fresh" },
  Normal_age:   { bg: "#f8fafc", color: "#475569", label: "Normal" },
  Ageing:       { bg: "#fffbeb", color: "#b45309", label: "Ageing" },
  "At Risk":    { bg: "#fef2f2", color: "#dc2626", label: "At Risk" },
  // Alert severities
  critical:     { bg: "#fef2f2", color: "#dc2626", label: "Critical" },
  warning:      { bg: "#fffbeb", color: "#b45309", label: "Warning" },
  info:         { bg: "#eff6ff", color: "#2563eb", label: "Info" },
  // Velocity trends
  accelerating: { bg: "#f0fdf4", color: "#16a34a", label: "↑ Accelerating" },
  stable:       { bg: "#f8fafc", color: "#475569", label: "→ Stable" },
  decelerating: { bg: "#fef2f2", color: "#dc2626", label: "↓ Decelerating" },
};

export default function Badge({ type, label: overrideLabel }) {
  const s = styles[type] || { bg: "#f1f5f9", color: "#64748b", label: type };
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        padding: "2px 10px",
        borderRadius: 99,
        background: s.bg,
        color: s.color,
        fontSize: 12,
        fontWeight: 600,
        whiteSpace: "nowrap",
      }}
    >
      {overrideLabel || s.label}
    </span>
  );
}
