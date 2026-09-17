// ─────────────────────────────────────────────────────────────────────────────
// RISK BUFFER ENGINE (MVP2 Day 3)
//
// A deterministic SQL match against risk_events (db/init.js), never an LLM
// call — the model layer is only ever handed the matched event's label and
// severity to narrate, the same way it's already handed stockout_gap_days
// today; it never decides whether a buffer applies or how large it is.
//
// risk_events is a seeded, illustrative dataset (is_illustrative = 1 on every
// row), not a live feed — see db/seed.js and rules.md. Matches by
// country_of_origin OR supplier, summed and capped so one entry can't blow
// out a reorder point unboundedly.
// ─────────────────────────────────────────────────────────────────────────────

const MAX_BUFFER_DAYS = 30;

/**
 * @param {import('better-sqlite3').Database} db
 * @param {{country_of_origin: string, supplier: string}} sku
 * @returns {{ days: number, reason: string|null, events: object[] }}
 */
function computeRiskBuffer(db, sku) {
  const events = db.prepare(`
    SELECT label, severity, buffer_days_add
      FROM risk_events
     WHERE active = 1
       AND ((country_of_origin IS NOT NULL AND country_of_origin = @origin)
         OR (supplier IS NOT NULL AND supplier = @supplier))
     ORDER BY buffer_days_add DESC`
  ).all({ origin: sku.country_of_origin || null, supplier: sku.supplier || null });

  if (!events.length) return { days: 0, reason: null, events: [] };

  const days = Math.min(MAX_BUFFER_DAYS, events.reduce((sum, e) => sum + e.buffer_days_add, 0));
  // The highest-severity match names the reason: a portfolio manager reading
  // one sentence needs the thing that matters most, not every matching row.
  const reason = events[0].label;

  return { days: round1(days), reason, events };
}

const round1 = (n) => Math.round(n * 10) / 10;

module.exports = { computeRiskBuffer, MAX_BUFFER_DAYS };
