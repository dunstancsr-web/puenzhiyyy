import React, { useState, useEffect, useCallback } from "react";
import {
  AlertTriangle, XCircle, TrendingUp, TrendingDown,
  RefreshCw, X, CheckCircle, Clock, Cpu, ChevronDown,
} from "lucide-react";
import Badge from "../components/Badge";
import ColHint from "../components/ColHint";
import LoadingState from "../components/LoadingState";
import ErrorState from "../components/ErrorState";
import { useCollapsed } from "../hooks/useCollapsed";
import { api } from "../api/inventory";

// Escape-to-close + body-scroll-lock while a modal is open. Inventory.jsx's
// Modal component already does this; AiModal/ApprovalModal below didn't —
// pressing Escape closed the SKU edit/Add SKU/Restock modals but silently
// did nothing here, and the alert list behind these two could still scroll.
function useModalEscape(onClose) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [onClose]);
}

// ── Config ─────────────────────────────────────────────────────────────────────
// Colors now token-based (was hardcoded light-mode-only hex) — the direct
// cause of this page never respecting Dark/Glass (visual overhaul, 2026-09).
const TYPE_META = {
  STOCKOUT_RISK: { icon: XCircle,       color: "var(--red)",    bg: "var(--red-light)",    label: "Stockout Risk" },
  REORDER:       { icon: AlertTriangle, color: "var(--yellow)", bg: "var(--yellow-light)", label: "Reorder" },
  OVERSTOCK:     { icon: TrendingUp,    color: "var(--purple)", bg: "var(--purple-light)", label: "Overstock" },
  SLOW_MOVING:   { icon: TrendingDown,  color: "var(--yellow)", bg: "var(--yellow-light)", label: "Slow Moving" },
  IDLE:          { icon: Clock,         color: "var(--red)",    bg: "var(--red-light)",    label: "Idle Stock" },
  AGEING:        { icon: AlertTriangle, color: "var(--yellow)", bg: "var(--yellow-light)", label: "Ageing" },
};

const SEVERITY_ORDER = { critical: 0, warning: 1, info: 2 };

// ELI18: plain language, no assumed prior inventory-ops vocabulary — matches
// the Dashboard's ColHint copy style (visual-consistency pass, 2026-09).
const TYPE_HINTS = {
  STOCKOUT_RISK: {
    what: "Stock on hand won't last until the next shipment arrives, based on how fast it's currently selling.",
    how: "The number shown is days until it runs out. If that's less than the supplier's lead time, the shelf goes empty before the next delivery lands — place an order now.",
  },
  REORDER: {
    what: "Stock has dropped to the point a normal reorder should be triggered, based on typical sales between shipments.",
    how: "Not yet as urgent as Stockout Risk, but ignoring it usually turns into one. The number shown is MT currently on hand plus anything already inbound.",
  },
  OVERSTOCK: {
    what: "More stock is on hand than the maximum level set for this SKU — more than normal operations need.",
    how: "The number shown is how many MT over that maximum. Ties up cash and warehouse space; not automatically a mistake, but should be a deliberate choice.",
  },
  SLOW_MOVING: {
    what: "This SKU is selling much slower than usual, so the stock on hand will last far longer than it should.",
    how: "The number shown is days of cover — how long it'd last at the current sales pace. A high number means cash sitting on a shelf instead of turning into sales.",
  },
  IDLE: {
    what: "No sales at all for this SKU in 90+ days — it isn't moving, period.",
    how: "The number shown is days since the last sale. The longer it sits, the more likely it needs a markdown, a different sales channel, or a write-off.",
  },
  AGEING: {
    what: "Stock has been physically sitting in the warehouse a long time, approaching its shelf-life / holding-time limit.",
    how: "The number shown is days held. Rice doesn't spoil overnight, but quality and sellability drop the longer it sits past that limit.",
  },
};
const DECISION_LOG_HINT = {
  what: "A permanent record of every Approve, Modify, or Reject decision a manager has made on an AI/rule-based recommendation.",
  how: "Nothing here can be edited or deleted — it's the audit trail for \"who decided what, and why,\" not a working list. Compare Manager Decision against AI Recommended to see how often recommendations get overridden.",
};

// Ask AI is a placeholder until TASK-11 wires a real LLM call (blocked on an
// Anthropic API key). This used to look up a MOCK_AI_EXPLANATIONS dict keyed
// by numeric alert.id, hand-written against the old mock alert set — but
// alert.id now comes from the live alerts_log table, and only ever lined up
// with that hand-written content by coincidence for one alert. Every other
// click showed a different SKU's canned explanation as if it were this
// alert's. Synthesizing from the alert's own (already-correct) fields
// guarantees the text always matches what was actually clicked.
function buildFallbackExplanation(alert) {
  const qtyLine = alert.ai_recommendation_qty != null
    ? `\n\nSuggested quantity: ${alert.ai_recommendation_qty} MT.`
    : "";
  return `${alert.message}\n\nRecommended action: ${alert.recommended_action}${qtyLine}`;
}

// ── Main component ─────────────────────────────────────────────────────────────
export default function Alerts() {
  const [alerts, setAlerts] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [filter, setFilter] = useState("ALL");
  const [aiModal, setAiModal] = useState(null);       // { alert, explanation }
  const [approvalModal, setApprovalModal] = useState(null); // alert
  const [decisions, setDecisions] = useState([]);
  const [logOpen, setLogOpen] = useCollapsed("alerts-decision-log", true);

  const loadAlerts = useCallback(() => {
    setLoadError(null);
    setAlerts(null);
    Promise.all([api.getAlerts(), api.getDecisions()])
      .then(([alertsData, decisionsData]) => { setAlerts(alertsData); setDecisions(decisionsData); })
      .catch((err) => setLoadError(err.message || "Failed to load alerts"));
  }, []);

  useEffect(() => { loadAlerts(); }, [loadAlerts]);

  if (loadError) return <ErrorState message={loadError} onRetry={loadAlerts} />;
  if (!alerts) return <LoadingState label="Loading alerts…" />;

  // ── Filtering + sorting ──────────────────────────────────────────────────────
  // The API already excludes acknowledged alerts (routes/inventory.js materializes
  // against alerts_log) — no client-side "active" filter needed any more.
  const active = alerts;
  const filtered = active
    .filter((a) => filter === "ALL" || a.alert_type === filter)
    .sort((a, b) => (SEVERITY_ORDER[a.severity] ?? 3) - (SEVERITY_ORDER[b.severity] ?? 3));

  const counts = active.reduce((acc, a) => {
    acc[a.alert_type] = (acc[a.alert_type] || 0) + 1;
    return acc;
  }, {});

  // ── Actions ──────────────────────────────────────────────────────────────────
  // acknowledge/dismiss and decisions are both wired to the real backend
  // (alerts_log.status / the decisions table — TASK-10 / TASK-12). handleAskAI
  // stays local-only for now — Ask AI needs an LLM API key that isn't set up
  // yet (TASK-11); buildFallbackExplanation is the known placeholder until then.
  const acknowledge = async (id) => {
    try {
      await api.acknowledgeAlert(id);
      setAlerts((prev) => prev.filter((a) => a.id !== id));
    } catch (err) {
      console.error("Failed to acknowledge alert:", err);
    }
  };

  const handleAskAI = (alert) => {
    setAiModal({ alert, explanation: buildFallbackExplanation(alert) });
  };

  // Deliberately doesn't catch: ApprovalModal awaits this and needs the
  // rejection to show its own error + keep the modal open (and the user's
  // typed reason) rather than the decision silently vanishing. It used to
  // be swallowed here with a `finally { setApprovalModal(null) }` that
  // closed the modal unconditionally — a failed save looked identical to a
  // successful one.
  const handleDecision = async (alert, action, qty, reason) => {
    const created = await api.createDecision({
      sku_id: alert.sku_id,
      alert_type: alert.alert_type,
      ai_recommendation: alert.recommended_action,
      ai_quantity: alert.ai_recommendation_qty,
      manager_action: action,
      manager_quantity: qty,
      manager_reason: reason,
    });
    setDecisions((prev) => [created, ...prev]);
    await acknowledge(alert.id);
  };
  return (
    <div>
      {/* ── Header ── */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 20 }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 700 }}>Alerts</h1>
          <p style={{ fontSize: 14, color: "var(--text-secondary)", marginTop: 4 }}>
            {filter === "ALL" ? `${active.length} active alerts` : `${filtered.length} of ${active.length} alerts`} · sorted by severity
          </p>
        </div>
        <button
          onClick={loadAlerts}
          style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 14px", border: "1px solid var(--border)", borderRadius: "var(--radius)", background: "var(--card-bg)", fontSize: 14, color: "var(--text-secondary)", cursor: "pointer" }}
        >
          <RefreshCw size={13} /> Refresh
        </button>
      </div>

      {/* ── Summary tiles — these ARE the filter control (click to filter,
          click again to clear); a separate row of filter pills used to sit
          right below repeating the exact same counts and the exact same
          click target, which was the same "two widgets, one job" pattern
          fixed on the Dashboard (visual-consistency pass, 2026-09). ── */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 12, marginBottom: 12 }}>
        {Object.entries(TYPE_META).map(([type, meta]) => {
          const Icon = meta.icon;
          const count = counts[type] || 0;
          const isActive = filter === type;
          return (
            <button key={type} type="button" onClick={() => setFilter(isActive ? "ALL" : type)}
              aria-pressed={isActive}
              style={{
                background: isActive ? meta.bg : "var(--card-bg)",
                border: `1px solid ${isActive ? meta.color : "var(--border)"}`,
                borderRadius: "var(--radius-lg)", padding: "14px 16px",
                cursor: "pointer", transition: "all 0.15s", textAlign: "left", font: "inherit",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 8 }}>
                <Icon size={14} color={meta.color} />
                <span style={{ fontSize: 12, fontWeight: 600, color: meta.color }}>{meta.label}</span>
                <ColHint label={meta.label} what={TYPE_HINTS[type].what} how={TYPE_HINTS[type].how} />
              </div>
              <div style={{ fontSize: 26, fontWeight: 700, color: count > 0 ? meta.color : "var(--text-muted)" }}>
                {count}
              </div>
            </button>
          );
        })}
      </div>

      {filter !== "ALL" && (
        <div style={{
          display: "inline-flex", alignItems: "center", gap: 6, fontSize: 14, fontWeight: 600,
          background: "var(--blue-light)", color: "var(--blue)", padding: "4px 10px 4px 12px",
          borderRadius: 99, marginBottom: 18,
        }}>
          Filtering by {TYPE_META[filter]?.label}
          <button type="button" onClick={() => setFilter("ALL")} aria-label="Clear filter"
            style={{ background: "none", border: "none", cursor: "pointer", color: "inherit", display: "flex", padding: 2 }}>
            <X size={13} />
          </button>
        </div>
      )}

      {/* ── Alert cards ── */}
      <div style={{ display: "flex", flexDirection: "column", gap: 14, marginBottom: 32 }}>
        {filtered.length === 0 ? (
          <div style={{ background: "var(--card-bg)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", padding: 48, textAlign: "center", color: "var(--text-muted)", fontSize: 15 }}>
            {active.length === 0 ? "✓ No active alerts — all inventory levels are healthy." : "No alerts match this filter."}
          </div>
        ) : (
          filtered.map((alert, i) => (
            <AlertCard
              key={alert.id}
              alert={alert}
              onAcknowledge={acknowledge}
              onAskAI={handleAskAI}
              onApprove={setApprovalModal}
              isLast={i === filtered.length - 1}
            />
          ))
        )}
      </div>

      {/* ── Decision log — collapsible: it only grows, and isn't something
          you need open on every visit (matches the Dashboard's per-widget
          collapse pattern, persisted the same way). ── */}
      {decisions.length > 0 && (
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 5, marginBottom: logOpen ? 14 : 0 }}>
            <button type="button" onClick={() => setLogOpen((v) => !v)} aria-expanded={logOpen}
              aria-label={logOpen ? "Collapse Decision Log" : "Expand Decision Log"}
              style={{ display: "flex", alignItems: "center", gap: 6, background: "none", border: "none", cursor: "pointer", padding: 0, color: "inherit" }}>
              <ChevronDown size={15} color="var(--text-muted)" style={{ transform: logOpen ? "none" : "rotate(-90deg)", transition: "transform 0.15s" }} />
              <h2 style={{ fontSize: 18, fontWeight: 700 }}>Decision Log</h2>
            </button>
            <ColHint label="Decision Log" what={DECISION_LOG_HINT.what} how={DECISION_LOG_HINT.how} />
          </div>
          {logOpen && (
          <div style={{ background: "var(--card-bg)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", overflow: "hidden" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ background: "var(--surface-2)", borderBottom: "1px solid var(--border)" }}>
                  {["Time", "SKU", "Alert Type", "AI Recommended", "Manager Decision", "Qty Approved", "Reason"].map((h) => (
                    <th key={h} style={{ padding: "9px 14px", textAlign: "left", fontSize: 12, fontWeight: 600, color: "var(--text-secondary)", whiteSpace: "nowrap" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {decisions.map((d, i) => (
                  <tr key={d.id} style={{ borderBottom: i < decisions.length - 1 ? "1px solid var(--border)" : "none" }}>
                    <td style={{ padding: "10px 14px", fontSize: 13, color: "var(--text-muted)", whiteSpace: "nowrap" }}>
                      {new Date(d.decided_at).toLocaleTimeString("en-SG", { hour: "2-digit", minute: "2-digit" })}
                    </td>
                    <td style={{ padding: "10px 14px", fontSize: 14, fontWeight: 600 }}>{d.sku_name}</td>
                    <td style={{ padding: "10px 14px" }}>
                      {d.trigger_type && <Badge type={d.trigger_type} label={d.trigger_type.replace(/_/g, " ")} />}
                    </td>
                    <td style={{ padding: "10px 14px", fontSize: 13, color: "var(--text-secondary)", maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                      title={d.ai_quantity == null ? d.ai_recommendation : undefined}>
                      {/* Quantity-based alerts (stockout, reorder) recommend an
                          MT figure; qualitative ones (idle, ageing, slow-moving)
                          don't — this used to fall back to a bare, meaningless
                          "Review" literal instead of the actual recommendation
                          text that's already stored right alongside it. */}
                      {d.ai_quantity != null ? `${d.ai_quantity} MT` : (d.ai_recommendation || "—")}
                    </td>
                    <td style={{ padding: "10px 14px" }}>
                      <span style={{
                        fontWeight: 700, fontSize: 13,
                        color: d.manager_action === "approved" ? "var(--green)" : d.manager_action === "rejected" ? "var(--red)" : "var(--yellow)",
                      }}>
                        {d.manager_action.toUpperCase()}
                      </span>
                    </td>
                    <td style={{ padding: "10px 14px", fontSize: 14 }}>
                      {d.manager_quantity != null ? `${d.manager_quantity} MT` : "—"}
                    </td>
                    <td style={{ padding: "10px 14px", fontSize: 13, color: "var(--text-secondary)" }}>
                      {d.manager_reason || "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          )}
        </div>
      )}

      {/* ── AI explanation modal ── */}
      {aiModal && (
        <AiModal aiModal={aiModal} onClose={() => setAiModal(null)} />
      )}

      {/* ── Approval modal ── */}
      {approvalModal && (
        <ApprovalModal
          alert={approvalModal.alert || approvalModal}
          preAction={approvalModal.preAction || "approved"}
          onDecide={handleDecision}
          onClose={() => setApprovalModal(null)}
        />
      )}
    </div>
  );
}

// ── Alert card ─────────────────────────────────────────────────────────────────
function AlertCard({ alert, onAcknowledge, onAskAI, onApprove, isLast }) {
  const meta = TYPE_META[alert.alert_type] || TYPE_META.REORDER;
  const Icon = meta.icon;
  const needsApproval = alert.severity === "critical" || (alert.ai_recommendation_qty != null);

  // Hairline divider, not a bordered-and-shadowed box — matches the rest of
  // the app's post-overhaul style; the colored left stripe still carries
  // severity at a glance without needing a full card outline (visual-
  // consistency pass, 2026-09 — this was the last page still boxing rows).
  return (
    <div style={{
      borderLeft: `3px solid ${meta.color}`,
      borderBottom: isLast ? "none" : "1px solid var(--border)",
      paddingBottom: 14,
    }}>
      {/* Main row */}
      <div style={{ display: "flex", alignItems: "flex-start", gap: 14, padding: "16px 20px" }}>
        {/* Icon */}
        <div style={{ width: 38, height: 38, borderRadius: 10, background: meta.bg, border: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
          <Icon size={17} color={meta.color} />
        </div>

        {/* Content */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 6 }}>
            <span style={{ fontWeight: 700, fontSize: 15 }}>{alert.sku_name}</span>
            <span style={{ fontSize: 12, fontFamily: "monospace", color: "var(--text-muted)", background: "var(--surface-2)", padding: "1px 7px", borderRadius: 4 }}>{alert.sku_id}</span>
            <Badge type={alert.alert_type} label={meta.label} />
            <Badge type={alert.severity} />
          </div>
          <p style={{ fontSize: 14, color: "var(--text-secondary)", lineHeight: 1.55, marginBottom: 8 }}>
            {alert.message}
          </p>
          <div style={{ padding: "8px 12px", background: "var(--surface-2)", borderRadius: "var(--radius)", fontSize: 13, color: "var(--text-primary)", borderLeft: "3px solid var(--blue)" }}>
            <span style={{ fontWeight: 600, color: "var(--blue)" }}>Recommended: </span>
            {alert.recommended_action}
          </div>
        </div>

        {/* Right: value + acknowledge */}
        <div style={{ textAlign: "right", flexShrink: 0 }}>
          <div style={{ fontSize: 24, fontWeight: 700, color: meta.color }}>{alert.triggered_value}</div>
          <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 10 }}>
            {/* Matches each alert type's actual triggered_value unit — see backend/src/engines/alerts.js */}
            {alert.alert_type === "STOCKOUT_RISK" || alert.alert_type === "SLOW_MOVING" ? "days" :
             alert.alert_type === "REORDER" || alert.alert_type === "OVERSTOCK" ? "MT" :
             alert.alert_type === "IDLE" ? "days idle" : "days held"}
          </div>
          <button onClick={() => onAcknowledge(alert.id)}
            style={{ display: "flex", alignItems: "center", gap: 5, padding: "5px 11px", border: "1px solid var(--border)", borderRadius: 6, background: "var(--card-bg)", fontSize: 13, cursor: "pointer", color: "var(--text-secondary)" }}>
            <CheckCircle size={12} /> Dismiss
          </button>
        </div>
      </div>

      {/* Action bar — only for alerts needing manager decision */}
      {needsApproval && (
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "10px 20px", background: "var(--surface-2)",
          borderTop: "1px solid var(--border)",
        }}>
          <div style={{ fontSize: 13, color: "var(--text-secondary)" }}>
            <span style={{ fontWeight: 600 }}>AI Recommendation: </span>
            {alert.ai_recommendation_qty != null
              ? `Purchase ${alert.ai_recommendation_qty} MT`
              : "Initiate inventory review"}
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            {/* Ask AI button */}
            <button onClick={() => onAskAI(alert)}
              style={{
                display: "flex", alignItems: "center", gap: 6,
                padding: "6px 14px", borderRadius: "var(--radius)",
                border: "1px solid var(--border)",
                background: "var(--purple-light)", color: "var(--purple)",
                fontSize: 13, fontWeight: 600, cursor: "pointer",
              }}
            >
              <Cpu size={12} /> Ask AI
            </button>
            {/* Approval buttons — fixed: these referenced the out-of-scope
                `setApprovalModal` directly and threw ReferenceError on click;
                now correctly call the `onApprove` prop passed down from Alerts(). */}
            <button onClick={() => onApprove(alert)}
              style={{ padding: "6px 14px", borderRadius: "var(--radius)", border: "1px solid var(--border)", background: "var(--green-light)", color: "var(--green)", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
              ✓ Approve
            </button>
            <button onClick={() => onApprove({ alert, preAction: "modified" })}
              style={{ padding: "6px 14px", borderRadius: "var(--radius)", border: "1px solid var(--border)", background: "var(--yellow-light)", color: "var(--yellow)", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
              ✏ Modify
            </button>
            <button onClick={() => onApprove({ alert, preAction: "rejected" })}
              style={{ padding: "6px 14px", borderRadius: "var(--radius)", border: "1px solid var(--border)", background: "var(--red-light)", color: "var(--red)", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
              ✕ Reject
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── AI explanation modal ───────────────────────────────────────────────────────
function AiModal({ aiModal, onClose }) {
  const { alert, explanation } = aiModal;
  useModalEscape(onClose);
  return (
    <div onClick={(e) => e.target === e.currentTarget && onClose()}
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }}>
      <div style={{ background: "var(--modal-bg)", borderRadius: "var(--radius-lg)", padding: "28px 30px", width: 560, maxHeight: "85vh", overflowY: "auto", boxShadow: "var(--shadow-md)" }}>
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ width: 32, height: 32, borderRadius: 8, background: "var(--purple-light)", border: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <Cpu size={15} color="var(--purple)" />
            </div>
            <div>
              <div style={{ fontWeight: 700, fontSize: 16 }}>Explanation</div>
              <div style={{ fontSize: 12, color: "var(--text-muted)" }}>{alert.sku_name} · {alert.alert_type.replace(/_/g, " ")}</div>
            </div>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)" }}><X size={18} /></button>
        </div>

        {/* Disclaimer — was "AI-generated analysis", which overstated what
            this actually is: a rule-based summary of already-computed
            fields, not a live model call (TASK-11 needs an API key that
            isn't available yet). Corrected to say so plainly rather than
            claim a capability that doesn't exist yet. */}
        <div style={{ padding: "8px 12px", background: "var(--yellow-light)", border: "1px solid var(--border)", borderRadius: "var(--radius)", fontSize: 13, color: "var(--yellow)", marginBottom: 16 }}>
          ⚠️ Rule-based summary of the numbers already computed for this SKU — not yet a live AI call. All recommendations require manager review and approval before action is taken.
        </div>

        {/* Explanation */}
        <div style={{ fontSize: 14, color: "var(--text-primary)", lineHeight: 1.8, whiteSpace: "pre-line" }}>
          {explanation}
        </div>

        <div style={{ marginTop: 20, display: "flex", justifyContent: "flex-end" }}>
          <button onClick={onClose}
            style={{ padding: "8px 20px", borderRadius: "var(--radius)", background: "var(--blue)", color: "#fff", fontWeight: 600, fontSize: 14, border: "none", cursor: "pointer" }}>
            Understood
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Approval modal ─────────────────────────────────────────────────────────────
function ApprovalModal({ alert, preAction = "approved", onDecide, onClose }) {
  const [action, setAction] = useState(preAction);
  const [qty, setQty] = useState(alert.ai_recommendation_qty ?? "");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [submitError, setSubmitError] = useState(null);
  // Guarded like the Cancel button: don't let Escape yank the modal away
  // mid-save (same reasoning as disabling Cancel while saving).
  useModalEscape(() => { if (!saving) onClose(); });

  // The label shows a required "*" on Reason for modify/reject, but nothing
  // actually enforced it — a Reject could be recorded with an empty reason,
  // leaving no audit trail for why. Enforced here to match the label.
  const reasonRequired = action !== "approved";
  const valid = !reasonRequired || reason.trim().length > 0;

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!valid || saving) return;
    setSaving(true);
    setSubmitError(null);
    try {
      await onDecide(alert, action, qty !== "" ? Number(qty) : null, reason);
      onClose();
    } catch (err) {
      // Keep the modal open with what the user typed — it used to close
      // unconditionally here, so a failed save looked identical to a
      // successful one with no error shown at all.
      setSubmitError(err.message || "Failed to record decision");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div onClick={(e) => e.target === e.currentTarget && onClose()}
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }}>
      <div style={{ background: "var(--modal-bg)", borderRadius: "var(--radius-lg)", padding: "28px 30px", width: 480, boxShadow: "var(--shadow-md)" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
          <div style={{ fontWeight: 700, fontSize: 18 }}>Manager Decision</div>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)" }}><X size={18} /></button>
        </div>

        {/* Context */}
        <div style={{ padding: "12px 14px", background: "var(--surface-2)", borderRadius: "var(--radius)", marginBottom: 20, fontSize: 14 }}>
          <div style={{ fontWeight: 600, marginBottom: 4 }}>{alert.sku_name}</div>
          <div style={{ color: "var(--text-secondary)" }}>{alert.recommended_action}</div>
          {alert.ai_recommendation_qty != null && (
            <div style={{ marginTop: 6, color: "var(--blue)", fontWeight: 600 }}>
              AI recommendation: {alert.ai_recommendation_qty} MT
            </div>
          )}
        </div>

        <form onSubmit={handleSubmit}>
          {/* Action selector */}
          <div style={{ marginBottom: 16 }}>
            <label style={{ display: "block", fontSize: 13, fontWeight: 600, color: "var(--text-secondary)", marginBottom: 8 }}>Decision</label>
            <div style={{ display: "flex", gap: 8 }}>
              {[
                { value: "approved", label: "✓ Approve", activeColor: "var(--green)", activeBg: "var(--green-light)" },
                { value: "modified", label: "✏ Modify",  activeColor: "var(--yellow)", activeBg: "var(--yellow-light)" },
                { value: "rejected", label: "✕ Reject",  activeColor: "var(--red)", activeBg: "var(--red-light)" },
              ].map((opt) => (
                <button key={opt.value} type="button" onClick={() => setAction(opt.value)}
                  style={{
                    flex: 1, padding: "8px", borderRadius: "var(--radius)", fontSize: 14, fontWeight: 600, cursor: "pointer",
                    border: `1px solid ${action === opt.value ? opt.activeColor : "var(--border)"}`,
                    background: action === opt.value ? opt.activeBg : "var(--surface)",
                    color: action === opt.value ? opt.activeColor : "var(--text-secondary)",
                  }}>
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* Quantity (shown for approve/modify) */}
          {action !== "rejected" && alert.ai_recommendation_qty != null && (
            <div style={{ marginBottom: 16 }}>
              <label style={{ display: "block", fontSize: 13, fontWeight: 600, color: "var(--text-secondary)", marginBottom: 6 }}>
                Quantity to {action === "approved" ? "approve" : "adjust"} (MT)
              </label>
              <input type="number" min={0} step={1} value={qty} onChange={(e) => setQty(e.target.value)}
                style={{ width: "100%", padding: "9px 12px", border: "1px solid var(--border)", borderRadius: "var(--radius)", fontSize: 14 }} />
            </div>
          )}

          {/* Reason */}
          <div style={{ marginBottom: 20 }}>
            <label style={{ display: "block", fontSize: 13, fontWeight: 600, color: "var(--text-secondary)", marginBottom: 6 }}>
              Reason / Notes {action !== "approved" && <span style={{ color: "var(--red)" }}>*</span>}
            </label>
            <textarea
              value={reason} onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Customer contract confirmed, adjusted quantity accordingly…"
              rows={3}
              style={{
                width: "100%", padding: "9px 12px", borderRadius: "var(--radius)", fontSize: 14,
                resize: "vertical", fontFamily: "inherit",
                border: `1px solid ${reasonRequired && !reason.trim() ? "var(--red)" : "var(--border)"}`,
              }}
            />
            {reasonRequired && !reason.trim() && (
              <div style={{ fontSize: 12, color: "var(--red)", marginTop: 4 }}>
                A reason is required to {action === "rejected" ? "reject" : "modify"} this recommendation.
              </div>
            )}
          </div>

          {submitError && (
            <div style={{ fontSize: 13, color: "var(--red)", marginBottom: 12 }}>⚠ {submitError}</div>
          )}

          <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
            <button type="button" onClick={onClose} disabled={saving}
              style={{ padding: "8px 18px", borderRadius: "var(--radius)", border: "1px solid var(--border)", background: "var(--surface)", fontSize: 14, cursor: saving ? "not-allowed" : "pointer" }}>
              Cancel
            </button>
            <button type="submit" disabled={!valid || saving}
              style={{
                padding: "8px 22px", borderRadius: "var(--radius)", background: "var(--blue)", color: "#fff",
                fontWeight: 600, fontSize: 14, border: "none", cursor: !valid || saving ? "not-allowed" : "pointer",
                opacity: !valid || saving ? 0.6 : 1,
              }}>
              {saving ? "Recording…" : "Record Decision"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
