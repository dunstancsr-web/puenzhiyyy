// ─────────────────────────────────────────────────────────────────────────────
// ABC × XYZ SEGMENTATION ENGINE
//   ABC — Pareto on annual consumption value (blended daily × 365 × unit cost)
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

/**
 * Build the 3×3 matrix summary (count + inventory value per cell).
 * @param {Array<{ abc_class, xyz_class, inventory_value, sku_id }>} skus
 */
function buildMatrix(skus) {
  const rows = ["A", "B", "C"];
  const cols = ["X", "Y", "Z"];
  const cells = {};
  rows.forEach((r) => cols.forEach((c) => (cells[`${r}${c}`] = { count: 0, value: 0, skus: [] })));

  for (const s of skus) {
    const key = `${s.abc_class}${s.xyz_class}`;
    if (!cells[key]) continue;
    cells[key].count += 1;
    cells[key].value += s.inventory_value;
    cells[key].skus.push(s.sku_id);
  }
  return { rows, cols, cells };
}

module.exports = { segmentPortfolio, buildMatrix };
