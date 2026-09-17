import React, { useEffect } from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, Check, ChevronRight } from "lucide-react";

// ─────────────────────────────────────────────────────────────────────────────
// CSV import review, shared by BulkEdit (TASK-60) and the onboarding flow
// (MVP2 step 1). Extracted so the two places that let a CSV update the
// database show the exact same review step rather than two versions of the
// same UI drifting apart.
//
// ImportPreview renders a field-by-field diff (SKUs, monthly history); it is
// the wrong shape for an append-only import, which has no "before" value, so
// SalesHistoryPreview exists as a genuinely different view: what would be
// ADDED, not what would CHANGE.
// ─────────────────────────────────────────────────────────────────────────────

export function ImportPreview({ preview }) {
  if (preview.dataset === "salesHistory") return <SalesHistoryPreview preview={preview} />;

  const { fileName, rows, changed, unchanged, errors, warnings, ignoredColumns } = preview;
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

      {warnings?.length > 0 && (
        <Panel tone="warn" icon={AlertTriangle} title="Worth checking, but not blocking"
          body="These rows can be saved. The newest month no longer matches the stock recorded as being on hand today, which is expected if you are correcting the months first and the position afterwards.">
          <ul style={{ margin: "10px 0 0", paddingLeft: 18, fontSize: "var(--text-sm)", lineHeight: 1.6 }}>
            {warnings.slice(0, 8).map((w, i) => <li key={i}>{w}</li>)}
          </ul>
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
                {/* History rows are identified by SKU AND period, so the period
                    has to appear or two edited months look like one row edited
                    twice. */}
                {c.period && <span style={{ color: "var(--text-muted)", fontWeight: 500 }}> · {c.period}</span>}
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

// Sales history's preview is a different SHAPE from every other dataset here:
// what would be ADDED, not a field-by-field diff, since an append-only import
// has no "before" value to show. Reusing ImportPreview's changes-table for
// this would mean showing every new row as N empty-to-value diffs, which is
// noise, not review.
export function SalesHistoryPreview({ preview }) {
  const { fileName, rows, changed, errors, unknownSkus, dateRange, skuBreakdown, ignoredColumns } = preview;
  const halt = errors.length > 0;

  return (
    <div>
      <div style={{ fontSize: "var(--text-sm)", color: "var(--text-secondary)", marginBottom: 16 }}>
        <b style={{ color: "var(--text-primary)" }}>{fileName}</b> · {rows} row{rows === 1 ? "" : "s"} read
      </div>

      <div style={{ display: "flex", gap: 10, marginBottom: 18, flexWrap: "wrap" }}>
        <Stat n={changed} label="new sales" tone={changed ? "blue" : "muted"} />
        <Stat n={errors.length} label={errors.length === 1 ? "problem" : "problems"} tone={halt ? "bad" : "muted"} />
      </div>

      {halt && (
        <Panel tone="bad" icon={AlertTriangle}
          title={`Nothing will be added until ${errors.length === 1 ? "this is" : "these are"} fixed`}
          body="An import is all or nothing on purpose: adding the good rows and skipping the rest would leave no record of which sales made it in.">
          <ul style={{ margin: "10px 0 0", paddingLeft: 18, fontSize: "var(--text-sm)", lineHeight: 1.6 }}>
            {errors.slice(0, 12).map((e, i) => <li key={i}>{e.message}</li>)}
          </ul>
          {errors.length > 12 && (
            <div style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)", marginTop: 8 }}>
              and {errors.length - 12} more
            </div>
          )}
          {unknownSkus?.length > 0 && (
            <div style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)", marginTop: 8 }}>
              Unknown SKU{unknownSkus.length === 1 ? "" : "s"}: {unknownSkus.join(", ")}. Add the product first, or fix the code in the file.
            </div>
          )}
        </Panel>
      )}

      {!halt && changed === 0 && (
        <Panel tone="muted" icon={Check} title="Nothing to add"
          body="This file has no rows this import can read." />
      )}

      {changed > 0 && (
        <>
          {dateRange && (
            <div style={{ fontSize: "var(--text-sm)", color: "var(--text-secondary)", marginBottom: 12 }}>
              Date range: <b style={{ color: "var(--text-primary)" }}>{dateRange.from}</b> to{" "}
              <b style={{ color: "var(--text-primary)" }}>{dateRange.to}</b>
            </div>
          )}
          <div style={{ border: "1px solid var(--border)", borderRadius: "var(--radius)", overflow: "hidden" }}>
            {skuBreakdown.map((s) => (
              <div key={s.sku_id} style={{
                display: "flex", justifyContent: "space-between", alignItems: "center",
                padding: "11px 13px", borderBottom: "1px solid var(--border)", fontSize: "var(--text-sm)",
              }}>
                <span>
                  {s.name}
                  <span style={{ color: "var(--text-muted)", fontWeight: 500 }}> · {s.sku_id}</span>
                </span>
                <span style={{ color: "var(--text-secondary)" }}>
                  {s.count} row{s.count === 1 ? "" : "s"} · {s.qty_total} MT
                </span>
              </div>
            ))}
          </div>
        </>
      )}

      {ignoredColumns?.length > 0 && (
        <div style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)", marginTop: 12, lineHeight: 1.5 }}>
          Ignored, not a recognised column: {ignoredColumns.join(", ")}.
        </div>
      )}
    </div>
  );
}

export function Stat({ n, label, tone }) {
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

export function Panel({ tone, icon: Icon, title, body, children }) {
  const color = tone === "bad" ? "var(--red)" : tone === "warn" ? "var(--yellow)" : "var(--text-muted)";
  const edge = tone === "bad" ? "var(--red)" : tone === "warn" ? "var(--yellow)" : "var(--border)";
  const fill = tone === "bad" ? "var(--red-light)" : tone === "warn" ? "var(--yellow-light)" : "var(--surface-2)";
  return (
    <div style={{
      padding: "13px 15px", borderRadius: "var(--radius)", marginBottom: 16,
      border: `1px solid ${edge}`,
      background: fill,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 700, fontSize: "var(--text-sm)", color }}>
        <Icon size={15} /> {title}
      </div>
      {body && <div style={{ fontSize: "var(--text-xs)", color: "var(--text-secondary)", marginTop: 6, lineHeight: 1.55 }}>{body}</div>}
      {children}
    </div>
  );
}

// Portaled to the body so it is not clipped by an ancestor's own stacking
// context, and so it reads as page-level feedback rather than a footnote to
// the control that triggered it.
export function Toast({ tone, message, onDismiss }) {
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
