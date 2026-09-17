import React, { useState, useMemo, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { useNavigate, Link } from "react-router-dom";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine,
} from "recharts";
import { Search, Filter, Plus, ChevronUp, ChevronDown, ChevronRight, TrendingUp, X } from "lucide-react";
import Badge from "../components/Badge";
import ColHint from "../components/ColHint";
import StockPositionBar from "../components/StockPositionBar";
import LoadingState from "../components/LoadingState";
import ErrorState from "../components/ErrorState";
import { TextField, NumberField, SliderField, niceCeil } from "../components/FormField";
import { api } from "../api/inventory";
// Used only for the SkuEditForm's instant live-preview strip while dragging sliders
// (no round-trip per keystroke) - the actual Save always persists via the real API
// below. Formulas are identical post the domain-alignment rename, so the preview
// matches what the server will return.
import { computeSkuAnalytics } from "../mock/analytics";
import Modal, { ModalBtn } from "../components/Modal";
import BulkEdit from "../components/BulkEdit";

const HEALTH_STATUSES = ["All", "RED", "ORANGE", "YELLOW", "GREEN"];
const MOVEMENT_CLASSES = ["All", "Fast Moving", "Normal", "Slow Moving", "Idle"];

const HEALTH_ORDER = { RED: 0, ORANGE: 1, YELLOW: 2, GREEN: 3 };

// ── Column definitions ──────────────────────────────────────────────────────
const COLS = [
  {
    key: "health_status", label: "Status", width: "15%",
    tip: {
      what: "The overall health of this SKU's inventory position.",
      how: "🔴 RED - Critical. Either you'll run out before the next shipment arrives, or stock has been sitting idle too long.\n🟠 ORANGE - Action needed soon. You're approaching your reorder point or you're holding too much stock.\n🟡 YELLOW - Watch this one. It's slow-moving or drifting toward a problem.\n🟢 GREEN - You're in good shape. No action needed right now.",
    },
  },
  {
    key: "product_name", label: "Product", width: "17%",
    tip: {
      what: "The rice SKU name, internal SKU code, country of origin, and supplier.",
      how: "Use the search bar above to find a specific product by name, SKU code, or supplier. Click a product to open its full record.",
    },
  },
  {
    key: "available_qty", label: "Stock Position", width: "28%",
    tip: {
      what: "Where this SKU's available stock sits against its reorder point and maximum.",
      how: "The coloured bar is available stock; its colour is the health status - red below the reorder point, amber just above it, green healthy, purple overstock.\n\nThe two tick marks are the reorder point and the maximum, labelled with their values beneath. Grey shading marks the ranges to avoid: below the reorder point (order now) or above the maximum (overstock). Aim to keep the bar between the two ticks.\n\nAvailable = on-hand stock − reserved for orders − quality hold.",
    },
  },
  {
    key: "days_of_cover", label: "Coverage vs Lead Time", width: "13%",
    tip: {
      what: "How many days your current stock will last, compared to how long it takes to get more.",
      how: "Formula: Days of cover = Available stock ÷ Average daily sales (last 30 days).\n\nThe grey marker on the mini bar shows your supplier's lead time. If the coloured bar doesn't reach the marker - you will run out before new stock arrives.\n\nExample: 26 days of cover, 45-day lead time = 19-day gap. Red bar, order now.\n\nIf no demand is shown, this SKU hasn't sold anything recently and is classified as Idle.",
    },
  },
  {
    key: "movement_class", label: "Movement", width: "12%",
    tip: {
      what: "How quickly this SKU is selling, based on recent sales data.",
      how: "🔵 Fast Moving - High daily sales. Priority: prevent stockouts.\n⚫ Normal - Steady demand. Maintain target stock.\n🟡 Slow Moving - Low sales relative to stock on hand. Consider reducing the next order.\n🔴 Idle - No meaningful sales in 90+ days. Stop ordering and review whether to discount, redirect, or dispose.\n\nThe number below is average daily consumption in MT.",
    },
  },
  {
    key: null, label: "Actions", width: "15%",
    tip: {
      what: "Quick actions you can take on this SKU.",
      how: "Restock - record a new incoming quantity (e.g. a shipment just arrived).\nEdit - open the full SKU record to change policy thresholds, supplier, costs, lead time, and stock adjustments.",
    },
  },
];

// Which fields the edit form writes, grouped for layout.
const EDIT_GROUPS = [
  {
    title: "Identity",
    fields: [
      ["product_name", "text", "Product name", true],
      ["rice_variety", "text", "Rice variety"],
      ["grade", "text", "Grade"],
      ["country_of_origin", "text", "Country of origin"],
      ["brand", "text", "Brand"],
      ["supplier", "text", "Supplier"],
      ["packaging_size", "text", "Packaging size"],
    ],
  },
  {
    title: "Inventory Policy",
    fields: [
      ["min_stock", "num", "Min stock", false, "MT"],
      ["target_stock", "num", "Target stock", false, "MT"],
      ["max_stock", "num", "Max stock", false, "MT"],
      ["reorder_point_policy", "num", "Reorder point", false, "MT"],
      ["lead_time_days", "num", "Lead time", false, "days"],
      ["target_service_level_pct", "num", "Target service level", false, "%"],
      ["safety_stock_pct", "num", "Safety stock", false, "%"],
      ["min_order_qty", "num", "Min order qty", false, "MT"],
    ],
  },
  {
    title: "Costs",
    fields: [
      ["unit_cost_sgd", "num", "Unit cost", false, "SGD"],
      ["unit_price_sgd", "num", "Unit price", false, "SGD"],
    ],
  },
  {
    title: "Stock Adjustments",
    fields: [
      ["reserved_qty", "num", "Reserved for orders", false, "MT"],
      ["quality_hold_qty", "num", "Quality hold", false, "MT"],
    ],
  },
];

const NUMERIC_EDIT_KEYS = EDIT_GROUPS.flatMap((g) =>
  g.fields.filter(([, t]) => t === "num").map(([k]) => k)
);

// Which SkuEditForm tab each EDIT_GROUPS section renders under (visual overhaul,
// 2026-09) - "Overview" (the default tab) has no EDIT_GROUPS section at all;
// it's built from read-only SKU data instead. See SkuEditForm below.
const TAB_FOR_GROUP = {
  "Inventory Policy": "policy",
  "Identity": "details",
  "Costs": "details",
  "Stock Adjustments": "details",
};
const TABS = [
  { id: "overview", label: "Overview" },
  { id: "policy", label: "Policy" },
  { id: "details", label: "Details" },
];

// Which numeric fields render as a slider (+ number), and how their range is set.
// Keys absent here (unit cost / price, min order qty) stay plain number inputs.
const SLIDER_SPECS = {
  min_stock: { kind: "stock" },
  reorder_point_policy: { kind: "stock" },
  target_stock: { kind: "stock" },
  max_stock: { kind: "stock" },
  reserved_qty: { kind: "physical" },
  quality_hold_qty: { kind: "physical" },
  target_service_level_pct: { min: 50, max: 99.9, step: 0.5 },
  safety_stock_pct: { min: 0, max: 50, step: 1 },
  lead_time_days: { min: 1, max: 120, step: 1 },
};

function resolveSpec(spec, { axisMax, physicalStock }) {
  if (spec.kind === "stock") return { min: 0, max: axisMax, step: 5 };
  if (spec.kind === "physical")
    return { min: 0, max: Math.max(1, physicalStock || 0), step: 1, disabled: !physicalStock };
  return spec;
}

const STOCK_SLIDER_KEYS = ["min_stock", "reorder_point_policy", "target_stock", "max_stock"];
const stockAxisMax = (form, physicalStock = 0) =>
  niceCeil(
    Math.max(...STOCK_SLIDER_KEYS.map((k) => Number(form[k]) || 0), Number(physicalStock) || 0) * 1.15
  );

export default function Inventory() {
  const [skus, setSkus] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [search, setSearch] = useState("");
  const [healthFilter, setHealthFilter] = useState("All");
  const [movementFilter, setMovementFilter] = useState("All");
  const [originFilter, setOriginFilter] = useState("All");
  const [sortKey, setSortKey] = useState("health_status");
  const [sortDir, setSortDir] = useState("asc");
  const [restockTarget, setRestockTarget] = useState(null);
  const [restockQty, setRestockQty] = useState("");
  const [showAddModal, setShowAddModal] = useState(false);
  const [selectedSku, setSelectedSku] = useState(null);

  const loadSkus = useCallback(() => {
    setLoadError(null);
    setSkus(null);
    api.getSkus().then(setSkus).catch((err) => setLoadError(err.message || "Failed to load inventory"));
  }, []);

  useEffect(() => { loadSkus(); }, [loadSkus]);

  const ORIGINS = useMemo(
    () => ["All", ...new Set((skus || []).map((s) => s.country_of_origin)).values()],
    [skus]
  );

  // ── Sort + filter ──────────────────────────────────────────────────────────
  // Counted across the whole catalogue, not the filtered view: the subtitle
  // reports the state of the business, which does not change because someone
  // typed in the search box.
  const needsAttention = useMemo(
    () => (skus || []).filter((s) => s.health_status !== "GREEN").length,
    [skus]
  );

  const filtered = useMemo(() => {
    let result = skus || [];
    if (search) {
      const q = search.toLowerCase();
      result = result.filter(
        (s) =>
          s.product_name.toLowerCase().includes(q) ||
          s.sku_id.toLowerCase().includes(q) ||
          s.rice_variety.toLowerCase().includes(q) ||
          s.supplier.toLowerCase().includes(q)
      );
    }
    if (healthFilter !== "All") result = result.filter((s) => s.health_status === healthFilter);
    if (movementFilter !== "All") result = result.filter((s) => s.movement_class === movementFilter);
    if (originFilter !== "All") result = result.filter((s) => s.country_of_origin === originFilter);

    return [...result].sort((a, b) => {
      let av = a[sortKey], bv = b[sortKey];
      if (sortKey === "health_status") {
        av = HEALTH_ORDER[av] ?? 9;
        bv = HEALTH_ORDER[bv] ?? 9;
      }
      if (av === null) return 1;
      if (bv === null) return -1;
      if (typeof av === "string") av = av.toLowerCase();
      if (typeof bv === "string") bv = bv.toLowerCase();
      if (av < bv) return sortDir === "asc" ? -1 : 1;
      if (av > bv) return sortDir === "asc" ? 1 : -1;
      return 0;
    });
  }, [skus, search, healthFilter, movementFilter, originFilter, sortKey, sortDir]);

  const handleSort = (key) => {
    if (!key) return;
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(key); setSortDir("asc"); }
  };

  // ── Mutations - all routed through the real backend (TASK-10); the server's
  // recomputed SKU (not a client-side recompute) is the source of truth ──────
  const replaceSku = (updated) =>
    setSkus((prev) => prev.map((s) => (s.sku_id === updated.sku_id ? updated : s)));

  const [restockSaving, setRestockSaving] = useState(false);
  const [restockError, setRestockError] = useState(null);

  const handleRestock = async () => {
    const qty = parseFloat(restockQty);
    // Used to just `return` here on a zero/negative/unparseable quantity -
    // the button looked like it did nothing, with no indication why. The
    // native <input type="number" min={0.1}> attributes look like validation
    // but never actually run: this button isn't a form submit, so HTML5
    // constraint validation never triggers on click.
    if (!qty || qty <= 0) {
      setRestockError("Enter a quantity greater than 0.");
      return;
    }
    setRestockSaving(true);
    setRestockError(null);
    try {
      const updated = await api.restockSku(restockTarget.sku_id, qty);
      replaceSku(updated);
      setRestockTarget(null);
      setRestockQty("");
    } catch (err) {
      setRestockError(err.message || "Failed to restock");
    } finally {
      setRestockSaving(false);
    }
  };

  // patch -> Promise, so SkuEditForm can await and surface a server error inline.
  const handleSkuSave = async (patch) => {
    const updated = await api.updateSku(selectedSku.sku_id, patch);
    replaceSku(updated);
    setSelectedSku(null);
  };

  // data -> Promise, so AddSkuForm can await and surface a server error inline.
  const handleAddSku = async (data) => {
    const created = await api.createSku(data);
    setSkus((prev) => [...prev, created]);
    setShowAddModal(false);
  };

  const SortIcon = ({ col }) =>
    sortKey !== col ? null : sortDir === "asc"
      ? <ChevronUp size={12} style={{ flexShrink: 0 }} />
      : <ChevronDown size={12} style={{ flexShrink: 0 }} />;

  if (loadError) return <ErrorState message={loadError} onRetry={loadSkus} />;
  if (!skus) return <LoadingState label="Loading inventory…" />;

  return (
    <div>
      {/* ── Header ── */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 20 }}>
        <div>
          <h1 style={{ fontSize: "var(--text-xl)", fontWeight: 700 }}>Inventory</h1>
          <p style={{ fontSize: "var(--text-sm)", color: "var(--text-secondary)", marginTop: 4 }}>
            {filtered.length} of {skus.length} SKUs
            {needsAttention > 0
              ? ` · ${needsAttention} need${needsAttention === 1 ? "s" : ""} attention`
              : " · all healthy"}
          </p>
        </div>
        {/* Bulk edit sits to the LEFT of Add SKU and stays outlined rather than
            filled. Add SKU is the one primary action on this surface; two solid
            blue buttons side by side is a rainbow, not a hierarchy. */}
        <div style={{ display: "flex", alignItems: "center", gap: 9, flexShrink: 0 }}>
          {/* Outlined, same weight as Bulk edit, so "Add SKU" stays the one
              primary action on this surface. MVP2 (branch-only for now) -
              see the App.jsx route comment for why this isn't in Sidebar yet. */}
          <Link to="/forecast" style={{
            display: "flex", alignItems: "center", gap: 6, padding: "9px 14px", borderRadius: "var(--radius)",
            border: "1px solid var(--border)", background: "var(--card-bg)", color: "var(--text-secondary)",
            fontSize: "var(--text-sm)", fontWeight: 600, textDecoration: "none",
          }}>
            <TrendingUp size={15} /> Forecast overview
          </Link>
          <BulkEdit onImported={loadSkus} />
          <button
            onClick={() => setShowAddModal(true)}
            style={{
              display: "flex", alignItems: "center", gap: 7,
              background: "var(--blue)", color: "#fff",
              padding: "9px 18px", borderRadius: "var(--radius)",
              fontWeight: 600, fontSize: "var(--text-sm)", border: "none",
              cursor: "pointer", flexShrink: 0,
            }}
          >
            <Plus size={15} /> Add SKU
          </button>
        </div>
      </div>

      {/* ── Filters ── */}
      <div style={{ display: "flex", gap: 10, marginBottom: 16, flexWrap: "wrap", alignItems: "center" }}>
        <div style={{ position: "relative", flex: "1 1 220px" }}>
          <Search size={13} style={{ position: "absolute", left: 11, top: "50%", transform: "translateY(-50%)", color: "var(--text-muted)", pointerEvents: "none" }} />
          <input
            value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder="Search SKU, variety, supplier…"
            style={{ width: "100%", padding: "8px 12px 8px 32px", border: "1px solid var(--border)", borderRadius: "var(--radius)", fontSize: "var(--text-sm)", background: "var(--surface)", color: "var(--text-primary)" }}
          />
        </div>
        <Select value={healthFilter}   onChange={setHealthFilter}   options={HEALTH_STATUSES}  placeholder="Health Status" />
        <Select value={movementFilter} onChange={setMovementFilter} options={MOVEMENT_CLASSES} placeholder="Movement" />
        <Select value={originFilter}   onChange={setOriginFilter}   options={ORIGINS}          placeholder="Origin" />
      </div>

      {/* ── Table ── */}
      <div
        style={{ background: "var(--card-bg)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", boxShadow: "var(--shadow)", overflow: "hidden" }}
      >
        <div style={{ overflowX: "auto" }}>
          <table className="inv-table" style={{ width: "100%", borderCollapse: "collapse", tableLayout: "fixed", minWidth: 980 }}>
            <colgroup>
              {COLS.map(({ label, width }) => (
                <col key={label} style={width ? { width } : undefined} />
              ))}
            </colgroup>
            <thead>
              <tr style={{ background: "var(--table-head-bg)", borderBottom: "1px solid var(--border)" }}>
                {COLS.map(({ key, label, tip }) => (
                  <th key={label}
                    onClick={() => handleSort(key)}
                    style={{
                      padding: "12px 16px", textAlign: "left", fontSize: "var(--text-xs)", fontWeight: 600,
                      color: "var(--text-secondary)", cursor: key ? "pointer" : "default",
                      userSelect: "none", lineHeight: 1.3,
                      textTransform: "uppercase", letterSpacing: "0.03em",
                    }}
                  >
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 5, flexWrap: "wrap" }}>
                      {label}
                      {key && <SortIcon col={key} />}
                      {tip && <ColHint label={label} what={tip.what} how={tip.how} />}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={COLS.length} style={{ padding: 40, textAlign: "center", color: "var(--text-muted)" }}>
                    No SKUs match your filters.
                  </td>
                </tr>
              ) : (
                filtered.map((sku, i) => (
                  <tr key={sku.sku_id}
                    style={{ borderBottom: i < filtered.length - 1 ? "1px solid var(--border)" : "none" }}
                  >
                    {/* Status. The coloured badge alone: a matching dot beside it said the
                        same thing twice and pushed "Action Required" out of the column at
                        laptop widths. */}
                    <td style={{ padding: "13px 8px 13px 16px" }}>
                      <Badge type={sku.health_status} />
                    </td>

                    {/* Product - click to open the record */}
                    <td
                      onClick={() => setSelectedSku(sku)}
                      style={{ padding: "13px 16px", cursor: "pointer" }}
                    >
                      <div style={{ fontWeight: 600, fontSize: "var(--text-sm)", lineHeight: 1.35 }}>{sku.product_name}</div>
                      <div style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)", marginTop: 1 }}>
                        {sku.sku_id} · {sku.rice_variety}
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 5, fontSize: "var(--text-xs)", color: "var(--text-muted)" }}>
                        {sku.abc_class && sku.xyz_class && (
                          <span style={{
                            fontWeight: 700, letterSpacing: "0.04em",
                            padding: "1px 6px", borderRadius: 5,
                            background: "var(--surface-2)", border: "1px solid var(--border)",
                            color: "var(--text-secondary)",
                          }}>
                            {sku.abc_class}{sku.xyz_class}
                          </span>
                        )}
                        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {sku.country_of_origin} · {sku.supplier}
                        </span>
                      </div>
                    </td>

                    {/* Stock position */}
                    <td style={{ padding: "13px 16px" }}>
                      <StockPositionBar
                        available={sku.available_qty}
                        minStock={sku.min_stock}
                        reorder={sku.reorder_point_policy}
                        suggested={sku.reorder_point_suggested}
                        maxStock={sku.max_stock}
                        reservedQty={sku.reserved_qty}
                        physicalStock={sku.on_hand_qty}
                        idle={sku.days_of_cover === null}
                      />
                    </td>

                    {/* Coverage vs lead time */}
                    <td style={{ padding: "13px 16px" }}>
                      {sku.days_of_cover === null ? (
                        <span style={{ fontSize: "var(--text-xs)", color: "var(--red)", fontWeight: 700 }}>No demand</span>
                      ) : (
                        <div>
                          <div style={{ display: "flex", alignItems: "baseline", gap: 4 }}>
                            <span style={{
                              fontSize: "var(--text-sm)", fontWeight: 800,
                              color: sku.days_of_cover < sku.lead_time_days ? "var(--red)"
                                : sku.days_of_cover < sku.lead_time_days * 1.5 ? "var(--yellow)"
                                : "var(--green)",
                            }}>
                              {sku.days_of_cover}d
                            </span>
                            <span style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)" }}>/ {sku.lead_time_days}d LT</span>
                          </div>
                          <div style={{ marginTop: 4, width: 84, height: 5, background: "var(--border)", borderRadius: 99, position: "relative" }}>
                            <div style={{
                              position: "absolute",
                              left: `${Math.min((sku.lead_time_days / Math.max(sku.days_of_cover, sku.lead_time_days + 5)) * 100, 98)}%`,
                              top: -2, width: 2, height: 9, background: "var(--text-muted)", borderRadius: 1,
                            }} />
                            <div style={{
                              width: `${Math.min((sku.days_of_cover / Math.max(sku.days_of_cover, sku.lead_time_days + 5)) * 100, 100)}%`,
                              height: "100%",
                              background: sku.days_of_cover < sku.lead_time_days ? "var(--red)" : "var(--green)",
                              borderRadius: 99,
                            }} />
                          </div>
                        </div>
                      )}
                    </td>

                    {/* Movement */}
                    <td style={{ padding: "13px 16px" }}>
                      <Badge type={sku.movement_class} />
                      <div style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)", marginTop: 4 }}>
                        {sku.avg_daily_usage_30d} MT/day
                      </div>
                    </td>

                    {/* Actions. 15% of the table, with tighter padding than the other
                        cells: at 10% the two buttons (about 116px) overflowed the cell
                        at laptop widths and the card clipped Edit. Wrapping is a safety
                        net, never the intended layout. */}
                    <td style={{ padding: "13px 8px 13px 12px" }}>
                      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                        <ActionBtn label="Restock" onClick={() => { setRestockTarget(sku); setRestockQty(""); setRestockError(null); }} />
                        <ActionBtn label="Edit" onClick={() => setSelectedSku(sku)} variant="ghost" />
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Restock modal ── */}
      {restockTarget && (
        <Modal title={`Restock: ${restockTarget.product_name}`} onClose={() => setRestockTarget(null)}>
          <InfoRow label="Current on-hand stock" value={`${restockTarget.on_hand_qty} MT`} />
          <InfoRow label="Available stock"       value={`${restockTarget.available_qty} MT`} />
          <InfoRow label="Target stock"            value={`${restockTarget.target_stock} MT`} />
          <InfoRow label="Max stock"               value={`${restockTarget.max_stock} MT`} />
          <div style={{ height: 1, background: "var(--border)", margin: "14px 0" }} />
          <label style={{ display: "block", fontSize: "var(--text-sm)", fontWeight: 500, marginBottom: 6 }}>
            Quantity to add (MT)
          </label>
          <input
            type="number" min={0.1} step={0.1} value={restockQty}
            onChange={(e) => { setRestockQty(e.target.value); setRestockError(null); }}
            placeholder="e.g. 200"
            style={{ width: "100%", padding: "9px 12px", border: "1px solid var(--border)", borderRadius: "var(--radius)", fontSize: "var(--text-sm)", marginBottom: restockError ? 8 : 18, background: "var(--surface)", color: "var(--text-primary)" }}
            autoFocus
          />
          {restockError && (
            <div style={{ fontSize: "var(--text-xs)", color: "var(--red)", marginBottom: 12 }}>⚠ {restockError}</div>
          )}
          <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
            <ModalBtn label="Cancel" onClick={() => setRestockTarget(null)} disabled={restockSaving} />
            <ModalBtn label={restockSaving ? "Saving…" : "Confirm Restock"} onClick={handleRestock} primary disabled={restockSaving} />
          </div>
        </Modal>
      )}

      {/* ── SKU edit modal ── */}
      {selectedSku && (
        <Modal title={selectedSku.product_name} onClose={() => setSelectedSku(null)} wide>
          <SkuEditForm sku={selectedSku} onSave={handleSkuSave} onCancel={() => setSelectedSku(null)} />
        </Modal>
      )}

      {/* ── Add SKU modal ── */}
      {showAddModal && (
        <Modal title="Add New Rice SKU" onClose={() => setShowAddModal(false)} wide>
          <AddSkuForm onSave={handleAddSku} onCancel={() => setShowAddModal(false)} />
        </Modal>
      )}
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function Select({ value, onChange, options, placeholder }) {
  return (
    <div style={{ position: "relative" }}>
      <Filter size={12} style={{ position: "absolute", left: 9, top: "50%", transform: "translateY(-50%)", color: "var(--text-muted)", pointerEvents: "none" }} />
      {/* The placeholder ("Health Status" etc.) is the only thing naming this
          control, and it lives inside an <option>, so a screen reader
          announced three unlabelled comboboxes. */}
      <select value={value} onChange={(e) => onChange(e.target.value)}
        aria-label={`Filter by ${placeholder || "value"}`}
        style={{ padding: "8px 12px 8px 26px", border: "1px solid var(--border)", borderRadius: "var(--radius)", background: "var(--surface)", fontSize: "var(--text-sm)", color: "var(--text-primary)", cursor: "pointer", appearance: "none" }}>
        {options.map((o) => <option key={o} value={o}>{o === "All" ? placeholder || "All" : o}</option>)}
      </select>
    </div>
  );
}

function ActionBtn({ label, onClick, variant }) {
  return (
    <button onClick={onClick} style={{
      padding: "5px 11px", borderRadius: 6, fontSize: "var(--text-xs)", fontWeight: 500,
      border: "1px solid var(--border)",
      background: variant === "ghost" ? "transparent" : "var(--surface)",
      color: "var(--text-primary)", cursor: "pointer",
    }}>
      {label}
    </button>
  );
}

function InfoRow({ label, value }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", fontSize: "var(--text-sm)", marginBottom: 8 }}>
      <span style={{ color: "var(--text-secondary)" }}>{label}</span>
      <span style={{ fontWeight: 600 }}>{value}</span>
    </div>
  );
}

function FormSection({ title, children }) {
  return (
    <div style={{ marginBottom: 20 }}>
      <div style={{ fontSize: "var(--text-xs)", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--text-muted)", marginBottom: 10 }}>
        {title}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px 16px" }}>
        {children}
      </div>
    </div>
  );
}

// ── Projected inventory curve (TASK-07) ─────────────────────────────────────
// Real 90-day projection from the backend (backend/src/engines/projection.js) -
// available stock depleting at the 30 day average daily rate, stepped up by open POs
// on their ETA day. Fetched fresh per SKU; not blocking the rest of the modal.
function ProjectionChart({ skuId }) {
  const [projection, setProjection] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    setProjection(null);
    setError(null);
    api.getSkuProjection(skuId)
      .then(setProjection)
      .catch((err) => setError(err.message || "Failed to load projection"));
  }, [skuId]);

  if (error) {
    return <div style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)" }}>Projection unavailable - {error}</div>;
  }
  if (!projection) {
    return <div style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)", padding: "16px 0" }}>Loading projection…</div>;
  }

  const { curve, first_stockout_date, first_safety_breach_date, lowest_position, lowest_date, reference } = projection;

  return (
    <div>
      <div style={{ display: "flex", gap: 16, flexWrap: "wrap", fontSize: "var(--text-xs)", marginBottom: 10 }}>
        {first_stockout_date ? (
          <span style={{ color: "var(--red)", fontWeight: 700 }}>
            {/* "Projected" reads oddly for a date of today - that's not a forecast,
                the SKU is already at/below zero right now. */}
            {first_stockout_date === curve[0]?.date
              ? "⚠ Already out of stock"
              : `⚠ Stockout projected ${first_stockout_date}`}
          </span>
        ) : (
          <span style={{ color: "var(--green)", fontWeight: 700 }}>✓ No stockout projected within 90 days</span>
        )}
        {first_safety_breach_date && first_safety_breach_date !== first_stockout_date && (
          <span style={{ color: "var(--yellow)" }}>Safety stock breached {first_safety_breach_date}</span>
        )}
        <span style={{ color: "var(--text-muted)" }}>
          Lowest point: {Math.round(lowest_position)} MT on {lowest_date}
        </span>
      </div>
      <ResponsiveContainer width="100%" height={200}>
        <LineChart data={curve} margin={{ top: 8, right: 12, bottom: 0, left: -16 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
          <XAxis
            dataKey="date" tick={{ fontSize: 11 }} tickLine={false} axisLine={false}
            tickFormatter={(d) => d.slice(5)} interval={Math.ceil(curve.length / 6)}
          />
          {/* width was 60, which clipped the leading digit off four-figure
              ticks ("800 MT" rendered as ":00 MT"). Sized for the widest
              label this axis can produce rather than a guess. */}
          <YAxis tick={{ fontSize: 11 }} tickLine={false} axisLine={false} width={78} unit=" MT" />
          <Tooltip
            contentStyle={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8, fontSize: "var(--text-xs)" }}
            labelStyle={{ color: "var(--text-primary)", fontWeight: 700 }}
            formatter={(v) => [`${Math.round(v)} MT`, "Projected available"]}
          />
          <ReferenceLine y={0} stroke="var(--text-muted)" />
          {reference.safety_stock_mt > 0 && (
            <ReferenceLine y={reference.safety_stock_mt} stroke="var(--yellow)" strokeDasharray="4 4"
              label={{ value: "Safety stock", position: "insideBottomRight", fontSize: 11, fill: "var(--yellow)" }} />
          )}
          {/* The approved reorder point, which is what the REORDER alert fires
              on (TASK-95). This line was the one place left drawing the
              calculated value after the stock bars moved to policy. */}
          {reference.reorder_point_policy > 0 && (
            <ReferenceLine y={reference.reorder_point_policy} stroke="var(--text-secondary)" strokeDasharray="4 4"
              label={{ value: "Reorder point", position: "insideTopRight", fontSize: 11, fill: "var(--text-secondary)" }} />
          )}
          {reference.max_stock > 0 && (
            <ReferenceLine y={reference.max_stock} stroke="var(--purple)" strokeDasharray="2 2"
              label={{ value: "Max", position: "insideTopRight", fontSize: 11, fill: "var(--purple)" }} />
          )}
          <Line type="monotone" dataKey="projected_available" stroke="var(--blue)" strokeWidth={2} dot={false} name="Projected available" />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

// ── Edit an existing SKU ─────────────────────────────────────────────────────
function SkuEditForm({ sku, onSave, onCancel }) {
  const navigate = useNavigate();
  const initial = useMemo(() => {
    const f = {};
    for (const g of EDIT_GROUPS) {
      for (const [k] of g.fields) {
        if (k === "target_service_level_pct") {
          f[k] = String(Math.round((sku.target_service_level ?? 0.95) * 100));
        } else {
          f[k] = sku[k] == null ? "" : String(sku[k]);
        }
      }
    }
    return f;
  }, [sku]);

  const [form, setForm] = useState(initial);
  const set = (k) => (val) => setForm((f) => ({ ...f, [k]: val }));

  const errors = {};
  if (!String(form.product_name || "").trim()) errors.product_name = "Required";
  for (const k of NUMERIC_EDIT_KEYS) {
    const n = Number(form[k]);
    if (form[k] === "" || !Number.isFinite(n) || n < 0) errors[k] = "Must be ≥ 0";
  }
  const valid = Object.keys(errors).length === 0;

  const coerce = () => {
    const out = {};
    for (const g of EDIT_GROUPS) for (const [k, t] of g.fields) {
      if (k === "target_service_level_pct") continue;
      out[k] = t === "num" ? Number(form[k]) : form[k];
    }
    out.target_service_level = Math.min(0.999, Math.max(0.5, Number(form.target_service_level_pct) / 100));
    return out;
  };

  const preview = useMemo(() => {
    try { return computeSkuAnalytics({ ...sku, ...coerce() }); }
    catch { return sku; }
  }, [form, sku]);

  const warnings = [];
  const p = coerce();
  if (!(p.min_stock <= p.reorder_point_policy && p.reorder_point_policy <= p.max_stock)) {
    warnings.push("Expected min ≤ reorder point ≤ max.");
  }
  if (p.reserved_qty + p.quality_hold_qty > Number(sku.on_hand_qty)) {
    warnings.push("Reserved + quality hold exceeds on-hand stock.");
  }

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);
  // Opens on Overview (read-only) - no editable fields visible until the user
  // deliberately switches to Policy or Details. This is the fix for "a wall
  // of text-box fields on open."
  const [activeTab, setActiveTab] = useState("overview");

  const submit = async (e) => {
    e.preventDefault();
    if (!valid) return;
    setSaving(true);
    setSaveError(null);
    try {
      await onSave(coerce());
    } catch (err) {
      setSaveError(err.message || "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  const physicalStock = Number(sku.on_hand_qty) || 0;
  const axisMax = stockAxisMax(form, physicalStock);
  const previewAvailable =
    physicalStock - (Number(form.reserved_qty) || 0) - (Number(form.quality_hold_qty) || 0);

  return (
    <form onSubmit={submit}>
      <div style={{ fontSize: "var(--text-sm)", color: "var(--text-muted)", marginBottom: "var(--space-3)" }}>
        {sku.sku_id} · {sku.rice_variety}
      </div>

      <div className="modal-tabs">
        {TABS.map((tb) => (
          <button key={tb.id} type="button" className={`modal-tab ${activeTab === tb.id ? "active" : ""}`}
            onClick={() => setActiveTab(tb.id)}>
            {tb.label}
          </button>
        ))}
      </div>

      {/* minHeight keeps the dialog a stable size across tabs. Without it the
          frame resized and re-centred on every tab click, so the tabs
          themselves moved out from under the pointer. */}
      <div style={{ minHeight: 380 }}>
      {/* ── Overview: read-only, zero editable fields - what opens by default ── */}
      {activeTab === "overview" && (
        <div>
          <div style={{ marginBottom: "var(--space-5)" }}>
            <StockPositionBar
              available={sku.available_qty}
              minStock={sku.min_stock}
              reorder={sku.reorder_point_policy}
              suggested={sku.reorder_point_suggested}
              maxStock={sku.max_stock}
              reservedQty={sku.reserved_qty}
              physicalStock={sku.on_hand_qty}
              idle={sku.days_of_cover === null}
            />
          </div>

          <FormSection title="Current position">
            <div style={{ gridColumn: "span 2" }}>
              <InfoRow label="On-hand stock" value={`${sku.on_hand_qty} MT`} />
              <InfoRow label="Avg daily usage (30d)" value={`${sku.avg_daily_usage_30d} MT/day`} />
              <InfoRow label="Days of cover" value={sku.days_of_cover != null ? `${sku.days_of_cover} days` : "No recent demand"} />
              <InfoRow label="Movement" value={sku.movement_class} />
              <InfoRow label="Coverage band" value={sku.coverage_band} />
            </div>
          </FormSection>

          <FormSection title="Projected inventory (90 days)">
            <div style={{ gridColumn: "span 2" }}>
              <ProjectionChart skuId={sku.sku_id} />
            </div>
          </FormSection>

          <FormSection title="Demand forecasting">
            <div style={{ gridColumn: "span 2", display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
              <span style={{ fontSize: "var(--text-sm)", color: "var(--text-secondary)" }}>
                {sku.use_forecast
                  ? `Reorder point is currently driven by the ${sku.demand_source?.replace("_", " ")} forecast.`
                  : "Model picker, reasoning chain, and a what-if sandbox for this SKU's reorder point."}
              </span>
              <button type="button" onClick={() => { onCancel(); navigate(`/inventory/${sku.sku_id}/forecast`); }} style={{
                display: "flex", alignItems: "center", gap: 6, fontWeight: 700, fontSize: "var(--text-sm)",
                padding: "8px 14px", borderRadius: "var(--radius)", border: "1px solid var(--blue)",
                background: "var(--blue-light)", color: "var(--blue)", cursor: "pointer", flexShrink: 0,
              }}>
                View forecast <ChevronRight size={14} />
              </button>
            </div>
          </FormSection>

          {sku.recommended_action && (
            <div style={{ fontSize: "var(--text-base)", lineHeight: 1.6, paddingTop: "var(--space-3)", borderTop: "1px solid var(--border)" }}>
              <span style={{ fontWeight: 600 }}>Recommended: </span>{sku.recommended_action}
            </div>
          )}
        </div>
      )}

      {/* ── Policy: the sliders that actually change operating thresholds ── */}
      {activeTab === "policy" && (
        <div>
          <div style={{ marginBottom: "var(--space-5)" }}>
            <StockPositionBar
              axisMax={axisMax}
              animateFill={false}
              available={previewAvailable}
              minStock={Number(form.min_stock) || 0}
              reorder={Number(form.reorder_point_policy) || 0}
              target={Number(form.target_stock) || 0}
              maxStock={Number(form.max_stock) || 0}
              reservedQty={Number(form.reserved_qty) || 0}
              physicalStock={physicalStock}
              idle={sku.days_of_cover === null}
            />
          </div>

          {EDIT_GROUPS.filter((g) => TAB_FOR_GROUP[g.title] === "policy").map((g) => (
            <FormSection key={g.title} title={g.title}>
              {g.fields.map(([k, t, label, required, suffix]) => {
                const spec = SLIDER_SPECS[k];
                if (!spec) {
                  // Min order qty is the only sliderless field on this tab, so
                  // it sits beside sliders and has to share their rhythm or
                  // the two inputs land on different baselines.
                  return (
                    <NumberField key={k} half alignWithSlider label={label} suffix={suffix}
                      value={form[k]} onChange={set(k)} error={errors[k]} min={0} />
                  );
                }
                const r = resolveSpec(spec, { axisMax, physicalStock });
                return (
                  <SliderField key={k} half label={label} suffix={suffix}
                    value={form[k]} onChange={set(k)} error={errors[k]}
                    min={r.min} max={r.max} step={r.step} disabled={r.disabled} />
                );
              })}
            </FormSection>
          ))}

          <div style={{ fontSize: "var(--text-sm)", marginBottom: "var(--space-4)" }}>
            <div style={{ fontSize: "var(--text-xs)", fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", marginBottom: "var(--space-2)" }}>
              After save
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "6px var(--space-4)", alignItems: "center" }}>
              <span>Available <strong>{preview.available_qty} MT</strong></span>
              <span>Days of cover <strong>{preview.days_of_cover ?? "-"}</strong></span>
              {sku.use_forecast ? (
                // MVP2 Day 5: this preview is the client-side approximation
                // (mock/analytics.js), computed from the 30-day average. Once
                // use_forecast is on, the real suggested figure comes from the
                // forecast instead and this simplified formula would silently
                // disagree with it - so it's suppressed rather than shown as
                // a second, conflicting number (rules.md, "derived values
                // computed twice eventually disagree").
                <span>Reorder point (suggested) <strong>see Forecasting tab</strong></span>
              ) : (
                <span>Reorder point (suggested) <strong>{preview.reorder_point_suggested} MT</strong></span>
              )}
              <span>Gross margin <strong>{preview.gross_margin_pct}%</strong></span>
              <Badge type={preview.health_status} />
            </div>
          </div>

          {warnings.length > 0 && (
            <div style={{ fontSize: "var(--text-sm)", color: "var(--yellow)", marginBottom: "var(--space-4)" }}>
              {warnings.map((w) => <div key={w}>⚠ {w}</div>)}
            </div>
          )}
        </div>
      )}

      {/* ── Details: identity, costs, stock adjustments - least frequently touched ── */}
      {activeTab === "details" && (
        <div>
          {EDIT_GROUPS.filter((g) => TAB_FOR_GROUP[g.title] === "details").map((g) => (
            <FormSection key={g.title} title={g.title}>
              {g.fields.map(([k, t, label, required, suffix]) => {
                if (t === "text") {
                  return (
                    <TextField key={k} half label={label} required={required}
                      value={form[k]} onChange={set(k)} error={errors[k]} />
                  );
                }
                const spec = SLIDER_SPECS[k];
                if (!spec) {
                  return (
                    <NumberField key={k} half label={label} suffix={suffix}
                      value={form[k]} onChange={set(k)} error={errors[k]} min={0} />
                  );
                }
                const r = resolveSpec(spec, { axisMax, physicalStock });
                return (
                  <SliderField key={k} half label={label} suffix={suffix}
                    value={form[k]} onChange={set(k)} error={errors[k]}
                    min={r.min} max={r.max} step={r.step} disabled={r.disabled} />
                );
              })}
            </FormSection>
          ))}
        </div>
      )}

      </div>

      {saveError && (
        <div style={{ fontSize: "var(--text-sm)", color: "var(--red)", marginTop: "var(--space-3)" }}>
          ⚠ {saveError}
        </div>
      )}

      <div style={{ display: "flex", gap: "var(--space-3)", justifyContent: "flex-end", marginTop: "var(--space-5)", paddingTop: "var(--space-4)", borderTop: "1px solid var(--border)" }}>
        <ModalBtn label={activeTab === "overview" ? "Close" : "Cancel"} type="button" onClick={onCancel} disabled={saving} />
        {/* Overview is read-only - there is nothing on it to save, so a primary
            Save button there is an invitation to a no-op. */}
        {activeTab !== "overview" && (
          <ModalBtn label={saving ? "Saving…" : "Save changes"} type="submit" primary disabled={!valid || saving} />
        )}
      </div>
    </form>
  );
}

// ── Add a new SKU ────────────────────────────────────────────────────────────
function AddSkuForm({ onSave, onCancel }) {
  const [form, setForm] = useState({
    sku_id: "", product_name: "", rice_variety: "", grade: "", country_of_origin: "",
    brand: "", packaging_size: "", supplier: "",
    unit_cost_sgd: "", unit_price_sgd: "", lead_time_days: "45",
    min_order_qty: "", reorder_point_policy: "", min_stock: "", target_stock: "", max_stock: "",
    safety_stock_pct: "20",
  });
  const set = (k) => (val) => setForm((f) => ({ ...f, [k]: val }));

  const required = ["sku_id", "product_name"];
  const numeric = ["unit_cost_sgd", "unit_price_sgd", "lead_time_days", "min_order_qty", "reorder_point_policy", "min_stock", "target_stock", "max_stock", "safety_stock_pct"];
  const valid =
    required.every((k) => String(form[k]).trim()) &&
    numeric.every((k) => form[k] === "" || Number.isFinite(Number(form[k])));

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);

  const submit = async (e) => {
    e.preventDefault();
    if (!valid) return;
    const out = { ...form };
    for (const k of numeric) out[k] = Number(form[k]) || 0;
    setSaving(true);
    setSaveError(null);
    try {
      await onSave(out);
    } catch (err) {
      setSaveError(err.message || "Failed to create SKU");
    } finally {
      setSaving(false);
    }
  };

  const axisMax = Math.max(200, stockAxisMax(form, 0)); // floor so empty sliders have a usable range

  return (
    <form onSubmit={submit}>
      <FormSection title="Identity">
        <TextField half label="SKU ID" required value={form.sku_id} onChange={set("sku_id")} placeholder="e.g. TJ-25KG" />
        <TextField half label="Product name" required value={form.product_name} onChange={set("product_name")} placeholder="e.g. Thai Jasmine 25KG" />
        <TextField half label="Rice variety" value={form.rice_variety} onChange={set("rice_variety")} placeholder="e.g. Thai Hom Mali" />
        <TextField half label="Grade" value={form.grade} onChange={set("grade")} placeholder="e.g. Grade A" />
        <TextField half label="Country of origin" value={form.country_of_origin} onChange={set("country_of_origin")} placeholder="e.g. Thailand" />
        <TextField half label="Packaging size" value={form.packaging_size} onChange={set("packaging_size")} placeholder="e.g. 25KG" />
        <TextField half label="Supplier" value={form.supplier} onChange={set("supplier")} placeholder="Supplier name" />
        <TextField half label="Brand" value={form.brand} onChange={set("brand")} placeholder="Brand name" />
      </FormSection>

      <FormSection title="Costs & Policy">
        {Number(form.max_stock) > 0 && (
          <div style={{ gridColumn: "span 2", marginBottom: 6 }}>
            <StockPositionBar
              axisMax={axisMax}
              animateFill={false}
              available={Number(form.target_stock) || 0}
              minStock={Number(form.min_stock) || 0}
              reorder={Number(form.reorder_point_policy) || 0}
              target={Number(form.target_stock) || 0}
              maxStock={Number(form.max_stock) || 0}
              reservedQty={0}
              physicalStock={Number(form.target_stock) || 0}
              idle={false}
            />
          </div>
        )}
        <NumberField half label="Unit cost" suffix="SGD" value={form.unit_cost_sgd} onChange={set("unit_cost_sgd")} min={0} />
        <NumberField half label="Unit price" suffix="SGD" value={form.unit_price_sgd} onChange={set("unit_price_sgd")} min={0} />
        <SliderField half label="Lead time" suffix="days" value={form.lead_time_days} onChange={set("lead_time_days")} min={1} max={120} step={1} />
        <NumberField half label="Min order qty" suffix="MT" value={form.min_order_qty} onChange={set("min_order_qty")} min={0} />
        <SliderField half label="Min stock" suffix="MT" value={form.min_stock} onChange={set("min_stock")} min={0} max={axisMax} step={5} />
        <SliderField half label="Reorder point" suffix="MT" value={form.reorder_point_policy} onChange={set("reorder_point_policy")} min={0} max={axisMax} step={5} />
        <SliderField half label="Target stock" suffix="MT" value={form.target_stock} onChange={set("target_stock")} min={0} max={axisMax} step={5} />
        <SliderField half label="Max stock" suffix="MT" value={form.max_stock} onChange={set("max_stock")} min={0} max={axisMax} step={5} />
      </FormSection>

      {saveError && (
        <div style={{ padding: "8px 12px", background: "var(--red-light)", border: "1px solid var(--border)", borderRadius: "var(--radius)", fontSize: "var(--text-xs)", color: "var(--red)", marginBottom: 16 }}>
          ⚠ {saveError}
        </div>
      )}

      <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
        <ModalBtn label="Cancel" type="button" onClick={onCancel} disabled={saving} />
        <ModalBtn label={saving ? "Adding…" : "Add SKU"} type="submit" primary disabled={!valid || saving} />
      </div>
    </form>
  );
}
