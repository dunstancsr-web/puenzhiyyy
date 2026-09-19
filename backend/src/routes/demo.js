const express = require("express");
const router = express.Router();
const { enterDemoMode, exitDemoMode, isDemoModeActive, isInDemoContext, getDb } = require("../db/init");

// ─────────────────────────────────────────────────────────────────────────────
// DEMO MODE (MVP2 Day 7). Three small routes managing the shared in-memory
// sandbox — see db/init.js for the actual switching mechanism. No PIN, no
// login: Stan is the one demoing this live, and it can never reach the real
// database regardless of who clicks it (rules.md's "Working rules" gate on
// paid model spend, not on this — nothing here costs anything).
// ─────────────────────────────────────────────────────────────────────────────

const COOKIE_NAME = "stocksense_demo";
// No httpOnly: the frontend badge reads this cookie's presence isn't actually
// needed client-side (status comes from GET /demo/status), but keeping it
// readable costs nothing and avoids ever needing document.cookie tricks later.
const COOKIE_OPTS = { sameSite: "lax", path: "/" };

router.post("/demo/enter", (req, res) => {
  enterDemoMode();
  res.cookie(COOKIE_NAME, "1", COOKIE_OPTS);
  res.json({ success: true, data: { active: true } });
});

router.post("/demo/exit", (req, res) => {
  // Shared, not per-visitor (see db/init.js): exiting ends the sandbox for
  // anyone else currently in it too, matching "Stan is the one demoing this
  // live" rather than pretending this is a private session.
  exitDemoMode();
  res.clearCookie(COOKIE_NAME, { path: "/" });
  res.json({ success: true, data: { active: false } });
});

router.get("/demo/status", (req, res) => {
  const cookies = req.headers.cookie || "";
  const hasCookie = cookies.split(";").map((c) => c.trim()).includes(`${COOKIE_NAME}=1`);
  res.json({ success: true, data: { active: hasCookie && isDemoModeActive() } });
});

// Both catalog and sales rows depend on a shared PRNG consumed sequentially
// across all 10 SKUs in seed.js's own loop (see buildSales's comment there),
// so computing an accurate preview WITHOUT actually seeding would mean
// re-implementing that entire loop a second time, and the two copies could
// silently drift - exactly the "derived value computed twice" bug class this
// repo has already been bitten by more than once. Simpler and impossible to
// drift: since the demo sandbox is disposable by design (the banner says so),
// seed for real first, then read back exactly what's there. Top 3 only, not
// top-and-bottom (Stan's call, 18 Sep, simplifying the earlier "top three and
// bottom three"): a straight slice, not two halves with a divider row.
function sampleDataPreview(db) {
  const catalog = db.prepare(`
    SELECT sku_id, product_name, lead_time_days, reorder_point_policy, target_stock
      FROM skus WHERE active = 1 ORDER BY sku_id`).all();
  const sales = db.prepare(`
    SELECT sku_id, quantity_mt, sale_date, customer, channel, status
      FROM sales_transactions ORDER BY sale_date, id`).all();
  // Stock IN, alongside sales' stock OUT (Stan's ask, 18 Sep): seed.js used to
  // wipe goods_movements every run but never write to it, so this table was
  // always empty before now - see the RECEIPT-generation block added to
  // seed.js the same session. movement_type is fixed to RECEIPT here on
  // purpose: ISSUE rows exist in the schema for the Goods Out flow, but that
  // flow has no screens yet (rules.md: "describe what the running app does"),
  // so seeding sample ISSUE rows would preview a workflow nobody can use yet.
  // `reference` is now a real po_number with a matching, status='received'
  // purchase_orders row (seed.js) - it used to be a fabricated string that
  // matched nothing, which POST /warehouse/inbound/receive could never
  // actually have produced (that endpoint refuses a receipt without a
  // matching OPEN po_number). Caught from Stan asking directly.
  const receipts = db.prepare(`
    SELECT sku_id, movement_no, reference, expected_qty, actual_qty, variance_qty, created_at
      FROM goods_movements WHERE movement_type = 'RECEIPT' ORDER BY created_at, id`).all();
  const pick3 = (rows) => rows.slice(0, 3);
  return {
    catalogCount: catalog.length,
    catalogSample: pick3(catalog),
    salesCount: sales.length,
    salesSample: pick3(sales),
    receiptsCount: receipts.length,
    receiptsSample: pick3(receipts),
  };
}

// Trims the demo sandbox down to a smaller catalog for onboarding's own walk-
// through (Stan's call, 18 Sep: "let's keep it simple and do 5 SKUs for now
// too" - scoped to this sample-data path only, not the master 10-SKU dataset
// seed.js builds and every other verification in this app assumes). Deletes
// rows outright rather than marking the other 5 SKUs inactive: sales,
// receipts and purchase_orders don't carry an active flag of their own, so
// they'd still be summed into totals for SKUs the catalog no longer shows.
// audit_log is skipped: its sku_id is nullable (events with no SKU exist),
// and trimming a demo sandbox's audit trail isn't what this is for.
const SAMPLE_CATALOG_SIZE = 5;
function trimSampleCatalog(db) {
  const keep = db.prepare(`SELECT sku_id FROM skus ORDER BY id LIMIT ?`).all(SAMPLE_CATALOG_SIZE).map((r) => r.sku_id);
  const placeholders = keep.map(() => "?").join(",");
  const tables = [
    "inventory_positions", "sales_transactions", "purchase_orders", "alerts_log",
    "decisions", "forecasts", "sales_orders", "goods_movements", "inventory_history",
    "order_requests",
  ];
  for (const t of tables) {
    db.prepare(`DELETE FROM ${t} WHERE sku_id NOT IN (${placeholders})`).run(...keep);
  }
  db.prepare(`DELETE FROM skus WHERE sku_id NOT IN (${placeholders})`).run(...keep);
}

// Fills the sandbox with the same 10-SKU dataset `npm run seed` builds for the
// real database — safe here specifically because seed()'s own getDb() call
// resolves to whatever database THIS request is running against, and
// isInDemoContext() (checked, not just the cookie) refuses to run at all
// unless that's the demo sandbox. Lets someone exploring the demo skip past
// onboarding's upload step instead of needing a CSV on hand. Returns the
// preview shape above alongside success, so the frontend can show exactly
// what landed without a second round trip.
router.post("/demo/seed-sample", (req, res) => {
  if (!isInDemoContext()) {
    return res.status(403).json({ success: false, message: "Sample data can only be seeded in demo mode." });
  }
  try {
    require("../db/seed").seed();
    trimSampleCatalog(getDb());
    res.json({ success: true, data: sampleDataPreview(getDb()) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Failed to seed sample data" });
  }
});

module.exports = router;
module.exports.COOKIE_NAME = COOKIE_NAME;
