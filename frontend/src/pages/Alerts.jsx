import React, { useState, useEffect, useCallback } from "react";
import {
  AlertTriangle, XCircle, TrendingUp, TrendingDown,
  RefreshCw, X, CheckCircle, Clock, Cpu,
} from "lucide-react";
import Badge from "../components/Badge";
import LoadingState from "../components/LoadingState";
import ErrorState from "../components/ErrorState";
import { api } from "../api/inventory";

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

const MOCK_AI_EXPLANATIONS = {
  1: `Thai Jasmine 25KG requires immediate procurement action.\n\nCurrent available stock stands at 160 MT against a reorder point of 302 MT. At the current 30-day consumption rate of 6.2 MT/day, stock will be fully depleted in approximately 26 days.\n\nThe supplier's average lead time is 45 days. This means that even if a purchase order is placed today, new inventory will not be available before the current stock runs out — creating a projected 19-day supply gap.\n\nDemand is currently accelerating (30-day rate exceeds 90-day average by 5.6%), which increases the risk further.\n\nRecommended action: Place a replenishment order of at minimum 300 MT immediately. Consider requesting expedited handling from Supplier ABC Thailand given the urgency.`,
  2: `Thai White Rice 25KG is approaching its reorder point.\n\nAvailable stock is 260 MT, which is 10 MT above the reorder point of 250 MT. At current consumption of 4.6 MT/day, the reorder point will be breached within approximately 7 days.\n\nSupplier lead time is 45 days, so action is required now to avoid a potential shortage situation developing.\n\nDemand trend is stable, which gives reasonable confidence in the forecast.\n\nRecommended action: Initiate a standard replenishment order of 250 MT within the next 7 days.`,
  3: `Vietnam Fragrant 10KG is significantly overstocked.\n\nCurrent physical stock of 620 MT exceeds the maximum recommended level of 400 MT by 220 MT. A further confirmed inbound shipment of 200 MT will push total inventory to approximately 820 MT — more than double the recommended maximum.\n\nAt the current consumption rate of 3.17 MT/day, this represents over 6 months of stock. Excess holding is locking up working capital and increasing storage and ageing risk.\n\nRecommended action: Cancel or defer the inbound shipment if contractually possible. Suspend all new purchasing for this SKU. Consider a targeted sales promotion to accelerate consumption.`,
  4: `Basmati Premium 5KG is slow-moving with excessive stock coverage.\n\nWith 175 MT available and average daily consumption of only 0.6 MT, current stock represents approximately 292 days of supply — nearly 10 months.\n\nDemand has been decelerating: the 30-day consumption rate is below the 90-day average, suggesting the slowdown may continue.\n\nRecommended action: Reduce or pause future ordering. Review the customer base for this SKU and consider a targeted promotion or price adjustment to stimulate demand.`,
  5: `Japonica Short Grain 5KG has been completely idle for 104 days.\n\nWith 78 MT on hand valued at approximately SGD $249,600 and no sales recorded in the past 104 days, this inventory represents a significant working capital risk.\n\nThe inventory is also ageing — held for 189 days against a maximum holding guideline of 270 days. At zero current demand, the stock will reach the ageing threshold before being consumed.\n\nRecommended action: Stop all replenishment immediately. Convene a commercial and QA review. Evaluate in order: (1) targeted discount to existing customers, (2) alternative commercial channels such as wholesalers or food-service operators, (3) CSR donation if stock remains safe and unsellable. Do not allow stock to age past the quality threshold.`,
  6: `Japonica Short Grain 5KG inventory is ageing and at risk of exceeding holding limits.\n\nThe batch has been held for 189 days. At zero current demand, the entire 78 MT will reach the 270-day maximum holding guideline in approximately 81 days — without any consumption.\n\nQuality risk increases with age. If the stock is not moved commercially, it may need to be downgraded or disposed of.\n\nRecommended action: Escalate to QA for a quality inspection. Simultaneously activate a commercial disposal strategy — discount, alternative channel, or CSR donation — before the stock reaches critical age.`,
};

// ── Main component ─────────────────────────────────────────────────────────────
export default function Alerts() {
  const [alerts, setAlerts] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [filter, setFilter] = useState("ALL");
  const [aiModal, setAiModal] = useState(null);       // { alert, explanation }
  const [approvalModal, setApprovalModal] = useState(null); // alert
  const [decisions, setDecisions] = useState([]);

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

  const tabs = [
    { key: "ALL", label: "All", count: active.length },
    ...Object.entries(TYPE_META).map(([k, v]) => ({ key: k, label: v.label, count: counts[k] || 0 })),
  ];

  // ── Actions ──────────────────────────────────────────────────────────────────
  // acknowledge/dismiss and decisions are both wired to the real backend
  // (alerts_log.status / the decisions table — TASK-10 / TASK-12). handleAskAI
  // stays local-only for now — Ask AI needs an LLM API key that isn't set up
  // yet (TASK-11); MOCK_AI_EXPLANATIONS is the known placeholder until then.
  const acknowledge = async (id) => {
    try {
      await api.acknowledgeAlert(id);
      setAlerts((prev) => prev.filter((a) => a.id !== id));
    } catch (err) {
      console.error("Failed to acknowledge alert:", err);
    }
  };

  const handleAskAI = (alert) => {
    const explanation = MOCK_AI_EXPLANATIONS[alert.id] || "AI explanation not available for this alert.";
    setAiModal({ alert, explanation });
  };

  const handleDecision = async (alert, action, qty, reason) => {
    try {
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
    } catch (err) {
      console.error("Failed to record decision:", err);
    } finally {
      setApprovalModal(null);
    }
  };
  return (
    <div>
      {/* ── Header ── */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 20 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700 }}>Alerts</h1>
          <p style={{ fontSize: 13, color: "var(--text-secondary)", marginTop: 4 }}>
            {active.length} active alerts · sorted by severity
          </p>
        </div>
        <button
          onClick={loadAlerts}
          style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 14px", border: "1px solid var(--border)", borderRadius: "var(--radius)", background: "var(--card-bg)", fontSize: 13, color: "var(--text-secondary)", cursor: "pointer" }}
        >
          <RefreshCw size={13} /> Refresh
        </button>
      </div>

      {/* ── Summary cards ── */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 12, marginBottom: 20 }}>
        {Object.entries(TYPE_META).map(([type, meta]) => {
          const Icon = meta.icon;
          const count = counts[type] || 0;
          return (
            <div key={type} onClick={() => setFilter(filter === type ? "ALL" : type)}
              style={{
                background: filter === type ? meta.bg : "var(--card-bg)",
                border: `1px solid ${filter === type ? meta.color : "var(--border)"}`,
                borderRadius: "var(--radius-lg)", padding: "14px 16px",
                cursor: "pointer", transition: "all 0.15s",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 8 }}>
                <Icon size={14} color={meta.color} />
                <span style={{ fontSize: 11, fontWeight: 600, color: meta.color }}>{meta.label}</span>
              </div>
              <div style={{ fontSize: 26, fontWeight: 700, color: count > 0 ? meta.color : "var(--text-muted)" }}>
                {count}
              </div>
            </div>
          );
        })}
      </div>

      {/* ── Filter tabs ── */}
      <div style={{ display: "flex", gap: 6, marginBottom: 18, flexWrap: "wrap" }}>
        {tabs.map((t) => (
          <button key={t.key} onClick={() => setFilter(t.key)}
            style={{
              display: "flex", alignItems: "center", gap: 6,
              padding: "6px 14px", borderRadius: 99,
              border: `1px solid ${filter === t.key ? "var(--blue)" : "var(--border)"}`,
              background: filter === t.key ? "var(--blue-light)" : "var(--card-bg)",
              color: filter === t.key ? "var(--blue)" : "var(--text-secondary)",
              fontSize: 13, fontWeight: 500, cursor: "pointer",
            }}
          >
            {t.label}
            <span style={{
              background: filter === t.key ? "var(--blue)" : "var(--border)",
              color: filter === t.key ? "#fff" : "var(--text-secondary)",
              borderRadius: 99, padding: "0 7px", fontSize: 11, fontWeight: 700,
            }}>
              {t.count}
            </span>
          </button>
        ))}
      </div>

      {/* ── Alert cards ── */}
      <div style={{ display: "flex", flexDirection: "column", gap: 12, marginBottom: 32 }}>
        {filtered.length === 0 ? (
          <div style={{ background: "var(--card-bg)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", padding: 48, textAlign: "center", color: "var(--text-muted)", fontSize: 14 }}>
            {active.length === 0 ? "✓ No active alerts — all inventory levels are healthy." : "No alerts match this filter."}
          </div>
        ) : (
          filtered.map((alert) => (
            <AlertCard
              key={alert.id}
              alert={alert}
              onAcknowledge={acknowledge}
              onAskAI={handleAskAI}
              onApprove={setApprovalModal}
            />
          ))
        )}
      </div>

      {/* ── Decision log ── */}
      {decisions.length > 0 && (
        <div>
          <h2 style={{ fontSize: 16, fontWeight: 700, marginBottom: 14 }}>Decision Log</h2>
          <div style={{ background: "var(--card-bg)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", overflow: "hidden" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ background: "var(--surface-2)", borderBottom: "1px solid var(--border)" }}>
                  {["Time", "SKU", "Alert Type", "AI Recommended", "Manager Decision", "Qty Approved", "Reason"].map((h) => (
                    <th key={h} style={{ padding: "9px 14px", textAlign: "left", fontSize: 11, fontWeight: 600, color: "var(--text-secondary)", whiteSpace: "nowrap" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {decisions.map((d, i) => (
                  <tr key={d.id} style={{ borderBottom: i < decisions.length - 1 ? "1px solid var(--border)" : "none" }}>
                    <td style={{ padding: "10px 14px", fontSize: 12, color: "var(--text-muted)", whiteSpace: "nowrap" }}>
                      {new Date(d.decided_at).toLocaleTimeString("en-SG", { hour: "2-digit", minute: "2-digit" })}
                    </td>
                    <td style={{ padding: "10px 14px", fontSize: 13, fontWeight: 600 }}>{d.sku_name}</td>
                    <td style={{ padding: "10px 14px" }}>
                      {d.trigger_type && <Badge type={d.trigger_type} label={d.trigger_type.replace(/_/g, " ")} />}
                    </td>
                    <td style={{ padding: "10px 14px", fontSize: 12, color: "var(--text-secondary)" }}>
                      {d.ai_quantity != null ? `${d.ai_quantity} MT` : "Review"}
                    </td>
                    <td style={{ padding: "10px 14px" }}>
                      <span style={{
                        fontWeight: 700, fontSize: 12,
                        color: d.manager_action === "approved" ? "var(--green)" : d.manager_action === "rejected" ? "var(--red)" : "var(--yellow)",
                      }}>
                        {d.manager_action.toUpperCase()}
                      </span>
                    </td>
                    <td style={{ padding: "10px 14px", fontSize: 13 }}>
                      {d.manager_quantity != null ? `${d.manager_quantity} MT` : "—"}
                    </td>
                    <td style={{ padding: "10px 14px", fontSize: 12, color: "var(--text-secondary)" }}>
                      {d.manager_reason || "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
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
function AlertCard({ alert, onAcknowledge, onAskAI, onApprove }) {
  const meta = TYPE_META[alert.alert_type] || TYPE_META.REORDER;
  const Icon = meta.icon;
  const needsApproval = alert.severity === "critical" || (alert.ai_recommendation_qty != null);

  return (
    <div style={{
      background: "var(--card-bg)", borderRadius: "var(--radius-lg)",
      border: "1px solid var(--border)",
      borderLeft: `4px solid ${meta.color}`,
      boxShadow: "var(--shadow)",
      overflow: "hidden",
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
            <span style={{ fontWeight: 700, fontSize: 14 }}>{alert.sku_name}</span>
            <span style={{ fontSize: 11, fontFamily: "monospace", color: "var(--text-muted)", background: "var(--surface-2)", padding: "1px 7px", borderRadius: 4 }}>{alert.sku_id}</span>
            <Badge type={alert.alert_type} label={meta.label} />
            <Badge type={alert.severity} />
          </div>
          <p style={{ fontSize: 13, color: "var(--text-secondary)", lineHeight: 1.55, marginBottom: 8 }}>
            {alert.message}
          </p>
          <div style={{ padding: "8px 12px", background: "var(--surface-2)", borderRadius: "var(--radius)", fontSize: 12, color: "var(--text-primary)", borderLeft: "3px solid var(--blue)" }}>
            <span style={{ fontWeight: 600, color: "var(--blue)" }}>Recommended: </span>
            {alert.recommended_action}
          </div>
        </div>

        {/* Right: value + acknowledge */}
        <div style={{ textAlign: "right", flexShrink: 0 }}>
          <div style={{ fontSize: 22, fontWeight: 700, color: meta.color }}>{alert.triggered_value}</div>
          <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 10 }}>
            {/* Matches each alert type's actual triggered_value unit — see backend/src/engines/alerts.js */}
            {alert.alert_type === "STOCKOUT_RISK" || alert.alert_type === "SLOW_MOVING" ? "days" :
             alert.alert_type === "REORDER" || alert.alert_type === "OVERSTOCK" ? "MT" :
             alert.alert_type === "IDLE" ? "days idle" : "days held"}
          </div>
          <button onClick={() => onAcknowledge(alert.id)}
            style={{ display: "flex", alignItems: "center", gap: 5, padding: "5px 11px", border: "1px solid var(--border)", borderRadius: 6, background: "var(--card-bg)", fontSize: 12, cursor: "pointer", color: "var(--text-secondary)" }}>
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
          <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>
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
                fontSize: 12, fontWeight: 600, cursor: "pointer",
              }}
            >
              <Cpu size={12} /> Ask AI
            </button>
            {/* Approval buttons — fixed: these referenced the out-of-scope
                `setApprovalModal` directly and threw ReferenceError on click;
                now correctly call the `onApprove` prop passed down from Alerts(). */}
            <button onClick={() => onApprove(alert)}
              style={{ padding: "6px 14px", borderRadius: "var(--radius)", border: "1px solid var(--border)", background: "var(--green-light)", color: "var(--green)", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
              ✓ Approve
            </button>
            <button onClick={() => onApprove({ alert, preAction: "modified" })}
              style={{ padding: "6px 14px", borderRadius: "var(--radius)", border: "1px solid var(--border)", background: "var(--yellow-light)", color: "var(--yellow)", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
              ✏ Modify
            </button>
            <button onClick={() => onApprove({ alert, preAction: "rejected" })}
              style={{ padding: "6px 14px", borderRadius: "var(--radius)", border: "1px solid var(--border)", background: "var(--red-light)", color: "var(--red)", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
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
              <div style={{ fontWeight: 700, fontSize: 15 }}>AI Explanation</div>
              <div style={{ fontSize: 11, color: "var(--text-muted)" }}>{alert.sku_name} · {alert.alert_type.replace(/_/g, " ")}</div>
            </div>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)" }}><X size={18} /></button>
        </div>

        {/* Disclaimer */}
        <div style={{ padding: "8px 12px", background: "var(--yellow-light)", border: "1px solid var(--border)", borderRadius: "var(--radius)", fontSize: 12, color: "var(--yellow)", marginBottom: 16 }}>
          ⚠️ AI-generated analysis · All recommendations require manager review and approval before action is taken.
        </div>

        {/* Explanation */}
        <div style={{ fontSize: 13, color: "var(--text-primary)", lineHeight: 1.8, whiteSpace: "pre-line" }}>
          {explanation}
        </div>

        <div style={{ marginTop: 20, display: "flex", justifyContent: "flex-end" }}>
          <button onClick={onClose}
            style={{ padding: "8px 20px", borderRadius: "var(--radius)", background: "var(--blue)", color: "#fff", fontWeight: 600, fontSize: 13, border: "none", cursor: "pointer" }}>
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

  const handleSubmit = (e) => {
    e.preventDefault();
    onDecide(alert, action, qty !== "" ? Number(qty) : null, reason);
  };

  return (
    <div onClick={(e) => e.target === e.currentTarget && onClose()}
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }}>
      <div style={{ background: "var(--modal-bg)", borderRadius: "var(--radius-lg)", padding: "28px 30px", width: 480, boxShadow: "var(--shadow-md)" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
          <div style={{ fontWeight: 700, fontSize: 16 }}>Manager Decision</div>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)" }}><X size={18} /></button>
        </div>

        {/* Context */}
        <div style={{ padding: "12px 14px", background: "var(--surface-2)", borderRadius: "var(--radius)", marginBottom: 20, fontSize: 13 }}>
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
            <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "var(--text-secondary)", marginBottom: 8 }}>Decision</label>
            <div style={{ display: "flex", gap: 8 }}>
              {[
                { value: "approved", label: "✓ Approve", activeColor: "var(--green)", activeBg: "var(--green-light)" },
                { value: "modified", label: "✏ Modify",  activeColor: "var(--yellow)", activeBg: "var(--yellow-light)" },
                { value: "rejected", label: "✕ Reject",  activeColor: "var(--red)", activeBg: "var(--red-light)" },
              ].map((opt) => (
                <button key={opt.value} type="button" onClick={() => setAction(opt.value)}
                  style={{
                    flex: 1, padding: "8px", borderRadius: "var(--radius)", fontSize: 13, fontWeight: 600, cursor: "pointer",
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
              <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "var(--text-secondary)", marginBottom: 6 }}>
                Quantity to {action === "approved" ? "approve" : "adjust"} (MT)
              </label>
              <input type="number" min={0} step={1} value={qty} onChange={(e) => setQty(e.target.value)}
                style={{ width: "100%", padding: "9px 12px", border: "1px solid var(--border)", borderRadius: "var(--radius)", fontSize: 13 }} />
            </div>
          )}

          {/* Reason */}
          <div style={{ marginBottom: 20 }}>
            <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "var(--text-secondary)", marginBottom: 6 }}>
              Reason / Notes {action !== "approved" && <span style={{ color: "var(--red)" }}>*</span>}
            </label>
            <textarea
              value={reason} onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Customer contract confirmed, adjusted quantity accordingly…"
              rows={3}
              style={{ width: "100%", padding: "9px 12px", border: "1px solid var(--border)", borderRadius: "var(--radius)", fontSize: 13, resize: "vertical", fontFamily: "inherit" }}
            />
          </div>

          <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
            <button type="button" onClick={onClose}
              style={{ padding: "8px 18px", borderRadius: "var(--radius)", border: "1px solid var(--border)", background: "var(--surface)", fontSize: 13, cursor: "pointer" }}>
              Cancel
            </button>
            <button type="submit"
              style={{ padding: "8px 22px", borderRadius: "var(--radius)", background: "var(--blue)", color: "#fff", fontWeight: 600, fontSize: 13, border: "none", cursor: "pointer" }}>
              Record Decision
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
