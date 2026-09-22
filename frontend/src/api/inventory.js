// Fetch client for backend/src/routes/inventory.js - the real SQLite + analytics
// backend (TASK-09/10). Response shape is always { success, data, message? };
// `request()` unwraps it to just the `data` payload and throws on failure so
// callers can `await` directly and catch one error type.

const BASE = "/api";

// Shown when the request never reached the Express app at all, as opposed to
// reaching it and being refused. Names the port and the likely cause, because
// the alternative ("Request failed (500)") sends you debugging the frontend
// when the actual problem is a dead backend process.
const UNREACHABLE =
  "Cannot reach the API on localhost:4000. Check the backend is running (npm run dev in backend/) - if it is, check its log for a crash.";

async function request(path, options = {}) {
  let res;
  try {
    // `...options` FIRST, then headers. The other order let options.headers
    // replace the merged object wholesale, so the first caller to pass any
    // header (the demo unlock pass, TASK-90) silently lost Content-Type and
    // the server received an unparsed body. Nothing passed a header before
    // that, which is why it had never shown.
    res = await fetch(`${BASE}${path}`, {
      ...options,
      headers: { "Content-Type": "application/json", ...options.headers },
      body: options.body ? JSON.stringify(options.body) : undefined,
    });
  } catch {
    // fetch only rejects on a genuine network-level failure (dev server gone,
    // offline, DNS). An HTTP error status never lands here.
    throw new Error(UNREACHABLE);
  }

  // Every real response from this API is JSON, errors included: all the route
  // handlers and the catch-all in backend/src/index.js return
  // { success, message }. So a body that will not parse as JSON means the
  // request never got as far as Express. In dev that is the Vite proxy
  // failing to connect to :4000 and answering with a bare text/plain 500
  // (verified: empty body, Content-Type: text/plain).
  let body;
  let parsed = true;
  try {
    body = await res.json();
  } catch {
    parsed = false;
  }

  if (!parsed) {
    if (res.ok) return undefined;              // e.g. a legitimate empty 204
    if (res.status >= 500) throw new Error(UNREACHABLE);
    throw new Error(`Request failed (${res.status})`);
  }

  if (!res.ok || body.success === false) {
    const err = new Error(body.message || `Request failed (${res.status})`);
    // The server refused a write because this visitor is not in the demo sandbox;
    // the handheld uses this to offer a one tap join (see JoinDemo).
    if (body.needs_demo) err.needsDemo = true;
    throw err;
  }
  return body.data;
}

export const api = {
  // Demo mode (MVP2 Day 7). `request()` already sends/receives cookies by
  // default (same-origin via the Vite proxy in dev, same-origin for real in
  // production), so no extra fetch option is needed for the demo cookie to
  // round-trip correctly.
  getDemoStatus: () => request("/demo/status"),
  getDataVersion: () => request("/data-version"),
  enterDemoMode: () => request("/demo/enter", { method: "POST" }),
  exitDemoMode: () => request("/demo/exit", { method: "POST" }),
  seedSampleData: () => request("/demo/seed-sample", { method: "POST" }),

  // SKUs
  getSkus: () => request("/skus"),
  getSku: (id) => request(`/skus/${id}`),
  createSku: (body) => request("/skus", { method: "POST", body }),
  updateSku: (id, body) => request(`/skus/${id}`, { method: "PUT", body }),
  // Onboarding's one-time starting count for a product with no stock yet. Audited, once per
  // product, refused if stock already exists (the office cannot top up a live balance).
  setOpeningBalance: (skuId, quantity) =>
    request("/skus/opening-balance", { method: "POST", body: { sku_id: skuId, quantity } }),
  getOpeningBalanceSuggestions: () => request("/skus/opening-balance-suggestions"),
  // Reorder Loop step 7: the one write the Control Tower may trigger. Records a
  // request to the buyer, never a stock change. (The old restockSku, which
  // added on-hand stock from the office, was removed when the duties were
  // separated - stock now moves only on the warehouse floor.)
  raiseOrderRequest: (body) => request("/order-requests", { method: "POST", body }),
  getOrderRequests: (params) => {
    const q = new URLSearchParams(params || {}).toString();
    return request(`/order-requests${q ? `?${q}` : ""}`);
  },
  // Reorder Loop step 7 follow-through: move a request one step along its timeline
  // (acknowledged, po_raised, approved, rejected with a note, or cancelled). Still no stock change.
  updateOrderRequest: (id, status, note) =>
    request(`/order-requests/${id}`, { method: "PATCH", body: { status, note } }),
  getSkuProjection: (id) => request(`/skus/${id}/projection`),

  // Forecasting (MVP2 Day 5). getSkuForecast returns { history, forecast } -
  // history is always present, forecast is null until Recompute has run once.
  getSkuForecast: (id) => request(`/skus/${id}/forecast`),
  getSkuInventoryHistory: (id, months = 12) => request(`/skus/${id}/inventory-history?months=${months}`),
  getForecastModels: () => request("/forecast/models"),
  setForecastConfig: (id, body) => request(`/skus/${id}/forecast-config`, { method: "PUT", body }),
  recomputeForecast: (skuId) => request("/forecast/recompute", { method: "POST", body: { sku_id: skuId } }),
  // Preview: recomputes King's formula with hypothetical inputs, saves nothing.
  previewForecast: (id, body) => request(`/skus/${id}/forecast/preview`, { method: "POST", body }),

  // Onboarding suggested settings (MVP2 Day 8). GET never writes; apply does.
  getSuggestedSettings: () => request("/onboarding/suggested-settings"),
  applySuggestedSettings: (skus) => request("/onboarding/suggested-settings/apply", { method: "POST", body: { skus } }),

  // Bulk edit (TASK-60). Export bypasses request() because the response is
  // text/csv, not the { success, data } envelope everything else returns.
  exportSkusCsv: async () => {
    let res;
    try {
      res = await fetch(`${BASE}/skus/export`);
    } catch {
      throw new Error(UNREACHABLE);
    }
    if (!res.ok) throw new Error("Could not export the inventory. Check the backend log.");
    return res.text();
  },
  importSkusCsv: (csv, apply) => request("/skus/import", { method: "POST", body: { csv, apply } }),
  // Update-only (sku_id is the key). For CREATING new SKUs from a spreadsheet
  // — onboarding's empty-catalog case — see importNewSkusCsv below.
  importNewSkusCsv: (csv, apply) => request("/skus/import-new", { method: "POST", body: { csv, apply } }),

  // Monthly history (TASK-85). A separate file from the SKU export because it
  // has a different grain: one row per SKU per month, not one per SKU.
  exportHistoryCsv: async (months = 24) => {
    let res;
    try {
      res = await fetch(`${BASE}/skus/history/export?months=${months}`);
    } catch {
      throw new Error(UNREACHABLE);
    }
    if (!res.ok) throw new Error("Could not export the history. Check the backend log.");
    return res.text();
  },
  importHistoryCsv: (csv, apply) => request("/skus/history/import", { method: "POST", body: { csv, apply } }),

  // Sales history onboarding upload (MVP2 step 1). Append-only, unlike the
  // history import above, so the response shape is a "what would be added"
  // summary rather than a field-by-field diff.
  exportSalesHistoryCsv: async (days = 180) => {
    let res;
    try {
      res = await fetch(`${BASE}/skus/history/export-sales?days=${days}`);
    } catch {
      throw new Error(UNREACHABLE);
    }
    if (!res.ok) throw new Error("Could not export sales history. Check the backend log.");
    return res.text();
  },
  // pendingSkus (optional, [{sku_id, product_name}]): onboarding's combined
  // catalog + sales preview (Onboarding.jsx). SKUs about to be created in
  // the same action, not yet real, so the preview shouldn't flag them as
  // unknown or show a placeholder where the real name is already known. See
  // the route.
  importSalesHistoryCsv: (csv, apply, pendingSkus) => request("/skus/history/import-sales", { method: "POST", body: { csv, apply, pendingSkus } }),

  // Dashboard
  getDashboardStats: () => request("/dashboard/stats"),
  getDashboardHistory: (months = 24) => request(`/dashboard/history?months=${months}`),

  // Alerts
  getAlerts: () => request("/alerts"),
  acknowledgeAlert: (id) => request(`/alerts/${id}/acknowledge`, { method: "POST" }),
  // Undo for a dismissal, the alerts that are not open (so History can offer to reopen the dismissed ones),
  // and what happened to one alert.
  reopenAlert: (id) => request(`/alerts/${id}/reopen`, { method: "POST" }),
  getHandledAlerts: () => request("/alerts/handled"),
  getAlertHistory: (id) => request(`/alerts/${id}/history`),

  // Decisions (TASK-12) - Approve/Modify/Reject audit trail
  getDecisions: () => request("/decisions"),
  createDecision: (body) => request("/decisions", { method: "POST", body }),

  // AI explanation (TASK-11). Always resolves, never rejects on a model
  // problem: the backend answers { available: false, reason } when no model is
  // configured or reachable, because the caller already has a deterministic
  // explanation to show instead.
  //
  // `tier` and `pass` come from lib/llmTier.js: the tier is this visitor's own
  // choice, and the pass is what the demo PIN unlocked (TASK-90).
  explainAlert: (skuId, alertType, { tier, pass } = {}) =>
    request("/alerts/explain", {
      method: "POST",
      headers: pass ? { "X-Demo-Unlock": pass } : undefined,
      body: { sku_id: skuId, alert_type: alertType, tier },
    }),

  // Action Items' own "Why?" (19 Sep) - same shape as explainAlert above,
  // separate endpoint because it explains a different kind of thing
  // (nearest-stockout / blind-spot rows, not the six alert types).
  explainActionItem: (skuId, kind, { tier, pass } = {}) =>
    request("/action-items/explain", {
      method: "POST",
      headers: pass ? { "X-Demo-Unlock": pass } : undefined,
      body: { sku_id: skuId, kind, tier },
    }),

  // Open-ended follow-up questions (19 Sep) - the model can call a small set
  // of read-only tools (backend/src/llm/tools.js) to fetch facts about any
  // SKU, not just the one row a fixed "Why?" already knew about.
  askDatabase: (question, { tier, pass } = {}) =>
    request("/ask-database", {
      method: "POST",
      headers: pass ? { "X-Demo-Unlock": pass } : undefined,
      body: { question, tier },
    }),

  // Model tier (TASK-42). What this server can offer. There is no setter since
  // TASK-90: the choice is stored per browser, not on the server.
  getLlmMode: () => request("/llm/mode"),
  // Exchanges the demo PIN for a two hour pass. Rejects with the server's own
  // message ("2 tries left", "try again in 15 min"), which is written to be
  // shown as is.
  unlockLlm: (pin) => request("/llm/unlock", { method: "POST", body: { pin } }),

  // Warehouse floor (TASK-46/47)
  getOperators: () => request("/warehouse/operators"),
  warehouseLogin: (pin) => request("/warehouse/login", { method: "POST", body: { pin } }),
  getInbound: () => request("/warehouse/inbound"),
  receiveGoods: (body) => request("/warehouse/inbound/receive", { method: "POST", body }),
  getOutbound: () => request("/warehouse/outbound"),
  pickGoods: (body) => request("/warehouse/outbound/pick", { method: "POST", body }),
  getMovements: () => request("/warehouse/movements"),

  // Market signals: news events assessed against stock. Every call resolves to
  // { signals, catalog, playbook }, the whole picture after the change.
  getMarketSignals: () => request("/market-signals"),
  replaySignal: (fixture_id) => request("/market-signals/replay", { method: "POST", body: { fixture_id } }),
  decideSignal: (id, decision) => request(`/market-signals/${id}/decision`, { method: "POST", body: { decision } }),
  // `tier` (22 Sep): "cloud" reads on Claude Sonnet instead of the free local model,
  // capped far lower per scan than the free tier (see routes/signals.js), and needs
  // `pass` (the same demo-unlock pass Why?/Ask use) or the server refuses it before
  // any cost, same shape as explainAlert/askDatabase above.
  scanSignals: (days, { tier, pass } = {}) =>
    request("/market-signals/scan", {
      method: "POST",
      headers: pass ? { "X-Demo-Unlock": pass } : undefined,
      body: { days, tier },
    }),
  correctSignal: (id, body) => request(`/market-signals/${id}`, { method: "PATCH", body }),

  // Audit log (TASK-31) - every state change the API made, newest first.
  // Resolves to { events, counts }, not a bare array: `counts` is the whole
  // table's totals per event type, which the filter chips need even when the
  // current filter returns a handful of rows.
  getAuditLog: ({ eventType, skuId, limit } = {}) => {
    const qs = new URLSearchParams();
    if (eventType) qs.set("event_type", eventType);
    if (skuId) qs.set("sku_id", skuId);
    if (limit) qs.set("limit", limit);
    const q = qs.toString();
    return request(`/audit${q ? `?${q}` : ""}`);
  },
};
