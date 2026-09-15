// ─────────────────────────────────────────────────────────────────────────────
// ABC × XYZ SEGMENTATION ENGINE
//   ABC — Pareto on annual consumption value (30 day average daily usage × 365 × unit cost)
//         A: cumulative ≤ 80%   B: ≤ 95%   C: remainder
//   XYZ — demand predictability by coefficient of variation
//         X: cv < 0.25   Y: 0.25–0.5   Z: > 0.5
// The 3×3 matrix sets inventory policy: AX gets lean stock + tight review,
// CZ / BZ get fat safety stock and slow reorder cycles.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @param {Array<{ sku_id, annual_cogs, demand_cv }>} rows
 * @returns {Map<string, { abc_class, xyz_class }>}
 */
function segmentPortfolio(rows) {
  const out = new Map();

  const sorted = [...rows].sort((a, b) => b.annual_cogs - a.annual_cogs);
  const total = sorted.reduce((s, r) => s + r.annual_cogs, 0) || 1;

  let cumulative = 0;
  for (const r of sorted) {
    cumulative += r.annual_cogs;
    const pct = cumulative / total;
    const abc_class = pct <= 0.8 ? "A" : pct <= 0.95 ? "B" : "C";
    const xyz_class = r.demand_cv < 0.25 ? "X" : r.demand_cv <= 0.5 ? "Y" : "Z";
    out.set(r.sku_id, { abc_class, xyz_class });
  }
  return out;
}

// Movement columns in the order a planner reads them, fastest to dead. Ids
// are terse so a cell key stays legible ("A:Fast").
const MOVEMENT_COLS = [
  { id: "Fast",   movement: "Fast Moving" },
  { id: "Normal", movement: "Normal" },
  { id: "Slow",   movement: "Slow Moving" },
  { id: "Idle",   movement: "Idle" },
];
const movementCode = (m) => {
  const hit = MOVEMENT_COLS.find((c) => c.movement === m);
  return hit ? hit.id : null;
};

/**
 * ABC (economic value) × movement class (velocity), as a count + inventory
 * value per cell.
 *
 * This is the pairing the domain spec actually prescribes: Step 8A item 7,
 * "Combine ABC class with Fast/Normal/Slow/Idle for management action", with
 * its A+fast / A+idle / C+fast / C+idle interpretation table.
 *
 * It replaces an earlier ABC × XYZ matrix (2026-09-13). XYZ appears nowhere
 * in the technical spec, the glossary or the terminology map - it was written
 * in code first and back-filled into requirements.md afterwards - and on a
 * 10-SKU portfolio it left 5 of 9 cells empty, including both AZ and BZ, the
 * very cells the widget's own caption told you to act on. xyz_class is still
 * computed above (REQ-14 documents it, and the Inventory table shows it), it
 * just no longer drives this matrix.
 *
 * @param {Array<{ abc_class, movement_class, inventory_value, sku_id }>} skus
 */
function buildMatrix(skus) {
  const rows = ["A", "B", "C"];
  const cols = MOVEMENT_COLS.map((c) => c.id);
  const cells = {};
  rows.forEach((r) => cols.forEach((c) => (cells[`${r}:${c}`] = { count: 0, value: 0, skus: [] })));

  for (const s of skus) {
    const code = movementCode(s.movement_class);
    if (!code) continue;
    const key = `${s.abc_class}:${code}`;
    if (!cells[key]) continue;
    cells[key].count += 1;
    cells[key].value += s.inventory_value;
    cells[key].skus.push(s.sku_id);
  }
  return { rows, cols, cells };
}

module.exports = { segmentPortfolio, buildMatrix, movementCode };
