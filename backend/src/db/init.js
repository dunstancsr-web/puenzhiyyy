const Database = require("better-sqlite3");
const fs = require("fs");
const path = require("path");
const { AsyncLocalStorage } = require("async_hooks");

// ─────────────────────────────────────────────────────────────────────────────
// DEMO MODE (MVP2 Day 7). A visitor can switch every request onto a genuinely
// separate, empty, in-memory SQLite database instead of the real file, so the
// real onboarding flow (an empty portfolio) can be demoed live without any
// risk to the real data — there is no code path from inside demo mode that can
// reach the real database.
//
// One shared sandbox, not per-visitor: Stan is the one demoing this live, not
// concurrent unsupervised judges, so per-visitor isolation isn't worth the
// complexity here. `demoDb` is the one shared instance, or null when demo mode
// has never been entered (or has been exited, which just drops the reference —
// no "reset" step, nothing to reset).
//
// getDb() is called directly, with no request object threaded through, by
// almost every engine and route in this codebase — AsyncLocalStorage lets a
// request-scoped "which database" decision reach every one of those calls
// without changing a single call site.
const demoContext = new AsyncLocalStorage();
let demoDb = null;

function createDemoDb() {
  const instance = new Database(":memory:");
  instance.pragma("foreign_keys = ON");
  initDb(instance); // same schema-building code as the real database, see below
  return instance;
}

function enterDemoMode() {
  if (!demoDb) demoDb = createDemoDb();
  return demoDb;
}

function exitDemoMode() {
  if (demoDb) demoDb.close(); // release the native handle; nothing to reset because nothing is reused
  demoDb = null;
}

function isDemoModeActive() {
  return demoDb != null;
}

// Whether THIS request is currently running inside the demo context — not
// just whether demo mode is active for someone else. The one thing allowed
// to check this is a route that would otherwise be destructive if it ever
// ran against the real database (see /demo/seed-sample) — it refuses instead
// of trusting the caller's cookie alone.
function isInDemoContext() {
  return demoContext.getStore() != null;
}

// Wraps one request's handling in the demo database's async context. Called by
// the middleware in index.js for any request carrying the demo cookie. If the
// shared instance was dropped (someone else exited) since this cookie was set,
// self-heals by starting a fresh empty one — the alternative, silently falling
// back to the real database for a visitor who believes they are in a sandbox,
// is the one outcome this feature exists to make impossible.
function runInDemoContext(fn) {
  const instance = demoDb || enterDemoMode();
  return demoContext.run(instance, fn);
}

// DATA_DIR is configurable so a deployed instance can point the database at a
// mounted persistent disk, which is never inside the checked-out source tree.
// Defaults to the repo-local data/ directory, so local development and
// `npm run seed` behave exactly as before with no env var set.
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "../../data");
const DB_PATH = path.join(DATA_DIR, "stocksense.db");

let db;

function getDb() {
  // A demo-mode request (see runInDemoContext, above) gets the shared
  // in-memory sandbox instead of the real file — every other call site in
  // this codebase is unchanged and unaware this branch exists.
  const demoInstance = demoContext.getStore();
  if (demoInstance) return demoInstance;

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

// targetDb: build the schema on a specific Database instance (createDemoDb's
// in-memory one) instead of the real singleton. Every existing call site
// (index.js's boot-time initDb()) passes nothing and behaves exactly as before.
function initDb(targetDb) {
  const db = targetDb || getDb();

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
      strategic_adjustment     REAL DEFAULT 0,   -- MVP2: risk-buffer contribution (MT) from riskbuffer.js,
                                                  -- added to reorder_point_suggested; 0 when no active
                                                  -- risk_events match this SKU's origin/supplier
      forecast_model           TEXT,             -- MVP2: naive_seasonal | holt_winters | linear_trend | auto | NULL
      use_forecast             INTEGER DEFAULT 0,-- MVP2: opt-in switch, decoupled from forecast_model so
                                                  -- picking a model does not silently activate it
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
    -- ORDER REQUESTS  (Reorder Loop step 7, "Separate the duties")
    -- The one write the Control Tower is allowed to make: a request to the
    -- buyer to order more of a SKU. It records INTENT for a buyer to act on;
    -- it does NOT change stock. Stock only ever moves on the warehouse floor
    -- (goods_movements), attributed to an operator, against an expected line.
    --
    -- This is why the office has no restock endpoint any more: the two duties
    -- are separated, and this table is the office half of that split. A real
    -- deployment would route these to a procurement system; here they are a
    -- durable, auditable record that the request was raised.
    -- ================================================================
    CREATE TABLE IF NOT EXISTS order_requests (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      request_no    TEXT UNIQUE,                 -- REQ-0001
      sku_id        TEXT NOT NULL,
      quantity_mt   REAL NOT NULL,
      reason        TEXT,
      status        TEXT NOT NULL DEFAULT 'open', -- open | acknowledged | po_raised | approved | received | rejected | cancelled
      po_number     TEXT,                        -- set when approved: the purchase order Goods In receives against
      requested_by  TEXT DEFAULT 'control tower',
      created_at    TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (sku_id) REFERENCES skus(sku_id)
    );
    CREATE INDEX IF NOT EXISTS idx_order_requests_sku ON order_requests(sku_id, status);

    -- One row per step a request has been through, oldest first. order_requests.status
    -- is only the latest step; this is the timeline. Append-only: a step is never edited.
    -- actor is a role label ('control tower', 'buyer', 'buyer manager'); there is no
    -- login yet, so in the demo a person plays each role and the label says so.
    CREATE TABLE IF NOT EXISTS order_request_events (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      request_id  INTEGER NOT NULL,
      status      TEXT NOT NULL,   -- open | acknowledged | po_raised | approved | rejected | cancelled
      actor       TEXT NOT NULL,
      note        TEXT,
      created_at  TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (request_id) REFERENCES order_requests(id)
    );
    CREATE INDEX IF NOT EXISTS idx_order_request_events_req ON order_request_events(request_id, id);

    -- ================================================================
    -- FORECASTS  (MVP2)
    -- One row per SKU per model per generation. is_active=1 marks the one row
    -- per sku_id currently feeding safetystock.js; older rows stay as history
    -- for later forecast-vs-actual comparison. avg_daily_demand_forecast and
    -- demand_cv_forecast are the only two fields engines/index.js reads; the
    -- rest is for the review UI and the backtest report.
    -- ================================================================
    CREATE TABLE IF NOT EXISTS forecasts (
      id                        INTEGER PRIMARY KEY AUTOINCREMENT,
      sku_id                    TEXT NOT NULL,
      model                     TEXT NOT NULL,   -- naive_seasonal | holt_winters | linear_trend | holt_damped_seasonal
      generated_at              TEXT DEFAULT (datetime('now')),
      horizon_months            INTEGER NOT NULL,
      avg_daily_demand_forecast REAL NOT NULL,
      demand_cv_forecast        REAL NOT NULL,
      monthly_forecast_json     TEXT NOT NULL,   -- [{period, qty_mt, lower, upper}, ...]
      backtest_metric           TEXT,            -- 'WMAPE'
      backtest_score            REAL,
      candidate_scores_json     TEXT,            -- {model_id: wmape, ...} for every model tried, so
                                                  -- auto-mode's pick is inspectable, not a black box
      low_confidence            INTEGER DEFAULT 0, -- 1 when fold count was thin (sparse sales history)
      is_active                 INTEGER DEFAULT 0,
      FOREIGN KEY (sku_id) REFERENCES skus(sku_id)
    );
    CREATE INDEX IF NOT EXISTS idx_forecasts_sku_active ON forecasts(sku_id, is_active);

    -- ================================================================
    -- RISK EVENTS  (MVP2)
    -- A seeded, illustrative supply-chain risk signal, matched to SKUs by
    -- country_of_origin or supplier. NOT a live feed: real USDA GAIN/AMIS
    -- integration is roadmap, not this build. is_illustrative always 1 here,
    -- the same honesty label compliance_position already carries.
    -- ================================================================
    CREATE TABLE IF NOT EXISTS risk_events (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      label             TEXT NOT NULL,
      country_of_origin TEXT,
      supplier          TEXT,
      severity          TEXT NOT NULL,    -- low | medium | high
      buffer_days_add   REAL NOT NULL,
      active            INTEGER DEFAULT 1,
      is_illustrative   INTEGER DEFAULT 1,
      notes             TEXT,
      created_at        TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_risk_events_active ON risk_events(active);

    -- ================================================================
    -- MARKET SIGNALS
    -- A news event read into a fixed shape, waiting for a person to accept
    -- or dismiss it. Never a figure and never an action: the days it costs
    -- come from engines/signals.js's playbook, and approving one only adds a
    -- risk_events row (the buffer the reorder point already knows about).
    --   origin        replay = a real past event loaded to show what the agent
    --                 would say; live = read from the news feed
    --   extracted_by  hand | rules | model:<name>, so a reader can tell how
    --                 much to trust the classification
    --   affects/excludes_varieties  JSON arrays; a NON-basmati ban must not
    --                 flag a basmati SKU
    --   fixture_id    makes loading the same replay twice a no-op
    -- ================================================================
    CREATE TABLE IF NOT EXISTS market_signals (
      id                 INTEGER PRIMARY KEY AUTOINCREMENT,
      headline           TEXT NOT NULL,
      summary            TEXT,
      source_name        TEXT,
      source_url         TEXT,
      published_at       TEXT,
      country_of_origin  TEXT,
      supplier           TEXT,
      event_type         TEXT NOT NULL,
      severity           TEXT NOT NULL,
      direction          TEXT NOT NULL DEFAULT 'tightens',
      affects_varieties  TEXT,
      excludes_varieties TEXT,
      origin             TEXT NOT NULL DEFAULT 'replay',
      extracted_by       TEXT NOT NULL DEFAULT 'hand',
      status             TEXT NOT NULL DEFAULT 'pending',
      decided_at         TEXT,
      decided_by         TEXT,
      risk_event_id      INTEGER,
      fixture_id         TEXT,
      also_reported_by   TEXT,
      created_at         TEXT DEFAULT (datetime('now'))
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_market_signals_fixture ON market_signals(fixture_id) WHERE fixture_id IS NOT NULL;

    -- Every headline the news scan has already looked at, kept or not, so the same
    -- story is never read twice (a model call each time otherwise).
    CREATE TABLE IF NOT EXISTS signal_seen (
      url_hash TEXT PRIMARY KEY,
      verdict  TEXT NOT NULL,
      seen_at  TEXT DEFAULT (datetime('now'))
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
    -- INVENTORY HISTORY  (TASK-85)
    --
    -- One row per SKU per month. LONG format, and that is the decision that
    -- lets this carry any number of months: the header never changes, only the
    -- row count grows. A wide layout (a column per month) would need the
    -- schema, the CSV writer and the import validator edited every time the
    -- window moved, and the column count would grow without bound.
    --
    -- The four quantity columns are a balance, not four independent numbers:
    --   opening_qty + receipts_qty - issues_qty = closing_qty
    -- and each period's opening_qty equals the previous period's closing_qty.
    -- The CSV importer enforces both, so a spreadsheet that does not balance
    -- cannot enter the database.
    --
    -- There is deliberately NO closing_value column. It is
    -- closing_qty * unit_cost_sgd, derived in SQL. Storing it would be a third
    -- place for the same number, and values computed twice have disagreed in
    -- this repo twice already. unit_cost_sgd IS stored per row, because the
    -- cost at that time is a point-in-time fact: a later price change must not
    -- silently rewrite what last year's stock was worth.
    -- ================================================================
    CREATE TABLE IF NOT EXISTS inventory_history (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      sku_id        TEXT NOT NULL,
      period        TEXT NOT NULL,              -- 'YYYY-MM'
      opening_qty   REAL NOT NULL DEFAULT 0,
      receipts_qty  REAL NOT NULL DEFAULT 0,
      issues_qty    REAL NOT NULL DEFAULT 0,
      closing_qty   REAL NOT NULL DEFAULT 0,
      unit_cost_sgd REAL NOT NULL DEFAULT 0,
      UNIQUE (sku_id, period),
      FOREIGN KEY (sku_id) REFERENCES skus(sku_id)
    );

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
  // Variety scoping for risk events, so an approved market signal about NON-basmati
  // rice does not buffer a basmati SKU. NULL keeps the old, unscoped behaviour.
  // Order requests used to end at 'ordered'. That step is now the approved purchase order, so a
  // database from before the timeline reads the same way. Idempotent: matches nothing afterwards.
  db.exec(`UPDATE order_requests SET status = 'approved' WHERE status = 'ordered'`);
  ensureColumn(db, "order_requests", "po_number", "po_number TEXT");
  ensureColumn(db, "market_signals", "also_reported_by", "also_reported_by TEXT");
  ensureColumn(db, "risk_events", "affects_varieties", "affects_varieties TEXT");
  ensureColumn(db, "risk_events", "excludes_varieties", "excludes_varieties TEXT");
  ensureColumn(db, "skus", "warehouse", "warehouse TEXT DEFAULT 'MAIN'");
  ensureColumn(db, "skus", "lead_time_std_days", "lead_time_std_days REAL DEFAULT 0");
  ensureColumn(db, "skus", "target_service_level", "target_service_level REAL DEFAULT 0.95");
  ensureColumn(db, "skus", "demand_cv", "demand_cv REAL DEFAULT 0.3");
  ensureColumn(db, "skus", "unit_price_sgd", "unit_price_sgd REAL DEFAULT 0");
  ensureColumn(db, "skus", "annual_carrying_rate_pct", "annual_carrying_rate_pct REAL DEFAULT 22");
  ensureColumn(db, "skus", "obsolescence_risk_pct", "obsolescence_risk_pct REAL DEFAULT 10");
  ensureColumn(db, "skus", "abc_class", "abc_class TEXT");
  ensureColumn(db, "skus", "xyz_class", "xyz_class TEXT");
  ensureColumn(db, "skus", "forecast_model", "forecast_model TEXT");
  ensureColumn(db, "skus", "use_forecast", "use_forecast INTEGER DEFAULT 0");
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
    -- The dashboard reads history a period at a time across all SKUs, so the
    -- period is the leading column here; the (sku_id, period) UNIQUE above
    -- already serves the per-SKU direction.
    CREATE INDEX IF NOT EXISTS idx_hist_period    ON inventory_history(period);
  `);

  console.log("✓ Database initialised at", DB_PATH);
  return db;
}

module.exports = {
  getDb, initDb, ensureColumn, DB_PATH,
  enterDemoMode, exitDemoMode, isDemoModeActive, isInDemoContext, runInDemoContext,
};
