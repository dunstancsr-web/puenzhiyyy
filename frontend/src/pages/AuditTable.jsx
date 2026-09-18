import React, { useEffect, useState } from "react";
import LoadingState from "../components/LoadingState";
import ErrorState from "../components/ErrorState";
import ColHint from "../components/ColHint";
import { api } from "../api/inventory";

// ─────────────────────────────────────────────────────────────────────────────
// AUDIT TABLE - a deliberately plain, one-screen-wide view of every SKU, built
// fresh after the top-5 formula prioritisation exercise (18-19 Sep). Purpose:
// see whether the 5/4/4 columns onboarding actually asks for (product
// catalog, sales history, goods receipts) are enough to feed the five formulas
// judged most relevant to the chosen problem statement - not to look good, to
// look HONEST. Every column here is either exactly what onboarding collected
// (the "Uploaded" group) or a value read straight off a live API response -
// nothing here is invented, estimated in the frontend, or carried over from
// an earlier conversation. If a cell is empty, that is the actual finding:
// the basic data wasn't enough to compute it.
//
// No new backend endpoint for most of this: GET /api/skus already carries
// movement_class, health_status, safety_stock_mt, reorder_point_suggested,
// suggested_order_qty, forecast_active_model and forecast_avg_daily_demand
// (engines/index.js). Two extra live calls: GET /api/alerts (grouped by
// sku_id here, not recomputed) for the "#2 Triggers" group, and one
// GET /api/skus/:id/projection per SKU for "#4 Projected inventory" - that
// one genuinely isn't on the SKU list response, so there is no way to show it
// without asking the server directly.
// ─────────────────────────────────────────────────────────────────────────────

const fmt = (v, unit = "") => (v == null ? "–" : `${v}${unit}`);
const fmtDate = (v) => v || "–";

// ─────────────────────────────────────────────────────────────────────────────
// Two different reasons a cell can be empty, per Stan's ask (19 Sep) - and a
// third, unmarked default that most empty cells actually are:
//
//   GAP     an onboarded field this formula needs was left at its schema
//           default (target_stock or reorder_point_policy = 0) rather than a
//           real value - a genuine "go set this up" finding, traced back to
//           the specific uploaded column responsible.
//   PENDING the SKU doesn't have enough sales history yet for the figure to
//           mean anything (avg_daily_usage_30d = 0), or an available action
//           (running a forecast) simply hasn't been taken yet - resolves on
//           its own with time or one click, not a data-entry problem.
//   ok      (no colour) the formula ran on real inputs and genuinely has
//           nothing to report - a healthy SKU, not a gap of any kind.
//
// Classification only, no new computation: every check below reads a field
// GET /skus or GET /skus/:id/projection already returned.
// ─────────────────────────────────────────────────────────────────────────────
const TONE_STYLE = {
  gap: { background: "var(--orange-light)", color: "var(--orange)" },
  pending: { background: "var(--purple-light)", color: "var(--purple)" },
};

function classify(s, key, proj) {
  const noSales = !s.avg_daily_usage_30d;
  switch (key) {
    case "avgDailySales":
      return noSales ? { tone: "pending", note: "no sales recorded yet" } : { tone: "ok" };
    case "suggestedOrder":
      if (s.suggested_order_qty > 0) return { tone: "ok" };
      if (!s.target_stock) return { tone: "gap", note: "target stock was never set (0)" };
      return { tone: "ok" };
    case "firstStockout":
    case "firstSafetyBreach":
      if (proj?.[key === "firstStockout" ? "first_stockout_date" : "first_safety_breach_date"]) return { tone: "ok" };
      return noSales ? { tone: "pending", note: "no sales yet to project forward" } : { tone: "ok" };
    case "recoveryDate":
      if (proj?.recovery_date && !s.reorder_point_policy) return { tone: "gap", note: "reorder point was never set (0), so this date isn't meaningful" };
      return { tone: "ok" };
    case "model":
      if (s.forecast_active_model) return { tone: "ok" };
      return noSales
        ? { tone: "pending", note: "no sales history to forecast from yet" }
        : { tone: "pending", note: "forecasting is available for this SKU but hasn't been run" };
    default:
      return { tone: "ok" };
  }
}

export default function AuditTable() {
  const [skus, setSkus] = useState(null);
  const [alertsBySkuId, setAlertsBySkuId] = useState({});
  const [projectionBySkuId, setProjectionBySkuId] = useState({});
  const [error, setError] = useState(null);

  const load = () => {
    setError(null);
    setSkus(null);
    api.getSkus()
      .then(async (list) => {
        setSkus(list);

        const alerts = await api.getAlerts().catch(() => []);
        const grouped = {};
        for (const a of alerts) (grouped[a.sku_id] ||= []).push(a.alert_type);
        setAlertsBySkuId(grouped);

        const projections = await Promise.all(
          list.map((s) => api.getSkuProjection(s.sku_id).catch(() => null))
        );
        const byId = {};
        list.forEach((s, i) => { byId[s.sku_id] = projections[i]; });
        setProjectionBySkuId(byId);
      })
      .catch((err) => setError(err.message || "Failed to load"));
  };
  useEffect(load, []);

  if (error) return <ErrorState message={error} onRetry={load} />;
  if (!skus) return <LoadingState label="Loading every SKU, live…" />;

  return (
    <div>
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: "var(--text-xl)", fontWeight: 700 }}>Audit table</h1>
        <p style={{ fontSize: "var(--text-sm)", color: "var(--text-secondary)", marginTop: 4, maxWidth: "70ch" }}>
          Every SKU, one row each, fetched live just now - nothing cached or carried over. What's uploaded
          on the left, what the top-5 formulas produce from it on the right.
        </p>
        <div style={{ display: "flex", gap: 18, marginTop: 12, fontSize: "var(--text-xs)", color: "var(--text-secondary)" }}>
          <LegendItem tone="gap" label="Needs setup — an uploaded field was left blank" />
          <LegendItem tone="pending" label="Not yet — new SKU or an available action not run" />
          <LegendItem label="No colour — genuinely nothing to flag right now" />
        </div>
      </div>

      <div style={{ background: "var(--card-bg)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", boxShadow: "var(--shadow)", overflow: "hidden" }}>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 1500, fontSize: "var(--text-xs)" }}>
            <thead>
              <tr style={{ borderBottom: "1px solid var(--border)" }}>
                <GroupTh span={5} label="Uploaded" bg="var(--surface-2)" />
                <GroupTh span={2} label="Stock position" bg="var(--surface-2)" />
                <GroupTh span={2} label="#1 Movement class" bg="var(--blue-light)" />
                <GroupTh span={2} label="#2 Triggers" bg="var(--blue-light)" />
                <GroupTh span={3} label="#3 Reorder & safety stock" bg="var(--blue-light)" />
                <GroupTh span={4} label="#4 Projected inventory" bg="var(--blue-light)" />
                <GroupTh span={3} label="#5 Demand forecast" bg="var(--blue-light)" />
              </tr>
              <tr style={{ background: "var(--table-head-bg)", borderBottom: "1px solid var(--border)" }}>
                <Th label="SKU" />
                <Th label="Product" />
                <Th label="Lead time" />
                <Th label="Reorder pt (policy)" />
                <Th label="Target stock" />

                <Th label="On hand" />
                <Th label="Available" />

                <Th label="Class" tip={{
                  what: "Fast / Normal / Slow / Idle - how quickly this product actually moves, from real sales history.",
                  how: "Computed from the same rolling usage window as everywhere else in StockSense. Needs sales history to mean anything; a brand-new SKU with none shows as Idle by default, not an error.",
                }} />
                <Th label="Avg daily sales (30d)" />

                <Th label="Open alerts" tip={{
                  what: "Which of the six trigger rules (Shortage, Reorder, Overstock, Demand surge, Supplier delay, Idle/ageing) are currently firing for this SKU.",
                  how: "Read straight from GET /alerts, grouped here by SKU - not recomputed. A dash means no open alert, not that alerts were never checked.",
                }} />
                <Th label="Health" />

                <Th label="Safety stock" />
                <Th label="Reorder pt (suggested)" />
                <Th label="Suggested order" />

                <Th label="First stockout" tip={{
                  what: "The earliest future date the projected available stock is expected to hit zero, running the current on-hand/incoming/demand forward.",
                  how: "A dash means the 90-day projection never reaches zero, not that it wasn't checked.",
                }} />
                <Th label="First safety breach" />
                <Th label="Lowest point" />
                <Th label="Recovery date" />

                <Th label="Model" tip={{
                  what: "Which demand-forecast model (if any) is active for this SKU.",
                  how: "A dash means forecasting has never been run for this SKU - it's still relying on the plain 30-day average everywhere else in the app.",
                }} />
                <Th label="Forecast demand" />
                <Th label="Driving reorder pt?" />
              </tr>
            </thead>
            <tbody>
              {skus.map((s) => {
                const alerts = alertsBySkuId[s.sku_id] || [];
                const proj = projectionBySkuId[s.sku_id];
                return (
                  <tr key={s.sku_id} style={{ borderBottom: "1px solid var(--border)" }}>
                    <Td style={{ fontWeight: 600 }}>{s.sku_id}</Td>
                    <Td>{s.product_name}</Td>
                    <Td>{fmt(s.lead_time_days, "d")}</Td>
                    {/* Root causes, not just symptoms: these two are the actual
                        uploaded fields the "gap" cells to the right trace back
                        to, so they're marked at the source too. */}
                    <Td tone={s.reorder_point_policy ? "ok" : "gap"} note={s.reorder_point_policy ? null : "left blank on upload"}>
                      {fmt(s.reorder_point_policy, " MT")}
                    </Td>
                    <Td tone={s.target_stock ? "ok" : "gap"} note={s.target_stock ? null : "left blank on upload"}>
                      {fmt(s.target_stock, " MT")}
                    </Td>

                    <Td>{fmt(s.on_hand_qty, " MT")}</Td>
                    <Td>{fmt(s.available_qty, " MT")}</Td>

                    <Td>{s.movement_class || "–"}</Td>
                    <CellFor s={s} proj={proj} colKey="avgDailySales">{fmt(s.avg_daily_usage_30d, " MT")}</CellFor>

                    <Td>{alerts.length ? alerts.join(", ") : "–"}</Td>
                    <Td>{s.health_status || "–"}</Td>

                    <Td>{fmt(s.safety_stock_mt, " MT")}</Td>
                    <Td>{fmt(s.reorder_point_suggested, " MT")}</Td>
                    <CellFor s={s} proj={proj} colKey="suggestedOrder">{s.suggested_order_qty > 0 ? `${s.suggested_order_qty} MT` : "–"}</CellFor>

                    <CellFor s={s} proj={proj} colKey="firstStockout">{fmtDate(proj?.first_stockout_date)}</CellFor>
                    <CellFor s={s} proj={proj} colKey="firstSafetyBreach">{fmtDate(proj?.first_safety_breach_date)}</CellFor>
                    <Td>{proj ? fmt(proj.lowest_position, " MT") : "–"}</Td>
                    <CellFor s={s} proj={proj} colKey="recoveryDate">{fmtDate(proj?.recovery_date)}</CellFor>

                    <CellFor s={s} proj={proj} colKey="model">{s.forecast_active_model || "Not started"}</CellFor>
                    <Td>{fmt(s.forecast_avg_daily_demand, " MT")}</Td>
                    <Td>{s.use_forecast ? "Yes" : "No"}</Td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function GroupTh({ span, label, bg }) {
  return (
    <th colSpan={span} style={{
      padding: "8px 16px", textAlign: "left", fontSize: "var(--text-xs)", fontWeight: 700,
      color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: "0.04em",
      background: bg, borderLeft: "1px solid var(--border)",
    }}>
      {label}
    </th>
  );
}

function Th({ label, tip }) {
  return (
    <th style={{
      padding: "10px 16px", textAlign: "left", fontSize: "var(--text-xs)", fontWeight: 600,
      color: "var(--text-secondary)", whiteSpace: "nowrap",
    }}>
      <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
        {label}
        {tip && <ColHint label={label} what={tip.what} how={tip.how} />}
      </span>
    </th>
  );
}

function Td({ children, style, tone, note }) {
  const toneStyle = tone && TONE_STYLE[tone] ? TONE_STYLE[tone] : null;
  return (
    <td
      title={note || undefined}
      style={{
        padding: "10px 16px", whiteSpace: "nowrap", color: "var(--text-primary)",
        ...(toneStyle && { background: toneStyle.background, color: toneStyle.color, fontWeight: 600 }),
        ...style,
      }}
    >
      {children}
    </td>
  );
}

// Runs classify() and hands the result's tone/note straight to Td, so every
// derived column above only has to name which key it is, not repeat the
// tone-lookup boilerplate five times.
function CellFor({ s, proj, colKey, children }) {
  const { tone, note } = classify(s, colKey, proj);
  return <Td tone={tone === "ok" ? null : tone} note={note}>{children}</Td>;
}

function LegendItem({ tone, label }) {
  const toneStyle = tone && TONE_STYLE[tone];
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
      <span style={{
        width: 12, height: 12, borderRadius: 3, flexShrink: 0,
        background: toneStyle ? toneStyle.background : "var(--surface-2)",
        border: `1.5px solid ${toneStyle ? toneStyle.color : "var(--border)"}`,
      }} />
      {label}
    </span>
  );
}
