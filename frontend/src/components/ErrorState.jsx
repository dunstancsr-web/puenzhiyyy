import React from "react";
import { AlertTriangle } from "lucide-react";

// Shared "Failed to load" surface for pages fetching from the real backend
// (TASK-10 acceptance criterion: show an explicit error, never a blank screen).

export default function ErrorState({ message = "Failed to load.", onRetry }) {
  return (
    <div
      style={{
        display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
        gap: 12, padding: "60px 20px", textAlign: "center",
        background: "var(--red-light)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)",
      }}
    >
      <AlertTriangle size={22} color="var(--red)" />
      <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary)" }}>{message}</div>
      {onRetry && (
        <button
          onClick={onRetry}
          style={{
            padding: "7px 16px", borderRadius: "var(--radius)", fontSize: 12, fontWeight: 600,
            border: "1px solid var(--border)", background: "var(--surface)", color: "var(--text-primary)",
            cursor: "pointer",
          }}
        >
          Retry
        </button>
      )}
    </div>
  );
}
