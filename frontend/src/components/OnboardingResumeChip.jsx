import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import { isMinimized } from "../lib/onboardingResume";

// ─────────────────────────────────────────────────────────────────────────────
// The "hop out and back in" half of onboarding's minimize control: a small
// fixed chip, mounted at the same App-root level as DemoModeBadge, so it
// survives navigating anywhere in the app after minimizing. Reads localStorage
// once on mount rather than polling — the only writer is Onboarding.jsx's own
// minimize/clear calls, both of which happen through a full navigation, so a
// fresh mount always sees the current value.
//
// Bottom-left on purpose: DemoModeBadge and the demo-mode screen glow both
// live at the top-right and along every edge, so this needed a corner of its
// own rather than competing for the same one.
// ─────────────────────────────────────────────────────────────────────────────

export default function OnboardingResumeChip() {
  const navigate = useNavigate();
  const [show, setShow] = useState(false);

  useEffect(() => { setShow(isMinimized()); }, []);

  if (!show) return null;

  return (
    <button onClick={() => navigate("/onboarding")} style={{
      position: "fixed", bottom: 18, left: 18, zIndex: 150,
      display: "flex", alignItems: "center", gap: 8, padding: "10px 16px", borderRadius: 99,
      border: "1px solid var(--blue)", background: "var(--card-bg)", color: "var(--blue)",
      fontSize: "var(--text-xs)", fontWeight: 700, cursor: "pointer", boxShadow: "var(--shadow-md)",
    }}>
      Continue setup <ArrowRight size={14} />
    </button>
  );
}
