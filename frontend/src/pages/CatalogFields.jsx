import React from "react";
import { useNavigate } from "react-router-dom";
import { ChevronLeft } from "lucide-react";

// ─────────────────────────────────────────────────────────────────────────────
// CATALOG FIELDS REFERENCE, linked from Onboarding step 1's "Download a blank
// template" button.
//
// Trimmed 18 Sep (Stan's call) from a full column-by-column breakdown of all
// 21 template columns down to just the five the blank template now asks for.
// The earlier version treated "has a default" as license to explain all 21
// fields at once, which read as MORE work, not less - the fix wasn't
// wordier defaults, it was showing fewer columns in the first place. See
// MINIMAL_TEMPLATE_COLUMNS in backend/src/routes/inventory.js for where that
// five-column line is actually drawn, and Onboarding.jsx's EXAMPLE_CSVS.bare
// comment for why: requirements.md's REQ-02 (16 "required" fields) turned out
// to disagree with Stan's own domain-expert source document, whose own
// "minimum fields" table is this short.
//
// Every other column (variety, grade, origin, brand, packaging, supplier,
// costs, min/max stock, safety stock %, MOQ, stock-on-hand adjustments) still
// exists in the schema, still works if filled in, and is still explained
// briefly below - just not as five separate detailed sections anymore. Add
// them from a product's own page in Inventory once it exists, or via Bulk
// edit's fuller spreadsheet.
// ─────────────────────────────────────────────────────────────────────────────

const REQUIRED = [
  { field: "sku_id", label: "SKU ID", example: "TJ-25KG",
    what: "Your own short code for this product. Anything unique works." },
  { field: "product_name", label: "Product name", example: "Thai Jasmine 25KG",
    what: "The name shown throughout the app." },
];

const CORE = [
  { field: "lead_time_days", label: "Lead time", example: "45", unit: "days", defaultValue: "45 days",
    what: "How long from placing an order to it arriving. Feeds directly into the reorder point." },
  { field: "reorder_point_policy", label: "Reorder point", example: "300", unit: "MT", defaultValue: "0",
    what: "The stock level that triggers a REORDER alert." },
  { field: "target_stock", label: "Target stock", example: "500", unit: "MT", defaultValue: "0",
    what: "What a healthy stock level looks like day to day." },
];

const LATER = [
  { field: "rice_variety", label: "Rice variety" },
  { field: "grade", label: "Grade" },
  { field: "country_of_origin", label: "Country of origin" },
  { field: "brand", label: "Brand" },
  { field: "supplier", label: "Supplier" },
  { field: "packaging_size", label: "Packaging size" },
  { field: "min_order_qty", label: "Min order qty" },
  { field: "min_stock", label: "Min stock" },
  { field: "max_stock", label: "Max stock" },
  { field: "safety_stock_pct", label: "Safety stock %" },
  { field: "unit_cost_sgd", label: "Unit cost" },
  { field: "unit_price_sgd", label: "Unit price" },
  { field: "on_hand_qty", label: "On hand qty" },
  { field: "lead_time_std_days", label: "Lead time variability" },
  { field: "target_service_level", label: "Target service level" },
];

export default function CatalogFields() {
  const navigate = useNavigate();

  return (
    <div style={{ minHeight: "calc(100vh - var(--demo-banner-height))", background: "var(--bg)", display: "flex", justifyContent: "center", padding: "clamp(32px, 8vh, 80px) 20px 48px" }}>
      <div style={{ width: "100%", maxWidth: 640 }}>

        <button onClick={() => navigate("/onboarding")} style={{
          display: "flex", alignItems: "center", gap: 4, background: "none", border: "none",
          padding: "4px 2px 4px 0", cursor: "pointer", color: "var(--text-muted)",
          fontSize: "var(--text-xs)", fontWeight: 600, marginBottom: 20,
        }}>
          <ChevronLeft size={15} /> Back to setup
        </button>

        <h1 style={{ fontSize: "var(--text-xl)", fontWeight: 700, lineHeight: 1.2, margin: "0 0 10px" }}>
          Five columns, two required
        </h1>
        <p style={{ fontSize: "var(--text-base)", color: "var(--text-secondary)", lineHeight: 1.5, margin: "0 0 30px", maxWidth: "50ch" }}>
          That's the whole template. Everything past these five is optional and can be added later,
          once you're inside the app.
        </p>

        <Section title="Required" intro="Every row needs both, or the row is rejected.">
          {REQUIRED.map((f) => <FieldRow key={f.field} f={f} required />)}
        </Section>

        <Section title="Worth filling in" intro="Optional, but these three are what make the reorder point real instead of a default guess.">
          {CORE.map((f) => <FieldRow key={f.field} f={f} />)}
        </Section>

        <div className="card" style={{ padding: "18px 22px" }}>
          <div style={{ fontSize: "var(--text-sm)", fontWeight: 700, marginBottom: 8 }}>
            Everything else — add later, not now
          </div>
          <p style={{ fontSize: "var(--text-sm)", color: "var(--text-secondary)", lineHeight: 1.6, margin: "0 0 10px" }}>
            Variety, grade, supplier, costs, min/max stock and a few statistical tuning fields. All real,
            all optional, none of them block anything today. Set them from a product's own page in
            Inventory, or upload a fuller spreadsheet from Bulk edit once you're ready.
          </p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {LATER.map((f) => (
              <span key={f.field} style={{
                fontSize: "var(--text-xs)", fontWeight: 600, color: "var(--text-muted)",
                background: "var(--surface-2)", border: "1px solid var(--border)",
                borderRadius: 99, padding: "4px 10px",
              }}>
                {f.label}
              </span>
            ))}
          </div>
        </div>

      </div>
    </div>
  );
}

function Section({ title, intro, children }) {
  return (
    <div style={{ marginBottom: 28 }}>
      <div style={{ fontSize: "var(--text-xs)", fontWeight: 700, letterSpacing: "0.04em", textTransform: "uppercase", color: "var(--text-muted)", marginBottom: 4 }}>
        {title}
      </div>
      {intro && (
        <p style={{ fontSize: "var(--text-sm)", color: "var(--text-secondary)", lineHeight: 1.5, margin: "0 0 12px" }}>
          {intro}
        </p>
      )}
      <div className="card" style={{ overflow: "hidden" }}>
        {children}
      </div>
    </div>
  );
}

function FieldRow({ f, required }) {
  return (
    <div style={{ padding: "14px 18px", borderBottom: "1px solid var(--border)", display: "flex", gap: 16, alignItems: "flex-start" }}>
      <div style={{ minWidth: 168, flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
          <code style={{ fontFamily: "ui-monospace, Menlo, monospace", fontSize: "var(--text-xs)", fontWeight: 700, color: "var(--text-primary)" }}>
            {f.field}
          </code>
          {f.unit && (
            <span style={{
              fontSize: 10, fontWeight: 700, color: "var(--blue)",
              background: "var(--blue-light)", borderRadius: 4, padding: "1px 5px",
            }}>
              {f.unit}
            </span>
          )}
        </div>
        <div style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)", marginTop: 2 }}>
          {f.label}
        </div>
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        {f.what && (
          <div style={{ fontSize: "var(--text-sm)", color: "var(--text-secondary)", lineHeight: 1.5, marginBottom: 6 }}>
            {f.what}
          </div>
        )}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
          <span style={{
            fontSize: "var(--text-xs)", fontWeight: 600,
            color: required ? "var(--red)" : "var(--text-muted)",
          }}>
            {required ? "Required" : `Default if blank: ${f.defaultValue ?? "blank"}`}
          </span>
          <span style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)" }}>
            · Example: <code style={{ fontFamily: "ui-monospace, Menlo, monospace" }}>{f.example}{f.unit ? ` ${f.unit}` : ""}</code>
          </span>
        </div>
      </div>
    </div>
  );
}
