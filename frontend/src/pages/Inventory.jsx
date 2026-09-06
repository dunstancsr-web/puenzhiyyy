import React, { useEffect, useState, useCallback } from "react";
import { Search, Filter, Plus, RefreshCw, ChevronUp, ChevronDown } from "lucide-react";
import Badge from "../components/Badge";
import { api } from "../api/inventory";

const CATEGORIES = ["All", "Electronics", "Furniture", "Stationery"];
const STATUS_OPTIONS = ["All", "in_stock", "low_stock", "out_of_stock", "overstock"];

export default function Inventory() {
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("All");
  const [status, setStatus] = useState("All");
  const [sortKey, setSortKey] = useState("name");
  const [sortDir, setSortDir] = useState("asc");
  const [showModal, setShowModal] = useState(false);
  const [restockTarget, setRestockTarget] = useState(null);
  const [restockQty, setRestockQty] = useState("");

  const fetchProducts = useCallback(() => {
    setLoading(true);
    const params = {};
    if (search) params.search = search;
    if (category !== "All") params.category = category;
    if (status !== "All") params.status = status;
    api
      .getProducts(params)
      .then((r) => setProducts(r.data))
      .finally(() => setLoading(false));
  }, [search, category, status]);

  useEffect(() => {
    fetchProducts();
  }, [fetchProducts]);

  const handleSort = (key) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  };

  const sorted = [...products].sort((a, b) => {
    let av = a[sortKey], bv = b[sortKey];
    if (typeof av === "string") av = av.toLowerCase();
    if (typeof bv === "string") bv = bv.toLowerCase();
    if (av < bv) return sortDir === "asc" ? -1 : 1;
    if (av > bv) return sortDir === "asc" ? 1 : -1;
    return 0;
  });

  const handleRestock = async () => {
    const qty = parseInt(restockQty, 10);
    if (!qty || qty <= 0) return;
    await api.restockProduct(restockTarget.id, qty);
    setRestockTarget(null);
    setRestockQty("");
    fetchProducts();
  };

  const SortIcon = ({ col }) =>
    sortKey === col ? (
      sortDir === "asc" ? <ChevronUp size={13} /> : <ChevronDown size={13} />
    ) : null;

  return (
    <div>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700 }}>Inventory</h1>
          <p style={{ fontSize: 14, color: "var(--text-secondary)", marginTop: 4 }}>
            {products.length} products · manage stock levels
          </p>
        </div>
        <button
          onClick={() => setShowModal(true)}
          style={{
            display: "flex", alignItems: "center", gap: 8,
            background: "var(--blue)", color: "#fff",
            padding: "9px 18px", borderRadius: "var(--radius)",
            fontWeight: 600, fontSize: 13,
          }}
        >
          <Plus size={15} /> Add Product
        </button>
      </div>

      {/* Filters */}
      <div
        style={{
          display: "flex", gap: 12, marginBottom: 20,
          flexWrap: "wrap", alignItems: "center",
        }}
      >
        <div style={{ position: "relative", flex: "1 1 200px" }}>
          <Search size={14} style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "var(--text-muted)" }} />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name, SKU, supplier…"
            style={{
              width: "100%", padding: "9px 12px 9px 34px",
              border: "1px solid var(--border)", borderRadius: "var(--radius)",
              background: "var(--surface)", fontSize: 13,
            }}
          />
        </div>

        <FilterSelect value={category} onChange={setCategory} options={CATEGORIES} label="Category" />
        <FilterSelect
          value={status}
          onChange={setStatus}
          options={STATUS_OPTIONS}
          label="Status"
          formatLabel={(v) => v === "All" ? "All Status" : v.replace(/_/g, " ")}
        />

        <button
          onClick={fetchProducts}
          style={{
            display: "flex", alignItems: "center", gap: 6,
            padding: "9px 14px", border: "1px solid var(--border)",
            borderRadius: "var(--radius)", background: "var(--surface)",
            fontSize: 13, color: "var(--text-secondary)", fontWeight: 500,
          }}
        >
          <RefreshCw size={13} /> Refresh
        </button>
      </div>

      {/* Table */}
      <div
        style={{
          background: "var(--surface)", borderRadius: "var(--radius-lg)",
          border: "1px solid var(--border)", boxShadow: "var(--shadow)",
          overflow: "hidden",
        }}
      >
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ background: "var(--surface-2)", borderBottom: "1px solid var(--border)" }}>
                {[
                  { key: "name", label: "Product" },
                  { key: "sku", label: "SKU" },
                  { key: "category", label: "Category" },
                  { key: "currentStock", label: "Stock" },
                  { key: "reorderPoint", label: "Reorder At" },
                  { key: "salesLast30Days", label: "Sales (30d)" },
                  { key: "stockValue", label: "Stock Value" },
                  { key: "status", label: "Status" },
                  { key: null, label: "Action" },
                ].map(({ key, label }) => (
                  <th
                    key={label}
                    onClick={key ? () => handleSort(key) : undefined}
                    style={{
                      padding: "11px 16px", textAlign: "left",
                      fontSize: 12, fontWeight: 600, color: "var(--text-secondary)",
                      cursor: key ? "pointer" : "default",
                      userSelect: "none", whiteSpace: "nowrap",
                    }}
                  >
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                      {label}
                      {key && <SortIcon col={key} />}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={9} style={{ padding: 40, textAlign: "center", color: "var(--text-muted)" }}>
                    Loading…
                  </td>
                </tr>
              ) : sorted.length === 0 ? (
                <tr>
                  <td colSpan={9} style={{ padding: 40, textAlign: "center", color: "var(--text-muted)" }}>
                    No products found.
                  </td>
                </tr>
              ) : (
                sorted.map((p, i) => (
                  <tr
                    key={p.id}
                    style={{
                      borderBottom: i < sorted.length - 1 ? "1px solid var(--border)" : "none",
                      transition: "background 0.1s",
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = "var(--surface-2)")}
                    onMouseLeave={(e) => (e.currentTarget.style.background = "")}
                  >
                    <td style={{ padding: "12px 16px" }}>
                      <div style={{ fontWeight: 600, fontSize: 13 }}>{p.name}</div>
                      <div style={{ fontSize: 11, color: "var(--text-muted)" }}>{p.supplier}</div>
                    </td>
                    <td style={{ padding: "12px 16px", fontSize: 12, color: "var(--text-secondary)", fontFamily: "monospace" }}>
                      {p.sku}
                    </td>
                    <td style={{ padding: "12px 16px", fontSize: 13 }}>{p.category}</td>
                    <td style={{ padding: "12px 16px" }}>
                      <StockBar current={p.currentStock} max={p.maxStock} status={p.status} />
                    </td>
                    <td style={{ padding: "12px 16px", fontSize: 13, color: "var(--text-secondary)" }}>
                      {p.reorderPoint}
                    </td>
                    <td style={{ padding: "12px 16px", fontSize: 13 }}>{p.salesLast30Days}</td>
                    <td style={{ padding: "12px 16px", fontSize: 13 }}>
                      ${p.stockValue.toLocaleString()}
                    </td>
                    <td style={{ padding: "12px 16px" }}>
                      <Badge type={p.status} />
                    </td>
                    <td style={{ padding: "12px 16px" }}>
                      <button
                        onClick={() => { setRestockTarget(p); setRestockQty(""); }}
                        style={{
                          padding: "5px 12px", borderRadius: 6,
                          border: "1px solid var(--border)",
                          background: "var(--surface)", fontSize: 12,
                          fontWeight: 500, color: "var(--text-primary)",
                        }}
                      >
                        Restock
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Restock modal */}
      {restockTarget && (
        <Modal title={`Restock: ${restockTarget.name}`} onClose={() => setRestockTarget(null)}>
          <p style={{ fontSize: 13, color: "var(--text-secondary)", marginBottom: 16 }}>
            Current stock: <strong>{restockTarget.currentStock}</strong> units
          </p>
          <label style={{ display: "block", fontSize: 13, fontWeight: 500, marginBottom: 6 }}>
            Quantity to add
          </label>
          <input
            type="number"
            min={1}
            value={restockQty}
            onChange={(e) => setRestockQty(e.target.value)}
            placeholder="e.g. 50"
            style={{
              width: "100%", padding: "9px 12px",
              border: "1px solid var(--border)", borderRadius: "var(--radius)",
              fontSize: 13, marginBottom: 20,
            }}
            autoFocus
          />
          <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
            <button
              onClick={() => setRestockTarget(null)}
              style={{ padding: "8px 16px", borderRadius: "var(--radius)", border: "1px solid var(--border)", background: "var(--surface)", fontSize: 13 }}
            >
              Cancel
            </button>
            <button
              onClick={handleRestock}
              style={{ padding: "8px 20px", borderRadius: "var(--radius)", background: "var(--blue)", color: "#fff", fontSize: 13, fontWeight: 600 }}
            >
              Confirm Restock
            </button>
          </div>
        </Modal>
      )}

      {/* Add product modal (placeholder) */}
      {showModal && (
        <Modal title="Add New Product" onClose={() => setShowModal(false)}>
          <AddProductForm
            onSave={(data) => {
              api.createProduct(data).then(() => {
                setShowModal(false);
                fetchProducts();
              });
            }}
            onCancel={() => setShowModal(false)}
          />
        </Modal>
      )}
    </div>
  );
}

function StockBar({ current, max, status }) {
  const pct = max > 0 ? Math.min((current / max) * 100, 100) : 0;
  const barColor =
    status === "out_of_stock" ? "var(--red)" :
    status === "low_stock"    ? "var(--yellow)" :
    status === "overstock"    ? "var(--purple)" :
                                "var(--green)";
  return (
    <div>
      <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>{current}</div>
      <div style={{ width: 80, height: 5, background: "var(--border)", borderRadius: 99 }}>
        <div style={{ width: `${pct}%`, height: "100%", background: barColor, borderRadius: 99 }} />
      </div>
    </div>
  );
}

function FilterSelect({ value, onChange, options, label, formatLabel }) {
  return (
    <div style={{ position: "relative" }}>
      <Filter size={13} style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: "var(--text-muted)", pointerEvents: "none" }} />
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{
          padding: "9px 12px 9px 28px",
          border: "1px solid var(--border)",
          borderRadius: "var(--radius)",
          background: "var(--surface)",
          fontSize: 13, color: "var(--text-primary)",
          appearance: "none", cursor: "pointer",
        }}
      >
        {options.map((o) => (
          <option key={o} value={o}>
            {formatLabel ? formatLabel(o) : o}
          </option>
        ))}
      </select>
    </div>
  );
}

function Modal({ title, onClose, children }) {
  return (
    <div
      style={{
        position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)",
        display: "flex", alignItems: "center", justifyContent: "center",
        zIndex: 1000,
      }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        style={{
          background: "var(--surface)", borderRadius: "var(--radius-lg)",
          padding: "28px 32px", width: 460, boxShadow: "var(--shadow-md)",
          maxHeight: "90vh", overflowY: "auto",
        }}
      >
        <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 20 }}>{title}</div>
        {children}
      </div>
    </div>
  );
}

function AddProductForm({ onSave, onCancel }) {
  const [form, setForm] = useState({
    name: "", sku: "", category: "Electronics",
    currentStock: "", minStock: "", maxStock: "",
    reorderPoint: "", unitCost: "", unitPrice: "",
    supplier: "",
  });

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const handleSubmit = (e) => {
    e.preventDefault();
    onSave({
      ...form,
      currentStock: Number(form.currentStock),
      minStock: Number(form.minStock),
      maxStock: Number(form.maxStock),
      reorderPoint: Number(form.reorderPoint),
      unitCost: Number(form.unitCost),
      unitPrice: Number(form.unitPrice),
    });
  };

  const Field = ({ label, k, type = "text", placeholder }) => (
    <div style={{ marginBottom: 14 }}>
      <label style={{ display: "block", fontSize: 12, fontWeight: 500, marginBottom: 4 }}>{label}</label>
      <input
        required
        type={type}
        value={form[k]}
        onChange={set(k)}
        placeholder={placeholder}
        style={{
          width: "100%", padding: "8px 12px",
          border: "1px solid var(--border)", borderRadius: "var(--radius)",
          fontSize: 13,
        }}
      />
    </div>
  );

  return (
    <form onSubmit={handleSubmit}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 16px" }}>
        <Field label="Product Name" k="name" placeholder="e.g. Wireless Mouse" />
        <Field label="SKU" k="sku" placeholder="e.g. WM-1234" />
        <div style={{ marginBottom: 14 }}>
          <label style={{ display: "block", fontSize: 12, fontWeight: 500, marginBottom: 4 }}>Category</label>
          <select value={form.category} onChange={set("category")}
            style={{ width: "100%", padding: "8px 12px", border: "1px solid var(--border)", borderRadius: "var(--radius)", fontSize: 13 }}>
            {["Electronics", "Furniture", "Stationery"].map((c) => <option key={c}>{c}</option>)}
          </select>
        </div>
        <Field label="Supplier" k="supplier" placeholder="e.g. TechSupply Co." />
        <Field label="Current Stock" k="currentStock" type="number" placeholder="0" />
        <Field label="Reorder Point" k="reorderPoint" type="number" placeholder="20" />
        <Field label="Min Stock" k="minStock" type="number" placeholder="10" />
        <Field label="Max Stock" k="maxStock" type="number" placeholder="100" />
        <Field label="Unit Cost ($)" k="unitCost" type="number" placeholder="0.00" />
        <Field label="Unit Price ($)" k="unitPrice" type="number" placeholder="0.00" />
      </div>
      <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 8 }}>
        <button type="button" onClick={onCancel}
          style={{ padding: "8px 16px", borderRadius: "var(--radius)", border: "1px solid var(--border)", background: "var(--surface)", fontSize: 13 }}>
          Cancel
        </button>
        <button type="submit"
          style={{ padding: "8px 20px", borderRadius: "var(--radius)", background: "var(--blue)", color: "#fff", fontSize: 13, fontWeight: 600 }}>
          Add Product
        </button>
      </div>
    </form>
  );
}
