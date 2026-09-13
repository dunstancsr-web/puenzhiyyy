const Database = require("better-sqlite3");
const fs = require("fs");
const path = require("path");

// DATA_DIR is configurable so a deployed instance can point the database at a
// mounted persistent disk, which is never inside the checked-out source tree.
// Defaults to the repo-local data/ directory, so local development and
// `npm run seed` behave exactly as before with no env var set.
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "../../data");
const DB_PATH = path.join(DATA_DIR, "stocksense.db");

let db;

function getDb() {
  if (!db) {
    // A mounted volume can be empty on first boot, and better-sqlite3 will not
    // create a missing parent directory for you: it throws SQLITE_CANTOPEN.
    fs.mkdirSync(DATA_DIR, { recursive: true });
    db = new Database(DB_PATH);
    db.pragma("journal_mode = WAL"); // better concurrent read performance
    db.pragma("foreign_keys = ON");
  }
  return db;
}

// Add a column only if it does not already exist (cheap forward migration).
function ensureColumn(db, table, column, ddl) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!cols.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
  }
}

function initDb() {
  const db = getDb();

  db.exec(`
    -- ================================================================
    -- SKU MASTER
    -- Core product reference. Inventory-policy inputs (service level,
    -- demand/lead-time variability, carrying + obsolescence rates) drive
    -- the statistical safety-stock and financial engines.
    -- ================================================================
    CREATE TABLE IF NOT EXISTS skus (
      id                       INTEGER PRIMARY KEY AUTOINCREMENT,
      sku_id                   TEXT UNIQUE NOT NULL,
      product_name             TEXT NOT NULL,
      rice_variety             TEXT,
      grade                    TEXT,
      country_of_origin        TEXT,
      brand                    TEXT,
      packaging_size           TEXT,
      uom                      TEXT DEFAULT 'MT',
      supplier                 TEXT,
      warehouse                TEXT DEFAULT 'MAIN',
      min_order_qty            REAL DEFAULT 0,
      reorder_point_policy     REAL DEFAULT 0,   -- approved/editable operating value (glossary #28); engine also computes reorder_point_suggested
      min_stock                REAL DEFAULT 0,
      target_stock             REAL DEFAULT 0,
      max_stock                REAL DEFAULT 0,
      safety_stock_pct         REAL DEFAULT 20,  -- legacy flat buffer; superseded by statistical SS
      lead_time_days           INTEGER DEFAULT 45,
      lead_time_std_days       REAL DEFAULT 0,   -- supplier lead-time variability (1 sigma)
      target_service_level     REAL DEFAULT 0.95,
      demand_cv                REAL DEFAULT 0.3, -- fallback; velocity engine recomputes from sales
      unit_cost_sgd            REAL DEFAULT 0,
      unit_price_sgd           REAL DEFAULT 0,   -- sell price -> margin, GMROI, lost-sales value
      annual_carrying_rate_pct REAL DEFAULT 22,  -- storage + capital + risk, % of value / year
      obsolescence_risk_pct    REAL DEFAULT 10,  -- write-down probability for E&O valuation
      max_holding_days         INTEGER DEFAULT 270,
      abc_class                TEXT,             -- cached on refresh (A/B/C by consumption value)
      xyz_class                TEXT,             -- cached on refresh (X/Y/Z by demand CV)
      active                   INTEGER DEFAULT 1,
      strategic_adjustment     REAL DEFAULT 0,   -- Phase 2 placeholder, always 0 in MVP 1
      created_at               TEXT DEFAULT (datetime('now'))
    );

    -- ================================================================
    -- INVENTORY POSITIONS
    -- available_qty = on_hand_qty - reserved - quality_hold  (always derived)
    -- ================================================================
    CREATE TABLE IF NOT EXISTS inventory_positions (
      id                 INTEGER PRIMARY KEY AUTOINCREMENT,
      sku_id             TEXT NOT NULL UNIQUE,
      on_hand_qty        REAL DEFAULT 0,   -- glossary #4 "On Hand"; was 'physical_stock'
      reserved_qty       REAL DEFAULT 0,
      quality_hold_qty   REAL DEFAULT 0,
      last_received_date TEXT,
      last_updated       TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (sku_id) REFERENCES skus(sku_id)
    );

    -- ================================================================
    -- SALES TRANSACTIONS
    -- status: 'fulfilled' = shipped demand, 'lost' = unfilled demand
    -- (stockout). Fill rate = fulfilled / (fulfilled + lost).
    -- ================================================================
    CREATE TABLE IF NOT EXISTS sales_transactions (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      sku_id       TEXT NOT NULL,
      quantity_mt  REAL NOT NULL,
      sale_date    TEXT NOT NULL,
      customer     TEXT,
      channel      TEXT DEFAULT 'direct',
      status       TEXT DEFAULT 'fulfilled',
      FOREIGN KEY (sku_id) REFERENCES skus(sku_id)
    );

    -- ================================================================
    -- PURCHASE ORDERS
    -- Open POs feed inventory position (on-hand + on-order - backorders).
    -- ================================================================
    CREATE TABLE IF NOT EXISTS purchase_orders (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      po_number      TEXT UNIQUE,
      sku_id         TEXT NOT NULL,
      ordered_qty    REAL DEFAULT 0,
      order_date     TEXT,
      eta            TEXT,
      actual_arrival TEXT,
      status         TEXT DEFAULT 'open',   -- open | received | cancelled
      FOREIGN KEY (sku_id) REFERENCES skus(sku_id)
    );

    -- ================================================================
    -- ALERTS LOG
    -- Lifecycle: open -> acknowledged -> actioned -> resolved.
    -- dedupe_key = sku_id + ':' + alert_type keeps one live row per issue.
    -- ================================================================
    CREATE TABLE IF NOT EXISTS alerts_log (
      id                 INTEGER PRIMARY KEY AUTOINCREMENT,
      dedupe_key         TEXT,
      sku_id             TEXT NOT NULL,
      alert_type         TEXT NOT NULL,
      severity           TEXT NOT NULL,
      message            TEXT,
      recommended_action TEXT,
      triggered_value    REAL,
      threshold_value    REAL,
      status             TEXT DEFAULT 'open',
      owner              TEXT,
      acknowledged       INTEGER DEFAULT 0,   -- legacy mirror of status != 'open'
      triggered_at       TEXT DEFAULT (datetime('now')),
      resolved_at        TEXT,
      FOREIGN KEY (sku_id) REFERENCES skus(sku_id)
    );

    -- ================================================================
    -- DECISIONS  (audit trail + Phase 2 training data)
    -- ================================================================
    CREATE TABLE IF NOT EXISTS decisions (
      id                   INTEGER PRIMARY KEY AUTOINCREMENT,
      sku_id               TEXT NOT NULL,
      trigger_type         TEXT,
      ai_recommendation    TEXT,
      ai_quantity          REAL,
      manager_action       TEXT,
      manager_quantity     REAL,
      manager_reason       TEXT,
      decided_by           TEXT DEFAULT 'manager',
      decided_at           TEXT DEFAULT (datetime('now')),
      outcome_notes        TEXT,
      strategic_adjustment REAL DEFAULT 0,
      FOREIGN KEY (sku_id) REFERENCES skus(sku_id)
    );

    -- ================================================================
    -- OPERATORS  (warehouse floor staff, for handheld attribution)
    -- A shared rugged device with a short PIN per person is the normal
    -- pattern on a warehouse floor: gloves make passwords impractical, and
    -- attribution still has to be per person for the audit trail.
    --
    -- PINs are stored in clear text ON PURPOSE and ONLY because this is a
    -- prototype whose demo PINs are printed on the login screen. They are not
    -- secrets. A real deployment needs hashed credentials and a device
    -- enrolment step; see requirements.md "Explicitly Deferred".
    -- ================================================================
    CREATE TABLE IF NOT EXISTS operators (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      name        TEXT NOT NULL,
      pin         TEXT NOT NULL,
      role        TEXT NOT NULL DEFAULT 'both',   -- receiving | dispatch | both
      active      INTEGER DEFAULT 1
    );

    -- ================================================================
    -- SALES ORDERS  (what outbound picks against)
    -- Seeded to reconcile EXACTLY with inventory_positions.reserved_qty per
    -- SKU. Reserved stock is, by definition, stock already promised to an
    -- order, so open order quantities that did not sum to it would mean the
    -- warehouse and the dashboard disagreed about the same MT.
    -- ================================================================
    CREATE TABLE IF NOT EXISTS sales_orders (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      so_number     TEXT UNIQUE,
      sku_id        TEXT NOT NULL,
      customer      TEXT,
      ordered_qty   REAL NOT NULL,
      required_date TEXT,
      status        TEXT DEFAULT 'open',        -- open | picked | cancelled
      picked_qty    REAL,
      picked_by     TEXT,
      picked_at     TEXT,
      FOREIGN KEY (sku_id) REFERENCES skus(sku_id)
    );
    CREATE INDEX IF NOT EXISTS idx_so_status ON sales_orders(status);

    -- ================================================================
    -- GOODS MOVEMENTS  (the GRN / DN record for every physical move)
    -- One row per confirmed receipt or issue, carrying who did it, what was
    -- expected, what actually moved, and any variance.
    --
    -- NOT the immutable movement ledger deferred in requirements.md: balances
    -- are still a mutable snapshot on inventory_positions and are not rebuilt
    -- from these rows. This records the TRANSACTION, not the balance.
    -- ================================================================
    CREATE TABLE IF NOT EXISTS goods_movements (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      movement_no     TEXT UNIQUE,              -- GRN-0001 / DN-0001
      movement_type   TEXT NOT NULL,            -- RECEIPT | ISSUE
      reference       TEXT,                     -- po_number or so_number
      sku_id          TEXT NOT NULL,
      expected_qty    REAL,
      actual_qty      REAL NOT NULL,
      variance_qty    REAL DEFAULT 0,
      variance_reason TEXT,
      operator_id     INTEGER,
      operator_name   TEXT,
      created_at      TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (sku_id) REFERENCES skus(sku_id)
    );
    CREATE INDEX IF NOT EXISTS idx_mv_type ON goods_movements(movement_type, created_at);

    -- ================================================================
    -- AUDIT LOG  (Observability — every LLM_CALL, ALERT_TRIGGERED, RESTOCK)
    -- ================================================================
    CREATE TABLE IF NOT EXISTS audit_log (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      event_type   TEXT NOT NULL,
      sku_id       TEXT,
      input_data   TEXT,
      output_data  TEXT,
      created_at   TEXT DEFAULT (datetime('now'))
    );

  `);

  // Forward migrations for databases created before these columns existed.
  ensureColumn(db, "skus", "warehouse", "warehouse TEXT DEFAULT 'MAIN'");
  ensureColumn(db, "skus", "lead_time_std_days", "lead_time_std_days REAL DEFAULT 0");
  ensureColumn(db, "skus", "target_service_level", "target_service_level REAL DEFAULT 0.95");
  ensureColumn(db, "skus", "demand_cv", "demand_cv REAL DEFAULT 0.3");
  ensureColumn(db, "skus", "unit_price_sgd", "unit_price_sgd REAL DEFAULT 0");
  ensureColumn(db, "skus", "annual_carrying_rate_pct", "annual_carrying_rate_pct REAL DEFAULT 22");
  ensureColumn(db, "skus", "obsolescence_risk_pct", "obsolescence_risk_pct REAL DEFAULT 10");
  ensureColumn(db, "skus", "abc_class", "abc_class TEXT");
  ensureColumn(db, "skus", "xyz_class", "xyz_class TEXT");
  // Compliance Position (REQ-16) is a portfolio-level KPI, computed in financials.js — no SKU column needed.
  ensureColumn(db, "alerts_log", "dedupe_key", "dedupe_key TEXT");
  ensureColumn(db, "alerts_log", "status", "status TEXT DEFAULT 'open'");
  ensureColumn(db, "alerts_log", "owner", "owner TEXT");
  ensureColumn(db, "alerts_log", "resolved_at", "resolved_at TEXT");

  // Indexes last — after migrations have guaranteed the columns exist.
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_sales_sku_date ON sales_transactions(sku_id, sale_date);
    CREATE INDEX IF NOT EXISTS idx_po_sku_status  ON purchase_orders(sku_id, status);
    CREATE INDEX IF NOT EXISTS idx_alerts_status  ON alerts_log(status);
  `);

  console.log("✓ Database initialised at", DB_PATH);
  return db;
}

module.exports = { getDb, initDb, ensureColumn, DB_PATH };
