import React from "react";

const styles = {
  in_stock:    { bg: "var(--green-light)",  color: "var(--green)",  label: "In Stock" },
  low_stock:   { bg: "var(--yellow-light)", color: "#b45309",       label: "Low Stock" },
  out_of_stock:{ bg: "var(--red-light)",    color: "var(--red)",    label: "Out of Stock" },
  overstock:   { bg: "var(--purple-light)", color: "var(--purple)", label: "Overstock" },
  critical:    { bg: "var(--red-light)",    color: "var(--red)",    label: "Critical" },
  warning:     { bg: "var(--yellow-light)", color: "#b45309",       label: "Warning" },
  info:        { bg: "var(--blue-light)",   color: "var(--blue)",   label: "Info" },
};

export default function Badge({ type }) {
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
      }}
    >
      {s.label}
    </span>
  );
}
