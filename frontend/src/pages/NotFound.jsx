import React from "react";
import { Link } from "react-router-dom";
import { Compass } from "lucide-react";

// Any address the app does not know. Until 20 Sep such an address rendered nothing at all (an empty page with
// no way out), which reads as a crash. One primary action, and the address that was asked for is shown so a
// mistyped or outdated link is easy to spot.
export default function NotFound() {
  return (
    <div style={{ minHeight: "calc(100vh - var(--demo-banner-height))", display: "flex", alignItems: "center", justifyContent: "center", padding: "32px 20px", background: "var(--bg)" }}>
      <div className="card" style={{ maxWidth: 480, width: "100%", padding: "32px 28px", textAlign: "center" }}>
        <Compass size={28} color="var(--text-muted)" aria-hidden="true" />
        <h1 style={{ fontSize: "var(--text-xl)", fontWeight: 700, margin: "12px 0 6px" }}>That page does not exist</h1>
        <p style={{ fontSize: "var(--text-base)", color: "var(--text-secondary)", lineHeight: 1.5, margin: "0 0 6px" }}>
          The address may be mistyped, or the page may have moved.
        </p>
        <p style={{ fontSize: "var(--text-sm)", color: "var(--text-muted)", margin: "0 0 22px", overflowWrap: "anywhere" }}>
          {typeof window !== "undefined" ? window.location.pathname : ""}
        </p>
        <div style={{ display: "flex", gap: 10, justifyContent: "center", flexWrap: "wrap" }}>
          <Link to="/" style={{ padding: "12px 20px", borderRadius: "var(--radius)", fontSize: "var(--text-base)", fontWeight: 600, background: "var(--blue-strong)", color: "#fff", textDecoration: "none" }}>
            Go to Home
          </Link>
          <Link to="/dashboard" style={{ padding: "12px 20px", borderRadius: "var(--radius)", fontSize: "var(--text-base)", fontWeight: 600, background: "var(--card-bg)", color: "var(--text-secondary)", border: "1px solid var(--border)", textDecoration: "none" }}>
            Open the Dashboard
          </Link>
        </div>
      </div>
    </div>
  );
}
