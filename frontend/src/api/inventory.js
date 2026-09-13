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
    res = await fetch(`${BASE}${path}`, {
      headers: { "Content-Type": "application/json", ...options.headers },
      ...options,
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
    throw new Error(body.message || `Request failed (${res.status})`);
  }
  return body.data;
}

export const api = {
  // SKUs
  getSkus: () => request("/skus"),
  getSku: (id) => request(`/skus/${id}`),
  createSku: (body) => request("/skus", { method: "POST", body }),
  updateSku: (id, body) => request(`/skus/${id}`, { method: "PUT", body }),
  restockSku: (skuId, quantity) =>
    request("/inventory/restock", { method: "POST", body: { sku_id: skuId, quantity } }),
  getSkuProjection: (id) => request(`/skus/${id}/projection`),

  // Dashboard
  getDashboardStats: () => request("/dashboard/stats"),

  // Alerts
  getAlerts: () => request("/alerts"),
  acknowledgeAlert: (id) => request(`/alerts/${id}/acknowledge`, { method: "POST" }),

  // Decisions (TASK-12) - Approve/Modify/Reject audit trail
  getDecisions: () => request("/decisions"),
  createDecision: (body) => request("/decisions", { method: "POST", body }),

  // AI explanation (TASK-11). Always resolves, never rejects on a model
  // problem: the backend answers { available: false, reason } when no model is
  // configured or reachable, because the caller already has a deterministic
  // explanation to show instead.
  explainAlert: (skuId, alertType) =>
    request("/alerts/explain", { method: "POST", body: { sku_id: skuId, alert_type: alertType } }),

  // Model tier (TASK-42). Which engine answers "Why?", and what it costs.
  getLlmMode: () => request("/llm/mode"),
  setLlmMode: (mode) => request("/llm/mode", { method: "POST", body: { mode } }),

  // Warehouse floor (TASK-46/47)
  getOperators: () => request("/warehouse/operators"),
  warehouseLogin: (pin) => request("/warehouse/login", { method: "POST", body: { pin } }),
  getInbound: () => request("/warehouse/inbound"),
  receiveGoods: (body) => request("/warehouse/inbound/receive", { method: "POST", body }),
  getOutbound: () => request("/warehouse/outbound"),
  pickGoods: (body) => request("/warehouse/outbound/pick", { method: "POST", body }),
  getMovements: () => request("/warehouse/movements"),

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
