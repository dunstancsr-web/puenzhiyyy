const express = require("express");
const cors = require("cors");
const path = require("path");
const { initDb, getDb } = require("./db/init");

// Initialise database on startup (creates tables if not exist)
initDb();

// Seed on first boot only. A deployed instance starts with an empty volume and
// would otherwise serve a dashboard with nothing on it, but a redeploy must not
// wipe a demo someone is part way through clicking. Guarded on the SKU count,
// so this is a no-op on every boot after the first.
function seedIfEmpty() {
  try {
    const { count } = getDb().prepare(`SELECT COUNT(*) AS count FROM skus`).get();
    if (count > 0) return;
    console.log("No SKUs found, seeding demo data...");
    require("./db/seed").seed();
  } catch (err) {
    // Never block startup on this. A server that boots with an empty database
    // is diagnosable; one that refuses to boot at all is not.
    console.error("Seed-on-boot failed:", err.message);
  }
}
seedIfEmpty();

const productRoutes = require("./routes/products");
const inventoryRoutes = require("./routes/inventory");
const warehouseRoutes = require("./routes/warehouse");

const app = express();
const PORT = process.env.PORT || 4000;
const isProduction = process.env.NODE_ENV === "production";

// Middleware
// In production the frontend is served from this same origin, so no cross
// origin request happens at all. CORS_ORIGIN stays configurable for the case of
// running the Vite dev server against a deployed API.
app.use(cors({ origin: process.env.CORS_ORIGIN || "http://localhost:5173" }));
app.use(express.json());

// Routes
app.use("/api/products", productRoutes); // legacy in-memory demo store, unrelated to the SQLite schema below
app.use("/api", inventoryRoutes);
app.use("/api", warehouseRoutes);       // warehouse floor: goods receipt and goods issue        // real schema: /api/skus, /api/dashboard/stats, /api/alerts, /api/inventory/restock

// Health check
app.get("/api/health", (req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// ── Static frontend (production only) ────────────────────────────────────────
// In development the Vite dev server serves the app on :5173 and proxies /api
// here (see frontend/vite.config.js). That proxy is a dev-server feature and
// does not exist in a production build, so a deployed instance serves the built
// assets from this process instead, putting API and UI on one origin.
//
// Registration order matters twice over. This block sits AFTER every /api route
// so it can never shadow one, and BEFORE the 404 handler, which would otherwise
// answer every page request before the SPA fallback was reached.
if (isProduction) {
  const distDir = path.join(__dirname, "../../frontend/dist");
  app.use(express.static(distDir));

  // SPA fallback: React Router owns the client-side routes, so a hard refresh
  // on a deep link such as /activity has to return index.html rather than a
  // 404. Scoped to GET requests that are not /api, so a mistyped API path still
  // gets a JSON 404 instead of a page of HTML.
  app.get(/^(?!\/api).*/, (req, res, next) => {
    if (req.method !== "GET") return next();
    res.sendFile(path.join(distDir, "index.html"));
  });
}

// 404 handler
app.use((req, res) => {
  res.status(404).json({ success: false, message: "Route not found" });
});

// Error handler
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ success: false, message: "Internal server error" });
});

app.listen(PORT, () => {
  console.log(`StockSense API running at http://localhost:${PORT}`);
  if (isProduction) console.log("Serving built frontend from frontend/dist");
});
