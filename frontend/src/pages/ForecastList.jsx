import React, { useState, useEffect, useMemo } from "react";
import { Link } from "react-router-dom";
import { ChevronRight, ChevronUp, ChevronDown } from "lucide-react";
import LoadingState from "../components/LoadingState";
import ErrorState from "../components/ErrorState";
import ColHint from "../components/ColHint";
import { api } from "../api/inventory";

// One header, one explanation, so a reader never gets a different answer for
// the same column on two different visits. "Current -> Suggested" (not
// "Approved -> Suggested") on purpose: Alerts and the rest of the app already
// say "approved" for the reorder point a manager has signed off on, but this
// table pairs it against a number that isn't approved yet, and "current vs
// suggested" reads as a comparison, not two states of the same approval.
const COLUMN_TIPS = {
  status: {
    what: "Which demand-forecast model is active for this SKU: Naive seasonal, Linear trend, Holt-Winters, or Holt damped + seasonal. “Not started” means no forecast has been run yet.",
    how: "Auto picks whichever model backtested with the lowest WMAPE; open the SKU's Forecast page to compare them or pick one by hand. “Driving reorder point” means this forecast is the one actually feeding safety stock and the reorder point today, not just sitting there for reference.",
  },
  wmape: {
    what: "Weighted Mean Absolute Percentage Error: how far off, on average, the active model's own past predictions were from what actually sold, from a walk-forward backtest.",
    how: "Lower is better; 0 would mean the model never missed. This is the MODEL's own track record, not a margin of error on the reorder point pair beside it. That comparison is Gap, to the right.",
  },
  reorder: {
    what: "The reorder point, before and after. CURRENT is the approved policy value that alerts and health status key off today. SUGGESTED is what the safety-stock formula recommends instead, from this product's forecast demand, lead time and target service level.",
    how: "Suggested shows in blue when this SKU's forecast is switched on and actually driving the reorder point; grey when a forecast exists but isn't enabled, or hasn't been generated yet.",
  },
  gap: {
    what: "How far Suggested is from Current, as a percentage of Current: the same reorder-point pair shown just to the left, not a separate measurement.",
    how: "0% means the two already match. A gap large enough matters is what raises a policy-change suggestion on Alerts. This is not forecast accuracy, that's WMAPE, two columns over.",
  },
  stale: {
    what: "How long ago this SKU's active forecast was generated. Shown as a dash when no forecast has been run yet.",
    how: "Flagged yellow past 14 days, red past 30: a judgement call about how stale is too stale, not a rule derived from anything. Open the SKU's Forecast page to recompute.",
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// FORECAST OVERVIEW (MVP2 Day 6) - the portfolio-wide list Stan asked for:
// "is there a way you can create a standalone forecast tab (at the side panel
// there)". Reachable from a link on the Inventory page, deliberately NOT added
// to Sidebar.jsx's permanent nav - Stan's call, since MVP2 is still a feature
// branch and Sidebar's own comment already reasons carefully about the four
// destinations it holds. Add the route there once this ships to main.
//
// No new backend endpoint: GET /api/skus already carries every field used
// here (forecast_active_model, forecast_backtest_score, forecast_generated_at
// added today specifically so this page and the freshness nudge below don't
// need N+1 requests into GET /skus/:id/forecast per row).
// ─────────────────────────────────────────────────────────────────────────────

const STALE_DAYS = 14; // past this, a nudge to recompute - a judgment call, not a rule from anywhere
const VERY_STALE_DAYS = 30;

function daysAgo(iso) {
  if (!iso) return null;
  // SQLite's CURRENT_TIMESTAMP is UTC with a space, not 'T' - Safari's Date
  // parser silently fails on that; Chrome tolerates it, but never rely on it.
  const ms = Date.now() - new Date(iso.replace(" ", "T") + "Z").getTime();
  return Math.floor(ms / 86_400_000);
}
function relativeLabel(days) {
  if (days == null) return "-";
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days} days ago`;
  const months = Math.round(days / 30);
  return `${months} month${months === 1 ? "" : "s"} ago`;
}

export default function ForecastList() {
  const [skus, setSkus] = useState(null);
  const [error, setError] = useState(null);
  const [sortKey, setSortKey] = useState("gap");
  const [sortDir, setSortDir] = useState("desc");

  const load = () => {
    setError(null);
    api.getSkus().then(setSkus).catch((err) => setError(err.message || "Failed to load"));
  };
  useEffect(load, []);

  const rows = useMemo(() => {
    if (!skus) return [];
    const withMeta = skus.map((s) => {
      const approved = s.reorder_point_policy || 0;
      const suggested = s.reorder_point_suggested_with_risk || 0;
      const gap = approved > 0 ? Math.abs(suggested - approved) / approved : suggested > 0 ? 1 : 0;
      const stale = daysAgo(s.forecast_generated_at);
      return { ...s, _gap: gap, _staleDays: stale };
    });
    const dir = sortDir === "asc" ? 1 : -1;
    const sorters = {
      sku: (a, b) => a.product_name.localeCompare(b.product_name),
      status: (a, b) => (a.forecast_model || "").localeCompare(b.forecast_model || ""),
      wmape: (a, b) => (a.forecast_backtest_score ?? 999) - (b.forecast_backtest_score ?? 999),
      gap: (a, b) => a._gap - b._gap,
      stale: (a, b) => (a._staleDays ?? -1) - (b._staleDays ?? -1),
    };
    return [...withMeta].sort((a, b) => dir * sorters[sortKey](a, b));
  }, [skus, sortKey, sortDir]);

  const enabledCount = skus ? skus.filter((s) => s.use_forecast).length : 0;
  const startedCount = skus ? skus.filter((s) => s.forecast_model).length : 0;

  const toggleSort = (key) => {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(key); setSortDir("desc"); }
  };

  if (error) return <ErrorState message={error} onRetry={load} />;
  if (!skus) return <LoadingState label="Loading forecast overview…" />;

  return (
    <div>
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: "var(--text-xl)", fontWeight: 700 }}>Forecast overview</h1>
        <p style={{ fontSize: "var(--text-sm)", color: "var(--text-secondary)", marginTop: 4 }}>
          {startedCount} of {skus.length} SKUs have a forecast · {enabledCount} driving safety stock &amp; reorder point
        </p>
      </div>

      <div style={{ background: "var(--card-bg)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", boxShadow: "var(--shadow)", overflow: "hidden" }}>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 900 }}>
            <thead>
              <tr style={{ background: "var(--table-head-bg)", borderBottom: "1px solid var(--border)" }}>
                <Th label="SKU" sortKey="sku" active={sortKey} dir={sortDir} onClick={toggleSort} />
                <Th label="Model" sortKey="status" active={sortKey} dir={sortDir} onClick={toggleSort} tip={COLUMN_TIPS.status} />
                <Th label="WMAPE" sortKey="wmape" active={sortKey} dir={sortDir} onClick={toggleSort} tip={COLUMN_TIPS.wmape} />
                <th style={thStyle}>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                    Current &rarr; Suggested
                    <ColHint label="Current to Suggested" what={COLUMN_TIPS.reorder.what} how={COLUMN_TIPS.reorder.how} />
                  </span>
                </th>
                <Th label="Gap" sortKey="gap" active={sortKey} dir={sortDir} onClick={toggleSort} tip={COLUMN_TIPS.gap} />
                <Th label="Last recomputed" sortKey="stale" active={sortKey} dir={sortDir} onClick={toggleSort} tip={COLUMN_TIPS.stale} />
                <th style={thStyle}></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((s, i) => (
                <tr key={s.sku_id} style={{ borderBottom: i < rows.length - 1 ? "1px solid var(--border)" : "none" }}>
                  <td style={{ padding: "13px 16px" }}>
                    <div style={{ fontWeight: 600, fontSize: "var(--text-sm)" }}>{s.product_name}</div>
                    <div style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)", marginTop: 1 }}>{s.sku_id}</div>
                  </td>
                  <td style={{ padding: "13px 16px" }}>
                    {s.forecast_model ? (
                      <div>
                        <div style={{ fontSize: "var(--text-sm)", fontWeight: 600 }}>
                          {(s.forecast_active_model || s.forecast_model).replace("_", " ")}
                        </div>
                        {s.use_forecast ? (
                          <span style={{ fontSize: "var(--text-xs)", color: "var(--green-text)", fontWeight: 600 }}>Driving reorder point</span>
                        ) : (
                          <span style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)" }}>Not enabled</span>
                        )}
                      </div>
                    ) : (
                      <span style={{ fontSize: "var(--text-sm)", color: "var(--text-muted)" }}>Not started</span>
                    )}
                  </td>
                  <td style={{ padding: "13px 16px", fontSize: "var(--text-sm)", fontVariantNumeric: "tabular-nums" }}>
                    {s.forecast_backtest_score != null ? s.forecast_backtest_score : "-"}
                  </td>
                  <td style={{ padding: "13px 16px", fontSize: "var(--text-sm)", fontVariantNumeric: "tabular-nums" }}>
                    {Math.round(s.reorder_point_policy)} MT
                    <span style={{ color: "var(--text-muted)", margin: "0 4px" }}>&rarr;</span>
                    <span style={{ color: s.use_forecast ? "var(--blue-text)" : "var(--text-muted)", fontWeight: 600 }}>
                      {Math.round(s.reorder_point_suggested_with_risk)} MT
                    </span>
                  </td>
                  <td style={{ padding: "13px 16px", fontSize: "var(--text-sm)", fontVariantNumeric: "tabular-nums" }}>
                    {/* Real regardless of forecast status - reorder_point_suggested_with_risk
                        is always computed (falls back to the 30-day average when there's no
                        active forecast), same as the Current -> Suggested pair beside it. */}
                    {Math.round(s._gap * 100)}%
                  </td>
                  <td style={{ padding: "13px 16px", fontSize: "var(--text-sm)" }}>
                    {s.forecast_model ? (
                      <span style={{
                        color: s._staleDays >= VERY_STALE_DAYS ? "var(--red)" : s._staleDays >= STALE_DAYS ? "var(--yellow)" : "var(--text-secondary)",
                        fontWeight: s._staleDays >= STALE_DAYS ? 700 : 400,
                      }}>
                        {relativeLabel(s._staleDays)}
                        {s._staleDays >= STALE_DAYS && ", recompute?"}
                      </span>
                    ) : "-"}
                  </td>
                  <td style={{ padding: "13px 16px", textAlign: "right" }}>
                    <Link to={`/inventory/${s.sku_id}/forecast`} className="touch-44" style={{
                      display: "inline-flex", alignItems: "center", gap: 4, fontSize: "var(--text-xs)", fontWeight: 700,
                      color: "var(--blue-text)", textDecoration: "none", minHeight: 28, padding: "0 6px",
                    }}>
                      Open <ChevronRight size={13} />
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

const thStyle = {
  padding: "12px 16px", textAlign: "left", fontSize: "var(--text-xs)", fontWeight: 600,
  color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: "0.03em",
};

function Th({ label, sortKey, active, dir, onClick, tip }) {
  const isActive = active === sortKey;
  return (
    <th style={thStyle} aria-sort={isActive ? (dir === "asc" ? "ascending" : "descending") : "none"}>
      <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
        <button
          type="button"
          className="touch-44 focus-ring"
          onClick={() => onClick(sortKey)}
          style={{
            all: "unset", cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 4, minHeight: 28,
          }}
        >
          {label}
          {isActive && (dir === "asc" ? <ChevronUp size={12} /> : <ChevronDown size={12} />)}
        </button>
        {/* Outside the sort button on purpose (ModelPicker's own fix, ForecastDetail.jsx):
            a <button> can't contain another interactive control, and stopPropagation
            alone wouldn't stop the hint's click from also toggling sort. */}
        {tip && <ColHint label={label} what={tip.what} how={tip.how} />}
      </span>
    </th>
  );
}
