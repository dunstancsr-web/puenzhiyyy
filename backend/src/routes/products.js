const express = require("express");
const router = express.Router();
const store = require("../data/products");

// GET /api/products — list all, with optional ?category= and ?status= filters
router.get("/", (req, res) => {
  let products = store.getAll();
  const { category, status, search } = req.query;

  if (category) {
    products = products.filter(
      (p) => p.category.toLowerCase() === category.toLowerCase()
    );
  }
  if (status) {
    products = products.filter((p) => p.status === status);
  }
  if (search) {
    const q = search.toLowerCase();
    products = products.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        p.sku.toLowerCase().includes(q) ||
        p.supplier.toLowerCase().includes(q)
    );
  }

  res.json({ success: true, count: products.length, data: products });
});

// GET /api/products/stats — summary stats for the dashboard
router.get("/stats", (req, res) => {
  res.json({ success: true, data: store.getStats() });
});

// GET /api/products/alerts — items that need attention
router.get("/alerts", (req, res) => {
  const products = store.getAll();
  const alerts = [];

  products.forEach((p) => {
    if (p.status === "out_of_stock") {
      alerts.push({
        productId: p.id,
        sku: p.sku,
        name: p.name,
        type: "out_of_stock",
        severity: "critical",
        message: `${p.name} is completely out of stock.`,
        currentStock: p.currentStock,
      });
    } else if (p.status === "low_stock") {
      alerts.push({
        productId: p.id,
        sku: p.sku,
        name: p.name,
        type: "low_stock",
        severity: "warning",
        message: `${p.name} is below reorder point (${p.currentStock} left, reorder at ${p.reorderPoint}).`,
        currentStock: p.currentStock,
        reorderPoint: p.reorderPoint,
      });
    } else if (p.status === "overstock") {
      alerts.push({
        productId: p.id,
        sku: p.sku,
        name: p.name,
        type: "overstock",
        severity: "info",
        message: `${p.name} exceeds max stock level (${p.currentStock} units, max ${p.maxStock}).`,
        currentStock: p.currentStock,
        maxStock: p.maxStock,
      });
    }

    // Slow-moving: less than 10 sales in 30 days but high stock
    if (
      p.salesLast30Days < 10 &&
      p.currentStock > p.minStock * 2 &&
      p.status !== "out_of_stock"
    ) {
      alerts.push({
        productId: p.id,
        sku: p.sku,
        name: p.name,
        type: "slow_moving",
        severity: "info",
        message: `${p.name} is slow-moving - only ${p.salesLast30Days} sales in last 30 days.`,
        currentStock: p.currentStock,
        salesLast30Days: p.salesLast30Days,
      });
    }
  });

  res.json({ success: true, count: alerts.length, data: alerts });
});

// GET /api/products/:id
router.get("/:id", (req, res) => {
  const product = store.getById(req.params.id);
  if (!product) return res.status(404).json({ success: false, message: "Product not found" });
  res.json({ success: true, data: product });
});

// POST /api/products — create a new product
router.post("/", (req, res) => {
  const required = ["name", "sku", "category", "currentStock", "unitCost", "unitPrice"];
  for (const field of required) {
    if (req.body[field] === undefined) {
      return res.status(400).json({ success: false, message: `Missing required field: ${field}` });
    }
  }
  const product = store.create(req.body);
  res.status(201).json({ success: true, data: product });
});

// PUT /api/products/:id — update product details
router.put("/:id", (req, res) => {
  const product = store.update(req.params.id, req.body);
  if (!product) return res.status(404).json({ success: false, message: "Product not found" });
  res.json({ success: true, data: product });
});

// PATCH /api/products/:id/restock — adjust stock quantity
router.patch("/:id/restock", (req, res) => {
  const { quantity } = req.body;
  if (!quantity || typeof quantity !== "number" || quantity <= 0) {
    return res.status(400).json({ success: false, message: "quantity must be a positive number" });
  }
  const product = store.restock(req.params.id, quantity);
  if (!product) return res.status(404).json({ success: false, message: "Product not found" });
  res.json({ success: true, data: product });
});

// DELETE /api/products/:id
router.delete("/:id", (req, res) => {
  const deleted = store.remove(req.params.id);
  if (!deleted) return res.status(404).json({ success: false, message: "Product not found" });
  res.json({ success: true, message: "Product deleted" });
});

module.exports = router;
