import React from "react";
import { HelpCircle } from "lucide-react";
import HoverHint from "./HoverHint";

// ─────────────────────────────────────────────────────────────────────────────
// Column-header help popover. Thin composition over HoverHint: an ⓘ trigger
// (turns blue while open, never triggers the column sort) + the two-section
// "What is this? / How to read it" body.
// ─────────────────────────────────────────────────────────────────────────────

// `term` (optional) is the industry name for a metric whose on-screen label
// has been written in plain English. It is the load-bearing half of that
// rename: an SME owner reads "Profit per $1 of Stock" and understands it, and
// anyone who already knows the trade finds "GMROI" in one hover. Without it a
// plain-English label reads as a project that did not know the real term.
export default function ColHint({ label, what, how, term }) {
  return (
    <HoverHint
      panelWidth={320}
      content={
        <>
          <div className="hint-panel__hdr">What is this?</div>
          <div className="hint-panel__body" style={{ marginBottom: how ? 12 : 0, whiteSpace: "normal", overflowWrap: "anywhere" }}>
            {what}
          </div>
          {/* Optional since TASK-78. The Home cards have one description
              rather than a what/how pair, and rendering an empty "How to read
              it" header under them would be a heading with nothing beneath. */}
          {how && (
            <>
              <div className="hint-panel__hdr">How to read it</div>
              <div className="hint-panel__body" style={{ whiteSpace: "pre-line" }}>{how}</div>
            </>
          )}
          {/* A footnote, not a third section. It gets no "hdr" of its own
              because it is one short line of provenance, and giving it the
              same weight as "What is this?" would imply the jargon is the
              point rather than the answer to it. */}
          {term && (
            <div style={{
              marginTop: 12, paddingTop: 8, borderTop: "1px solid var(--border)",
              fontSize: "var(--text-xs)", color: "var(--text-muted)",
            }}>
              Also called: {term}
            </div>
          )}
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
