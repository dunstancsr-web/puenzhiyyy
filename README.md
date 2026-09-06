# StockSense — Inventory Monitoring System

A full-stack inventory monitoring dashboard built for the hackathon. Helps inventory managers identify slow-moving products, fast-selling items, and potential shortages before they become problems.

---

## Features

- **Dashboard** — real-time KPI cards (total products, stock value, low stock, out of stock, overstock), top-selling products bar chart, stock status pie chart, slow-movers list, and live alerts preview
- **Inventory table** — full product list with search, category/status filters, sortable columns, inline stock progress bars, and a restock modal
- **Add Products** — form to add new SKUs directly from the UI
- **Alerts page** — all inventory issues grouped by type (out of stock, low stock, overstock, slow-moving), filterable tabs, severity-sorted with color-coded rows
- **REST API** — Express backend with full CRUD + restock endpoint and computed alert logic

---

## Tech Stack

| Layer    | Technology                        |
|----------|-----------------------------------|
| Frontend | React 18, Vite, React Router v6   |
| Charts   | Recharts                          |
| Icons    | Lucide React                      |
| Backend  | Node.js, Express                  |
| Storage  | In-memory (seeded with 10 products) |

---

## Project Structure

```
puenzhiyyy/
├── backend/
│   ├── src/
│   │   ├── data/
│   │   │   └── products.js       # In-memory store + stock logic
│   │   ├── routes/
│   │   │   └── products.js       # REST routes
│   │   └── index.js              # Express app entry point
│   └── package.json
├── frontend/
│   ├── src/
│   │   ├── api/
│   │   │   └── inventory.js      # API client
│   │   ├── components/
│   │   │   ├── Layout.jsx
│   │   │   ├── Sidebar.jsx
│   │   │   ├── StatCard.jsx
│   │   │   └── Badge.jsx
│   │   ├── pages/
│   │   │   ├── Dashboard.jsx
│   │   │   ├── Inventory.jsx
│   │   │   └── Alerts.jsx
│   │   ├── App.jsx
│   │   ├── main.jsx
│   │   └── index.css
│   ├── index.html
│   ├── vite.config.js
│   └── package.json
└── package.json                  # Root convenience scripts
```

---

## Getting Started

### Prerequisites

- Node.js 18+
- npm 9+

### 1. Install dependencies

```bash
# From the project root — installs both backend and frontend
npm run install:all
```

Or install separately:

```bash
cd backend && npm install
cd ../frontend && npm install
```

### 2. Start the backend

```bash
# Terminal 1
npm run dev:backend
# → API running at http://localhost:4000
```

### 3. Start the frontend

```bash
# Terminal 2
npm run dev:frontend
# → App running at http://localhost:5173
```

Open **http://localhost:5173** in your browser.

---

## API Reference

Base URL: `http://localhost:4000/api`

| Method | Endpoint                      | Description                        |
|--------|-------------------------------|------------------------------------|
| GET    | `/products`                   | List all products (supports `?search=`, `?category=`, `?status=`) |
| GET    | `/products/stats`             | Dashboard summary statistics       |
| GET    | `/products/alerts`            | All active inventory alerts        |
| GET    | `/products/:id`               | Get a single product               |
| POST   | `/products`                   | Create a new product               |
| PUT    | `/products/:id`               | Update product details             |
| PATCH  | `/products/:id/restock`       | Add stock quantity `{ quantity: N }` |
| DELETE | `/products/:id`               | Remove a product                   |
| GET    | `/health`                     | API health check                   |

### Stock Status Logic

| Status        | Condition                                      |
|---------------|------------------------------------------------|
| `out_of_stock`| `currentStock === 0`                           |
| `low_stock`   | `currentStock <= reorderPoint`                 |
| `overstock`   | `currentStock > maxStock`                      |
| `in_stock`    | Everything else                                |

### Alert Types

| Type          | Trigger                                                        |
|---------------|----------------------------------------------------------------|
| `out_of_stock`| Stock is zero                                                  |
| `low_stock`   | Stock at or below reorder point                                |
| `overstock`   | Stock exceeds max stock level                                  |
| `slow_moving` | < 10 sales in 30 days AND stock > 2× minimum stock            |

---

## Next Steps / Extension Ideas

- [ ] Persist data with a real database (SQLite via better-sqlite3, or PostgreSQL)
- [ ] Add authentication (JWT or session-based)
- [ ] CSV/Excel export for inventory reports
- [ ] Email / webhook notifications for critical alerts
- [ ] Forecasting chart based on sales velocity and days-of-stock
- [ ] Supplier management page
- [ ] Barcode / QR code scanner integration
