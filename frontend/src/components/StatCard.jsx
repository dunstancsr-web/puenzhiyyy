import React from "react";

export default function StatCard({ label, value, icon: Icon, color = "blue", sub, target, trend }) {
  const colors = {
    blue:   { bg: "var(--blue-light)",   icon: "var(--blue)",   border: "#bfdbfe" },
    green:  { bg: "var(--green-light)",  icon: "var(--green)",  border: "#bbf7d0" },
    yellow: { bg: "var(--yellow-light)", icon: "var(--yellow)", border: "#fde68a" },
    red:    { bg: "var(--red-light)",    icon: "var(--red)",    border: "#fecaca" },
    purple: { bg: "var(--purple-light)", icon: "var(--purple)", border: "#ddd6fe" },
  };
  const c = colors[color] || colors.blue;

  return (
    <div
      style={{
        background: "var(--card-bg)",
        border: "1px solid var(--border)",
        borderRadius: "var(--radius-lg)",
        padding: "20px 24px",
        boxShadow: "var(--shadow)",
        display: "flex",
        alignItems: "flex-start",
        gap: 16,
      }}
    >
      <div
        style={{
          width: 44,
          height: 44,
          borderRadius: 10,
          background: c.bg,
          border: `1px solid ${c.border}`,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
        }}
      >
        <Icon size={20} color={c.icon} />
      </div>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 13, color: "var(--text-secondary)", fontWeight: 500 }}>
          {label}
        </div>
        <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginTop: 2, flexWrap: "wrap" }}>
          <div style={{ fontSize: 26, fontWeight: 700, color: "var(--text-primary)", lineHeight: 1.2 }}>
            {value}
          </div>
          {trend && (
            <span
              title="vs last month"
              style={{
                fontSize: 11,
                fontWeight: 700,
                color: trend.good ? "var(--green)" : "var(--red)",
                whiteSpace: "nowrap",
              }}
            >
              {trend.dir === "up" ? "▲" : trend.dir === "down" ? "▼" : "▬"} {trend.text}
            </span>
          )}
        </div>
        {sub && (
          <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 4 }}>{sub}</div>
        )}
        {target && (
          <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 3 }}>
            Target&nbsp;{target}
          </div>
        )}
      </div>
    </div>
  );
}
