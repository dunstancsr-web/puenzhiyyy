# MVP 1 — Inventory Visibility: Requirements

## Overview
Replace spreadsheet-based rice inventory monitoring with a live dashboard.
The system must give management a real-time view of inventory health across all rice SKUs —
without requiring any AI/LLM. All logic is deterministic.

---

## Requirements

### REQ-01 — SQLite Data Layer
The system must store all inventory data in a SQLite database (via better-sqlite3).
The in-memory product store must be replaced entirely.

Acceptance criteria:
- Database file created at `backend/data/stocksense.db` on first run
- Schema covers: SKUs, inventory_batches, sales_transactions, purchase_orders
- Seed script populates at least 10 rice SKUs with realistic data
- Backend restarts without data loss

---

### REQ-02 — Rice SKU Master
Each SKU must capture rice-specific attributes.

Required fields:
- sku_id (unique)
- product_name
- rice_variety (e.g. Thai Hom Mali, Vietnamese Fragrant, Basmati)
- grade
- country_of_origin
- brand
- packaging_size (e.g. 5KG, 10KG, 25KG)
- uom (MT or KG)
- supplier
- min_order_qty
- reorder_point (MT)
- min_stock (MT)
- target_stock (MT)
- max_stock (MT)
- safety_stock_pct (%)
- lead_time_days (supplier stated)
- active (boolean)

---

### REQ-03 — Inventory Balance
The system must calculate available stock correctly.

Formula:
  available_stock = physical_stock − reserved_qty − quality_hold_qty

The API must return all three figures plus the derived available figure.

---

### REQ-04 — Sales Velocity
For every SKU, calculate rolling consumption over multiple windows.

Required windows:
- Last 30 days
- Last 60 days
- Last 90 days

Derived metrics:
- avg_daily_usage_30d = sales_30d / 30
- avg_daily_usage_90d = sales_90d / 90
- velocity_trend: "accelerating" | "stable" | "decelerating"
  (accelerating if 30d rate > 90d rate by >10%, decelerating if <10% below)

---

### REQ-05 — Months of Stock
Calculate how long current available stock will last.

Formula:
  days_of_stock = available_stock / avg_daily_usage_30d
  months_of_stock = days_of_stock / 30

Edge case: if avg_daily_usage_30d = 0, classify as Idle and set days_of_stock = null.

---

### REQ-06 — SKU Movement Classification
Every SKU must be automatically assigned a movement class.

Rules (configurable thresholds):
- Fast Moving:   avg_daily_usage_30d >= fast_threshold (default: top 25% of all SKUs)
- Normal:        between slow and fast thresholds
- Slow Moving:   avg_daily_usage_30d > 0 AND days_of_stock > 120
- Idle:          no sales in last 90 days

Movement class must update on every data refresh.

---

### REQ-07 — Inventory Health Status
Every SKU must receive a health status based on its stock position.

Rules:
- RED:    days_of_stock < lead_time_days  (stockout before replenishment possible)
          OR inventory_age of any batch > max_holding_days
- ORANGE: days_of_stock between lead_time_days and (lead_time_days + safety_stock_days)
          OR physical_stock > max_stock
- YELLOW: days_of_stock between (lead_time_days + safety_stock_days) and target_days
          OR movement_class = "Slow Moving"
- GREEN:  everything within normal range

---

### REQ-08 — Ageing Report
Track how long inventory has been held.

Per SKU (MVP 1 — no batch granularity yet):
- last_received_date
- inventory_age_days = today − last_received_date
- ageing_status: Fresh (0–90d) | Normal (91–180d) | Ageing (181–270d) | At Risk (271d+)

Thresholds are configurable per SKU; defaults above apply if not set.

---

### REQ-09 — Alert Engine
The system must generate typed alerts automatically.

Alert types:
- STOCKOUT_RISK:   days_of_stock < lead_time_days
- REORDER:         available_stock <= reorder_point
- OVERSTOCK:       physical_stock > max_stock
- SLOW_MOVING:     movement_class = "Slow Moving" AND days_of_stock > 120
- IDLE:            no sales in 90 days
- AGEING:          ageing_status = "Ageing" or "At Risk"

Each alert must include:
- alert_type
- severity (critical | warning | info)
- sku_id, sku_name
- current value that triggered it
- threshold that was breached
- plain-English message
- recommended_action (short text, rule-based — no LLM)
- triggered_at timestamp

---

### REQ-10 — Management Dashboard
The dashboard must answer key questions within 30 seconds of opening.

Required KPI cards:
- Total active SKUs
- Total inventory value (MT × unit cost)
- Average days of stock (portfolio)
- SKUs at RED status (count)
- SKUs at ORANGE status (count)
- Overstocked value ($)
- Slow-moving + idle inventory value ($)

Required charts:
- Inventory health distribution (pie: GREEN / YELLOW / ORANGE / RED counts)
- Top 5 stockout risk SKUs (bar: days of stock remaining)
- Movement classification breakdown (bar: Fast / Normal / Slow / Idle counts)

Required tables:
- Top alerts (most critical first, max 8 rows on dashboard)
- Ageing inventory summary (SKUs with ageing_status = Ageing or At Risk)

---

### REQ-11 — Inventory Table Page
Full product list with filtering, sorting, and inline health indicators.

Features:
- Search by SKU name, variety, supplier
- Filter by: movement class, health status, country of origin
- Sort by: any column
- Inline stock bar showing physical vs max stock
- Health status badge (colour-coded)
- Restock modal (add quantity)
- Add new SKU form

---

### REQ-12 — Alerts Page
Dedicated page showing all active alerts.

Features:
- Filter tabs by alert type
- Sort by severity (critical first)
- Each alert card shows: SKU name, alert type, severity badge, triggered value, threshold, plain-English message, recommended action
- Manual dismiss (marks alert as acknowledged, does not delete)

---

### REQ-13 — API Structure
All data served via REST API from Express backend.

Required endpoints:
- GET  /api/skus                  — list all SKUs with computed fields
- GET  /api/skus/:id              — single SKU detail
- POST /api/skus                  — create SKU
- PUT  /api/skus/:id              — update SKU
- GET  /api/dashboard/stats       — KPI summary
- GET  /api/alerts                — all active alerts
- POST /api/alerts/:id/acknowledge — dismiss alert
- GET  /api/inventory             — inventory positions
- POST /api/inventory/restock     — add stock
- GET  /api/sales/velocity        — sales velocity per SKU

---

### Non-Functional Requirements
- No LLM calls in MVP 1. All logic is rules-based and deterministic.
- Backend must restart cleanly without data loss (SQLite file persists).
- Seed data must use realistic rice SKU names, suppliers, and quantities.
- All monetary values in SGD.
- UOM: metric tonnes (MT) for bulk rice, KG for retail packs.
