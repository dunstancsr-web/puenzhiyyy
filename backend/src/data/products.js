const { v4: uuidv4 } = require("uuid");

// Stock status thresholds
const LOW_STOCK_THRESHOLD = 20;
const OVERSTOCK_THRESHOLD = 200;

// In-memory product store
let products = [
  {
    id: uuidv4(),
    name: "Wireless Headphones",
    sku: "WH-1001",
    category: "Electronics",
    currentStock: 8,
    minStock: 20,
    maxStock: 150,
    reorderPoint: 25,
    unitCost: 45.99,
    unitPrice: 89.99,
    supplier: "TechSupply Co.",
    lastRestocked: "2026-08-20",
    salesLast30Days: 62,
  },
  {
    id: uuidv4(),
    name: "USB-C Charging Cable",
    sku: "UC-2045",
    category: "Electronics",
    currentStock: 245,
    minStock: 30,
    maxStock: 200,
    reorderPoint: 40,
    unitCost: 4.5,
    unitPrice: 12.99,
    supplier: "CablePro Ltd.",
    lastRestocked: "2026-09-01",
    salesLast30Days: 18,
  },
  {
    id: uuidv4(),
    name: "Ergonomic Office Chair",
    sku: "EO-3012",
    category: "Furniture",
    currentStock: 14,
    minStock: 10,
    maxStock: 60,
    reorderPoint: 15,
    unitCost: 120.0,
    unitPrice: 249.99,
    supplier: "FurniWorld",
    lastRestocked: "2026-07-15",
    salesLast30Days: 9,
  },
  {
    id: uuidv4(),
    name: "Mechanical Keyboard",
    sku: "MK-4088",
    category: "Electronics",
    currentStock: 3,
    minStock: 15,
    maxStock: 100,
    reorderPoint: 20,
    unitCost: 55.0,
    unitPrice: 119.99,
    supplier: "TechSupply Co.",
    lastRestocked: "2026-08-01",
    salesLast30Days: 41,
  },
  {
    id: uuidv4(),
    name: "Notebook A5 Pack (5x)",
    sku: "NB-5500",
    category: "Stationery",
    currentStock: 310,
    minStock: 50,
    maxStock: 250,
    reorderPoint: 70,
    unitCost: 3.2,
    unitPrice: 8.99,
    supplier: "OfficeGear",
    lastRestocked: "2026-09-03",
    salesLast30Days: 7,
  },
  {
    id: uuidv4(),
    name: "Standing Desk Mat",
    sku: "SD-6601",
    category: "Furniture",
    currentStock: 55,
    minStock: 15,
    maxStock: 80,
    reorderPoint: 20,
    unitCost: 18.0,
    unitPrice: 39.99,
    supplier: "FurniWorld",
    lastRestocked: "2026-08-28",
    salesLast30Days: 23,
  },
  {
    id: uuidv4(),
    name: "Laptop Stand Aluminum",
    sku: "LS-7720",
    category: "Electronics",
    currentStock: 19,
    minStock: 20,
    maxStock: 120,
    reorderPoint: 25,
    unitCost: 22.0,
    unitPrice: 49.99,
    supplier: "TechSupply Co.",
    lastRestocked: "2026-08-10",
    salesLast30Days: 34,
  },
  {
    id: uuidv4(),
    name: "Ballpoint Pens Box (50x)",
    sku: "BP-8801",
    category: "Stationery",
    currentStock: 180,
    minStock: 40,
    maxStock: 150,
    reorderPoint: 55,
    unitCost: 5.0,
    unitPrice: 14.99,
    supplier: "OfficeGear",
    lastRestocked: "2026-07-30",
    salesLast30Days: 4,
  },
  {
    id: uuidv4(),
    name: "Webcam HD 1080p",
    sku: "WC-9900",
    category: "Electronics",
    currentStock: 0,
    minStock: 10,
    maxStock: 80,
    reorderPoint: 15,
    unitCost: 35.0,
    unitPrice: 79.99,
    supplier: "TechSupply Co.",
    lastRestocked: "2026-07-01",
    salesLast30Days: 28,
  },
  {
    id: uuidv4(),
    name: "Monitor Arm Dual",
    sku: "MA-1010",
    category: "Furniture",
    currentStock: 37,
    minStock: 8,
    maxStock: 50,
    reorderPoint: 12,
    unitCost: 40.0,
    unitPrice: 89.99,
    supplier: "FurniWorld",
    lastRestocked: "2026-09-02",
    salesLast30Days: 11,
  },
];

/**
 * Derive status from current stock vs thresholds.
 */
function getStockStatus(product) {
  if (product.currentStock === 0) return "out_of_stock";
  if (product.currentStock <= product.reorderPoint) return "low_stock";
  if (product.currentStock > product.maxStock) return "overstock";
  return "in_stock";
}

/**
 * Enrich a product with computed fields.
 */
function enrichProduct(p) {
  return {
    ...p,
    status: getStockStatus(p),
    stockValue: parseFloat((p.currentStock * p.unitCost).toFixed(2)),
    daysOfStock:
      p.salesLast30Days > 0
        ? Math.floor((p.currentStock / p.salesLast30Days) * 30)
        : null,
  };
}

module.exports = {
  getAll: () => products.map(enrichProduct),

  getById: (id) => {
    const p = products.find((p) => p.id === id);
    return p ? enrichProduct(p) : null;
  },

  create: (data) => {
    const newProduct = {
      id: uuidv4(),
      lastRestocked: new Date().toISOString().split("T")[0],
      salesLast30Days: 0,
      ...data,
    };
    products.push(newProduct);
    return enrichProduct(newProduct);
  },

  update: (id, data) => {
    const idx = products.findIndex((p) => p.id === id);
    if (idx === -1) return null;
    products[idx] = { ...products[idx], ...data, id };
    return enrichProduct(products[idx]);
  },

  remove: (id) => {
    const idx = products.findIndex((p) => p.id === id);
    if (idx === -1) return false;
    products.splice(idx, 1);
    return true;
  },

  restock: (id, quantity) => {
    const idx = products.findIndex((p) => p.id === id);
    if (idx === -1) return null;
    products[idx].currentStock += quantity;
    products[idx].lastRestocked = new Date().toISOString().split("T")[0];
    return enrichProduct(products[idx]);
  },

  getStats: () => {
    const all = products.map(enrichProduct);
    return {
      totalProducts: all.length,
      totalStockValue: parseFloat(
        all.reduce((sum, p) => sum + p.stockValue, 0).toFixed(2)
      ),
      outOfStock: all.filter((p) => p.status === "out_of_stock").length,
      lowStock: all.filter((p) => p.status === "low_stock").length,
      overstock: all.filter((p) => p.status === "overstock").length,
      inStock: all.filter((p) => p.status === "in_stock").length,
      categories: [...new Set(all.map((p) => p.category))],
    };
  },
};
