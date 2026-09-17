import React, { useState, useEffect, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { Package, Upload, TrendingUp, Sparkles, X, ChevronLeft } from "lucide-react";
import { api } from "../api/inventory";
import { ImportPreview, Toast } from "../components/ImportPreview";
import Modal, { ModalBtn } from "../components/Modal";
import { Seal, CLIENT_EN } from "../components/Tenant";
import { dismissOnboarding, clearDismissal } from "../lib/onboardingResume";
import { armForecastNudge } from "../lib/forecastNudge";

const TOTAL_STEPS = 2;

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
// Sequential and story-like on purpose (Stan's call, after trying a "minimize
// and hop back in from anywhere" version): a segmented progress bar up top
// shows how many steps are left, Back returns to the previous one, and Skip
// moves forward exactly like a story's skip, closing the whole thing on the
// last step rather than dangling. Nothing here is mandatory: every step has
// its own way out, and a manager who skips everything can still add products
// and sales history exactly like any other data entry, from Inventory or Bulk
// edit, once inside the app. What's gone is a floating "resume setup" control
// following you around the app; skip and close both just go to Home.
//
// "Skip setup, explore with sample data" is offered ONLY in demo mode (see
// trySampleData below) — against the real database this is still cut, since
// reseeding wipes decisions and the audit trail (see rules.md), a real
// destructive action a stray click shouldn't trigger there.
//
// Someone with BOTH files ready doesn't have to visit step 2 at all: the
// catalog upload's own review modal offers "Also add sales history now"
// (salesPreview/salesCsv below), previewed against the SKUs that upload is
// about to create rather than the live table, which doesn't have them yet
// (pendingSkus, backend/src/routes/inventory.js). Deliberately NOT one
// combined CSV format: a sales row has no product_name, rice_variety,
// country_of_origin, packaging_size or supplier to offer, so there is
// nothing in a sale to build a catalog row FROM; the two files stay their
// own shapes, and only the onboarding SCREEN combines them. The two applies
// are still two separate requests, not one transaction: if the catalog goes
// in but sales fails, the products stay (they're already real) and the flow
// drops into the ordinary step 2 rather than losing that progress.
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
  // A full reload, not navigate("/"): reachable from Home's OWN inline render
  // of this component when the catalog is empty, so we're already at "/" and
  // a client-side navigate to the same path never re-renders Home to notice
  // the new isDismissed() value (same reasoning as trySampleData below).
  const exitOnboarding = useCallback(() => { dismissOnboarding(); window.location.href = "/"; }, []);
  // Story-style: Skip moves to the next step, and on the last one there's
  // nowhere further to go, so it means the same thing as closing.
  const skipStep = useCallback(() => {
    if (step < TOTAL_STEPS) setStep(step + 1);
    else exitOnboarding();
  }, [step, exitOnboarding]);
  const backStep = useCallback(() => setStep((s) => Math.max(1, s - 1)), []);
  const [skuCount, setSkuCount] = useState(null);
  const [addedSkus, setAddedSkus] = useState(null); // { count, names } after a catalog upload this session

  const [busy, setBusy] = useState(null); // "read" | "apply" | "export" | "sample"
  const [error, setError] = useState(null);
  const [preview, setPreview] = useState(null);
  const [csv, setCsv] = useState(null);
  const datasetRef = useRef("skus");
  const fileRef = useRef(null);

  // A second, optional file attached to the SAME catalog review, so someone
  // with both spreadsheets ready doesn't have to sit through two separate
  // upload-preview-apply rounds. Only offered alongside a "skus" preview
  // (see the modal below): sales history on its own still goes through
  // step 2 exactly as before.
  const [salesPreview, setSalesPreview] = useState(null);
  const [salesCsv, setSalesCsv] = useState(null);
  const salesFileRef = useRef(null);
  const clearSalesAttachment = useCallback(() => { setSalesPreview(null); setSalesCsv(null); }, []);

  // "Try with sample data" is demo-mode-only: seeding is a full wipe-and-fill,
  // safe against the disposable in-memory sandbox but never something to
  // offer against the real database (see the module comment above).
  const [isDemo, setIsDemo] = useState(false);
  useEffect(() => { api.getDemoStatus().then((d) => setIsDemo(d.active)).catch(() => {}); }, []);
  const trySampleData = useCallback(async () => {
    setError(null); setBusy("sample");
    try {
      await api.seedSampleData();
      armForecastNudge();
      window.location.href = "/"; // whole database changed under us; reload, don't navigate
    } catch (err) {
      setError(err.message);
      setBusy(null);
    }
  }, []);

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

  // Reads the second file straight from the modal that's already reviewing
  // the catalog upload, previewing it against the SKUs that upload is about
  // to create (pendingSkus) rather than the live table, which doesn't have
  // them yet.
  const onSalesAttachment = useCallback(async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setError(null); setBusy("read");
    try {
      const text = await file.text();
      const pendingSkus = (preview?.changes || []).map((c) => ({ sku_id: c.sku_id, product_name: c.name }));
      const result = await api.importSalesHistoryCsv(text, false, pendingSkus);
      setSalesCsv(text);
      setSalesPreview({ ...result, fileName: file.name, dataset: "salesHistory" });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  }, [preview]);

  const applyImport = useCallback(async () => {
    setBusy("apply"); setError(null);
    try {
      const which = preview?.dataset || "skus";
      const result = await IMPORTERS[which](csv, true);

      if (which !== "skus") {
        // The standalone step 2 upload: sales on their own, catalog already done.
        setPreview(null); setCsv(null);
        clearDismissal();
        armForecastNudge();
        navigate("/");
        return;
      }

      setAddedSkus({ count: result.changed, names: (result.changes || []).slice(0, 3).map((c) => c.name) });
      loadCount();
      armForecastNudge();

      if (salesCsv) {
        // Products are real now, so this insert validates against the real
        // table: no pendingSkus needed, same as any other sales import.
        try {
          await api.importSalesHistoryCsv(salesCsv, true);
          setPreview(null); setCsv(null); clearSalesAttachment();
          clearDismissal();
          navigate("/");
          return;
        } catch (err) {
          // The catalog half already succeeded and stays. Surface the sales
          // problem and drop into the normal step 2, which has its own
          // upload/preview/retry, rather than losing what just went in.
          setError(`Products were added, but sales history didn't go through: ${err.message}`);
          clearSalesAttachment();
        }
      }

      setPreview(null); setCsv(null);
      setStep(2);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  }, [csv, salesCsv, preview, loadCount, navigate, clearSalesAttachment]);

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
  const salesBlocked = salesPreview ? salesPreview.errors.length > 0 : false;

  const applyLabel = () => {
    if (busy === "apply") return "Applying…";
    if (preview.dataset === "salesHistory") {
      return `Add ${preview.changed} sale${preview.changed === 1 ? "" : "s"}`;
    }
    if (salesPreview) {
      return `Add ${preview.changed} product${preview.changed === 1 ? "" : "s"} and ${salesPreview.changed} sale${salesPreview.changed === 1 ? "" : "s"}`;
    }
    return `Add ${preview.changed} product${preview.changed === 1 ? "" : "s"}`;
  };

  return (
    <div style={{ minHeight: "calc(100vh - var(--demo-banner-height))", background: "var(--bg)", display: "flex", justifyContent: "center", padding: "clamp(32px, 8vh, 80px) 20px 48px" }}>
      <div style={{ width: "100%", maxWidth: 620 }}>

        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 20 }}>
          <Seal size={30} />
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: "var(--text-sm)", fontWeight: 700, lineHeight: 1.1 }}>{CLIENT_EN}</div>
            <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--text-muted)" }}>
              Set up your catalog
            </div>
          </div>
          <button onClick={exitOnboarding} title="Close setup, add products later from Inventory or Bulk edit" style={{
            display: "flex", alignItems: "center", justifyContent: "center", width: 30, height: 30,
            background: "none", border: "none", borderRadius: 99, cursor: "pointer", color: "var(--text-muted)",
          }}>
            <X size={18} />
          </button>
        </div>

        {/* Story-style progress: filled segments show how far in you are,
            Back returns to the previous step, Skip moves to the next one (or
            closes, on the last step), same place either way, the way
            Instagram's stories keep their own controls in one spot. */}
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 32 }}>
          <button onClick={backStep} disabled={step === 1} style={{
            display: "flex", alignItems: "center", gap: 2, background: "none", border: "none",
            padding: "4px 2px 4px 0", cursor: step === 1 ? "default" : "pointer", flexShrink: 0,
            color: step === 1 ? "var(--border)" : "var(--text-muted)",
            fontSize: "var(--text-xs)", fontWeight: 600,
          }}>
            <ChevronLeft size={15} /> Back
          </button>

          <div style={{ display: "flex", gap: 6, flex: 1 }}>
            {Array.from({ length: TOTAL_STEPS }).map((_, i) => (
              <div key={i} style={{
                flex: 1, height: 4, borderRadius: 99,
                background: i < step ? "var(--blue)" : "var(--border)",
              }} />
            ))}
          </div>

          <button onClick={skipStep} style={{
            background: "none", border: "none", padding: "4px 0 4px 2px", cursor: "pointer", flexShrink: 0,
            color: "var(--text-muted)", fontSize: "var(--text-xs)", fontWeight: 600,
          }}>
            {step < TOTAL_STEPS ? "Skip" : "Skip for now"}
          </button>
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
              {isDemo && !skuCount && (
                <BigButton icon={Sparkles} label={busy === "sample" ? "Loading sample data…" : "Try with sample data"}
                  disabled={busy === "sample"} onClick={trySampleData} />
              )}
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
              </div>

              <div style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)", lineHeight: 1.6, borderTop: "1px solid var(--border)", paddingTop: 16, marginTop: 24 }}>
                You can always come back to this from <Code>Bulk edit → Upload sales history</Code> once you're inside the app.
              </div>
            </div>
          </div>
        )}

        <input ref={fileRef} type="file" accept=".csv,text/csv" onChange={onFile} style={{ display: "none" }} />
        <input ref={salesFileRef} type="file" accept=".csv,text/csv" onChange={onSalesAttachment} style={{ display: "none" }} />

        {error && <Toast tone="bad" message={error} onDismiss={() => setError(null)} />}

        {preview && (
          <Modal wide title="Review changes" onClose={() => { setPreview(null); setCsv(null); clearSalesAttachment(); }}>
            <ImportPreview preview={preview} />

            {/* Only offered alongside a fresh catalog preview: someone who
                already has both files ready shouldn't have to sit through
                step 2 separately to finish sales history too. */}
            {preview.dataset === "skus" && !blocked && (
              <div style={{ borderTop: "1px solid var(--border)", marginTop: 20, paddingTop: 18 }}>
                {salesPreview ? (
                  <>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
                      <div style={{ fontSize: "var(--text-xs)", fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--text-muted)" }}>
                        Also adding: sales history
                      </div>
                      <button onClick={clearSalesAttachment} style={{
                        background: "none", border: "none", cursor: "pointer", padding: 0,
                        fontSize: "var(--text-xs)", fontWeight: 600, color: "var(--text-muted)", textDecoration: "underline",
                      }}>
                        Remove
                      </button>
                    </div>
                    <ImportPreview preview={salesPreview} />
                  </>
                ) : (
                  <button onClick={() => salesFileRef.current?.click()} disabled={busy === "read"} style={{
                    display: "flex", alignItems: "center", justifyContent: "center", gap: 7, width: "100%",
                    background: "none", border: "1.5px dashed var(--border)", borderRadius: "var(--radius)",
                    padding: "12px 14px", cursor: busy === "read" ? "default" : "pointer",
                    color: "var(--text-secondary)", fontSize: "var(--text-sm)", fontWeight: 600,
                  }}>
                    <Upload size={15} />
                    {busy === "read" ? "Reading…" : "Also add sales history now (optional)"}
                  </button>
                )}
              </div>
            )}

            <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 22 }}>
              <ModalBtn label="Cancel" onClick={() => { setPreview(null); setCsv(null); clearSalesAttachment(); }} />
              <ModalBtn primary disabled={blocked || busy === "apply" || salesBlocked}
                label={applyLabel()}
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

function BigButton({ primary, icon: Icon, label, busy, disabled, onClick, style }) {
  const inert = busy || disabled;
  return (
    <button onClick={onClick} disabled={inert} style={{
      font: "inherit", fontSize: "var(--text-base)", fontWeight: 700,
      padding: "13px 20px", borderRadius: "var(--radius)", cursor: inert ? "default" : "pointer",
      display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
      border: primary ? "none" : "1px solid var(--border)",
      background: primary ? "var(--blue)" : "var(--surface-2)",
      color: primary ? "#fff" : "var(--text-secondary)",
      boxShadow: primary ? "var(--shadow)" : "none",
      opacity: inert ? 0.7 : 1,
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
