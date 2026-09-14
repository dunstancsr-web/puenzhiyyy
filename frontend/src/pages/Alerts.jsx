import React, { useState, useEffect, useCallback } from "react";
import { Link } from "react-router-dom";
import {
  AlertTriangle, XCircle, TrendingUp, TrendingDown,
  RefreshCw, X, CheckCircle, Clock, Cpu, History,
} from "lucide-react";
import Badge from "../components/Badge";
import ColHint from "../components/ColHint";
import LoadingState from "../components/LoadingState";
import ErrorState from "../components/ErrorState";
import { api } from "../api/inventory";
import { buildExplanation } from "../lib/explain";
import { effectiveTier, getTierChoice, getPass, clearPass } from "../lib/llmTier";

// Escape-to-close + body-scroll-lock while a modal is open. Inventory.jsx's
// Modal component already does this; AiModal/ApprovalModal below didn't -
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
// Colors now token-based (was hardcoded light-mode-only hex) - the direct
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

// Short verb phrase for the decision footer, one per alert type.
//
// The footer used to read "AI Recommendation: No order required for this alert"
// on every alert whose answer is not a purchase order, which is four of the six
// types. Sitting directly beside Approve / Modify / Reject, it told the reader
// there was nothing to decide and then asked them to decide it. Naming the
// actual action makes the buttons mean something: you are approving a
// disposition review, not approving nothing.
//
// The label is "Decision:", not "Recommended:". The card already carries a
// "Recommended:" block holding the full recommended_action sentence, and a
// second "Recommended" a few pixels below it reads as a competing
// recommendation rather than as the same one. This line names what the three
// buttons beside it will act on.
const ACTION_SUMMARY = {
  OVERSTOCK:   "Suspend purchasing",
  IDLE:        "Disposition review",
  SLOW_MOVING: "Reduce next order",
  AGEING:      "Escalate to QA and commercial",
};

// ELI18: plain language, no assumed prior inventory-ops vocabulary - matches
// the Dashboard's ColHint copy style (visual-consistency pass, 2026-09).
const TYPE_HINTS = {
  STOCKOUT_RISK: {
    what: "Stock on hand won't last until the next shipment arrives, based on how fast it's currently selling.",
    how: "The number shown is days until it runs out. If that's less than the supplier's lead time, the shelf goes empty before the next delivery lands - place an order now.",
  },
  REORDER: {
    what: "Stock has dropped to the point a normal reorder should be triggered, based on typical sales between shipments.",
    how: "Not yet as urgent as Stockout Risk, but ignoring it usually turns into one. The number shown is MT currently on hand plus anything already inbound.",
  },
  OVERSTOCK: {
    what: "More stock is on hand than the maximum level set for this SKU - more than normal operations need.",
    how: "The number shown is how many MT over that maximum. Ties up cash and warehouse space; not automatically a mistake, but should be a deliberate choice.",
  },
  SLOW_MOVING: {
    what: "This SKU is selling much slower than usual, so the stock on hand will last far longer than it should.",
    how: "The number shown is days of cover - how long it'd last at the current sales pace. A high number means cash sitting on a shelf instead of turning into sales.",
  },
  IDLE: {
    what: "No sales at all for this SKU in 90+ days - it isn't moving, period.",
    how: "The number shown is days since the last sale. The longer it sits, the more likely it needs a markdown, a different sales channel, or a write-off.",
  },
  AGEING: {
    what: "Stock has been physically sitting in the warehouse a long time, approaching its shelf-life / holding-time limit.",
    how: "The number shown is days held. Rice doesn't spoil overnight, but quality and sellability drop the longer it sits past that limit.",
  },
};
// Ask AI is a placeholder until TASK-11 wires a real LLM call (blocked on an
// Anthropic API key). This used to look up a MOCK_AI_EXPLANATIONS dict keyed
// by numeric alert.id, hand-written against the old mock alert set - but
// alert.id now comes from the live alerts_log table, and only ever lined up
// with that hand-written content by coincidence for one alert. Every other
// click showed a different SKU's canned explanation as if it were this
// alert's. Synthesizing from the alert's own (already-correct) fields
// guarantees the text always matches what was actually clicked.
// Superseded by lib/explain.js (TASK-37). The old body here concatenated
// alert.message with alert.recommended_action, which are the two lines already
// printed on the card the button sits on, so clicking Ask AI returned the card
// back to the reader. buildExplanation now assembles a four-step reasoning
// trace from the enriched SKU, and falls back to this restatement only when the
// SKU cannot be matched, saying so when it does.

// ── Main component ─────────────────────────────────────────────────────────────
export default function Alerts() {
  const [alerts, setAlerts] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [filter, setFilter] = useState("ALL");
  const [aiModal, setAiModal] = useState(null);       // { alert, explanation }
  const [approvalModal, setApprovalModal] = useState(null); // alert
  const [decisions, setDecisions] = useState([]);
  // Needed by the explanation builder: alerts carry the conclusion, the SKU
  // carries the inputs the conclusion was derived from.
  const [skus, setSkus] = useState([]);

  const loadAlerts = useCallback(() => {
    setLoadError(null);
    setAlerts(null);
    Promise.all([api.getAlerts(), api.getDecisions(), api.getSkus()])
      .then(([alertsData, decisionsData, skuData]) => {
        setAlerts(alertsData); setDecisions(decisionsData); setSkus(skuData || []);
      })
      .catch((err) => setLoadError(err.message || "Failed to load alerts"));
  }, []);

  useEffect(() => { loadAlerts(); }, [loadAlerts]);

  // Which tiers this server can offer, so a choice it cannot honour (an
  // expired pass, a local model that does not exist on a host) falls back
  // before the request rather than being refused after it.
  const [llmServer, setLlmServer] = useState(null);
  useEffect(() => { api.getLlmMode().then(setLlmServer).catch(() => setLlmServer(null)); }, []);

  if (loadError) return <ErrorState message={loadError} onRetry={loadAlerts} />;
  if (!alerts) return <LoadingState label="Loading alerts…" />;

  // ── Filtering + sorting ──────────────────────────────────────────────────────
  // The API already excludes acknowledged alerts (routes/inventory.js materializes
  // against alerts_log) - no client-side "active" filter needed any more.
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
  // (alerts_log.status / the decisions table - TASK-10 / TASK-12). handleAskAI
  // stays local-only for now - Ask AI needs an LLM API key that isn't set up
  // yet (TASK-11); buildFallbackExplanation is the known placeholder until then.
  const acknowledge = async (id) => {
    try {
      await api.acknowledgeAlert(id);
      setAlerts((prev) => prev.filter((a) => a.id !== id));
    } catch (err) {
      console.error("Failed to acknowledge alert:", err);
    }
  };

  // Opens immediately with the deterministic trace, then fills in the model
  // written summary when it arrives. Deliberately not the other way round: a
  // local model takes several seconds, and a spinner where the explanation
  // should be makes the button feel broken when the answer already exists.
  const handleAskAI = (alert) => {
    const sku = skus.find((s) => s.sku_id === alert.sku_id);
    setAiModal({ alert, ...buildExplanation(alert, sku), narrative: { loading: true } });

    // This visitor's own tier and pass (TASK-90). Read at click time rather
    // than held in state, so a PIN entered in Settings a second ago counts.
    // Until the server's tier list has loaded, the raw choice is sent and the
    // server applies its own fallback.
    const pass = getPass();
    const tier = llmServer ? effectiveTier(llmServer, getTierChoice(), pass) : getTierChoice() || undefined;

    api.explainAlert(alert.sku_id, alert.alert_type, { tier, pass: pass?.pass })
      .then((d) => {
        // The server refused the pass (expired, or the server restarted and
        // no longer recognises it). Drop it, so Settings shows the tier as
        // locked again instead of claiming an unlock that no longer works.
        if (d?.locked) clearPass();
        setAiModal((prev) =>
          prev && prev.alert.id === alert.id ? { ...prev, narrative: { loading: false, ...d } } : prev);
      })
      .catch((err) => setAiModal((prev) =>
        prev && prev.alert.id === alert.id
          ? { ...prev, narrative: { loading: false, available: false, reason: err.message } }
          : prev));
  };

  // Deliberately doesn't catch: ApprovalModal awaits this and needs the
  // rejection to show its own error + keep the modal open (and the user's
  // typed reason) rather than the decision silently vanishing. It used to
  // be swallowed here with a `finally { setApprovalModal(null) }` that
  // closed the modal unconditionally - a failed save looked identical to a
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
          <h1 style={{ fontSize: "var(--text-xl)", fontWeight: 700 }}>Alerts</h1>
          <p style={{ fontSize: "var(--text-sm)", color: "var(--text-secondary)", marginTop: 4 }}>
            {filter === "ALL"
              ? `${active.length} active alert${active.length === 1 ? "" : "s"}`
              : `${filtered.length} of ${active.length} alert${active.length === 1 ? "" : "s"}`} · sorted by severity
          </p>
        </div>
        <button
          onClick={loadAlerts}
          style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 14px", border: "1px solid var(--border)", borderRadius: "var(--radius)", background: "var(--card-bg)", fontSize: "var(--text-sm)", color: "var(--text-secondary)", cursor: "pointer" }}
        >
          <RefreshCw size={13} /> Refresh
        </button>
      </div>

      {/* ── Summary tiles - these ARE the filter control (click to filter,
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
              // A zero tile is still a useful filter target, but it should not
              // compete with the categories that actually have something in
              // them. Recede it rather than removing it, so the row stays a
              // stable, predictable set of six.
              style={{
                background: isActive ? meta.bg : "var(--card-bg)",
                border: `1px solid ${isActive ? meta.color : "var(--border)"}`,
                borderRadius: "var(--radius-lg)", padding: "14px 16px",
                cursor: "pointer", transition: "all 0.15s", textAlign: "left", font: "inherit",
                opacity: count === 0 && !isActive ? 0.55 : 1,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 8 }}>
                <Icon size={14} color={count > 0 ? meta.color : "var(--text-muted)"} />
                <span style={{ fontSize: "var(--text-xs)", fontWeight: 600, color: count > 0 ? meta.color : "var(--text-muted)" }}>{meta.label}</span>
                <ColHint label={meta.label} what={TYPE_HINTS[type].what} how={TYPE_HINTS[type].how} />
              </div>
              <div style={{ fontSize: "var(--text-xl)", fontWeight: 700, color: count > 0 ? meta.color : "var(--text-muted)" }}>
                {count}
              </div>
            </button>
          );
        })}
      </div>

      {filter !== "ALL" && (
        <div style={{
          display: "inline-flex", alignItems: "center", gap: 6, fontSize: "var(--text-sm)", fontWeight: 600,
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
          <div className="card" style={{ padding: 48, textAlign: "center", color: "var(--text-muted)", fontSize: "var(--text-sm)" }}>
            {active.length === 0 ? "✓ No active alerts - all inventory levels are healthy." : "No alerts match this filter."}
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

      {/* The Decision Log table lived here and has moved to /activity.
          It was a strict subset of what the audit trail already records
          (DECISION_RECORDED events), rendered as a second, worse view: seven
          columns of the same rows, growing forever, at the bottom of a page
          whose job is the opposite one. Alerts is a work queue, things leave it
          when handled. Activity is the permanent record, nothing ever leaves.
          Keeping both meant the page that should shrink as you work also grew
          as you worked. */}
      {decisions.length > 0 && (
        <div style={{ marginTop: 4, marginBottom: 24 }}>
          <Link to="/activity" style={{
            display: "inline-flex", alignItems: "center", gap: 7,
            fontSize: "var(--text-xs)", fontWeight: 600, color: "var(--text-secondary)",
            textDecoration: "none", padding: "8px 14px",
            border: "1px solid var(--border)", borderRadius: "var(--radius)",
            background: "var(--card-bg)",
          }}>
            <History size={13} />
            {decisions.length} decision{decisions.length === 1 ? "" : "s"} recorded
            <span style={{ color: "var(--text-muted)", fontWeight: 500 }}>View in Activity</span>
          </Link>
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
// Severity colours the stripe. Type colours the icon and the chip. The card used
// to carry FOUR encodings of roughly the same two facts: a type-coloured stripe,
// a type-coloured icon, a type chip AND a severity chip, on top of a tile row
// above that already groups by type. Severity moved to the stripe so one chip
// could go.
const SEVERITY_STRIPE = { critical: "var(--red)", warning: "var(--yellow)", info: "var(--blue)" };

// Unit for each alert type's triggered_value - see backend/src/engines/alerts.js
const VALUE_UNIT = {
  STOCKOUT_RISK: "days cover", SLOW_MOVING: "days cover",
  REORDER: "MT", OVERSTOCK: "MT",
  IDLE: "days idle", AGEING: "days held",
};

function ActionButton({ onClick, children, variant = "quiet", title }) {
  // One primary, everything else quiet. The row used to be four buttons in four
  // different colours (purple, green, amber, red), which is a rainbow rather
  // than a hierarchy: nothing led, so the eye had to read all four every time.
  const styles = {
    primary: { background: "var(--blue)", color: "#fff", border: "1px solid var(--blue)" },
    quiet:   { background: "var(--card-bg)", color: "var(--text-secondary)", border: "1px solid var(--border)" },
    danger:  { background: "var(--card-bg)", color: "var(--red)", border: "1px solid var(--border)" },
  }[variant];
  return (
    <button onClick={onClick} title={title}
      style={{
        display: "inline-flex", alignItems: "center", gap: 6,
        padding: "6px 13px", borderRadius: "var(--radius)",
        fontSize: "var(--text-xs)", fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap",
        ...styles,
      }}>
      {children}
    </button>
  );
}

function AlertCard({ alert, onAcknowledge, onAskAI, onApprove }) {
  const meta = TYPE_META[alert.alert_type] || TYPE_META.REORDER;
  const Icon = meta.icon;

  // Every alert is now decidable. `needsApproval` previously gated the action
  // row on critical severity or a non-null quantity, so four of the seven live
  // alerts offered no decision at all, only Dismiss. Those four still carry a
  // real recommended action ("Reduce or pause the next order", "Escalate to QA")
  // that a manager should be able to approve or reject, and the write-up claims
  // every recommendation terminates at a human decision. It did not.
  const decision = alert.ai_recommendation_qty > 0
    ? `Order ${alert.ai_recommendation_qty} MT`
    : (ACTION_SUMMARY[alert.alert_type] || "Review this SKU");

  // Each alert is its own white surface. The list previously sat directly on the
  // page's grey background with only hairline dividers, so body text was reading
  // against grey, and the rows already had a 14px gap from the parent AND a
  // bottom border, which is two separators doing one job. A discrete card per
  // alert is also the right unit here: each one is a single decision, and
  // dismissing it removes exactly one surface.
  //
  // `overflow: hidden` matters. The severity stripe is a 3px left border, and
  // without it the stripe squares off the card's rounded top and bottom corners.
  return (
    <div className="card" style={{
      padding: 0,
      overflow: "hidden",
      borderLeft: `3px solid ${SEVERITY_STRIPE[alert.severity] || "var(--border)"}`,
    }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 14, padding: "16px 20px" }}>
        <div style={{
          width: 34, height: 34, borderRadius: 9, background: meta.bg,
          display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, marginTop: 1,
        }}>
          <Icon size={16} color={meta.color} />
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span style={{ fontWeight: 700, fontSize: "var(--text-sm)" }}>{alert.sku_name}</span>
            <span style={{ fontSize: "var(--text-xs)", fontFamily: "monospace", color: "var(--text-muted)" }}>{alert.sku_id}</span>
            <Badge type={alert.alert_type} label={meta.label} />
          </div>

          <p style={{ fontSize: "var(--text-sm)", color: "var(--text-secondary)", lineHeight: 1.55, margin: "6px 0 0" }}>
            {alert.message}
          </p>

          {/* Unboxed. This was a bordered, tinted panel with its own coloured
              left bar, sitting inside a card that already has a border and a
              coloured left stripe: a box inside a box inside a box. The label
              alone separates it perfectly well. */}
          <p style={{ fontSize: "var(--text-sm)", color: "var(--text-primary)", lineHeight: 1.55, margin: "6px 0 0" }}>
            <span style={{ fontWeight: 600 }}>Recommended: </span>
            {alert.recommended_action}
          </p>

          {/* One action row, always present, Dismiss included. Dismiss used to
              float in the middle of the card beside the metric while the other
              four sat in a footer bar that only some cards had, so actions were
              split across two places and the set changed card to card. */}
          {/* The primary button states what approving will record, so the
              separate "Approving records: ..." line underneath could go. A
              button that says "Approve 597 MT" needs no caption.

              Dismiss stays in the same cluster rather than being pushed to the
              far edge by a flex spacer, which on a wide screen stranded it
              about a thousand pixels from its siblings. A plain separator
              carries "different kind of action" without the distance. */}
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginTop: 12 }}>
            <ActionButton variant="primary" onClick={() => onApprove(alert)}
              title={`Record approval: ${decision}`}>
              {alert.ai_recommendation_qty > 0 ? `Approve ${alert.ai_recommendation_qty} MT` : "Approve"}
            </ActionButton>
            <ActionButton onClick={() => onApprove({ alert, preAction: "modified" })}>Modify</ActionButton>
            <ActionButton variant="danger" onClick={() => onApprove({ alert, preAction: "rejected" })}>Reject</ActionButton>
            <ActionButton onClick={() => onAskAI(alert)} title="Show the reasoning behind this alert">
              <Cpu size={12} /> Why?
            </ActionButton>
            <span aria-hidden style={{ width: 1, height: 18, background: "var(--border)", margin: "0 3px" }} />
            <ActionButton onClick={() => onAcknowledge(alert.id)} title="Dismiss without recording a decision">
              <CheckCircle size={12} /> Dismiss
            </ActionButton>
          </div>
        </div>

        {/* The metric, quieter than before. At 24px bold in the type colour it
            competed with the product name for first read; the name is what a
            manager scans for. */}
        <div style={{ textAlign: "right", flexShrink: 0, minWidth: 74 }}>
          <div style={{ fontSize: "var(--text-lg)", fontWeight: 700, color: "var(--text-primary)", lineHeight: 1.1 }}>
            {alert.triggered_value}
          </div>
          <div style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)", marginTop: 2 }}>
            {VALUE_UNIT[alert.alert_type] || "days"}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── AI explanation modal ───────────────────────────────────────────────────────
function AiModal({ aiModal, onClose }) {
  const { alert, sections, degraded, narrative } = aiModal;
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
              <div style={{ fontWeight: 700, fontSize: "var(--text-base)" }}>Why this was flagged</div>
              <div style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)" }}>{alert.sku_name} · {alert.alert_type.replace(/_/g, " ")}</div>
            </div>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)" }}><X size={18} /></button>
        </div>

        {/* Disclaimer - was "AI-generated analysis", which overstated what
            this actually is: a rule-based summary of already-computed
            fields, not a live model call (TASK-11 needs an API key that
            isn't available yet). Corrected to say so plainly rather than
            claim a capability that doesn't exist yet. */}
        <div style={{ padding: "8px 12px", background: "var(--yellow-light)", border: "1px solid var(--border)", borderRadius: "var(--radius)", fontSize: "var(--text-xs)", color: "var(--yellow)", marginBottom: 18 }}>
          {degraded
            ? "\u26A0\uFE0F This SKU's current figures could not be loaded, so only the alert's own text is shown. Reopen after a refresh for the full reasoning."
            : narrative?.available
              ? "\u26A0\uFE0F The summary is written by a model from the figures below, which the engines computed. The model is told never to calculate anything itself, so every number is checkable against the Inventory page. All recommendations require manager approval before action is taken."
              : "\u26A0\uFE0F Traced from this SKU's computed figures by the rules in design.md. Every number below can be checked against the Inventory page. All recommendations require manager approval before action is taken."}
        </div>

        {/* Model written summary, above the trace it was built from. Shown
            only when a model actually answered: if none is configured or
            reachable, the deterministic steps below are the whole explanation
            and nothing announces an absence the reader did not ask about. */}
        {narrative?.loading && (
          <div style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)", marginBottom: 16 }}>
            Asking the model for a plain English summary...
          </div>
        )}
        {/* The one absence that IS announced. The rule above holds for a
            model that is simply not there, but a visitor who chose the paid
            tier asked for a summary, and silence would read as a broken
            button. Says what to do, not what went wrong. */}
        {narrative && !narrative.loading && narrative.locked && (
          <div style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)", marginBottom: 16 }}>
            Paid summaries are locked. Enter the demo PIN in Settings to unlock them; the steps below need no PIN.
          </div>
        )}
        {narrative && !narrative.loading && narrative.available && (
          <div style={{
            marginBottom: 18, padding: "13px 15px",
            background: "var(--purple-light)", borderRadius: "var(--radius)",
          }}>
            <div style={{
              display: "flex", alignItems: "center", gap: 6, marginBottom: 7,
              fontSize: "var(--text-xs)", fontWeight: 700, letterSpacing: "0.05em",
              textTransform: "uppercase", color: "var(--purple)",
            }}>
              <Cpu size={12} /> Summary
              <span style={{ fontWeight: 500, textTransform: "none", letterSpacing: 0, color: "var(--text-muted)" }}>
                {narrative.model}
                {/* Worth naming. In slot mode the model writes prose with named
                    placeholders and cannot emit a digit at all, so the figures
                    are inserted by the engine rather than typed by the model.
                    That is a stronger claim than "we checked it afterwards". */}
                {narrative.mode === "slots" ? " · figures inserted by the engine" : ""}
                {narrative.cached ? " · reused" : ""}
              </span>
            </div>
            <div style={{ fontSize: "var(--text-sm)", lineHeight: 1.6, color: "var(--text-primary)", whiteSpace: "pre-line" }}>
              {narrative.explanation}
            </div>
          </div>
        )}

        {/* The four steps, each labelled. A numbered rail is used here because
            these genuinely ARE a sequence: measurement, derivation,
            consequence, response. Numbering something that is not ordered is
            decoration, but this is the reasoning chain in order. */}
        <ol style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 16 }}>
          {sections.map((s, i) => (
            <li key={s.heading} style={{ display: "flex", gap: 12 }}>
              <span
                aria-hidden
                style={{
                  flexShrink: 0, width: 22, height: 22, borderRadius: "50%",
                  background: "var(--surface-2)", border: "1px solid var(--border)",
                  color: "var(--text-muted)", fontSize: "var(--text-xs)", fontWeight: 700,
                  display: "flex", alignItems: "center", justifyContent: "center", marginTop: 1,
                }}
              >
                {i + 1}
              </span>
              <div style={{ minWidth: 0 }}>
                <div style={{
                  fontSize: "var(--text-xs)", fontWeight: 700, letterSpacing: "0.05em",
                  textTransform: "uppercase", color: "var(--text-muted)", marginBottom: 3,
                }}>
                  {s.heading}
                </div>
                <div style={{ fontSize: "var(--text-sm)", color: "var(--text-primary)", lineHeight: 1.65 }}>
                  {s.body}
                </div>
              </div>
            </li>
          ))}
        </ol>

        <div style={{ marginTop: 20, display: "flex", justifyContent: "flex-end" }}>
          <button onClick={onClose}
            style={{ padding: "8px 20px", borderRadius: "var(--radius)", background: "var(--blue)", color: "#fff", fontWeight: 600, fontSize: "var(--text-sm)", border: "none", cursor: "pointer" }}>
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
  // actually enforced it - a Reject could be recorded with an empty reason,
  // leaving no audit trail for why. Enforced here to match the label.
  const reasonRequired = action !== "approved";
  const valid = !reasonRequired || reason.trim().length > 0;
  // Only surface the error once the user has actually engaged with the field
  // or tried to submit. Opening a fresh modal already showing a red box and
  // "a reason is required" scolds someone who has not done anything wrong yet.
  const [reasonTouched, setReasonTouched] = useState(false);
  const showReasonError = reasonRequired && !reason.trim() && reasonTouched;

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!valid || saving) { setReasonTouched(true); return; }
    setSaving(true);
    setSubmitError(null);
    try {
      await onDecide(alert, action, qty !== "" ? Number(qty) : null, reason);
      onClose();
    } catch (err) {
      // Keep the modal open with what the user typed - it used to close
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
          <div style={{ fontWeight: 700, fontSize: "var(--text-lg)" }}>Manager Decision</div>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)" }}><X size={18} /></button>
        </div>

        {/* Context */}
        <div style={{ padding: "12px 14px", background: "var(--surface-2)", borderRadius: "var(--radius)", marginBottom: 20, fontSize: "var(--text-sm)" }}>
          <div style={{ fontWeight: 600, marginBottom: 4 }}>{alert.sku_name}</div>
          <div style={{ color: "var(--text-secondary)" }}>{alert.recommended_action}</div>
          {alert.ai_recommendation_qty > 0 && (
            <div style={{ marginTop: 6, color: "var(--blue)", fontWeight: 600 }}>
              Suggested order quantity: {alert.ai_recommendation_qty} MT
            </div>
          )}
        </div>

        <form onSubmit={handleSubmit}>
          {/* Action selector */}
          <div style={{ marginBottom: 16 }}>
            <label style={{ display: "block", fontSize: "var(--text-xs)", fontWeight: 600, color: "var(--text-secondary)", marginBottom: 8 }}>Decision</label>
            <div style={{ display: "flex", gap: 8 }}>
              {[
                { value: "approved", label: "✓ Approve", activeColor: "var(--green)", activeBg: "var(--green-light)" },
                { value: "modified", label: "✏ Modify",  activeColor: "var(--yellow)", activeBg: "var(--yellow-light)" },
                { value: "rejected", label: "✕ Reject",  activeColor: "var(--red)", activeBg: "var(--red-light)" },
              ].map((opt) => (
                <button key={opt.value} type="button" onClick={() => setAction(opt.value)}
                  style={{
                    flex: 1, padding: "8px", borderRadius: "var(--radius)", fontSize: "var(--text-sm)", fontWeight: 600, cursor: "pointer",
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
              <label style={{ display: "block", fontSize: "var(--text-xs)", fontWeight: 600, color: "var(--text-secondary)", marginBottom: 6 }}>
                Quantity to {action === "approved" ? "approve" : "adjust"} (MT)
              </label>
              <input type="number" min={0} step={1} value={qty} onChange={(e) => setQty(e.target.value)}
                style={{ width: "100%", padding: "9px 12px", border: "1px solid var(--border)", borderRadius: "var(--radius)", fontSize: "var(--text-sm)" }} />
            </div>
          )}

          {/* Reason */}
          <div style={{ marginBottom: 20 }}>
            <label style={{ display: "block", fontSize: "var(--text-xs)", fontWeight: 600, color: "var(--text-secondary)", marginBottom: 6 }}>
              Reason / Notes {action !== "approved" && <span style={{ color: "var(--red)" }}>*</span>}
            </label>
            <textarea
              value={reason} onChange={(e) => setReason(e.target.value)}
              onBlur={() => setReasonTouched(true)}
              placeholder="e.g. Customer contract confirmed, adjusted quantity accordingly…"
              rows={3}
              style={{
                width: "100%", padding: "9px 12px", borderRadius: "var(--radius)", fontSize: "var(--text-sm)",
                resize: "vertical", fontFamily: "inherit",
                border: `1px solid ${showReasonError ? "var(--red)" : "var(--border)"}`,
              }}
            />
            {showReasonError && (
              <div style={{ fontSize: "var(--text-xs)", color: "var(--red)", marginTop: 4 }}>
                A reason is required to {action === "rejected" ? "reject" : "modify"} this recommendation.
              </div>
            )}
          </div>

          {submitError && (
            <div style={{ fontSize: "var(--text-xs)", color: "var(--red)", marginBottom: 12 }}>⚠ {submitError}</div>
          )}

          <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
            <button type="button" onClick={onClose} disabled={saving}
              style={{ padding: "8px 18px", borderRadius: "var(--radius)", border: "1px solid var(--border)", background: "var(--surface)", fontSize: "var(--text-sm)", cursor: saving ? "not-allowed" : "pointer" }}>
              Cancel
            </button>
            <button type="submit" disabled={!valid || saving}
              style={{
                padding: "8px 22px", borderRadius: "var(--radius)", background: "var(--blue)", color: "#fff",
                fontWeight: 600, fontSize: "var(--text-sm)", border: "none", cursor: !valid || saving ? "not-allowed" : "pointer",
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
