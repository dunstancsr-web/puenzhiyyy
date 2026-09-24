import React from "react";

// ─────────────────────────────────────────────────────────────────────────────
// STOCKSENSE MARK (TASK-73)
//
// One definition, used by the sidebar and by Home, which previously drew the
// same tile twice with two different sizes and stroke weights.
//
// Redrawn to sit beside the client's seal. The two marks disagreed on three
// things at once: the seal is a SOLID STAMP (filled glyph, deep pigment), the
// old tile was a HAIRLINE DRAWING (2.2px strokes, bright #3b82f6). Side by side
// one looked pressed into the page and the other sketched on it.
//
// So: solid bars carry the mass, the rising line the product is already known
// by sits over them, and the blue deepens to #1d4ed8. The colour is the larger
// half of the fix, because #3b82f6 is brighter than the cinnabar #b3271e is
// deep, which meant the junior mark won the first glance.
//
// The blue stays blue rather than going neutral: it is the app's functional
// accent on the active nav item, the primary buttons and every chart series,
// so the header tile has to belong to that system.
// ─────────────────────────────────────────────────────────────────────────────

// The StockSense product mark. On the Puenzhiy brand the structural colour is
// Ink, so the tile is Ink rather than a tech blue. Name kept as MARK_BLUE to
// avoid churn at its import sites; the value is what carries the brand.
export const MARK_BLUE = "#1d2b2a";

// Sizes are set to the measured height of the text block each mark sits beside,
// so the tile is exactly as tall as the name plus its sub-line rather than
// floating at some fraction of it. Measured in the browser, not guessed:
//   Home     33px title + 23px tagline = 56
//   Sidebar  a 45px two-line block
// If either type size changes, these want remeasuring; a mark that is nearly
// the height of its text reads as a mistake, where matching reads as a lockup.
export default function AppMark({ size = 34 }) {
  const glyph = Math.round(size * 0.58);
  return (
    <span
      aria-hidden="true"
      style={{
        width: size, height: size, flexShrink: 0,
        display: "grid", placeItems: "center",
        // Read from a custom property so an ancestor can mute it without the
        // inline style winning. The sidebar credit dims the mark until it is
        // hovered; everywhere else the fallback keeps the brand blue.
        background: "var(--app-mark-bg, " + MARK_BLUE + ")",
        transition: "background 0.16s ease",
        // Same corner ratio as the seal, so the two tiles read as a pair
        // rather than as two unrelated squares that happen to be adjacent.
        borderRadius: Math.round(size * 0.24),
      }}
    >
      <svg width={glyph} height={glyph} viewBox="0 0 24 24" role="img">
        {/* The two rear bars are the same white at reduced opacity rather than
            a second colour: depth without widening the palette. */}
        <rect x="3" y="15" width="4.4" height="6" rx="1.2" fill="#fff" opacity="0.55" />
        <rect x="9.8" y="11" width="4.4" height="10" rx="1.2" fill="#fff" opacity="0.55" />
        <rect x="16.6" y="6" width="4.4" height="15" rx="1.2" fill="#fff" />
        <path d="M4 12.5 L11 8.5 L18.8 3.4" stroke="#fff" strokeWidth="2.4" fill="none"
          strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </span>
  );
}
