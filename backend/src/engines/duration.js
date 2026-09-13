// ─────────────────────────────────────────────────────────────────────────────
// DURATION FORMATTING
//
// One function, its own module. It started inside engines/index.js, but
// engines/alerts.js needs it too and index.js already requires alerts.js, so
// importing it back produced a circular dependency: node resolved
// `humanDuration` to undefined at call time and warned rather than threw, which
// would have surfaced as a crash on the first slow-moving alert.
//
// A pure helper shared by two modules belongs beside neither of them.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 278 -> "9 months and 8 days".  28 -> "28 days".  null -> null.
 *
 * Months are 30 days, matching months_of_cover in engines/index.js and the
 * definition in design.md, so the two can never disagree.
 */
function humanDuration(days) {
  // Number(null) is 0 and Number("") is 0, and both are finite, so a bare
  // Number.isFinite guard turns a MISSING duration into a confident "0 days".
  // An idle SKU has no days of cover at all (the glossary says report Not
  // Applicable, never a number), and "0 days of cover" reads as an emergency
  // rather than as an absence.
  if (days === null || days === undefined || days === "") return null;
  const d = Math.round(Number(days));
  if (!Number.isFinite(d) || d < 0) return null;
  if (d < 30) return `${d} day${d === 1 ? "" : "s"}`;
  const months = Math.floor(d / 30);
  const rest = d - months * 30;
  const m = `${months} month${months === 1 ? "" : "s"}`;
  return rest ? `${m} and ${rest} day${rest === 1 ? "" : "s"}` : m;
}

module.exports = { humanDuration };
