// Fetch client for backend/src/routes/inventory.js - the real SQLite + analytics
// backend (TASK-09/10). Response shape is always { success, data, message? };
// `request()` unwraps it to just the `data` payload and throws on failure so
// callers can `await` directly and catch one error type.

const BASE = "/api";

async function request(path, options = {}) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "Content-Type": "application/json", ...options.headers },
    ...options,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body.success === false) throw new Error(body.message || `Request failed (${res.status})`);
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
};
