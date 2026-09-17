import React, { useState, useRef, useEffect, useCallback } from "react";
import { Table2, Download, Upload, CalendarRange, History } from "lucide-react";
import Modal, { ModalBtn } from "./Modal";
import { api } from "../api/inventory";
import { ImportPreview, Toast } from "./ImportPreview";

// ─────────────────────────────────────────────────────────────────────────────
// BULK EDIT (TASK-60)
//
// Export every SKU to CSV, fix it in a spreadsheet, put it back. The one-SKU
// edit modal is the right tool for one SKU and a miserable one for fifty.
//
// ONE button in the page header, not two. Download and Upload are two halves of
// a single job, they are used minutes apart, and giving each a permanent
// control would put three buttons in a header whose primary action is Add SKU.
// The menu costs one click and keeps the hierarchy legible, which is the same
// reasoning that collapsed the sidebar's settings behind a gear.
//
// The import is deliberately a THREE step flow: choose a file, read what it
// would change, then apply. A file picker wired straight to a write is how
// somebody replaces the wrong spreadsheet and finds out afterwards. The review
// step is the product.
// ─────────────────────────────────────────────────────────────────────────────

// The two datasets this menu can move. Keeping them in one table rather than
// duplicating the export and import handlers means the review dialog, the
// error handling and the toast are shared: a second file to edit, not a second
// code path to maintain.
const DATASETS = {
  skus: {
    label: "SKUs",
    downloadNote: "Every SKU and every editable field",
    uploadNote: "Review the changes before anything is saved",
    file: () => `stocksense-inventory-${new Date().toISOString().slice(0, 10)}.csv`,
    export: () => api.exportSkusCsv(),
    import: (csv, apply) => api.importSkusCsv(csv, apply),
  },
  history: {
    label: "monthly history",
    downloadNote: "24 months of stock movement, one row per SKU per month",
    uploadNote: "Rows must balance and follow on from each other",
    file: () => `stocksense-history-${new Date().toISOString().slice(0, 10)}.csv`,
    export: () => api.exportHistoryCsv(24),
    import: (csv, apply) => api.importHistoryCsv(csv, apply),
  },
  // MVP2 step 1: one-off historical sales onboarding. Append-only, so its
  // preview is a different shape (what would be ADDED, not a field diff) —
  // see the dataset === "salesHistory" branch in ImportPreview below.
  salesHistory: {
    label: "sales history",
    downloadNote: "Individual sales transactions, most recent first",
    uploadNote: "New rows are added; nothing existing is changed",
    file: () => `stocksense-sales-history-${new Date().toISOString().slice(0, 10)}.csv`,
    export: () => api.exportSalesHistoryCsv(180),
    import: (csv, apply) => api.importSalesHistoryCsv(csv, apply),
  },
};

export default function BulkEdit({ onImported }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [busy, setBusy] = useState(null);       // "export" | "read" | "apply"
  const [error, setError] = useState(null);
  const [preview, setPreview] = useState(null); // server's dry-run result
  const [csv, setCsv] = useState(null);         // held so apply sends the same bytes
  const [done, setDone] = useState(null);
  // Which dataset the open file picker is for. Held in a ref, not state: it is
  // set immediately before the picker opens and read in its change handler,
  // and a state update would not have landed by then.
  const datasetRef = useRef("skus");
  const wrapRef = useRef(null);
  const fileRef = useRef(null);

  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e) => { if (wrapRef.current && !wrapRef.current.contains(e.target)) setMenuOpen(false); };
    const onKey = (e) => { if (e.key === "Escape") setMenuOpen(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, [menuOpen]);

  const doExport = useCallback(async (which) => {
    const ds = DATASETS[which];
    setMenuOpen(false); setError(null); setBusy("export");
    try {
      const text = await ds.export();
      // Built here rather than linking straight at /api/skus/export so a failed
      // export surfaces as a message in the UI instead of a browser error page.
      const url = URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = ds.file();
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  }, []);

  const onFile = useCallback(async (e) => {
    const file = e.target.files?.[0];
    // Reset immediately, or picking the SAME file twice fires no change event
    // and the second attempt silently does nothing.
    e.target.value = "";
    if (!file) return;
    setError(null); setDone(null); setBusy("read");
    try {
      const text = await file.text();
      const which = datasetRef.current;
      const result = await DATASETS[which].import(text, false);
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
      const result = await DATASETS[which].import(csv, true);
      setPreview(null);
      setCsv(null);
      setDone({ ...result, dataset: which });
      onImported?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  }, [csv, preview, onImported]);

  const blocked = preview ? preview.errors.length > 0 || preview.changed === 0 : false;

  return (
    <div ref={wrapRef} style={{ position: "relative" }}>
      <button
        onClick={() => setMenuOpen((v) => !v)}
        aria-expanded={menuOpen}
        aria-haspopup="menu"
        disabled={busy === "export" || busy === "read"}
        style={{
          display: "flex", alignItems: "center", gap: 7,
          background: "transparent", color: "var(--text-secondary)",
          padding: "9px 16px", borderRadius: "var(--radius)",
          fontWeight: 600, fontSize: "var(--text-sm)",
          border: "1px solid var(--border)", cursor: "pointer",
        }}
      >
        <Table2 size={15} />
        {busy === "export" ? "Preparing..." : busy === "read" ? "Reading..." : "Bulk edit"}
      </button>

      {menuOpen && (
        <div role="menu" style={{
          position: "absolute", top: "calc(100% + 6px)", right: 0, zIndex: 60,
          width: 268, padding: 6,
          background: "var(--card-bg)", border: "1px solid var(--border)",
          borderRadius: "var(--radius-lg)", boxShadow: "var(--shadow-md)",
        }}>
          <MenuItem icon={Download} title="Download SKUs"
            note={DATASETS.skus.downloadNote}
            onClick={() => doExport("skus")} />
          <MenuItem icon={Upload} title="Upload SKUs"
            note={DATASETS.skus.uploadNote}
            onClick={() => { setMenuOpen(false); datasetRef.current = "skus"; fileRef.current?.click(); }} />

          <div style={{ height: 1, background: "var(--border)", margin: "5px 8px" }} />

          <MenuItem icon={CalendarRange} title="Download history"
            note={DATASETS.history.downloadNote}
            onClick={() => doExport("history")} />
          <MenuItem icon={Upload} title="Upload history"
            note={DATASETS.history.uploadNote}
            onClick={() => { setMenuOpen(false); datasetRef.current = "history"; fileRef.current?.click(); }} />

          <div style={{ height: 1, background: "var(--border)", margin: "5px 8px" }} />

          <MenuItem icon={History} title="Download sales history"
            note={DATASETS.salesHistory.downloadNote}
            onClick={() => doExport("salesHistory")} />
          <MenuItem icon={Upload} title="Upload sales history"
            note={DATASETS.salesHistory.uploadNote}
            onClick={() => { setMenuOpen(false); datasetRef.current = "salesHistory"; fileRef.current?.click(); }} />
        </div>
      )}

      <input ref={fileRef} type="file" accept=".csv,text/csv" onChange={onFile} style={{ display: "none" }} />

      {error && <Toast tone="bad" message={error} onDismiss={() => setError(null)} />}
      {done && (
        <Toast tone="good" onDismiss={() => setDone(null)}
          message={done.dataset === "salesHistory"
            ? `${done.changed} sale${done.changed === 1 ? "" : "s"} added from the spreadsheet.`
            : `${done.changed} SKU${done.changed === 1 ? "" : "s"} updated from the spreadsheet.`} />
      )}

      {preview && (
        <Modal wide title="Review changes" onClose={() => { setPreview(null); setCsv(null); }}>
          <ImportPreview preview={preview} />
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 22 }}>
            <ModalBtn label="Cancel" onClick={() => { setPreview(null); setCsv(null); }} />
            <ModalBtn primary disabled={blocked || busy === "apply"}
              label={busy === "apply" ? "Applying..." : preview.dataset === "salesHistory"
                ? `Add ${preview.changed} sale${preview.changed === 1 ? "" : "s"}`
                : `Apply ${preview.changed} change${preview.changed === 1 ? "" : "s"}`}
              onClick={applyImport} />
          </div>
        </Modal>
      )}
    </div>
  );
}

function MenuItem({ icon: Icon, title, note, onClick }) {
  return (
    <button role="menuitem" onClick={onClick} style={{
      display: "flex", alignItems: "flex-start", gap: 10, width: "100%",
      padding: "10px 11px", borderRadius: "var(--radius)",
      background: "none", border: "none", cursor: "pointer", textAlign: "left",
    }}>
      <Icon size={16} style={{ color: "var(--text-muted)", flexShrink: 0, marginTop: 2 }} />
      <span style={{ minWidth: 0 }}>
        <span style={{ display: "block", fontSize: "var(--text-sm)", fontWeight: 600, color: "var(--text-primary)" }}>{title}</span>
        <span style={{ display: "block", fontSize: "var(--text-xs)", color: "var(--text-muted)", marginTop: 1 }}>{note}</span>
      </span>
    </button>
  );
}

// ImportPreview, SalesHistoryPreview, Stat, Panel and Toast all live in
// ./ImportPreview.jsx now, shared with the onboarding flow (MVP2 step 1).
