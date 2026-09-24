import React from "react";
import { useNavigate } from "react-router-dom";
import { ChevronLeft } from "lucide-react";

// ─────────────────────────────────────────────────────────────────────────────
// WHAT EACH COLUMN MEANS, linked from Onboarding's "What does each column mean?".
//
// Covers both spreadsheets the setup asks for: the catalog (step 1) and the sales history (step 2).
//
// The catalog part was trimmed 18 Sep (Stan's call) from a breakdown of all 21 template columns to the five
// the blank template asks for, because explaining every column read as MORE work, not less. Refreshed 21 Sep
// so the lists match what the upload really accepts, read from backend/src/routes/inventory.js:
//   the blank template ....... MINIMAL_TEMPLATE_COLUMNS (five columns)
//   the catalog upload ....... CREATE_COLUMNS (REQUIRED, CORE and ALSO_ACCEPTED below)
//   set after the upload ..... LATER_ONLY (not read from a first upload: SKU_TABLE_FIELDS minus CREATE_COLUMNS,
//                              plus stock on hand, which the opening balance step sets)
//   the sales history ........ SALES_KEY and SALES_OPTIONAL
// If a column is added to any of those lists, add it here in the same change.
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

// Accepted in the catalog upload, all optional. Costs and prices are per MT.
const ALSO_ACCEPTED = [
  { field: "rice_variety", label: "Rice variety", what: "The type of rice, for example Thai Hom Mali or Basmati." },
  { field: "grade", label: "Grade", what: "The quality grade, for example Grade A or Premium." },
  { field: "country_of_origin", label: "Country of origin", what: "Where it is grown, for example Thailand." },
  { field: "brand", label: "Brand", what: "The brand on the pack." },
  { field: "supplier", label: "Supplier", what: "Who you buy it from." },
  { field: "packaging_size", label: "Packaging size", what: "The pack size, for example 25KG." },
  { field: "min_order_qty", label: "Min order qty", unit: "MT", what: "The smallest order the supplier will accept." },
  { field: "min_stock", label: "Min stock", unit: "MT", what: "A floor the stock should not fall below." },
  { field: "max_stock", label: "Max stock", unit: "MT", what: "A ceiling. Stock above it is flagged as overstock." },
  { field: "safety_stock_pct", label: "Safety stock %", unit: "%", what: "Extra stock held as a buffer, as a percentage." },
  { field: "unit_cost_sgd", label: "Unit cost", unit: "SGD per MT", what: "What one MT costs you. Used to value stock and to size the cost of holding too much." },
  { field: "unit_price_sgd", label: "Unit price", unit: "SGD per MT", what: "What you sell one MT for. Used to size the sales lost when a product runs out." },
];

// NOT read from a first upload. Set them afterwards, from a product's own page in Inventory or in Bulk edit.
const LATER_ONLY = [
  { field: "on_hand_qty", label: "Stock on hand", what: "Every product starts at zero. You enter what is on the shelf in the opening balance step after the upload." },
  { field: "reserved_qty", label: "Reserved", what: "Stock already promised to an order, so it is not available to sell." },
  { field: "quality_hold_qty", label: "On quality hold", what: "Stock set aside for inspection." },
  { field: "lead_time_std_days", label: "Lead time variability", what: "How much the supplier's delivery time swings, in days. Sharpens the safety stock." },
  { field: "target_service_level", label: "Target service level", what: "How often you want to have stock when a customer orders, for example 95%." },
];

// The sales history spreadsheet (setup step 2).
const SALES_REQUIRED = [
  { field: "sku_id", label: "SKU ID", example: "TJ-25KG", what: "Must match a product in your catalog." },
  { field: "quantity_mt", label: "Quantity", example: "12.5", unit: "MT", what: "How much was sold on that day." },
  { field: "sale_date", label: "Sale date", example: "2026-08-14", what: "The day of the sale, written year-month-day." },
];
const SALES_OPTIONAL = [
  { field: "customer", label: "Customer", what: "Who bought it." },
  { field: "channel", label: "Channel", what: "How it was sold, for example wholesale or retail." },
  { field: "status", label: "Status", what: "Either fulfilled or lost. Lost means an order you could not fill. Only fulfilled sales count as demand." },
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
          That's the whole catalog template. Everything past these five is optional and can be added later,
          once you're inside the app. The sales history spreadsheet is explained at the bottom.
        </p>

        <Section title="Required" intro="Every row needs both, or the row is rejected.">
          {REQUIRED.map((f) => <FieldRow key={f.field} f={f} required />)}
        </Section>

        <Section title="Worth filling in" intro="Optional, but these three are what make the reorder point real instead of a default guess.">
          {CORE.map((f) => <FieldRow key={f.field} f={f} />)}
        </Section>

        <Section title="Also accepted, all optional" intro="You can fill these in the upload, or leave them blank and add them later from a product's own page in Inventory or in Bulk edit. Blank means the default, not zero.">
          {ALSO_ACCEPTED.map((f) => <FieldRow key={f.field} f={f} />)}
        </Section>

        <Section title="Set after the upload, not in it" intro="A first upload does not read these. They are set once the products exist.">
          {LATER_ONLY.map((f) => <FieldRow key={f.field} f={f} />)}
        </Section>

        <h2 style={{ fontSize: "var(--text-lg)", fontWeight: 700, margin: "34px 0 6px" }}>
          The sales history spreadsheet
        </h2>
        <p style={{ fontSize: "var(--text-sm)", color: "var(--text-secondary)", lineHeight: 1.5, margin: "0 0 18px", maxWidth: "56ch" }}>
          The second setup step asks for past sales, one row per sale. It is how the app learns how fast each product
          moves. Three columns are required and three are optional.
        </p>

        <Section title="Required" intro="Every row needs all three, or the row is rejected.">
          {SALES_REQUIRED.map((f) => <FieldRow key={f.field} f={f} required />)}
        </Section>

        <Section title="Optional">
          {SALES_OPTIONAL.map((f) => <FieldRow key={f.field} f={f} />)}
        </Section>

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
      <div style={{ width: 200, maxWidth: "42%", flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
          <code style={{ fontFamily: "'IBM Plex Mono', ui-monospace, Menlo, monospace", fontSize: "var(--text-xs)", fontWeight: 700, color: "var(--text-primary)" }}>
            {f.field}
          </code>
          {f.unit && (
            <span style={{
              fontSize: "var(--text-xs)", fontWeight: 700, color: "var(--blue-text)",
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
            color: required ? "var(--red-text)" : "var(--text-muted)",
          }}>
            {required ? "Required" : f.defaultValue != null ? `Default if blank: ${f.defaultValue}` : "Optional"}
          </span>
          {f.example != null && (
            <span style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)" }}>
              {" \u00b7 "}Example: <code style={{ fontFamily: "'IBM Plex Mono', ui-monospace, Menlo, monospace" }}>{f.example}{f.unit ? ` ${f.unit}` : ""}</code>
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
