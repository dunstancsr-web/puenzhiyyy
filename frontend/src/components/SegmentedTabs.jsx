import React from "react";

// A row of two or more views, one shown at a time (Apple's segmented control). Used where the choices are
// alternatives for looking at the same thing, not steps: Alerts uses it for Needs action | History.
// tabs: [{ id, label, Icon?, badge? }]. badge is a count of things waiting, shown only when above zero.
export default function SegmentedTabs({ tabs, value, onChange, ariaLabel, panelId }) {
  const move = (e) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    const i = tabs.findIndex((t) => t.id === value);
    const next = tabs[(i + (e.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length];
    onChange(next.id);
  };
  return (
    <div role="tablist" aria-label={ariaLabel} onKeyDown={move} style={{
      display: "inline-flex", padding: 3, gap: 2, borderRadius: 11, background: "var(--surface-2)", maxWidth: "100%",
    }}>
      {tabs.map(({ id, label, Icon, badge }) => {
        const on = value === id;
        return (
          <button key={id} type="button" role="tab" id={`tab-${panelId}-${id}`} aria-selected={on} aria-controls={panelId}
            tabIndex={on ? 0 : -1} onClick={() => onChange(id)} className="ms-btn" style={{
              display: "inline-flex", alignItems: "center", gap: 7, padding: "8px 16px", borderRadius: 9, border: "none",
              fontSize: "var(--text-sm)", fontWeight: 600, cursor: "pointer",
              background: on ? "var(--card-bg)" : "transparent",
              color: on ? "var(--text-primary)" : "var(--text-secondary)",
              boxShadow: on ? "var(--shadow)" : "none",
            }}>
            {Icon && <Icon size={15} aria-hidden />} {label}
            {badge > 0 && (
              <span aria-label={`${badge} waiting`} style={{
                minWidth: 18, height: 18, padding: "0 5px", borderRadius: 9, background: "var(--blue-strong)", color: "#fff",
                fontSize: "var(--text-xs)", fontWeight: 700, lineHeight: "18px", textAlign: "center",
              }}>{badge}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
