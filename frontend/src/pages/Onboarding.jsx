import { queueTourAfterOnboarding } from "../lib/tour";
import React, { useState, useEffect, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { Package, Upload, TrendingUp, Sparkles, X, ChevronLeft, Info, Settings2, Check } from "lucide-react";
import { api } from "../api/inventory";
import { ImportPreview, Toast } from "../components/ImportPreview";
import { SuggestedSettingsReview } from "../components/SuggestedSettingsReview";
import Modal, { ModalBtn } from "../components/Modal";
import ColHint from "../components/ColHint";
import { Seal, CLIENT_EN } from "../components/Tenant";
import { dismissOnboarding, clearDismissal } from "../lib/onboardingResume";
import { armForecastNudge } from "../lib/forecastNudge";

const TOTAL_STEPS = 3;

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

// Step 2's example can't be a fixed string - see
// trySalesExample's comment for why. Deterministic (seeded on the sku_id, not
// Math.random) so re-clicking "try an example" against the same catalog shows
// the same numbers rather than a new random set every time, which would read
// as a bug ("didn't I already generate this?").
function buildExampleSalesCsv(skus) {
  const today = new Date();
  const rows = ["sku_id,quantity_mt,sale_date,customer,channel,status"];
  skus.forEach((sku, skuIdx) => {
    let seed = [...sku.sku_id].reduce((n, c) => n + c.charCodeAt(0), skuIdx * 7);
    const next = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
    for (let daysAgo = 89; daysAgo >= 0; daysAgo -= 2 + Math.floor(next() * 2)) {
      const d = new Date(today); d.setDate(d.getDate() - daysAgo);
      const qty = (4 + next() * 10).toFixed(1);
      rows.push(`${sku.sku_id},${qty},${d.toISOString().slice(0, 10)},Sheng Siong,wholesale,fulfilled`);
    }
  });
  return rows.join("\n") + "\n";
}

// Which SKUs earn a callout on the very first analysis screen someone sees,
// right after their opening balance. `skus` is GET /skus's own enriched
// output (engines/index.js) - health_status, days_of_cover, days_of_cover_text,
// target_days_of_cover and suggested_order_qty are all already computed,
// nothing here should recompute any of them (rules.md, "Derived values
// computed twice").
// TODO(human): return the subset of `skus` worth surfacing here. Keep it
// short - a crowded first impression defeats the point of "basic level".
function pickNeedsAttention(skus) {
  return [];
}

export default function Onboarding() {
  const navigate = useNavigate();
  const [step, setStep] = useState(1); // 1 = catalog, 2 = sales history, 3 = review suggested settings
  // A full reload, not navigate("/"): reachable from Home's OWN inline render
  // of this component when the catalog is empty, so we're already at "/" and
  // a client-side navigate to the same path never re-renders Home to notice
  // the new isDismissed() value (same reasoning as trySampleData below).
  const exitOnboarding = useCallback(() => { dismissOnboarding(); window.location.href = "/"; }, []);
  const backStep = useCallback(() => setStep((s) => Math.max(1, s - 1)), []);
  const [skuCount, setSkuCount] = useState(null);
  const [addedSkus, setAddedSkus] = useState(null); // { count, names } after a catalog upload this session

  const [busy, setBusy] = useState(null); // "read" | "apply" | "export" | "sample" | "suggestions"
  const [error, setError] = useState(null);
  const [preview, setPreview] = useState(null);
  const [csv, setCsv] = useState(null);
  const datasetRef = useRef("skus");
  const fileRef = useRef(null);

  // Step 3 state, loaded once on entering the step (not eagerly, since it's
  // a real query over the whole portfolio via getAnalytics()).
  const [suggestions, setSuggestions] = useState(null);
  const [included, setIncluded] = useState(new Set());
  const enterReviewStep = useCallback(() => {
    setStep(3);
    setBusy("suggestions"); setError(null);
    api.getSuggestedSettings()
      .then((data) => {
        setSuggestions(data);
        setIncluded(new Set(data.map((s) => s.sku_id)));
      })
      .catch((err) => setError(err.message))
      .finally(() => setBusy(null));
  }, []);
  // Story-style: Skip moves to the next step, and on the last one there's
  // nowhere further to go, so it means the same thing as closing.
  const skipStep = useCallback(() => {
    if (step === 2) enterReviewStep();          // loads the suggestions the last step shows
    else if (step < TOTAL_STEPS) setStep(step + 1);
    else exitOnboarding();
  }, [step, exitOnboarding, enterReviewStep]);
  const toggleIncluded = useCallback((skuId) => {
    setIncluded((prev) => {
      const next = new Set(prev);
      if (next.has(skuId)) next.delete(skuId); else next.add(skuId);
      return next;
    });
  }, []);
  const applySuggestions = useCallback(async () => {
    setBusy("apply"); setError(null);
    try {
      const payload = suggestions
        .filter((s) => included.has(s.sku_id))
        .map((s) => ({
          sku_id: s.sku_id,
          target_service_level: s.target_service_level.suggested,
          target_stock: s.target_stock.suggested,
          lead_time_days: s.lead_time_days.suggested,
        }));
      if (payload.length) await api.applySuggestedSettings(payload);
      // A full reload, not navigate("/"), for the same reason as exitOnboarding above.
      clearDismissal();
      queueTourAfterOnboarding();
      window.location.href = "/";
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  }, [suggestions, included]);


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

  // Review before leaving, not before committing: an accurate preview would
  // mean re-running seed.js's own PRNG loop a second time just to compute one
  // (see sampleDataPreview's comment, backend/src/routes/demo.js) - two
  // copies of the same generation logic that could silently drift apart, the
  // exact bug class rules.md already names. The sandbox is disposable by
  // design, so this seeds for real immediately and shows what actually
  // landed; Cancel resets it back to empty rather than pretending nothing
  // happened, since something genuinely did.
  const [samplePreview, setSamplePreview] = useState(null);
  const openSamplePreview = useCallback(async () => {
    setError(null); setBusy("sample");
    try {
      setSamplePreview(await api.seedSampleData());
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  }, []);
  // Opening balance (Stan's call, 18 Sep): sample data - like any onboarding
  // upload - creates every SKU with on_hand_qty = 0 (import-new's insertPos,
  // backend/src/routes/inventory.js), since the uploaded sales/receipt HISTORY
  // is context for demand, not a ledger to reconstruct a current balance from
  // (that would contradict on_hand_qty's own documented status as a mutable
  // snapshot, project-context.md). So Continue leads here instead of straight
  // to Home: one short "what do you actually have right now" step, additive
  // onto the 0 baseline via the audited POST /skus/opening-balance the rest of the
  // app already uses for a real stock receipt - no new backend logic, just
  // reusing it during onboarding.
  const [balanceSkus, setBalanceSkus] = useState(null);
  const [balances, setBalances] = useState({});
  const [balanceSuggestions, setBalanceSuggestions] = useState({});
  const [balanceBusy, setBalanceBusy] = useState(false);
  const [analysis, setAnalysis] = useState(null);

  const confirmSampleData = useCallback(async () => {
    setBusy("sample"); setError(null);
    try {
      const [skus, suggestions] = await Promise.all([api.getSkus(), api.getOpeningBalanceSuggestions()]);
      setBalances(Object.fromEntries(skus.map((s) => [s.sku_id, ""])));
      setBalanceSuggestions(suggestions);
      setBalanceSkus(skus);
      setSamplePreview(null);
    } catch (err) {
      // Sample data is already seeded regardless; don't strand the user on a
      // broken step for a fetch failure alone.
      setError(err.message);
      armForecastNudge();
      window.location.href = "/";
    } finally {
      setBusy(null);
    }
  }, []);

  // Blank/zero entries are left at 0, not sent - POST /skus/opening-balance
  // itself refuses a non-positive quantity, so this just skips the request
  // rather than relying on the backend to reject it silently per row.
  const submitBalances = useCallback(async () => {
    setBalanceBusy(true); setError(null);
    try {
      const entries = Object.entries(balances).filter(([, v]) => Number(v) > 0);
      for (const [sku_id, v] of entries) {
        await api.setOpeningBalance(sku_id, Number(v));
      }
      setAnalysis(await api.getSkus());
      setBalanceSkus(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setBalanceBusy(false);
    }
  }, [balances]);

  const skipBalances = useCallback(async () => {
    setBalanceBusy(true); setError(null);
    try {
      setAnalysis(await api.getSkus());
      setBalanceSkus(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setBalanceBusy(false);
    }
  }, []);

  const finishFlow = useCallback(() => {
    armForecastNudge();
    queueTourAfterOnboarding();
    window.location.href = "/"; // whole database changed under us; reload, don't navigate
  }, []);

  const loadCount = useCallback(() => {
    api.getSkus().then((list) => setSkuCount(list.length)).catch(() => setSkuCount(0));
  }, []);
  useEffect(() => { loadCount(); }, [loadCount]);

  const cancelSampleData = useCallback(async () => {
    setSamplePreview(null); setBusy("sample");
    try {
      await api.exitDemoMode();
      await api.enterDemoMode();
      loadCount();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  }, [loadCount]);

  const openPicker = (which) => { datasetRef.current = which; fileRef.current?.click(); };

  // Shared by a real file pick (onFile) and step 2's built-in sales example
  // below - same preview call either way, so the review modal
  // behaves identically whether the CSV came from disk or was built in.
  const previewText = useCallback(async (text, fileName, which) => {
    setError(null); setBusy("read");
    try {
      const result = await IMPORTERS[which](text, false);
      setCsv(text);
      setPreview({ ...result, fileName, dataset: which });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  }, []);

  const onFile = useCallback(async (e) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // picking the same file twice fires no change event otherwise
    if (!file) return;
    const text = await file.text();
    previewText(text, file.name, datasetRef.current);
  }, [previewText]);


  // Step 2's "try an example" can't ship a fixed CSV like step 1's does: a
  // sales row's sku_id has to match a REAL product already in the catalog
  // (import-sales rejects anything it doesn't recognise), and which products
  // exist at this point depends on whichever of step 1's paths was used - a
  // real upload, one of its two examples, "Try with sample data", or adding
  // one by hand. So this builds the CSV from whatever's actually there,
  // fetched fresh rather than trusted from addedSkus (which only carries the
  // first 3 names, not every sku_id).
  const trySalesExample = useCallback(async () => {
    setError(null); setBusy("read");
    try {
      const skus = await api.getSkus();
      if (!skus.length) { setError("Add a product first - there's nothing to attach sales to yet."); return; }
      const csv = buildExampleSalesCsv(skus.slice(0, 3));
      await previewText(csv, "example-sales-history.csv", "salesHistory");
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  }, [previewText]);

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
        armForecastNudge();
        // Sales are in; the last step is reviewing the suggested settings. That step ends with the full
        // reload home (see applySuggestions), which is what makes Home notice the new catalog.
        enterReviewStep();
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
          window.location.href = "/"; // same reload-not-navigate reasoning as above
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
  }, [csv, salesCsv, preview, loadCount, clearSalesAttachment, enterReviewStep]);

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
      <div style={{ width: "100%", maxWidth: step === 3 ? 760 : 620 }}>

        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 20 }}>
          <Seal size={30} />
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: "var(--text-sm)", fontWeight: 700, lineHeight: 1.1 }}>{CLIENT_EN}</div>
            <div style={{ fontSize: "var(--text-xs)", fontWeight: 600, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--text-muted)" }}>
              Set up your catalog
            </div>
          </div>
          <button onClick={exitOnboarding} className="hit-44-icon" title="Close setup, add products later from Inventory or Bulk edit" style={{
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
              StockSense can't monitor inventory it doesn't know exists. Add your products first: every reorder point, alert, and forecast builds from this catalog.
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
                <BigButton icon={Sparkles} label={busy === "sample" ? "Loading preview…" : "Try with sample data"}
                  disabled={busy === "sample"} onClick={openSamplePreview} />
              )}
            </div>

            <div style={{ display: "flex", justifyContent: "center", gap: 16, marginTop: 16, flexWrap: "wrap" }}>
              <button onClick={downloadTemplate} disabled={busy === "export"} style={{
                background: "none", border: "none", cursor: "pointer", padding: 0,
                fontSize: "var(--text-xs)", color: "var(--text-muted)", fontWeight: 600,
                borderBottom: "1px dotted var(--text-muted)",
              }}>
                {busy === "export" ? "Preparing…" : skuCount > 0 ? "Download your current catalog" : "Need the format? Download a blank template"}
              </button>
              <button onClick={() => navigate("/onboarding/catalog-fields")} style={{
                display: "flex", alignItems: "center", gap: 4,
                background: "none", border: "none", cursor: "pointer", padding: 0,
                fontSize: "var(--text-xs)", color: "var(--text-muted)", fontWeight: 600,
                borderBottom: "1px dotted var(--text-muted)",
              }}>
                <Info size={12} /> What does each column mean?
              </button>
            </div>

            {/* sku_id and product_name are the only two the database actually
                requires (CREATE_REQUIRED, backend/src/routes/inventory.js);
                lead_time_days/reorder_point_policy/target_stock are the
                three the blank template also asks for, since without them the
                reorder math rests entirely on defaults - see
                MINIMAL_TEMPLATE_COLUMNS, same file. Everything past those
                five has a sensible default and is explained on the linked
                reference page rather than restated here. */}
            <div style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)", lineHeight: 1.6, borderTop: "1px solid var(--border)", paddingTop: 16, marginTop: 24 }}>
              The template asks for five columns: <Code>sku_id</Code>, <Code>product_name</Code>, <Code>lead_time_days</Code>, <Code>reorder_point_policy</Code> and <Code>target_stock</Code>, only the first two are actually required. Everything else can be added later from Inventory.
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
                Upload past sales and StockSense can forecast demand and suggest safety stock from day one, instead of waiting a month to learn your patterns. This step is optional, skip it and forecasts build up as you go.
              </p>

              <div style={{
                fontFamily: "ui-monospace, Menlo, monospace", fontSize: "var(--text-xs)", background: "var(--surface-2)",
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

              {/* Demo-mode only, same reasoning as step 1's examples: generates
                  90 days of sales for whichever products already exist (up to
                  3), rather than a fixed file, since a sales row's sku_id has
                  to match something real - see trySalesExample above. */}
              {isDemo && (
                <div style={{ textAlign: "center", marginTop: 10, fontSize: "var(--text-xs)", color: "var(--text-muted)" }}>
                  Or{" "}
                  <button onClick={trySalesExample} disabled={busy === "read"} style={{
                    background: "none", border: "none", cursor: "pointer", padding: 0,
                    fontSize: "inherit", color: "var(--blue-text)", fontWeight: 600,
                  }}>
                    generate example sales for my products
                  </button>
                </div>
              )}

              <div style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)", lineHeight: 1.6, borderTop: "1px solid var(--border)", paddingTop: 16, marginTop: 24 }}>
                You can always come back to this from <Code>Bulk edit → Upload sales history</Code> once you're inside the app.
              </div>
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="card" style={{ padding: 36 }}>
            <StepIcon icon={Settings2} bg="var(--blue-light)" fg="var(--blue)" />
            <h1 style={{ fontSize: "var(--text-xl)", fontWeight: 700, lineHeight: 1.2, margin: "0 0 10px" }}>
              Start from sensible settings, not blank defaults.
            </h1>
            <p style={{ fontSize: "var(--text-base)", color: "var(--text-secondary)", lineHeight: 1.5, margin: "0 0 26px", maxWidth: "60ch" }}>
              Every product below is suggested a target service level and target stock from its own data, instead of the raw defaults every new product starts with. Uncheck anything you'd rather set by hand later.
            </p>

            {busy === "suggestions" && (
              <div style={{ color: "var(--text-muted)", fontSize: "var(--text-sm)", padding: "20px 0" }}>Computing suggestions…</div>
            )}

            {suggestions && (
              <SuggestedSettingsReview suggestions={suggestions} included={included} onToggle={toggleIncluded} />
            )}

            <div style={{ display: "flex", gap: 10, marginTop: 22 }}>
              <BigButton primary icon={Check}
                label={busy === "apply" ? "Applying…" : `Apply to ${included.size} product${included.size === 1 ? "" : "s"}`}
                disabled={busy === "apply" || !suggestions || included.size === 0}
                onClick={applySuggestions} />
              <BigButton label="Skip for now" onClick={exitOnboarding} />
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

        {samplePreview && (
          <Modal wide title="Review sample data" onClose={cancelSampleData}>
            <div style={{ fontSize: "var(--text-sm)", color: "var(--text-secondary)", marginBottom: 18 }}>
              Already added to the sandbox, {samplePreview.catalogCount} products, {samplePreview.salesCount} sales
              rows (stock out) and {samplePreview.receiptsCount} goods receipts (stock in) across 24 months. Cancel
              resets it back to empty.
            </div>

            <SampleTable
              title="Product catalog" count={samplePreview.catalogCount} rows={samplePreview.catalogSample}
              columns={[
                { key: "sku_id", label: "SKU", minWidth: 80, primary: true },
                { key: "product_name", label: "Product", minWidth: 160 },
                { key: "lead_time_days", label: "Lead time", minWidth: 70, render: (v) => `${v}d` },
                { key: "reorder_point_policy", label: "Reorder pt", minWidth: 80, render: (v) => `${v} MT` },
                { key: "target_stock", label: "Target", minWidth: 80, render: (v) => `${v} MT` },
              ]}
            />

            {/* Date/SKU/Qty are genuinely the same concept in both tables and
                share column position; the 4th column deliberately does NOT
                share a label (Stan's call, 18 Sep, reversing the first
                version of this): a sales channel and a PO number are
                different kinds of thing, and calling both "Reference" implied
                an equivalence that wasn't there. Receipts now show the real
                po_number, backed by an actual purchase_orders row (seed.js) -
                it used to be a fabricated string, caught when Stan asked
                whether it was real and pointed out Goods In requires a
                genuine open PO to post a receipt against. */}
            <div style={{ marginTop: 18 }}>
              <SampleTable
                title="Sale data (stock out)" count={samplePreview.salesCount} rows={samplePreview.salesSample}
                columns={[
                  { key: "sale_date", label: "Date", minWidth: 78 },
                  { key: "sku_id", label: "SKU", minWidth: 80, primary: true },
                  { key: "quantity_mt", label: "Qty", minWidth: 56, render: (v) => `${v} MT` },
                  { key: "channel", label: "Channel", minWidth: 90 },
                ]}
              />
            </div>

            <div style={{ marginTop: 18 }}>
              <SampleTable
                title="Goods receipts (stock in)" count={samplePreview.receiptsCount} rows={samplePreview.receiptsSample}
                columns={[
                  { key: "created_at", label: "Date", minWidth: 78 },
                  { key: "sku_id", label: "SKU", minWidth: 80, primary: true },
                  { key: "actual_qty", label: "Qty", minWidth: 56,
                    render: (v, r) => `${v} MT${r.variance_qty ? " (short)" : ""}` },
                  { key: "reference", label: "PO number", minWidth: 90 },
                ]}
              />
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 22 }}>
              <ModalBtn label="Cancel" disabled={busy === "sample"} onClick={cancelSampleData} />
              <ModalBtn primary disabled={busy === "sample"} label={busy === "sample" ? "Loading…" : "Continue"} onClick={confirmSampleData} />
            </div>
          </Modal>
        )}

        {balanceSkus && (
          <Modal wide title="What do you actually have on hand?" onClose={skipBalances}>
            <div style={{ fontSize: "var(--text-sm)", color: "var(--text-secondary)", marginBottom: 18, display: "flex", alignItems: "flex-start", gap: 6 }}>
              <span>
                The sales and receipts you just saw explain demand, not what's on the shelf today. Enter a
                current on-hand quantity for any product you know, leave the rest blank, and we'll
                treat those as unknown for now rather than guess.
              </span>
              <span style={{ marginTop: 3, flexShrink: 0 }}>
                <ColHint
                  label="opening balance"
                  what="The amount of a product physically sitting in your warehouse right now, today, not last month, not what's on order."
                  how="StockSense never guesses this for you. You type it in once here, and from then on every sale and every delivery you record moves it up or down, the same way a bank balance changes with each transaction, not by recalculating your whole history every time."
                />
              </span>
            </div>
            <div style={{ border: "1px solid var(--border)", borderRadius: "var(--radius)", overflow: "hidden" }}>
              {balanceSkus.map((s, i) => {
                const suggestion = balanceSuggestions[s.sku_id];
                return (
                  <div key={s.sku_id} style={{
                    display: "flex", alignItems: "center", gap: 12, padding: "10px 13px",
                    borderBottom: i === balanceSkus.length - 1 ? "none" : "1px solid var(--border)",
                  }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: "var(--text-sm)", fontWeight: 600 }}>{s.product_name}</div>
                      <div style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)" }}>{s.sku_id}</div>
                    </div>
                    {suggestion > 0 && (
                      <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
                        <button
                          type="button"
                          onClick={() => setBalances((b) => ({ ...b, [s.sku_id]: String(suggestion) }))}
                          style={{
                            fontSize: "var(--text-xs)", fontWeight: 600, color: "var(--blue-text)",
                            background: "var(--blue-light)", border: "none", borderRadius: 99,
                            padding: "4px 10px", cursor: "pointer", whiteSpace: "nowrap",
                          }}
                        >
                          Use ~{suggestion} MT
                        </button>
                        <ColHint
                          label={`how ${s.sku_id}'s suggestion was worked out`}
                          what="Everything this product has received, minus everything it's sold, added up since the earliest record in your upload."
                          how={`Deliveries in − sales out = ~${suggestion} MT. Not a count of what's actually on your shelf - only what you type in the box above becomes the real opening balance.`}
                        />
                      </span>
                    )}
                    <input
                      type="number" min="0" step="0.1" placeholder="0"
                      value={balances[s.sku_id] ?? ""}
                      onChange={(e) => setBalances((b) => ({ ...b, [s.sku_id]: e.target.value }))}
                      style={{
                        width: 90, fontSize: "var(--text-sm)", padding: "6px 8px", textAlign: "right",
                        border: "1px solid var(--border)", borderRadius: "var(--radius)", background: "var(--surface)",
                      }}
                    />
                    <span style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)", width: 22 }}>MT</span>
                  </div>
                );
              })}
            </div>
            {Object.values(balanceSuggestions).some((v) => v > 0) && (
              <div style={{ display: "flex", alignItems: "center", gap: 5, marginTop: 8, fontSize: "var(--text-xs)", color: "var(--text-muted)" }}>
                "Use ~X MT" is inferred from the deliveries and sales you just uploaded, not counted, click
                it only where you don't have a more accurate number yourself.
              </div>
            )}
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 22 }}>
              <ModalBtn label="Skip for now" disabled={balanceBusy} onClick={skipBalances} />
              <ModalBtn primary disabled={balanceBusy} label={balanceBusy ? "Saving…" : "Save and see analysis"} onClick={submitBalances} />
            </div>
          </Modal>
        )}

        {analysis && (
          <Modal wide title="Your first quick read" onClose={finishFlow}>
            {(() => {
              const attention = pickNeedsAttention(analysis);
              const topMovers = [...analysis]
                .filter((s) => s.avg_daily_usage_30d > 0)
                .sort((a, b) => b.avg_daily_usage_30d - a.avg_daily_usage_30d)
                .slice(0, 3);
              return (
                <>
                  <div style={{ fontSize: "var(--text-sm)", color: "var(--text-secondary)", marginBottom: 18 }}>
                    Computed the same way as everywhere else in StockSense, nothing here is a guess.
                  </div>
                  {attention.length > 0 && (
                    <div style={{ marginBottom: 18 }}>
                      <div style={{ fontSize: "var(--text-xs)", fontWeight: 700, color: "var(--text-muted)", marginBottom: 8 }}>
                        Worth a look first
                      </div>
                      <AnalysisTable rows={attention} />
                    </div>
                  )}
                  {topMovers.length > 0 && (
                    <div>
                      <div style={{ fontSize: "var(--text-xs)", fontWeight: 700, color: "var(--text-muted)", marginBottom: 8 }}>
                        Your fastest movers
                      </div>
                      <AnalysisTable rows={topMovers} />
                    </div>
                  )}
                  {attention.length === 0 && topMovers.length === 0 && (
                    <div style={{ fontSize: "var(--text-sm)", color: "var(--text-muted)" }}>
                      Not enough history yet to say anything useful, check back after a few sales.
                    </div>
                  )}
                </>
              );
            })()}
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 22 }}>
              <ModalBtn primary label="Done" onClick={finishFlow} />
            </div>
          </Modal>
        )}
      </div>
    </div>
  );
}

// Shared by both lists on the "first quick read" screen above - same four
// fields either way (SKU, days of cover, health, suggested order qty), all
// read straight off GET /skus's enriched response, nothing recomputed here.
// One grid template shared by the header and every row (Stan's call: a flex
// row per line lets a header cell with an icon push its own width around
// independently of the data cells below it, so columns drift out of line -
// a grid with a fixed template can't do that, each column is exactly as wide
// in the header as in every row, no visible grid lines needed for that).
const ANALYSIS_GRID = "minmax(140px, 1fr) 130px 80px 110px";

function AnalysisTable({ rows }) {
  return (
    <div style={{ border: "1px solid var(--border)", borderRadius: "var(--radius)", overflow: "hidden", fontSize: "var(--text-xs)" }}>
      <div style={{
        display: "grid", gridTemplateColumns: ANALYSIS_GRID, gap: 12, padding: "6px 13px",
        borderBottom: "1px solid var(--border)", background: "var(--surface-2)",
        color: "var(--text-muted)", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.03em",
      }}>
        <span>Product</span>
        <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
          Days of cover
          <ColHint
            label="days of cover"
            what="How many days your current on-hand stock would last, at the rate you've actually been selling it."
            how="On hand ÷ average daily sales. Shown as 'Not applicable' when there's no sales history yet or on-hand stock is unknown - never a blank, never infinity."
          />
        </span>
        <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
          Health
          <ColHint
            label="health"
            what="A traffic light for this product's stock position: green is healthy, red needs attention now."
            how="Compares days of cover against your lead time plus safety stock, and against your target stock - the same rule used everywhere in StockSense, not a different one for onboarding."
          />
        </span>
        <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
          Suggested order
          <ColHint
            label="suggested order"
            what="How much to order to get back to your target stock level, based on what you'd have on hand after anything already incoming arrives."
            how="Target stock minus (on hand + expected incoming). A recommendation for a manager to approve, never placed automatically."
          />
        </span>
      </div>
      {rows.map((s, i) => (
        <div key={s.sku_id} style={{
          display: "grid", gridTemplateColumns: ANALYSIS_GRID, gap: 12, padding: "8px 13px",
          borderBottom: i === rows.length - 1 ? "none" : "1px solid var(--border)",
          color: "var(--text-secondary)",
        }}>
          <span style={{ fontWeight: 600, color: "var(--text-primary)" }}>{s.product_name}</span>
          <span>{s.days_of_cover_text || "Not applicable"}</span>
          <span>{s.health_status}</span>
          <span>{s.suggested_order_qty > 0 ? `${s.suggested_order_qty} MT` : "-"}</span>
        </div>
      ))}
    </div>
  );
}

// Shared by all three tables in the sample-data review modal above. `rows` is
// already the top-3 slice from the backend (sampleDataPreview,
// backend/src/routes/demo.js) - a straight slice now, not two halves, so
// there's no divider to draw (Stan's call, 18 Sep, simplifying the earlier
// top-3/bottom-3 version).
function SampleTable({ title, count, rows, columns }) {
  const truncated = count > rows.length;
  return (
    <div>
      <div style={{ fontSize: "var(--text-xs)", fontWeight: 700, color: "var(--text-muted)", marginBottom: 8 }}>
        {title}, {truncated ? `first 3 of ${count}` : `all ${count}`}
      </div>
      <div style={{ border: "1px solid var(--border)", borderRadius: "var(--radius)", overflow: "hidden", fontSize: "var(--text-xs)" }}>
        <div style={{
          display: "flex", gap: 12, padding: "6px 13px",
          borderBottom: "1px solid var(--border)", background: "var(--surface-2)",
          color: "var(--text-muted)", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.03em",
        }}>
          {columns.map((c) => <span key={c.key} style={{ minWidth: c.minWidth }}>{c.label}</span>)}
        </div>
        {rows.map((r, i) => (
          <React.Fragment key={`${r.sku_id}-${i}`}>
            <div style={{
              display: "flex", gap: 12, padding: "8px 13px",
              borderBottom: i === rows.length - 1 ? "none" : "1px solid var(--border)",
              color: "var(--text-secondary)",
            }}>
              {columns.map((c) => (
                <span key={c.key} style={{
                  minWidth: c.minWidth,
                  fontWeight: c.primary ? 600 : 400,
                  color: c.primary ? "var(--text-primary)" : "inherit",
                }}>
                  {c.render ? c.render(r[c.key], r) : r[c.key]}
                </span>
              ))}
            </div>
          </React.Fragment>
        ))}
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
      background: primary ? "var(--blue-strong)" : "var(--surface-2)",
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
