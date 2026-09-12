import React from "react";

// Shared loading placeholder for pages fetching from the real backend
// (TASK-10). Matches the plain-CSS-variable styling used everywhere else -
// no spinner library, just a subtle pulsing dot.

export default function LoadingState({ label = "Loading…" }) {
  return (
    <div
      style={{
        display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
        gap: 10, padding: "80px 20px", color: "var(--text-muted)",
      }}
    >
      <div
        style={{
          width: 10, height: 10, borderRadius: "50%", background: "var(--blue)",
          animation: "loading-pulse 1s ease-in-out infinite",
        }}
      />
      <span style={{ fontSize: 13 }}>{label}</span>
      <style>{`
        @keyframes loading-pulse {
          0%, 100% { opacity: 0.3; transform: scale(0.85); }
          50% { opacity: 1; transform: scale(1.15); }
        }
      `}</style>
    </div>
  );
}
