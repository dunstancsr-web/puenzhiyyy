// ─────────────────────────────────────────────────────────────────────────────
// AUDIT LOG (TASK-31)
//
// The `audit_log` table has existed since db/init.js was written, with a comment
// naming the events it was meant to hold. Nothing ever wrote to it. This module
// is the missing write path.
//
// Observability is a scored submission criterion, so the point is not just that
// rows exist: the log has to answer "what did the system do, on what input, and
// what did a human do about it" without reading the source. Every event
// therefore stores its INPUT (what the system saw) and its OUTPUT (what it did
// or what changed), both as JSON.
//
// Design rule: logging is best-effort and MUST NOT break the request it is
// observing. A failed insert is swallowed and reported to the server log only.
// An audit trail that can 500 the restock it is recording is worse than none.
// ─────────────────────────────────────────────────────────────────────────────

const { getDb } = require("./init");

// The closed set of things worth recording. Kept as a frozen map rather than
// loose strings so a typo at a call site is a crash in dev, not a silent event
// type that never shows up in any filter.
const EVENTS = Object.freeze({
  SKU_CREATED: "SKU_CREATED",
  SKU_UPDATED: "SKU_UPDATED",
  RESTOCK: "RESTOCK",
  ALERT_TRIGGERED: "ALERT_TRIGGERED",
  ALERT_ACKNOWLEDGED: "ALERT_ACKNOWLEDGED",
  DECISION_RECORDED: "DECISION_RECORDED",
  // Switching into or out of the metered model tier is a spending decision, so
  // it is recorded like any other decision rather than living only in memory.
  LLM_MODE_CHANGED: "LLM_MODE_CHANGED",
  // Since TASK-90 the tier is per visitor, so nothing emits LLM_MODE_CHANGED
  // any more; it stays so older rows still read. The spending decision is now
  // a visitor unlocking the paid tier with the demo PIN, and the security
  // event worth a person's attention is a client getting locked out.
  LLM_UNLOCKED: "LLM_UNLOCKED",
  LLM_UNLOCK_LOCKED_OUT: "LLM_UNLOCK_LOCKED_OUT",
  // Physical movements from the warehouse floor. These are the most
  // consequential writes in the system, since they change what is actually in
  // the building, so they carry the operator and any variance reason.
  GOODS_RECEIVED: "GOODS_RECEIVED",
  GOODS_ISSUED: "GOODS_ISSUED",
  // One row per model explanation (TASK-11), failed attempts included, with
  // tokens and call count. scripts/spend.js prices paid spend from these rows.
  LLM_CALL: "LLM_CALL",
});

// JSON.stringify can throw (circular refs) and can return undefined (for a bare
// `undefined` input). Both would put junk in the column, so normalise here.
function encode(value) {
  if (value === undefined || value === null) return null;
  try {
    const s = JSON.stringify(value);
    return s === undefined ? null : s;
  } catch {
    return JSON.stringify({ unserializable: true });
  }
}

/**
 * Record one event. Best-effort: never throws, returns the new row id or null.
 *
 * @param {string} eventType  one of EVENTS
 * @param {object} opts
 * @param {string} [opts.skuId]   the SKU this concerns, if any
 * @param {*}      [opts.input]   what the system was given / what it saw
 * @param {*}      [opts.output]  what it produced / what changed
 */
function logEvent(eventType, { skuId = null, input, output } = {}) {
  try {
    const info = getDb()
      .prepare(
        `INSERT INTO audit_log (event_type, sku_id, input_data, output_data)
         VALUES (?, ?, ?, ?)`
      )
      .run(eventType, skuId, encode(input), encode(output));
    return info.lastInsertRowid;
  } catch (err) {
    console.error(`[audit] failed to record ${eventType}:`, err.message);
    return null;
  }
}

// Parse a stored column back to a value. A row written before a schema change,
// or by hand, may not be valid JSON, so fall back to the raw string rather than
// failing the whole read.
function decode(raw) {
  if (raw == null) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

/**
 * Read the trail, most recent first.
 *
 * @param {object} [filters]
 * @param {string} [filters.eventType]  exact event_type match
 * @param {string} [filters.skuId]      exact sku_id match
 * @param {number} [filters.limit]      default 200, hard-capped at 1000 so a
 *                                      long-lived log cannot blow up a response
 */
function readEvents({ eventType, skuId, limit } = {}) {
  const where = [];
  const params = {};
  if (eventType) {
    where.push("a.event_type = @eventType");
    params.eventType = eventType;
  }
  if (skuId) {
    where.push("a.sku_id = @skuId");
    params.skuId = skuId;
  }

  const n = Number(limit);
  params.limit = Number.isFinite(n) && n > 0 ? Math.min(Math.floor(n), 1000) : 200;

  const rows = getDb()
    .prepare(
      `SELECT a.*, s.product_name AS sku_name
         FROM audit_log a
         LEFT JOIN skus s ON s.sku_id = a.sku_id
        ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
        ORDER BY a.id DESC
        LIMIT @limit`
    )
    .all(params);

  return rows.map((r) => ({
    ...r,
    input_data: decode(r.input_data),
    output_data: decode(r.output_data),
  }));
}

// Counts per event type across the whole table (not just the returned page), so
// the UI can show filter chips with real totals instead of counting a slice.
function eventCounts() {
  const rows = getDb()
    .prepare(`SELECT event_type, COUNT(*) AS count FROM audit_log GROUP BY event_type`)
    .all();
  return Object.fromEntries(rows.map((r) => [r.event_type, r.count]));
}

/**
 * Compare a SKU's fields before and after an update, returning only what moved.
 * Used to make SKU_UPDATED useful: "this row changed" is not observability,
 * "reorder point went 280 -> 302" is.
 *
 * Values are compared loosely on their Number form where both sides are
 * numeric, so a form posting the string "302" against a stored 302 does not
 * register as a change.
 */
function diffFields(before, after, fields) {
  const changes = {};
  for (const k of fields) {
    if (after[k] === undefined) continue;
    const a = before ? before[k] : undefined;
    const b = after[k];
    const bothNumeric = a !== null && a !== "" && b !== null && b !== "" &&
      Number.isFinite(Number(a)) && Number.isFinite(Number(b));
    const same = bothNumeric ? Number(a) === Number(b) : String(a ?? "") === String(b ?? "");
    if (!same) changes[k] = { from: a ?? null, to: bothNumeric ? Number(b) : b };
  }
  return changes;
}

module.exports = { EVENTS, logEvent, readEvents, eventCounts, diffFields };
