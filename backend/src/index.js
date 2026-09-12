const express = require("express");
const cors = require("cors");
const { initDb } = require("./db/init");

// Initialise database on startup (creates tables if not exist)
initDb();

const productRoutes = require("./routes/products");
const inventoryRoutes = require("./routes/inventory");

const app = express();
const PORT = process.env.PORT || 4000;

// Middleware
app.use(cors({ origin: "http://localhost:5173" }));
app.use(express.json());

// Routes
app.use("/api/products", productRoutes); // legacy in-memory demo store — unrelated to the SQLite schema below
app.use("/api", inventoryRoutes);        // real schema: /api/skus, /api/dashboard/stats, /api/alerts, /api/inventory/restock

// Health check
app.get("/api/health", (req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

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
  console.log(`Inventory Monitor API running at http://localhost:${PORT}`);
});
