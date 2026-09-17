import React, { useState } from "react";
import { ChevronRight, Info } from "lucide-react";
import { Stat, Panel } from "./ImportPreview";
import HoverHint from "./HoverHint";

// Progressive disclosure, not a full paragraph up front: the short claim
// reads on hover, the IEEE citation stays collapsed behind a native
// <details> toggle until someone actually wants to fact-check it. [1]'s
// actual finding is a caveat, not an endorsement — it shows fixed per-tier
// service levels (the practice below) leave real savings on the table
// versus full cost-based optimization, cited for that honesty, not because
// it proves 98/95/90 is the right split.
const ServiceLevelHint = () => (
  <div style={{ fontSize: "var(--text-xs)", lineHeight: 1.5 }}>
    <p style={{ margin: "0 0 6px" }}>
      A widely used starting point in FMCG practice (roughly A 97&ndash;99%, B 93&ndash;96%, C 88&ndash;92%), not a
      cost-optimal calculation<sup>[1]</sup>.
    </p>
    <details>
      <summary style={{ cursor: "pointer", color: "var(--blue)", fontWeight: 600, listStyle: "none" }}>
        Show source
      </summary>
      <p style={{ margin: "6px 0 0", color: "var(--text-muted)" }}>
        Peer-reviewed research shows fixed per-tier service levels leave real savings on the table versus full
        cost-based optimization, which is out of scope here.
      </p>
      <p style={{ margin: "6px 0 0", color: "var(--text-muted)" }}>
        [1] R. H. Teunter, M. Z. Babai, and A. A. Syntetos, &ldquo;ABC classification: Service levels and inventory
        costs,&rdquo; <i>Production and Operations Management</i>, vol. 19, no. 3, pp. 343&ndash;352, 2010, doi:{" "}
        <a href="https://doi.org/10.1111/j.1937-5956.2009.01098.x" target="_blank" rel="noopener noreferrer"
          style={{ color: "var(--blue)", textDecoration: "underline" }}>
          10.1111/j.1937-5956.2009.01098.x
        </a>.
      </p>
    </details>
  </div>
);

// ─────────────────────────────────────────────────────────────────────────────
// Onboarding step 3 (MVP2 Day 8): "Review suggested settings". A genuinely
// different shape from ImportPreview's field-by-field diff — these are policy
// SUGGESTIONS with a confidence signal, not changes already read from a file,
// so it gets its own component rather than being forced into that one.
//
// Per-SKU granularity only (include/exclude a whole SKU), not per-field
// override — keeps this a real, shippable review step instead of a second
// full SKU edit form. A manager who wants to change one suggested number can
// still do it afterward on that SKU's own page.
// ─────────────────────────────────────────────────────────────────────────────

const CONFIDENCE_LABEL = {
  measured: { text: "measured", color: "var(--green)", bg: "var(--green-light)" },
  "tier-default": { text: "tier default", color: "var(--blue)", bg: "var(--blue-light)" },
  low: { text: "low confidence", color: "var(--yellow)", bg: "var(--yellow-light)" },
};

function ConfidenceBadge({ level }) {
  const c = CONFIDENCE_LABEL[level] || CONFIDENCE_LABEL.low;
  return (
    <span style={{
      fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em",
      color: c.color, background: c.bg, borderRadius: 99, padding: "2px 7px", whiteSpace: "nowrap",
    }}>
      {c.text}
    </span>
  );
}

function SuggestionLine({ label, field, unit, hint }) {
  const changed = field.suggested !== field.current;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", fontSize: "var(--text-xs)", marginTop: 4 }}>
      <span style={{ color: "var(--text-muted)", minWidth: 108, display: "inline-flex", alignItems: "center", gap: 4 }}>
        {label}
        {hint && (
          <HoverHint content={hint} title="Where this default comes from">
            <Info size={11} style={{ cursor: "help", verticalAlign: "middle" }} />
          </HoverHint>
        )}
      </span>
      {changed ? (
        <>
          <span style={{ textDecoration: "line-through", opacity: 0.6, color: "var(--text-secondary)" }}>
            {field.current}{unit}
          </span>
          <ChevronRight size={11} style={{ color: "var(--text-muted)" }} />
          <b style={{ color: "var(--blue)" }}>{field.suggested}{unit}</b>
        </>
      ) : (
        <span style={{ color: "var(--text-secondary)" }}>{field.current}{unit} (already at the suggestion)</span>
      )}
      <ConfidenceBadge level={field.confidence} />
      <span style={{ color: "var(--text-muted)", flexBasis: "100%", marginTop: 1 }}>{field.reason}</span>
    </div>
  );
}

export function SuggestedSettingsReview({ suggestions, included, onToggle }) {
  const changedCount = suggestions.filter(
    (s) => s.target_service_level.suggested !== s.target_service_level.current || s.target_stock.suggested !== s.target_stock.current
  ).length;

  return (
    <div>
      <div style={{ display: "flex", gap: 10, marginBottom: 18, flexWrap: "wrap" }}>
        <Stat n={suggestions.length} label="products reviewed" tone="muted" />
        <Stat n={changedCount} label="have a suggestion" tone={changedCount ? "blue" : "muted"} />
        <Stat n={included.size} label="selected to apply" tone={included.size ? "blue" : "muted"} />
      </div>

      <Panel tone="muted" icon={Info} title="Every value here stays editable afterward"
        body="Target service level comes from each product's ABC tier, target stock from its demand and lead time, both computed the same way the rest of the app does. Lead time itself isn't suggested yet — there's no receiving history to measure it from, so it's shown honestly at its current default." />

      <div style={{ border: "1px solid var(--border)", borderRadius: "var(--radius)", overflow: "hidden" }}>
        {suggestions.map((s) => (
          <label key={s.sku_id} style={{
            display: "flex", gap: 12, padding: "12px 14px", borderBottom: "1px solid var(--border)",
            cursor: "pointer", alignItems: "flex-start",
          }}>
            <input type="checkbox" checked={included.has(s.sku_id)} onChange={() => onToggle(s.sku_id)}
              style={{ marginTop: 3, width: 16, height: 16, flexShrink: 0 }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: "var(--text-sm)", fontWeight: 700 }}>
                {s.name}
                <span style={{ color: "var(--text-muted)", fontWeight: 500 }}> · {s.sku_id} · {s.abc_class}-tier</span>
              </div>
              <SuggestionLine label="Target service level" hint={<ServiceLevelHint />} field={{
                current: Math.round(s.target_service_level.current * 100), suggested: Math.round(s.target_service_level.suggested * 100), confidence: s.target_service_level.confidence, reason: s.target_service_level.reason,
              }} unit="%" />
              <SuggestionLine label="Target stock" field={s.target_stock} unit=" MT" />
              <SuggestionLine label="Lead time" field={s.lead_time_days} unit=" days" />
            </div>
          </label>
        ))}
      </div>
    </div>
  );
}
