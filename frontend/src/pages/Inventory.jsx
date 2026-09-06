import React, { useState, useMemo, useRef, useEffect } from "react";
import { Search, Filter, Plus, ChevronUp, ChevronDown, X, HelpCircle } from "lucide-react";
import Badge from "../components/Badge";
import { mockSkus } from "../mock/riceData";

const HEALTH_STATUSES = ["All", "RED", "ORANGE", "YELLOW", "GREEN"];
const MOVEMENT_CLASSES = ["All", "Fast Moving", "Normal", "Slow Moving", "Idle"];
const ORIGINS = ["All", ...new Set(mockSkus.map((s) => s.country_of_origin)).values()];

const HEALTH_DOT = { RED: "#ef4444", ORANGE: "#f97316", YELLOW: "#f59e0b", GREEN: "#22c55e" };

// ── Column definitions with tooltips ────────────────────────────────────────
const COLS = [
  {
    key: "health_status",
    label: "Status",
    tip: {
      what: "The overall health of this SKU's inventory position.",
      how: "🔴 RED — Critical. Either you'll run out before the next shipment arrives, or stock has been sitting idle too long.\n🟠 ORANGE — Action needed soon. You're approaching your reorder point or you're holding too much stock.\n🟡 YELLOW — Watch this one. It's slow-moving or drifting toward a problem.\n🟢 GREEN — You're in good shape. No action needed right now.",
    },
  },
  {
    key: "product_name",
    label: "Product",
    tip: {
      what: "The rice SKU name, internal SKU code, country of origin, and supplier.",
      how: "Use the search bar above to find a specific product by name, SKU code, or supplier.",
    },
  },
  {
    key: "available_stock",
    label: "Available (MT)",
    tip: {
      what: "How much stock you can actually sell or ship right now, in metric tonnes (MT).",
      how: "Available = Physical stock on hand − Stock reserved for customer orders − Stock on quality hold.\n\nExample: You have 500 MT in the warehouse, but 80 MT is already promised to a customer and 20 MT is being held for QA inspection. You can only actually sell 400 MT.\n\nThis is the number that drives every replenishment decision — not the raw warehouse quantity.",
    },
  },
  {
    key: "reorder_point",
    label: "Reorder Point",
    tip: {
      what: "The minimum available stock level at which you should place a new purchase order.",
      how: "Formula: Reorder Point = (Daily demand × Supplier lead time) + Safety stock buffer.\n\nExample: You sell 6 MT/day and your supplier takes 45 days to deliver. You need 270 MT just to cover the waiting period. Add a 20% buffer for delays and you get a reorder point of ~324 MT.\n\nWhen your available stock drops to this number, it's time to order — not before you run out.",
    },
  },
  {
    key: "gap_to_reorder",
    label: "Gap to Reorder",
    tip: {
      what: "How far above or below your reorder point you currently are.",
      how: "Formula: Gap = Available stock − Reorder point.\n\n▼ Negative (red) — You've already passed your reorder trigger. Order immediately.\n+ Near zero (orange) — You're close. Review within the next few days.\n+ Positive (green) — You have a comfortable buffer.\n\nThis is the fastest column to scan when you open the app each morning. Any red number = immediate action.",
    },
  },
  {
    key: "days_of_stock",
    label: "Coverage vs Lead Time",
    tip: {
      what: "How many days your current stock will last, compared to how long it takes to get more.",
      how: "Formula: Days of stock = Available stock ÷ Average daily sales (last 30 days).\n\nThe grey marker on the mini bar shows your supplier's lead time. If the coloured bar doesn't reach the marker — you will run out before new stock arrives.\n\nExample: 26 days of stock, 45-day lead time = 19-day gap. Red bar, order now.\n\nIf no demand is shown, this SKU hasn't sold anything recently and is classified as Idle.",
    },
  },
  {
    key: "movement_class",
    label: "Movement",
    tip: {
      what: "How quickly this SKU is selling, based on the last 30 days of sales data.",
      how: "🔵 Fast Moving — High daily sales. Priority: prevent stockouts.\n⚫ Normal — Steady demand. Maintain target stock.\n🟡 Slow Moving — Sales are low relative to stock on hand. Likely more than 4 months of stock. Consider reducing next order.\n🔴 Idle — No meaningful sales in 90+ days. Stop ordering and review whether to discount, redirect to another channel, or dispose.\n\nThe number below shows average daily consumption in MT.",
    },
  },
  {
    key: null,
    label: "Actions",
    tip: {
      what: "Quick actions you can take on this SKU.",
      how: "Restock — Record a new incoming quantity (e.g. a shipment just arrived).\nDetail — Open the full SKU profile: all stock figures, velocity data, inventory policy thresholds, and the system's recommended action.",
    },
  },
];

export default function Inventory() {
  const [skus, setSkus] = useState(mockSkus);
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

  // ── Sort + filter ────────────────────────────────────────────────────────────
  const HEALTH_ORDER = { RED: 0, ORANGE: 1, YELLOW: 2, GREEN: 3 };

  const filtered = useMemo(() => {
    let result = skus;
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
      // Health status sort by severity order
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
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(key); setSortDir("asc"); }
  };

  // ── Restock ──────────────────────────────────────────────────────────────────
  const handleRestock = () => {
    const qty = parseFloat(restockQty);
    if (!qty || qty <= 0) return;
    setSkus((prev) =>
      prev.map((s) => {
        if (s.sku_id !== restockTarget.sku_id) return s;
        const newPhysical = s.physical_stock + qty;
        const newAvailable = newPhysical - s.reserved_qty - s.quality_hold_qty;
        const newDays = s.avg_daily_usage_30d > 0 ? Math.round(newAvailable / s.avg_daily_usage_30d) : null;
        return {
          ...s,
          physical_stock: newPhysical,
          available_stock: newAvailable,
          days_of_stock: newDays,
          months_of_stock: newDays ? +(newDays / 30).toFixed(1) : null,
          last_received_date: new Date().toISOString().split("T")[0],
          inventory_age_days: 0,
          ageing_status: "Fresh",
        };
      })
    );
    setRestockTarget(null);
    setRestockQty("");
  };

  const SortIcon = ({ col }) =>
    sortKey !== col ? null : sortDir === "asc"
      ? <ChevronUp size={12} style={{ flexShrink: 0 }} />
      : <ChevronDown size={12} style={{ flexShrink: 0 }} />;

  const cols = COLS;

  return (
    <div>
      {/* ── Header ── */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 20 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700 }}>Inventory</h1>
          <p style={{ fontSize: 13, color: "var(--text-secondary)", marginTop: 4 }}>
            {filtered.length} of {skus.length} SKUs · rice inventory management
          </p>
        </div>
        <button
          onClick={() => setShowAddModal(true)}
          style={{
            display: "flex", alignItems: "center", gap: 7,
            background: "var(--blue)", color: "#fff",
            padding: "9px 18px", borderRadius: "var(--radius)",
            fontWeight: 600, fontSize: 13, border: "none",
          }}
        >
          <Plus size={15} /> Add SKU
        </button>
      </div>

      {/* ── Filters ── */}
      <div style={{ display: "flex", gap: 10, marginBottom: 16, flexWrap: "wrap", alignItems: "center" }}>
        {/* Search */}
        <div style={{ position: "relative", flex: "1 1 220px" }}>
          <Search size={13} style={{ position: "absolute", left: 11, top: "50%", transform: "translateY(-50%)", color: "var(--text-muted)", pointerEvents: "none" }} />
          <input
            value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder="Search SKU, variety, supplier…"
            style={{ width: "100%", padding: "8px 12px 8px 32px", border: "1px solid var(--border)", borderRadius: "var(--radius)", fontSize: 13, background: "#fff" }}
          />
        </div>
        <Select value={healthFilter}   onChange={setHealthFilter}   options={HEALTH_STATUSES}  placeholder="Health Status" />
        <Select value={movementFilter} onChange={setMovementFilter} options={MOVEMENT_CLASSES} placeholder="Movement" />
        <Select value={originFilter}   onChange={setOriginFilter}   options={ORIGINS}          placeholder="Origin" />
      </div>

      {/* ── Table ── */}
      <div style={{ background: "#fff", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", boxShadow: "var(--shadow)", overflow: "hidden" }}>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ background: "var(--surface-2)", borderBottom: "1px solid var(--border)" }}>
                {cols.map(({ key, label, tip }) => (
                  <th key={label}
                    onClick={key ? () => handleSort(key) : undefined}
                    style={{
                      padding: "10px 14px", textAlign: "left", fontSize: 11, fontWeight: 600,
                      color: "var(--text-secondary)", cursor: key ? "pointer" : "default",
                      userSelect: "none", whiteSpace: "nowrap",
                    }}
                  >
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                      {label}
                      {key && <SortIcon col={key} />}
                      {tip && <ColTooltip tip={tip} />}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={8} style={{ padding: 40, textAlign: "center", color: "var(--text-muted)" }}>
                    No SKUs match your filters.
                  </td>
                </tr>
              ) : (
                filtered.map((sku, i) => (
                  <tr key={sku.sku_id}
                    style={{ borderBottom: i < filtered.length - 1 ? "1px solid var(--border)" : "none", cursor: "pointer" }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = "var(--surface-2)")}
                    onMouseLeave={(e) => (e.currentTarget.style.background = "")}
                  >
                    {/* Status */}
                    <td style={{ padding: "12px 14px" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <span style={{ width: 8, height: 8, borderRadius: "50%", background: HEALTH_DOT[sku.health_status], flexShrink: 0 }} />
                        <Badge type={sku.health_status} />
                      </div>
                    </td>
                    {/* Product name + SKU + origin */}
                    <td style={{ padding: "12px 14px" }}>
                      <div style={{ fontWeight: 600, fontSize: 13 }}>{sku.product_name}</div>
                      <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
                        {sku.sku_id} · {sku.country_of_origin} · {sku.supplier}
                      </div>
                    </td>
                    {/* Available stock */}
                    <td style={{ padding: "12px 14px" }}>
                      <div style={{ fontSize: 13, fontWeight: 600 }}>{sku.available_stock} MT</div>
                      <StockBar value={sku.available_stock} max={sku.max_stock} status={sku.health_status} />
                      {sku.reserved_qty > 0 && (
                        <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>{sku.reserved_qty} MT reserved</div>
                      )}
                    </td>
                    {/* Reorder point */}
                    <td style={{ padding: "12px 14px", fontSize: 13, color: "var(--text-secondary)" }}>
                      <div style={{ fontWeight: 600 }}>{sku.reorder_point} MT</div>
                      <div style={{ fontSize: 11, color: "var(--text-muted)" }}>min {sku.min_stock} MT</div>
                    </td>
                    {/* Gap to reorder — primary decision column */}
                    <td style={{ padding: "12px 14px" }}>
                      {(() => {
                        const gap = sku.available_stock - sku.reorder_point;
                        const isNeg = gap < 0;
                        const isWarn = gap >= 0 && gap < sku.reorder_point * 0.2;
                        return (
                          <div>
                            <span style={{
                              fontSize: 14, fontWeight: 800,
                              color: isNeg ? "#dc2626" : isWarn ? "#c2410c" : "#16a34a",
                            }}>
                              {isNeg ? "▼ " : "+ "}{Math.abs(gap)} MT
                            </span>
                            <div style={{ fontSize: 11, color: isNeg ? "#dc2626" : "var(--text-muted)", fontWeight: isNeg ? 600 : 400 }}>
                              {isNeg ? "BELOW trigger" : isWarn ? "Near trigger" : "Above trigger"}
                            </div>
                          </div>
                        );
                      })()}
                    </td>
                    {/* Coverage vs Lead Time */}
                    <td style={{ padding: "12px 14px" }}>
                      {sku.days_of_stock === null ? (
                        <span style={{ fontSize: 12, color: "#ef4444", fontWeight: 700 }}>No demand</span>
                      ) : (
                        <div>
                          <div style={{ display: "flex", alignItems: "baseline", gap: 4 }}>
                            <span style={{
                              fontSize: 14, fontWeight: 800,
                              color: sku.days_of_stock < sku.lead_time_days ? "#dc2626"
                                : sku.days_of_stock < sku.lead_time_days * 1.5 ? "#c2410c"
                                : "#16a34a",
                            }}>
                              {sku.days_of_stock}d
                            </span>
                            <span style={{ fontSize: 11, color: "var(--text-muted)" }}>/ {sku.lead_time_days}d LT</span>
                          </div>
                          <div style={{ marginTop: 4, width: 80, height: 5, background: "var(--border)", borderRadius: 99, position: "relative" }}>
                            <div style={{
                              position: "absolute",
                              left: `${Math.min((sku.lead_time_days / Math.max(sku.days_of_stock, sku.lead_time_days + 5)) * 100, 98)}%`,
                              top: -2, width: 2, height: 9, background: "#94a3b8", borderRadius: 1,
                            }} />
                            <div style={{
                              width: `${Math.min((sku.days_of_stock / Math.max(sku.days_of_stock, sku.lead_time_days + 5)) * 100, 100)}%`,
                              height: "100%",
                              background: sku.days_of_stock < sku.lead_time_days ? "#ef4444" : "#22c55e",
                              borderRadius: 99,
                            }} />
                          </div>
                        </div>
                      )}
                    </td>
                    {/* Movement — single badge, daily rate below */}
                    <td style={{ padding: "12px 14px" }}>
                      <Badge type={sku.movement_class} />
                      <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4 }}>
                        {sku.avg_daily_usage_30d} MT/day
                      </div>
                    </td>
                    {/* Actions */}
                    <td style={{ padding: "12px 14px" }}>
                      <div style={{ display: "flex", gap: 6 }}>
                        <ActionBtn label="Restock" onClick={() => { setRestockTarget(sku); setRestockQty(""); }} />
                        <ActionBtn label="Detail" onClick={() => setSelectedSku(sku)} variant="ghost" />
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
          <InfoRow label="Current physical stock" value={`${restockTarget.physical_stock} MT`} />
          <InfoRow label="Available stock"         value={`${restockTarget.available_stock} MT`} />
          <InfoRow label="Target stock"            value={`${restockTarget.target_stock} MT`} />
          <InfoRow label="Max stock"               value={`${restockTarget.max_stock} MT`} />
          <div style={{ height: 1, background: "var(--border)", margin: "14px 0" }} />
          <label style={{ display: "block", fontSize: 13, fontWeight: 500, marginBottom: 6 }}>
            Quantity to add (MT)
          </label>
          <input
            type="number" min={0.1} step={0.1} value={restockQty}
            onChange={(e) => setRestockQty(e.target.value)}
            placeholder="e.g. 200"
            style={{ width: "100%", padding: "9px 12px", border: "1px solid var(--border)", borderRadius: "var(--radius)", fontSize: 13, marginBottom: 18 }}
            autoFocus
          />
          <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
            <ModalBtn label="Cancel" onClick={() => setRestockTarget(null)} />
            <ModalBtn label="Confirm Restock" onClick={handleRestock} primary />
          </div>
        </Modal>
      )}

      {/* ── SKU detail modal ── */}
      {selectedSku && (
        <Modal title={selectedSku.product_name} onClose={() => setSelectedSku(null)} wide>
          <SkuDetail sku={selectedSku} />
        </Modal>
      )}

      {/* ── Add SKU modal ── */}
      {showAddModal && (
        <Modal title="Add New Rice SKU" onClose={() => setShowAddModal(false)} wide>
          <AddSkuForm
            onSave={(data) => {
              setSkus((prev) => [...prev, { ...data, id: Date.now() }]);
              setShowAddModal(false);
            }}
            onCancel={() => setShowAddModal(false)}
          />
        </Modal>
      )}
    </div>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────────────

// ── Column header tooltip (portal-based, never clips) ────────────────────────
function ColTooltip({ tip }) {
  const [pos, setPos] = useState(null); // { x, y } in viewport coords
  const ref = useRef(null);

  useEffect(() => {
    if (!pos) return;
    const handler = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setPos(null);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [pos]);

  const handleClick = (e) => {
    e.stopPropagation();
    if (pos) { setPos(null); return; }
    const rect = e.currentTarget.getBoundingClientRect();
    // Place below the icon, centred; clamp so it never goes off-screen
    const tooltipWidth = 300;
    let x = rect.left + rect.width / 2 - tooltipWidth / 2;
    x = Math.max(12, Math.min(x, window.innerWidth - tooltipWidth - 12));
    setPos({ x, y: rect.bottom + 8 });
  };

  return (
    <>
      <span
        ref={ref}
        onClick={handleClick}
        style={{ display: "inline-flex", alignItems: "center", cursor: "pointer" }}
      >
        <HelpCircle size={12} color={pos ? "#3b82f6" : "#94a3b8"} style={{ flexShrink: 0 }} />
      </span>

      {pos && (
        <div
          style={{
            position: "fixed",
            top: pos.y,
            left: pos.x,
            zIndex: 9999,
            width: 300,
            background: "#1e293b",
            color: "#f1f5f9",
            borderRadius: 10,
            padding: "14px 16px",
            boxShadow: "0 8px 32px rgba(0,0,0,0.35)",
            pointerEvents: "auto",
          }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <div style={{ fontSize: 11, fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 6 }}>
            What is this?
          </div>
          <div style={{ fontSize: 12, lineHeight: 1.65, marginBottom: 12, color: "#e2e8f0" }}>
            {tip.what}
          </div>
          <div style={{ fontSize: 11, fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 6 }}>
            How to read it
          </div>
          <div style={{ fontSize: 12, lineHeight: 1.75, color: "#e2e8f0", whiteSpace: "pre-line" }}>
            {tip.how}
          </div>
          <button
            onClick={() => setPos(null)}
            style={{ marginTop: 12, fontSize: 11, color: "#64748b", background: "none", border: "none", cursor: "pointer", padding: 0 }}
          >
            close ✕
          </button>
        </div>
      )}
    </>
  );
}
function StockBar({ value, max, status }) {
  const pct = max > 0 ? Math.min((value / max) * 100, 120) : 0;
  const color = { RED: "#ef4444", ORANGE: "#f97316", YELLOW: "#f59e0b", GREEN: "#22c55e" }[status] || "#94a3b8";
  return (
    <div style={{ width: 80, height: 4, background: "var(--border)", borderRadius: 99, marginTop: 4 }}>
      <div style={{ width: `${Math.min(pct, 100)}%`, height: "100%", background: color, borderRadius: 99 }} />
    </div>
  );
}

function Select({ value, onChange, options, placeholder }) {
  return (
    <div style={{ position: "relative" }}>
      <Filter size={12} style={{ position: "absolute", left: 9, top: "50%", transform: "translateY(-50%)", color: "var(--text-muted)", pointerEvents: "none" }} />
      <select value={value} onChange={(e) => onChange(e.target.value)}
        style={{ padding: "8px 12px 8px 26px", border: "1px solid var(--border)", borderRadius: "var(--radius)", background: "#fff", fontSize: 13, color: "var(--text-primary)", cursor: "pointer", appearance: "none" }}>
        {options.map((o) => <option key={o} value={o}>{o === "All" ? placeholder || "All" : o}</option>)}
      </select>
    </div>
  );
}

function ActionBtn({ label, onClick, variant }) {
  return (
    <button onClick={onClick} style={{
      padding: "5px 11px", borderRadius: 6, fontSize: 12, fontWeight: 500,
      border: "1px solid var(--border)",
      background: variant === "ghost" ? "transparent" : "#fff",
      color: "var(--text-primary)", cursor: "pointer",
    }}>
      {label}
    </button>
  );
}

function Modal({ title, onClose, children, wide }) {
  return (
    <div
      onClick={(e) => e.target === e.currentTarget && onClose()}
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }}
    >
      <div style={{
        background: "#fff", borderRadius: "var(--radius-lg)", padding: "28px 30px",
        width: wide ? 680 : 460, maxHeight: "90vh", overflowY: "auto",
        boxShadow: "var(--shadow-md)",
      }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
          <div style={{ fontWeight: 700, fontSize: 16 }}>{title}</div>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)" }}>
            <X size={18} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function ModalBtn({ label, onClick, primary }) {
  return (
    <button onClick={onClick} style={{
      padding: "8px 20px", borderRadius: "var(--radius)", fontSize: 13, fontWeight: 600,
      border: "1px solid var(--border)",
      background: primary ? "var(--blue)" : "#fff",
      color: primary ? "#fff" : "var(--text-primary)", cursor: "pointer",
    }}>
      {label}
    </button>
  );
}

function InfoRow({ label, value }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginBottom: 8 }}>
      <span style={{ color: "var(--text-secondary)" }}>{label}</span>
      <span style={{ fontWeight: 600 }}>{value}</span>
    </div>
  );
}

function SkuDetail({ sku }) {
  const sections = [
    { title: "Product Info", rows: [
      ["SKU ID", sku.sku_id], ["Variety", sku.rice_variety], ["Grade", sku.grade],
      ["Origin", sku.country_of_origin], ["Packaging", sku.packaging_size], ["Supplier", sku.supplier],
    ]},
    { title: "Stock Position", rows: [
      ["Physical Stock", `${sku.physical_stock} MT`],
      ["Reserved", `${sku.reserved_qty} MT`],
      ["Quality Hold", `${sku.quality_hold_qty} MT`],
      ["Available Stock", `${sku.available_stock} MT`],
      ["Incoming Stock", `${sku.incoming_stock} MT`],
    ]},
    { title: "Velocity & Coverage", rows: [
      ["30-day Sales", `${sku.sales_30d} MT`],
      ["90-day Sales", `${sku.sales_90d} MT`],
      ["Avg Daily Usage (30d)", `${sku.avg_daily_usage_30d} MT/day`],
      ["Velocity Trend", sku.velocity_trend],
      ["Days of Stock", sku.days_of_stock ? `${sku.days_of_stock} days` : "No recent demand"],
      ["Months of Stock", sku.months_of_stock ? `${sku.months_of_stock} months` : "—"],
    ]},
    { title: "Inventory Policy", rows: [
      ["Lead Time", `${sku.lead_time_days} days`],
      ["Reorder Point", `${sku.reorder_point} MT`],
      ["Min Stock", `${sku.min_stock} MT`],
      ["Target Stock", `${sku.target_stock} MT`],
      ["Max Stock", `${sku.max_stock} MT`],
      ["Safety Stock %", `${sku.safety_stock_pct}%`],
    ]},
  ];

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
      {sections.map(({ title, rows }) => (
        <div key={title}>
          <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--text-muted)", marginBottom: 10 }}>
            {title}
          </div>
          {rows.map(([l, v]) => <InfoRow key={l} label={l} value={v} />)}
        </div>
      ))}
      <div style={{ gridColumn: "1 / -1", marginTop: 4, padding: "12px 14px", background: "var(--surface-2)", borderRadius: "var(--radius)", borderLeft: "3px solid var(--blue)" }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", marginBottom: 6 }}>Recommended Action</div>
        <div style={{ fontSize: 13, color: "var(--text-primary)", lineHeight: 1.6 }}>{sku.recommended_action}</div>
      </div>
    </div>
  );
}

function AddSkuForm({ onSave, onCancel }) {
  const [form, setForm] = useState({
    sku_id: "", product_name: "", rice_variety: "", grade: "", country_of_origin: "",
    brand: "", packaging_size: "", supplier: "", lead_time_days: 45,
    unit_cost_sgd: "", min_order_qty: "", reorder_point: "",
    min_stock: "", target_stock: "", max_stock: "", safety_stock_pct: 20,
    physical_stock: 0, reserved_qty: 0, quality_hold_qty: 0,
    available_stock: 0, incoming_stock: 0,
    sales_30d: 0, sales_60d: 0, sales_90d: 0,
    avg_daily_usage_30d: 0, avg_daily_usage_90d: 0,
    velocity_trend: "stable", days_of_stock: null, months_of_stock: null,
    movement_class: "Normal", health_status: "GREEN",
    ageing_status: "Fresh", inventory_age_days: 0,
    last_received_date: new Date().toISOString().split("T")[0],
    recommended_action: "New SKU — monitor initial demand.",
    inventory_position: 0,
  });

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const handleSubmit = (e) => {
    e.preventDefault();
    onSave({
      ...form,
      lead_time_days: Number(form.lead_time_days),
      unit_cost_sgd: Number(form.unit_cost_sgd),
      min_order_qty: Number(form.min_order_qty),
      reorder_point: Number(form.reorder_point),
      min_stock: Number(form.min_stock),
      target_stock: Number(form.target_stock),
      max_stock: Number(form.max_stock),
      safety_stock_pct: Number(form.safety_stock_pct),
    });
  };

  const Field = ({ label, k, type = "text", placeholder, half }) => (
    <div style={{ gridColumn: half ? "span 1" : "span 2" }}>
      <label style={{ display: "block", fontSize: 12, fontWeight: 500, marginBottom: 4, color: "var(--text-secondary)" }}>{label}</label>
      <input required type={type} value={form[k]} onChange={set(k)} placeholder={placeholder}
        style={{ width: "100%", padding: "8px 11px", border: "1px solid var(--border)", borderRadius: "var(--radius)", fontSize: 13 }} />
    </div>
  );

  return (
    <form onSubmit={handleSubmit}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px 16px", marginBottom: 20 }}>
        <Field label="SKU ID *"          k="sku_id"           placeholder="e.g. TJ-25KG"        half />
        <Field label="Product Name *"    k="product_name"     placeholder="e.g. Thai Jasmine 25KG" half />
        <Field label="Rice Variety"      k="rice_variety"     placeholder="e.g. Thai Hom Mali"  half />
        <Field label="Grade"             k="grade"            placeholder="e.g. Grade A"        half />
        <Field label="Country of Origin" k="country_of_origin" placeholder="e.g. Thailand"     half />
        <Field label="Packaging Size"    k="packaging_size"   placeholder="e.g. 25KG"           half />
        <Field label="Supplier"          k="supplier"         placeholder="Supplier name"       half />
        <Field label="Brand"             k="brand"            placeholder="Brand name"          half />
        <Field label="Unit Cost (SGD)" k="unit_cost_sgd" type="number" placeholder="0.00" half />
        <Field label="Lead Time (days)"  k="lead_time_days"   type="number" placeholder="45"   half />
        <Field label="Reorder Point (MT)" k="reorder_point"  type="number" placeholder="0"     half />
        <Field label="Min Stock (MT)"    k="min_stock"        type="number" placeholder="0"     half />
        <Field label="Target Stock (MT)" k="target_stock"     type="number" placeholder="0"     half />
        <Field label="Max Stock (MT)"    k="max_stock"        type="number" placeholder="0"     half />
      </div>
      <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
        <ModalBtn label="Cancel" onClick={onCancel} />
        <ModalBtn label="Add SKU" onClick={() => {}} primary />
      </div>
    </form>
  );
}
