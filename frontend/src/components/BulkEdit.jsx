import React, { useState, useRef, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { Table2, Download, Upload, AlertTriangle, Check, ChevronRight } from "lucide-react";
import Modal, { ModalBtn } from "./Modal";
import { api } from "../api/inventory";

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

export default function BulkEdit({ onImported }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [busy, setBusy] = useState(null);       // "export" | "read" | "apply"
  const [error, setError] = useState(null);
  const [preview, setPreview] = useState(null); // server's dry-run result
  const [csv, setCsv] = useState(null);         // held so apply sends the same bytes
  const [done, setDone] = useState(null);
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

  const doExport = useCallback(async () => {
    setMenuOpen(false); setError(null); setBusy("export");
    try {
      const text = await api.exportSkusCsv();
      // Built here rather than linking straight at /api/skus/export so a failed
      // export surfaces as a message in the UI instead of a browser error page.
      const url = URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = `stocksense-inventory-${new Date().toISOString().slice(0, 10)}.csv`;
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
      const result = await api.importSkusCsv(text, false);
      setCsv(text);
      setPreview({ ...result, fileName: file.name });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  }, []);

  const applyImport = useCallback(async () => {
    setBusy("apply"); setError(null);
    try {
      const result = await api.importSkusCsv(csv, true);
      setPreview(null);
      setCsv(null);
      setDone(result);
      onImported?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  }, [csv, onImported]);

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
          <MenuItem icon={Download} title="Download CSV"
            note="Every SKU and every editable field"
            onClick={doExport} />
          <MenuItem icon={Upload} title="Upload CSV"
            note="Review the changes before anything is saved"
            onClick={() => { setMenuOpen(false); fileRef.current?.click(); }} />
        </div>
      )}

      <input ref={fileRef} type="file" accept=".csv,text/csv" onChange={onFile} style={{ display: "none" }} />

      {error && <Toast tone="bad" message={error} onDismiss={() => setError(null)} />}
      {done && (
        <Toast tone="good" onDismiss={() => setDone(null)}
          message={`${done.changed} SKU${done.changed === 1 ? "" : "s"} updated from the spreadsheet.`} />
      )}

      {preview && (
        <Modal wide title="Review changes" onClose={() => { setPreview(null); setCsv(null); }}>
          <ImportPreview preview={preview} />
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 22 }}>
            <ModalBtn label="Cancel" onClick={() => { setPreview(null); setCsv(null); }} />
            <ModalBtn primary disabled={blocked || busy === "apply"}
              label={busy === "apply" ? "Applying..." : `Apply ${preview.changed} change${preview.changed === 1 ? "" : "s"}`}
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

// The review step. Errors first and in full, because they are the reason to
// stop; changes second, grouped by SKU so the unit of review is "this product"
// rather than "this cell".
function ImportPreview({ preview }) {
  const { fileName, rows, changed, unchanged, errors, ignoredColumns } = preview;
  const halt = errors.length > 0;

  return (
    <div>
      <div style={{ fontSize: "var(--text-sm)", color: "var(--text-secondary)", marginBottom: 16 }}>
        <b style={{ color: "var(--text-primary)" }}>{fileName}</b> · {rows} row{rows === 1 ? "" : "s"} read
      </div>

      <div style={{ display: "flex", gap: 10, marginBottom: 18, flexWrap: "wrap" }}>
        <Stat n={changed} label="to change" tone={changed ? "blue" : "muted"} />
        <Stat n={unchanged} label="unchanged" tone="muted" />
        <Stat n={errors.length} label={errors.length === 1 ? "problem" : "problems"} tone={halt ? "bad" : "muted"} />
      </div>

      {halt && (
        <Panel tone="bad" icon={AlertTriangle}
          title={`Nothing will be saved until ${errors.length === 1 ? "this is" : "these are"} fixed`}
          body="An import is all or nothing on purpose. Applying the good rows and skipping the rest would leave the spreadsheet and the database disagreeing, with no record of which rows made it.">
          <ul style={{ margin: "10px 0 0", paddingLeft: 18, fontSize: "var(--text-sm)", lineHeight: 1.6 }}>
            {errors.slice(0, 12).map((e, i) => <li key={i}>{e.message}</li>)}
          </ul>
          {errors.length > 12 && (
            <div style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)", marginTop: 8 }}>
              and {errors.length - 12} more
            </div>
          )}
        </Panel>
      )}

      {!halt && changed === 0 && (
        <Panel tone="muted" icon={Check} title="Nothing to apply"
          body="Every row in this file matches what is already stored, so there is no change to make." />
      )}

      {changed > 0 && (
        <div style={{ border: "1px solid var(--border)", borderRadius: "var(--radius)", overflow: "hidden" }}>
          {preview.changes.map((c) => (
            <div key={c.sku_id} style={{ padding: "11px 13px", borderBottom: "1px solid var(--border)" }}>
              <div style={{ fontSize: "var(--text-sm)", fontWeight: 700, marginBottom: 6 }}>
                {c.name}
                <span style={{ color: "var(--text-muted)", fontWeight: 500 }}> · {c.sku_id}</span>
              </div>
              {Object.entries(c.fields).map(([field, d]) => (
                <div key={field} style={{
                  display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap",
                  fontSize: "var(--text-xs)", color: "var(--text-secondary)", marginTop: 3,
                }}>
                  <code style={{ fontFamily: "ui-monospace, Menlo, monospace", color: "var(--text-muted)" }}>{field}</code>
                  <span style={{ textDecoration: "line-through", opacity: 0.7 }}>{String(d.from) || "empty"}</span>
                  <ChevronRight size={12} style={{ color: "var(--text-muted)" }} />
                  <b style={{ color: "var(--blue)" }}>{String(d.to)}</b>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}

      {ignoredColumns?.length > 0 && (
        <div style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)", marginTop: 12, lineHeight: 1.5 }}>
          Ignored, because these are calculated rather than stored:{" "}
          {ignoredColumns.join(", ")}.
        </div>
      )}
    </div>
  );
}

function Stat({ n, label, tone }) {
  const color = tone === "bad" ? "var(--red)" : tone === "blue" ? "var(--blue)" : "var(--text-muted)";
  return (
    <div style={{
      flex: "1 1 110px", padding: "10px 12px", borderRadius: "var(--radius)",
      border: "1px solid var(--border)", background: "var(--surface-2)",
    }}>
      <div style={{ fontSize: "var(--text-lg)", fontWeight: 700, color, lineHeight: 1.1 }}>{n}</div>
      <div style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)", marginTop: 2 }}>{label}</div>
    </div>
  );
}

function Panel({ tone, icon: Icon, title, body, children }) {
  const color = tone === "bad" ? "var(--red)" : "var(--text-muted)";
  return (
    <div style={{
      padding: "13px 15px", borderRadius: "var(--radius)", marginBottom: 16,
      border: `1px solid ${tone === "bad" ? "var(--red)" : "var(--border)"}`,
      background: tone === "bad" ? "var(--red-light)" : "var(--surface-2)",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 700, fontSize: "var(--text-sm)", color }}>
        <Icon size={15} /> {title}
      </div>
      {body && <div style={{ fontSize: "var(--text-xs)", color: "var(--text-secondary)", marginTop: 6, lineHeight: 1.55 }}>{body}</div>}
      {children}
    </div>
  );
}

// Portaled to the body so it is not clipped by the header's own stacking
// context, and so it reads as page-level feedback rather than a footnote to
// the button that triggered it.
function Toast({ tone, message, onDismiss }) {
  useEffect(() => {
    const t = setTimeout(onDismiss, tone === "bad" ? 9000 : 5000);
    return () => clearTimeout(t);
  }, [onDismiss, tone]);

  return createPortal(
    <div role="status" onClick={onDismiss} style={{
      position: "fixed", bottom: 22, left: "50%", transform: "translateX(-50%)",
      zIndex: 1200, cursor: "pointer", maxWidth: "92vw",
      display: "flex", alignItems: "center", gap: 9,
      padding: "12px 18px", borderRadius: 99,
      background: "var(--card-bg)", border: `1px solid ${tone === "bad" ? "var(--red)" : "var(--green)"}`,
      boxShadow: "var(--shadow-md)",
      fontSize: "var(--text-sm)", fontWeight: 600,
      color: tone === "bad" ? "var(--red)" : "var(--text-primary)",
    }}>
      {tone === "bad" ? <AlertTriangle size={15} /> : <Check size={15} style={{ color: "var(--green)" }} />}
      {message}
    </div>,
    document.body
  );
}
