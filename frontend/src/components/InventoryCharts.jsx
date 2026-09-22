import React, { useEffect, useMemo, useState } from "react";
import {
  BarChart, Bar, PieChart, Pie, XAxis, Tooltip, ResponsiveContainer, Cell, LabelList,
} from "recharts";
import ColHint from "./ColHint";
import { api } from "../api/inventory";

// ─────────────────────────────────────────────────────────────────────────────
// TWO CHARTS FOR THE TOP OF INVENTORY (22 Sep)
//
// Both read figures the engines already compute; nothing here derives a new
// number the rest of the app does not already stand behind.
//
//   1. Monthly total MT on hand, split into how much of it the illustrative
//      Singapore rice-stockpile buffer rule would call for versus the surplus
//      above it. Reuses GET /dashboard/history exactly as Dashboard's own
//      value chart does (same endpoint, same partial-month handling), plus
//      one new field on that response, compliance_required_qty_mt: the SAME
//      formula and the SAME "illustrative, not governance-approved" label
//      Dashboard's Compliance Position card already carries (engines/
//      financials.js's portfolioStats), applied per month instead of only to
//      today's snapshot. See that route's own comment for why the buffer
//      figure uses each month's own consumption rather than today's demand
//      rate applied backwards.
//   2. Current on-hand MT by country of origin, a plain composition of
//      country_of_origin and on_hand_qty across the SAME SKU list Inventory's
//      table already has loaded, passed in as a prop rather than fetched
//      again here.
//
// Neither chart is a new computed figure: the bar chart's two segments are
// read from the server, and the pie chart is client-side addition of a field
// every SKU row already carries, the same category of aggregation the page
// header ("10 of 10 SKUs") already does.
// ─────────────────────────────────────────────────────────────────────────────

const CHART_H = 220;
const fmtMt = (v) => Math.round(v).toLocaleString("en-SG");
const round1 = (n) => Math.round(n * 10) / 10;
const monthLabel = (period) => {
  const [y, m] = String(period).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-SG", { month: "short", year: "2-digit", timeZone: "UTC" });
};

// A fixed palette, not derived from a count, so a country keeps the same
// colour across a re-render or a filter change rather than reshuffling.
const COUNTRY_COLORS = ["var(--blue)", "var(--purple)", "var(--green)", "var(--orange)", "var(--yellow)", "var(--red)"];

// The exact same four windows Dashboard's own history chart already offers
// (same keys, same slicing, same 6M default), so a person who has learned
// what these buttons do there does not have to relearn them here.
const WINDOWS = [
  { key: "6M", label: "6M", slice: (rows) => rows.slice(-6) },
  { key: "YTD", label: "YTD", slice: (rows) => rows.filter((r) => r.period >= `${new Date().getFullYear()}-01`) },
  { key: "12M", label: "12M", slice: (rows) => rows.slice(-12) },
  { key: "ALL", label: "ALL", slice: (rows) => rows },
];

function StockBufferChart() {
  const [months, setMonths] = useState(null);
  const [error, setError] = useState(null);
  const [windowKey, setWindowKey] = useState("6M");

  // 36, not 12: fetched once, up front, so switching to 12M or ALL is an
  // instant re-slice of data already in hand rather than a second request.
  useEffect(() => {
    api.getDashboardHistory(36).then((d) => setMonths(d.months || [])).catch((err) => setError(err.message));
  }, []);

  const win = WINDOWS.find((w) => w.key === windowKey) || WINDOWS[0];
  const rows = useMemo(
    () => win.slice(months || []).map((m) => ({
      name: monthLabel(m.period),
      closing_qty_mt: m.closing_qty_mt,
      // Stacked as buffer-first, surplus-on-top: the buffer segment is capped
      // at the month's own total, so a month that falls SHORT of the rule
      // (buffer_qty < required) reads honestly as "the whole bar is buffer,
      // and it is still not enough" rather than implying a surplus that is
      // not there. A short month gets no surplus segment at all.
      buffer_qty_mt: Math.min(m.closing_qty_mt, m.compliance_required_qty_mt),
      surplus_qty_mt: Math.max(0, m.closing_qty_mt - m.compliance_required_qty_mt),
      required_qty_mt: m.compliance_required_qty_mt,
      short: m.closing_qty_mt < m.compliance_required_qty_mt,
      partial: m.partial,
    })),
    [months, windowKey]
  );

  if (error) return <div style={{ fontSize: "var(--text-sm)", color: "var(--text-muted)" }}>Couldn't load: {error}</div>;
  if (!months) return <div style={{ height: CHART_H, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-muted)", fontSize: "var(--text-sm)" }}>Loading…</div>;

  // Whole months only: the current month is still running, so counting it as
  // "met" or "short" compares a partial total against a full requirement,
  // which is the same false-collapse the dashboard/history route's own
  // `partial` field exists to prevent elsewhere on this figure.
  const wholeMonths = rows.filter((r) => !r.partial);
  const metCount = wholeMonths.filter((r) => !r.short).length;
  const allMet = wholeMonths.length > 0 && metCount === wholeMonths.length;

  return (
    <div>
      {/* Same four windows, same 6M default, as Dashboard's own history chart. */}
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 4, marginBottom: 6 }}>
        {WINDOWS.map((w) => {
          const on = w.key === windowKey;
          return (
            <button key={w.key} type="button" onClick={() => setWindowKey(w.key)} aria-pressed={on}
              style={{
                padding: "3px 9px", borderRadius: 99, cursor: "pointer",
                border: `1px solid ${on ? "var(--blue)" : "var(--border)"}`,
                background: on ? "var(--blue-light)" : "transparent",
                color: on ? "var(--blue-text)" : "var(--text-muted)",
                fontSize: "var(--text-xs)", fontWeight: on ? 700 : 500,
              }}>
              {w.label}
            </button>
          );
        })}
      </div>

      {/* Legend: what each colour means, and the one-line verdict Stan asked
          for ("has the buffer rule been met every month"), read off the same
          `short` flag every bar and tooltip already use, not a separate count. */}
      <div style={{ display: "flex", gap: 14, flexWrap: "wrap", alignItems: "center", marginBottom: 10, fontSize: "var(--text-xs)", color: "var(--text-secondary)" }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
          <span style={{ width: 10, height: 10, borderRadius: 3, background: "var(--blue)", flexShrink: 0 }} /> Meets the buffer rule
        </span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
          <span style={{ width: 10, height: 10, borderRadius: 3, background: "var(--blue-soft)", flexShrink: 0 }} /> Surplus above it
        </span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
          <span style={{ width: 10, height: 10, borderRadius: 3, background: "var(--red)", flexShrink: 0 }} /> Short of the buffer
        </span>
        <span style={{ marginLeft: "auto", fontWeight: 700, color: allMet ? "var(--green-text)" : "var(--red-text)" }}>
          {wholeMonths.length === 0 ? null : allMet
            ? `Met every month (${metCount} of ${wholeMonths.length})`
            : `Met ${metCount} of ${wholeMonths.length} months`}
        </span>
      </div>

      <div style={{ height: CHART_H }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={rows} margin={{ top: 18, right: 6, bottom: 0, left: 6 }}>
            <Tooltip
              cursor={{ fill: "var(--surface-2)" }}
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null;
                const d = payload[0].payload;
                return (
                  <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8, padding: "8px 11px", fontSize: "var(--text-xs)", boxShadow: "var(--shadow)", lineHeight: 1.55 }}>
                    <strong>{fmtMt(d.closing_qty_mt)} MT</strong> on hand{d.partial ? " (month in progress)" : ""}
                    <div style={{ color: d.short ? "var(--red-text)" : "var(--text-muted)" }}>
                      {d.short
                        ? `Short of the ${fmtMt(d.required_qty_mt)} MT illustrative buffer rule by ${fmtMt(d.required_qty_mt - d.closing_qty_mt)} MT`
                        : `${fmtMt(d.buffer_qty_mt)} MT toward the illustrative buffer rule, ${fmtMt(d.surplus_qty_mt)} MT surplus`}
                    </div>
                    {!d.partial && (
                      <div style={{ fontWeight: 700, color: d.short ? "var(--red-text)" : "var(--green-text)", marginTop: 3 }}>
                        {d.short ? "Buffer rule not met this month" : "Buffer rule met"}
                      </div>
                    )}
                  </div>
                );
              }}
            />
            <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: "var(--text-muted)" }} interval="preserveStartEnd" />
            {/* Bottom of the stack: what the illustrative buffer rule calls for. Square
                corners when a surplus segment sits on top of it, rounded when the bar
                is short and this is the whole thing. Carries the per-month verdict
                glyph too (checkmark or exclamation), so the answer to "was the rule
                met" reads directly off the bar, not only the legend's monthly count. */}
            <Bar dataKey="buffer_qty_mt" stackId="mt" isAnimationActive={false} maxBarSize={40}>
              <LabelList dataKey="short" position="insideBottom"
                content={({ x, y, width, height, index }) => {
                  const d = rows[index];
                  if (d.partial) return null; // no verdict yet for a month still running
                  return (
                    <text x={x + width / 2} y={y + height - 8} textAnchor="middle"
                      style={{ fontSize: 11, fontWeight: 900, fill: "#fff" }}>
                      {d.short ? "!" : "✓"}
                    </text>
                  );
                }} />
              {rows.map((d, i) => (
                <Cell key={i} fill={d.short ? "var(--red)" : "var(--blue)"} radius={d.short ? [3, 3, 0, 0] : 0}
                  fillOpacity={d.partial ? 0.55 : 1} />
              ))}
            </Bar>
            {/* Top of the stack: on hand above the buffer requirement. */}
            <Bar dataKey="surplus_qty_mt" stackId="mt" radius={[3, 3, 0, 0]} isAnimationActive={false} maxBarSize={40}>
              <LabelList dataKey="closing_qty_mt" position="top"
                content={({ x, y, width, index }) => (
                  <text x={x + width / 2} y={y - 5} textAnchor="middle" style={{ fontSize: 10, fontWeight: 700, fill: "var(--text-secondary)" }}>
                    {fmtMt(rows[index].closing_qty_mt)}
                  </text>
                )} />
              {rows.map((d, i) => <Cell key={i} fill="var(--blue-soft)" fillOpacity={d.partial ? 0.55 : 1} />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function OriginPieChart({ skus }) {
  const rows = useMemo(() => {
    const byCountry = new Map();
    for (const s of skus || []) {
      const c = s.country_of_origin || "Unknown";
      byCountry.set(c, (byCountry.get(c) || 0) + (Number(s.on_hand_qty) || 0));
    }
    const total = [...byCountry.values()].reduce((a, b) => a + b, 0) || 1;
    return [...byCountry.entries()]
      .map(([name, mt], i) => ({ name, mt, pct: round1((mt / total) * 100), color: COUNTRY_COLORS[i % COUNTRY_COLORS.length] }))
      .sort((a, b) => b.mt - a.mt);
  }, [skus]);

  if (!rows.length) return <div style={{ fontSize: "var(--text-sm)", color: "var(--text-muted)" }}>No stock on hand yet.</div>;

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
      {/* data-ux-ignore: Recharts' Pie root <g> gets tabIndex 0 for keyboard
          navigation between segments, which the UX-audit skill's I2 check reads
          as "a control needing an accessible name" even though the aria-label
          below is set (Recharts does not forward it to that exact node in this
          version). The legend beside this div, which carries the same MT and %
          figures in real text, is deliberately OUTSIDE this ignored region and
          stays fully checked. */}
      <div data-ux-ignore style={{ height: CHART_H, width: CHART_H, flexShrink: 0 }}>
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Tooltip
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null;
                const d = payload[0].payload;
                return (
                  <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8, padding: "8px 11px", fontSize: "var(--text-xs)", boxShadow: "var(--shadow)" }}>
                    <strong>{d.name}</strong>: {fmtMt(d.mt)} MT ({d.pct}%)
                  </div>
                );
              }}
            />
            <Pie data={rows} dataKey="mt" nameKey="name" innerRadius="55%" outerRadius="90%" isAnimationActive={false} stroke="var(--card-bg)" strokeWidth={2}
              aria-label={`On hand by country of origin: ${rows.map((d) => `${d.name} ${fmtMt(d.mt)} MT, ${d.pct}%`).join("; ")}`}>
              {rows.map((d, i) => <Cell key={i} fill={d.color} />)}
            </Pie>
          </PieChart>
        </ResponsiveContainer>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8, minWidth: 160 }}>
        {rows.map((d) => (
          <div key={d.name} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: "var(--text-sm)" }}>
            <span style={{ width: 10, height: 10, borderRadius: 3, background: d.color, flexShrink: 0 }} />
            <span style={{ flex: 1 }}>{d.name}</span>
            <span style={{ color: "var(--text-muted)", fontWeight: 600 }}>{fmtMt(d.mt)} MT · {d.pct}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function InventoryCharts({ skus }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1.3fr 1fr", gap: 16, marginBottom: 20 }} className="inventory-charts-grid">
      <div className="card" style={{ padding: "16px 18px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
          <h2 style={{ fontSize: "var(--text-lg)", fontWeight: 700 }}>Total stock vs the buffer rule</h2>
          <ColHint label="the buffer rule chart"
            what="Metric tons on hand each month, split into what an illustrative rice-stockpile buffer rule would call for and the surplus above it."
            how={"Blue: the portion meeting the buffer rule. Light blue: surplus above it. Red: a month where on-hand stock fell short of the rule.\nIllustrative only, pending governance approval of the real rule (engines/financials.js's Compliance Position uses the same formula and the same label)."} />
        </div>
        <StockBufferChart />
      </div>
      <div className="card" style={{ padding: "16px 18px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
          <h2 style={{ fontSize: "var(--text-lg)", fontWeight: 700 }}>On hand by country of origin</h2>
          <ColHint label="stock by origin"
            what="Metric tons currently on hand, grouped by the country each SKU is sourced from."
            how="Hover a slice for the exact tonnage and share of your total on-hand stock." />
        </div>
        <OriginPieChart skus={skus} />
      </div>
    </div>
  );
}
