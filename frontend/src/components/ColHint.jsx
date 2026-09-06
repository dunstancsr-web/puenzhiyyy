import React from "react";
import { HelpCircle } from "lucide-react";
import HoverHint from "./HoverHint";
import { HINT_HDR_STYLE, HINT_BODY_STYLE } from "./hintStyles";

// ─────────────────────────────────────────────────────────────────────────────
// Column-header help popover. Thin composition over HoverHint: an ⓘ trigger
// (turns blue while open, never triggers the column sort) + the two-section
// "What is this? / How to read it" body.
// ─────────────────────────────────────────────────────────────────────────────

export default function ColHint({ label, what, how }) {
  return (
    <HoverHint
      panelWidth={320}
      content={
        <>
          <div style={HINT_HDR_STYLE}>What is this?</div>
          <div style={{ ...HINT_BODY_STYLE, marginBottom: 12, whiteSpace: "normal", overflowWrap: "anywhere" }}>
            {what}
          </div>
          <div style={HINT_HDR_STYLE}>How to read it</div>
          <div style={{ ...HINT_BODY_STYLE, whiteSpace: "pre-line" }}>{how}</div>
        </>
      }
    >
      {({ open }) => (
        <button
          type="button"
          aria-label={`About ${label}`}
          onClick={(e) => e.stopPropagation()}
          style={{
            display: "inline-flex", alignItems: "center", justifyContent: "center",
            padding: 0, background: "none", border: "none", cursor: "help", lineHeight: 0,
          }}
        >
          <HelpCircle size={12} color={open ? "var(--blue)" : "var(--text-muted)"} aria-hidden style={{ flexShrink: 0 }} />
        </button>
      )}
    </HoverHint>
  );
}
