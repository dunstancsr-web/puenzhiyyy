import React, { useState, useEffect, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { Package, Upload, TrendingUp } from "lucide-react";
import { api } from "../api/inventory";
import { ImportPreview, Toast } from "../components/ImportPreview";
import Modal, { ModalBtn } from "../components/Modal";
import { Seal, CLIENT_EN } from "../components/Tenant";

// ─────────────────────────────────────────────────────────────────────────────
// ONBOARDING (MVP2 step 1), the real build of the "Day Zero" mockup Stan
// approved. Two real jobs, not a wizard shell of its own:
//
//   1. Get SKUs into the catalog — reuses the exact same import machinery as
//      Bulk edit's "Upload SKUs" (api.importSkusCsv, the shared ImportPreview
//      review step). "Add one by hand" hands off to Inventory's own Add SKU
//      modal (?add=1) rather than duplicating that ~90-line form here.
//   2. Optionally seed sales history — same pattern, api.importSalesHistoryCsv
//      and SalesHistoryPreview (backend/src/routes/inventory.js, MVP2 Day 1).
//
// Home.jsx renders this automatically when the live SKU count is 0. It is also
// reachable on demand at /onboarding (App.jsx), for showing the flow in a demo
// without actually emptying the database — in that case the real, current SKU
// count is shown honestly rather than pretending the catalog is empty.
//
// Deliberately NOT built: the mockup's "skip setup, explore with sample data"
// shortcut. That would need a "reseed demo data" action wired to a button, and
// reseeding wipes decisions and the audit trail (see rules.md) — a real,
// destructive action a stray click shouldn't be able to trigger. Cut, not
// half-built.
// ─────────────────────────────────────────────────────────────────────────────

// importNewSkusCsv, not importSkusCsv: the catalog is empty (or being added
// to), so this needs the CREATE-shaped import, not BulkEdit's update-only one
// — see /skus/import-new in backend/src/routes/inventory.js for why they're
// two different endpoints, not one with a flag.
const IMPORTERS = {
  skus: (csv, apply) => api.importNewSkusCsv(csv, apply),
  salesHistory: (csv, apply) => api.importSalesHistoryCsv(csv, apply),
};

export default function Onboarding() {
  const navigate = useNavigate();
  const [step, setStep] = useState(1); // 1 = catalog, 2 = sales history
  const [skuCount, setSkuCount] = useState(null);
  const [addedSkus, setAddedSkus] = useState(null); // { count, names } after a catalog upload this session

  const [busy, setBusy] = useState(null); // "read" | "apply" | "export"
  const [error, setError] = useState(null);
  const [preview, setPreview] = useState(null);
  const [csv, setCsv] = useState(null);
  const datasetRef = useRef("skus");
  const fileRef = useRef(null);

  const loadCount = useCallback(() => {
    api.getSkus().then((list) => setSkuCount(list.length)).catch(() => setSkuCount(0));
  }, []);
  useEffect(() => { loadCount(); }, [loadCount]);

  const openPicker = (which) => { datasetRef.current = which; fileRef.current?.click(); };

  const onFile = useCallback(async (e) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // picking the same file twice fires no change event otherwise
    if (!file) return;
    setError(null); setBusy("read");
    try {
      const text = await file.text();
      const which = datasetRef.current;
      const result = await IMPORTERS[which](text, false);
      setCsv(text);
      setPreview({ ...result, fileName: file.name, dataset: which });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  }, []);

  const applyImport = useCallback(async () => {
    setBusy("apply"); setError(null);
    try {
      const which = preview?.dataset || "skus";
      const result = await IMPORTERS[which](csv, true);
      setPreview(null);
      setCsv(null);
      if (which === "skus") {
        setAddedSkus({ count: result.changed, names: (result.changes || []).slice(0, 3).map((c) => c.name) });
        loadCount();
        setStep(2);
      } else {
        navigate("/");
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  }, [csv, preview, loadCount, navigate]);

  const downloadTemplate = useCallback(async () => {
    setError(null); setBusy("export");
    try {
      const text = await api.exportSkusCsv();
      const url = URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = skuCount ? `stocksense-inventory-${new Date().toISOString().slice(0, 10)}.csv` : "stocksense-inventory-template.csv";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  }, [skuCount]);

  const blocked = preview ? preview.errors.length > 0 || preview.changed === 0 : false;

  return (
    <div style={{ minHeight: "100vh", background: "var(--bg)", display: "flex", justifyContent: "center", padding: "clamp(32px, 8vh, 80px) 20px 48px" }}>
      <div style={{ width: "100%", maxWidth: 620 }}>

        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 36 }}>
          <Seal size={30} />
          <div>
            <div style={{ fontSize: "var(--text-sm)", fontWeight: 700, lineHeight: 1.1 }}>{CLIENT_EN}</div>
            <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--text-muted)" }}>
              Set up your catalog
            </div>
          </div>
        </div>

        {step === 1 && (
          <div className="card" style={{ padding: 36 }}>
            <StepIcon icon={Package} bg="var(--blue-light)" fg="var(--blue)" />
            <h1 style={{ fontSize: "var(--text-xl)", fontWeight: 700, lineHeight: 1.2, margin: "0 0 10px" }}>
              Before we track anything, tell us what you stock.
            </h1>
            <p style={{ fontSize: "var(--text-base)", color: "var(--text-secondary)", lineHeight: 1.5, margin: "0 0 26px", maxWidth: "46ch" }}>
              StockSense can't monitor inventory it doesn't know exists. Add your products first &mdash; every reorder point, alert, and forecast builds from this catalog.
            </p>

            <EmptyPanel icon={Package}>
              {skuCount === null ? "Checking your catalog…" : `${skuCount} product${skuCount === 1 ? "" : "s"} in your catalog`}
            </EmptyPanel>

            {skuCount > 0 && (
              <BigButton primary label={`Continue with ${skuCount} product${skuCount === 1 ? "" : "s"} →`}
                onClick={() => setStep(2)} style={{ marginBottom: 10 }} />
            )}

            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <BigButton primary icon={Upload} label="Upload a product spreadsheet"
                busy={busy === "read"} onClick={() => openPicker("skus")} />
              <BigButton label="Add one product by hand"
                onClick={() => navigate("/inventory?add=1")} />
            </div>

            <div style={{ textAlign: "center", marginTop: 16 }}>
              <button onClick={downloadTemplate} disabled={busy === "export"} style={{
                background: "none", border: "none", cursor: "pointer", padding: 0,
                fontSize: "var(--text-xs)", color: "var(--text-muted)", fontWeight: 600,
                borderBottom: "1px dotted var(--text-muted)",
              }}>
                {busy === "export" ? "Preparing…" : skuCount > 0 ? "Download your current catalog" : "Need the format? Download a blank template"}
              </button>
            </div>

            <div style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)", lineHeight: 1.6, borderTop: "1px solid var(--border)", paddingTop: 16, marginTop: 24 }}>
              Each row needs a <Code>sku_id</Code>, <Code>product_name</Code>, <Code>rice_variety</Code>, <Code>country_of_origin</Code>, <Code>packaging_size</Code> and <Code>supplier</Code> &mdash; the same fields you'll see on every product's page afterward.
            </div>
          </div>
        )}

        {step === 2 && (
          <div>
            {addedSkus && (
              <SuccessBanner
                text={`${addedSkus.count} product${addedSkus.count === 1 ? "" : "s"} added to your catalog`}
                detail={addedSkus.names.length ? addedSkus.names.join(", ") + (addedSkus.count > addedSkus.names.length ? ` +${addedSkus.count - addedSkus.names.length} more` : "") : null}
              />
            )}
            <div className="card" style={{ padding: 36 }}>
              <StepIcon icon={TrendingUp} bg="var(--green-light)" fg="var(--green)" />
              <h1 style={{ fontSize: "var(--text-xl)", fontWeight: 700, lineHeight: 1.2, margin: "0 0 10px" }}>
                Give it something to learn from.
              </h1>
              <p style={{ fontSize: "var(--text-base)", color: "var(--text-secondary)", lineHeight: 1.5, margin: "0 0 26px", maxWidth: "46ch" }}>
                Upload past sales and StockSense can forecast demand and suggest safety stock from day one, instead of waiting a month to learn your patterns. This step is optional &mdash; skip it and forecasts build up as you go.
              </p>

              <div style={{
                fontFamily: "ui-monospace, Menlo, monospace", fontSize: 12, background: "var(--surface-2)",
                border: "1px solid var(--border)", borderRadius: "var(--radius)", padding: "12px 14px",
                marginBottom: 26, color: "var(--text-secondary)", overflowX: "auto", lineHeight: 1.7, whiteSpace: "pre",
              }}>
                <span style={{ color: "var(--text-muted)" }}>sku_id,quantity_mt,sale_date,customer,channel,status</span>{"\n"}
                TJ-25KG,12.5,2026-08-01,Sheng Siong,wholesale,fulfilled
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <BigButton primary icon={Upload} label="Upload sales history"
                  busy={busy === "read"} onClick={() => openPicker("salesHistory")} />
                <BigButton label="Skip for now" onClick={() => navigate("/")} />
              </div>

              <div style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)", lineHeight: 1.6, borderTop: "1px solid var(--border)", paddingTop: 16, marginTop: 24 }}>
                You can always come back to this from <Code>Bulk edit → Upload sales history</Code> once you're inside the app.
              </div>
            </div>
          </div>
        )}

        <input ref={fileRef} type="file" accept=".csv,text/csv" onChange={onFile} style={{ display: "none" }} />

        {error && <Toast tone="bad" message={error} onDismiss={() => setError(null)} />}

        {preview && (
          <Modal wide title="Review changes" onClose={() => { setPreview(null); setCsv(null); }}>
            <ImportPreview preview={preview} />
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 22 }}>
              <ModalBtn label="Cancel" onClick={() => { setPreview(null); setCsv(null); }} />
              <ModalBtn primary disabled={blocked || busy === "apply"}
                label={busy === "apply" ? "Applying…" : preview.dataset === "salesHistory"
                  ? `Add ${preview.changed} sale${preview.changed === 1 ? "" : "s"}`
                  : `Add ${preview.changed} product${preview.changed === 1 ? "" : "s"}`}
                onClick={applyImport} />
            </div>
          </Modal>
        )}
      </div>
    </div>
  );
}

function StepIcon({ icon: Icon, bg, fg }) {
  return (
    <div style={{ width: 52, height: 52, borderRadius: 14, background: bg, display: "grid", placeItems: "center", marginBottom: 20 }}>
      <Icon size={26} color={fg} />
    </div>
  );
}

function EmptyPanel({ icon: Icon, children }) {
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 12,
      border: "1.5px dashed var(--border)", borderRadius: "var(--radius)",
      padding: "16px 18px", marginBottom: 26, color: "var(--text-muted)",
      fontSize: "var(--text-sm)", fontWeight: 600,
    }}>
      <Icon size={18} />
      {children}
    </div>
  );
}

function BigButton({ primary, icon: Icon, label, busy, onClick, style }) {
  return (
    <button onClick={onClick} disabled={busy} style={{
      font: "inherit", fontSize: "var(--text-base)", fontWeight: 700,
      padding: "13px 20px", borderRadius: "var(--radius)", cursor: busy ? "default" : "pointer",
      display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
      border: primary ? "none" : "1px solid var(--border)",
      background: primary ? "var(--blue)" : "var(--surface-2)",
      color: primary ? "#fff" : "var(--text-secondary)",
      boxShadow: primary ? "var(--shadow)" : "none",
      opacity: busy ? 0.7 : 1,
      ...style,
    }}>
      {Icon && <Icon size={17} />}
      {busy ? "Reading…" : label}
    </button>
  );
}

function SuccessBanner({ text, detail }) {
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 10,
      background: "var(--green-light)", border: "1px solid var(--green)",
      borderRadius: "var(--radius)", padding: "12px 16px", marginBottom: 20,
      fontSize: "var(--text-sm)", fontWeight: 600, color: "var(--text-primary)",
    }}>
      <span style={{ width: 20, height: 20, borderRadius: "50%", background: "var(--green)", color: "#fff", display: "grid", placeItems: "center", flexShrink: 0, fontSize: 12 }}>✓</span>
      <span>
        {text}
        {detail && <span style={{ display: "block", fontWeight: 500, color: "var(--text-secondary)", fontSize: "var(--text-xs)", marginTop: 1 }}>{detail}</span>}
      </span>
    </div>
  );
}

function Code({ children }) {
  return (
    <code style={{ fontFamily: "ui-monospace, Menlo, monospace", background: "var(--surface-2)", borderRadius: 4, padding: "1px 5px", color: "var(--text-secondary)" }}>
      {children}
    </code>
  );
}
