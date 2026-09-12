// ─────────────────────────────────────────────────────────────────────────────
// PROJECTED INVENTORY ENGINE (TASK-07, spec Step 12 / glossary #29)
//   Projected available(day) = Available today - (blended daily usage x day)
//                               + Σ open-PO qty landing on or before that day
// Flat-rate demand (no seasonality) — matches every other engine's demand
// model in this MVP. No confirmed-order netting (see design.md's documented
// inventory_position simplification — same limitation applies here).
//
// Reused two ways: the full curve backs GET /api/skus/:id/projection; a
// shorter run (days = lead_time_days) backs engines/index.js's
// suggested_order_qty ("projected position at receipt").
// ─────────────────────────────────────────────────────────────────────────────

const DAY_MS = 86_400_000;
const round = (n) => Math.round(n * 100) / 100;

/**
 * @param {object} p
 * @param {number} p.availableQty   current available stock (MT)
 * @param {number} p.dailyDemand    blended daily usage (MT/day), flat-rate
 * @param {Array<{ordered_qty:number, eta:string}>} p.openPos  open purchase orders
 * @param {number} [p.safetyStockMt]     for first_safety_breach_date
 * @param {number} [p.reorderPoint]      for recovery_date
 * @param {number} [p.days=90]
 * @param {Date|number} [p.asOf]
 */
function projectInventory({
  availableQty = 0,
  dailyDemand = 0,
  openPos = [],
  safetyStockMt = null,
  reorderPoint = null,
  days = 90,
  asOf = Date.now(),
}) {
  const startTime = asOf instanceof Date ? asOf.getTime() : asOf;

  // Bucket each open PO's quantity onto its ETA's day-offset (POs outside the
  // window or with no ETA don't affect this run's curve).
  const incomingByDay = new Map();
  for (const po of openPos) {
    if (!po.eta) continue;
    const offset = Math.round((new Date(po.eta).getTime() - startTime) / DAY_MS);
    if (offset >= 0 && offset <= days) {
      incomingByDay.set(offset, (incomingByDay.get(offset) || 0) + (Number(po.ordered_qty) || 0));
    }
  }

  const curve = [];
  let projected = availableQty;
  let firstStockoutDate = null;
  let firstSafetyBreachDate = null;
  // Seed with day 0's own date, not null — day 0 is a valid lowest point
  // (e.g. a flat zero-demand curve never dips below it), and the loop below
  // only overwrites `lowest` on a strictly-lower value, so a null seed here
  // left `lowest_date` blank for exactly that case.
  let lowest = { day: 0, date: new Date(startTime).toISOString().slice(0, 10), projected_available: projected };

  for (let day = 0; day <= days; day++) {
    if (day > 0) {
      projected = round(projected - dailyDemand + (incomingByDay.get(day) || 0));
    }
    const date = new Date(startTime + day * DAY_MS).toISOString().slice(0, 10);
    curve.push({ day, date, projected_available: projected });

    if (firstStockoutDate == null && projected <= 0) firstStockoutDate = date;
    if (firstSafetyBreachDate == null && safetyStockMt != null && projected < safetyStockMt) {
      firstSafetyBreachDate = date;
    }
    if (projected < lowest.projected_available) lowest = { day, date, projected_available: projected };
  }

  // Recovery: first day after the lowest point the curve climbs back to the
  // reorder point (only meaningful once a low point / breach has occurred).
  let recoveryDate = null;
  if (reorderPoint != null) {
    for (let i = lowest.day; i < curve.length; i++) {
      if (curve[i].projected_available >= reorderPoint) { recoveryDate = curve[i].date; break; }
    }
  }

  return {
    curve,
    first_stockout_date: firstStockoutDate,
    first_safety_breach_date: firstSafetyBreachDate,
    lowest_position: lowest.projected_available,
    lowest_date: lowest.date,
    recovery_date: recoveryDate,
  };
}

module.exports = { projectInventory };
