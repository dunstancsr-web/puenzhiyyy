# MVP 1 — Inventory Visibility: Design

## Architecture Overview

```
SQLite DB (stocksense.db)
       ↓
Express API (port 4000)
  ├── /api/skus
  ├── /api/dashboard/stats
  ├── /api/alerts
  ├── /api/inventory
  └── /api/sales/velocity
       ↓
React Frontend (port 5173)
  ├── Dashboard page
  ├── Inventory page
  └── Alerts page
```

All computation happens in the backend. The frontend only renders.

---

## Database Schema

### Table: skus
```sql
CREATE TABLE skus (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  sku_id           TEXT UNIQUE NOT NULL,
  product_name     TEXT NOT NULL,
  rice_variety     TEXT,
  grade            TEXT,
  country_of_origin TEXT,
  brand            TEXT,
  packaging_size   TEXT,
  uom              TEXT DEFAULT 'MT',
  supplier         TEXT,
  min_order_qty    REAL DEFAULT 0,
  reorder_point    REAL DEFAULT 0,
  min_stock        REAL DEFAULT 0,
  target_stock     REAL DEFAULT 0,
  max_stock        REAL DEFAULT 0,
  safety_stock_pct REAL DEFAULT 20,
  lead_time_days   INTEGER DEFAULT 45,
  unit_cost_sgd    REAL DEFAULT 0,
  max_holding_days INTEGER DEFAULT 270,
  active           INTEGER DEFAULT 1,
  created_at       TEXT DEFAULT (datetime('now'))
);
```

### Table: inventory_positions
```sql
CREATE TABLE inventory_positions (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  sku_id           TEXT NOT NULL,
  physical_stock   REAL DEFAULT 0,
  reserved_qty     REAL DEFAULT 0,
  quality_hold_qty REAL DEFAULT 0,
  last_received_date TEXT,
  last_updated     TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (sku_id) REFERENCES skus(sku_id)
);
```

### Table: sales_transactions
```sql
CREATE TABLE sales_transactions (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  sku_id       TEXT NOT NULL,
  quantity_mt  REAL NOT NULL,
  sale_date    TEXT NOT NULL,
  customer     TEXT,
  channel      TEXT,
  status       TEXT DEFAULT 'fulfilled',
  FOREIGN KEY (sku_id) REFERENCES skus(sku_id)
);
```

### Table: purchase_orders
```sql
CREATE TABLE purchase_orders (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  po_number        TEXT UNIQUE,
  sku_id           TEXT NOT NULL,
  ordered_qty      REAL,
  order_date       TEXT,
  eta              TEXT,
  status           TEXT DEFAULT 'open',
  FOREIGN KEY (sku_id) REFERENCES skus(sku_id)
);
```

### Table: alerts_log
```sql
CREATE TABLE alerts_log (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  sku_id            TEXT NOT NULL,
  alert_type        TEXT NOT NULL,
  severity          TEXT NOT NULL,
  message           TEXT,
  recommended_action TEXT,
  triggered_value   REAL,
  threshold_value   REAL,
  acknowledged      INTEGER DEFAULT 0,
  triggered_at      TEXT DEFAULT (datetime('now'))
);
```

---

## Backend File Structure

```
backend/src/
├── db/
│   ├── init.js          # creates tables, runs on startup
│   └── seed.js          # inserts 10 rice SKUs + 6 months of mock sales
├── engines/
│   ├── velocity.js      # calculates sales velocity per SKU
│   ├── health.js        # assigns GREEN/YELLOW/ORANGE/RED per SKU
│   ├── classification.js # assigns Fast/Normal/Slow/Idle per SKU
│   └── alerts.js        # generates alerts from health + classification
├── routes/
│   ├── skus.js
│   ├── inventory.js
│   ├── alerts.js
│   ├── sales.js
│   └── dashboard.js
└── index.js
```

---

## Key Computation Logic

### Available Stock
```
available = physical_stock - reserved_qty - quality_hold_qty
```

### Sales Velocity
```
sales_30d = SUM(quantity) WHERE sale_date >= today - 30
avg_daily_30d = sales_30d / 30

velocity_trend:
  if avg_daily_30d > avg_daily_90d * 1.10 → "accelerating"
  if avg_daily_30d < avg_daily_90d * 0.90 → "decelerating"
  else → "stable"
```

### Days of Stock
```
days_of_stock = available_stock / avg_daily_30d
(null if avg_daily_30d = 0)
```

### Health Status (evaluated in order)
```
RED    if days_of_stock < lead_time_days
       OR inventory_age > max_holding_days
ORANGE if days_of_stock < (lead_time_days * 1.5)
       OR physical_stock > max_stock
YELLOW if movement_class = "Slow Moving"
       OR days_of_stock < target_days
GREEN  otherwise
```

### Movement Classification
```
Idle        if no sales in 90 days
Slow Moving if avg_daily_30d > 0 AND days_of_stock > 120
Fast Moving if avg_daily_30d >= p75 of all active SKUs
Normal      otherwise
```

---

## Seed Data Plan (10 Rice SKUs)

| SKU ID     | Product                  | Variety           | Origin    | Supplier          |
|------------|--------------------------|-------------------|-----------|-------------------|
| TJ-25KG    | Thai Jasmine 25KG        | Thai Hom Mali     | Thailand  | Supplier ABC TH   |
| TJ-10KG    | Thai Jasmine 10KG        | Thai Hom Mali     | Thailand  | Supplier ABC TH   |
| VF-25KG    | Vietnam Fragrant 25KG    | Vietnamese Fragrant | Vietnam | Supplier DEF VN   |
| VF-10KG    | Vietnam Fragrant 10KG    | Vietnamese Fragrant | Vietnam | Supplier DEF VN   |
| BM-5KG     | Basmati Premium 5KG      | Basmati           | India     | Supplier GHI IN   |
| BM-25KG    | Basmati Bulk 25KG        | Basmati           | India     | Supplier GHI IN   |
| JP-5KG     | Japonica Short Grain 5KG | Japonica          | Japan     | Supplier JKL JP   |
| TW-25KG    | Thai White Rice 25KG     | Thai White        | Thailand  | Supplier ABC TH   |
| PH-25KG    | Philippine Sinandomeng   | Sinandomeng       | Philippines | Supplier MNO PH |
| BR-10KG    | Brown Rice Organic 10KG  | Brown             | Thailand  | Supplier ABC TH   |

Seed data should include:
- 180 days of sales transactions per SKU (varying volumes to create velocity patterns)
- Deliberate scenarios: TJ-25KG near stockout, VF-10KG overstocked, JP-5KG idle >90 days, BM-5KG ageing

---

## Frontend Page Designs

### Dashboard
- Top: 7 KPI stat cards in a responsive grid
- Middle: 2 charts side by side (health pie + stockout risk bar)
- Bottom left: Top 8 alerts table
- Bottom right: Ageing inventory list

### Inventory Page
- Header with search + filters
- Full SKU table with: name, variety, origin, physical stock, available stock, days of stock, movement class, health badge, actions
- Restock modal
- Add SKU modal

### Alerts Page
- Summary count cards (one per alert type)
- Filter tabs
- Alert cards with left colour border by severity
- Acknowledge button per alert
