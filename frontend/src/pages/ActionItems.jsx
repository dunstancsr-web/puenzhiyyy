import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Flame, EyeOff, Cpu } from "lucide-react";
import LoadingState from "../components/LoadingState";
import ErrorState from "../components/ErrorState";
import ColHint from "../components/ColHint";
import Modal from "../components/Modal";
import MarketSignals from "../components/MarketSignals";
import { api } from "../api/inventory";
import { effectiveTier, getTierChoice, getPass, clearPass } from "../lib/llmTier";

// ─────────────────────────────────────────────────────────────────────────────
// ACTION ITEMS (19 Sep) - additive, not a replacement. Alerts and Activity are
// untouched: Alerts stays the one place a policy value gets approved, Activity
// stays the record to consult. This page answers a narrower question, from a
// user interview run as an SME inventory-manager role-play: "once I've
// uploaded my data, what's urgent, right now, today" - a short, sorted list,
// not a portfolio dump.
//
// Two groups only, by design (Stan's call, 19 Sep - not the four-bucket
// version first proposed):
//   1. NEAREST STOCKOUT - real fulfilment risk, sorted by how soon, reusing
//      the projection engine (Step 12 of the domain spec) exactly as Alerts
//      and ForecastDetail already do. covered_by_po (Step 12's "supply
//      eligibility") downgrades urgency without hiding the row - an incoming
//      order already covers it, so it's visible, just not screaming.
//   2. BLIND SPOTS - not a risk at all, an honesty check: SKUs where a
//      figure above genuinely can't be trusted yet, either because there's
//      no sales history (resolves with time) or an onboarded field was left
//      at its schema default (a real setup gap - same distinction the Table
//      page's classify() already draws, reused here rather than re-invented).
//
// Everything below is rule-based template text with real numbers dropped in
// - the same technique alerts.js and Table's classify() already use, not a
// model call. No LLM anywhere on this page.
//
// Overstock, slow-moving, idle and the policy-change-suggested alert are
// deliberately NOT on this page yet - they're a real, computed, third kind
// of thing (working-capital risk, not time-boxed fulfilment risk), and
// forcing them into one of the two groups above would misrepresent what
// each group means. They stay visible on Alerts. See the devlog for the
// open question this leaves.
// ─────────────────────────────────────────────────────────────────────────────

const AT_RISK_HEALTH = ["RED", "ORANGE"];

// Priority order within "Blind Spots": the FIRST branch that applies wins,
// so a SKU missing both sales history and target stock is filed under the
// more fundamental gap (no demand signal at all) rather than the narrower
// one. Same decision-tree shape as alerts.js's own message functions.
function blindSpotReason(sku) {
  if (!sku.avg_daily_usage_30d) {
    return {
      whatsMissing: "No sales history yet",
      why: "Can't project a stockout date without a demand rate to project forward.",
      fix: "Nothing to do. This resolves itself once the product has sold a few times.",
      fixLink: null,
    };
  }
  if (!sku.target_stock) {
    return {
      whatsMissing: "Target stock was never set (0)",
      why: "Suggested order quantity is target stock minus projected position, so with no target it can't mean anything.",
      fix: "Set it on Table",
      fixLink: "/audit",
    };
  }
  if (!sku.reorder_point_policy) {
    return {
      whatsMissing: "Reorder point was never set (0)",
      why: "Figures that compare against the approved reorder point (like recovery date) aren't meaningful yet.",
      fix: "Set it on Table",
      fixLink: "/audit",
    };
  }
  return null;
}

function fmtDate(iso) {
  if (!iso) return null;
  const days = Math.round((new Date(iso).getTime() - Date.now()) / 86_400_000);
  return { iso, days: Math.max(0, days) };
}

export default function ActionItems() {
  const [skus, setSkus] = useState(null);
  const [projectionBySkuId, setProjectionBySkuId] = useState({});
  const [error, setError] = useState(null);

  // "Why?" (19 Sep) - same tier/pass machinery Alerts already uses, so a
  // demo PIN unlocked in Settings works here too rather than needing its own
  // separate unlock. aiModal holds the row it's explaining and the answer as
  // it arrives; opens immediately with loading:true rather than waiting on
  // the request, since a local model takes a few seconds and a blank modal
  // reads as broken.
  const [llmServer, setLlmServer] = useState(null);
  useEffect(() => { api.getLlmMode().then(setLlmServer).catch(() => setLlmServer(null)); }, []);
  const [aiModal, setAiModal] = useState(null);

  const askAI = (kind, sku, label) => {
    setAiModal({ kind, sku, label, loading: true });
    const pass = getPass();
    const tier = llmServer ? effectiveTier(llmServer, getTierChoice(), pass) : getTierChoice() || undefined;
    api.explainActionItem(sku.sku_id, kind, { tier, pass: pass?.pass })
      .then((d) => {
        if (d?.locked) clearPass();
        setAiModal((prev) => (prev && prev.sku.sku_id === sku.sku_id && prev.kind === kind ? { ...prev, loading: false, ...d } : prev));
      })
      .catch((err) => setAiModal((prev) =>
        prev && prev.sku.sku_id === sku.sku_id && prev.kind === kind
          ? { ...prev, loading: false, available: false, reason: err.message }
          : prev));
  };

  // Open-ended follow-up (19 Sep) - separate from askAI above: that one
  // explains a specific row this page already knows about, this one can be
  // about anything ("why is BM-5KG different from JP-5KG"), so it uses the
  // tool-calling endpoint instead of the fixed-slot one. Kept as its own
  // small box rather than folded into the modal, since it's a different
  // starting point (a blank question, not a row's Why? button).
  const [question, setQuestion] = useState("");
  const [askState, setAskState] = useState(null); // { loading, available, answer, reason }
  const askDatabase = () => {
    if (!question.trim()) return;
    setAskState({ loading: true });
    const pass = getPass();
    const tier = llmServer ? effectiveTier(llmServer, getTierChoice(), pass) : getTierChoice() || undefined;
    api.askDatabase(question.trim(), { tier, pass: pass?.pass })
      .then((d) => {
        if (d?.locked) clearPass();
        setAskState({ loading: false, ...d });
      })
      .catch((err) => setAskState({ loading: false, available: false, reason: err.message }));
  };

  const load = () => {
    setError(null);
    setSkus(null);
    api.getSkus()
      .then(async (list) => {
        setSkus(list);
        // Only the at-risk-looking SKUs need a projection call - the other
        // group (Blind Spots) is decided entirely from fields GET /skus
        // already returned, no extra request needed for it.
        const atRisk = list.filter((s) => AT_RISK_HEALTH.includes(s.health_status));
        const projections = await Promise.all(
          atRisk.map((s) => api.getSkuProjection(s.sku_id).catch(() => null))
        );
        const byId = {};
        atRisk.forEach((s, i) => { byId[s.sku_id] = projections[i]; });
        setProjectionBySkuId(byId);
      })
      .catch((err) => setError(err.message || "Failed to load"));
  };
  useEffect(load, []);

  if (error) return <ErrorState message={error} onRetry={load} />;
  if (!skus) return <LoadingState label="Checking every SKU for what's urgent…" />;

  const stockoutRows = skus
    .map((s) => {
      const proj = projectionBySkuId[s.sku_id];
      if (!proj) return null;
      const stockout = fmtDate(proj.first_stockout_date);
      const breach = fmtDate(proj.first_safety_breach_date);
      const nearest = stockout || breach;
      if (!nearest) return null;
      return { sku: s, proj, nearest, isStockout: !!stockout };
    })
    .filter(Boolean)
    .sort((a, b) => a.nearest.days - b.nearest.days);

  const blindSpotRows = skus
    .map((s) => {
      const reason = blindSpotReason(s);
      return reason ? { sku: s, reason } : null;
    })
    .filter(Boolean);

  return (
    <div>
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: "var(--text-xl)", fontWeight: 700 }}>Action Items</h1>
        <p style={{ fontSize: "var(--text-sm)", color: "var(--text-secondary)", marginTop: 4, maxWidth: "72ch" }}>
          What needs a decision from you, soonest first. Overstock and policy gaps still live on{" "}
          <Link to="/alerts" style={{ color: "var(--blue-text)", fontWeight: 600 }}>Alerts</Link> for now. This page is
          fulfilment risk, and how much you can trust the numbers below it.
        </p>
      </div>

      <div className="card" style={{ padding: "16px 20px", marginBottom: 20 }}>
        <div style={{ fontSize: "var(--text-sm)", fontWeight: 700, marginBottom: 8, display: "flex", alignItems: "center", gap: 6 }}>
          <Cpu size={15} /> Ask about your data
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <input
            type="text" value={question} onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") askDatabase(); }}
            placeholder="e.g. why is BM-5KG different from JP-5KG?"
            style={{
              flex: 1, fontSize: "var(--text-sm)", padding: "8px 12px",
              border: "1px solid var(--border)", borderRadius: "var(--radius)", background: "var(--surface)",
            }}
          />
          <button type="button" onClick={askDatabase} disabled={askState?.loading} style={{
            fontSize: "var(--text-sm)", fontWeight: 700, color: "#fff", background: "var(--blue-strong)",
            border: "none", borderRadius: "var(--radius)", padding: "8px 16px", cursor: "pointer",
          }}>
            {askState?.loading ? "Thinking…" : "Ask"}
          </button>
        </div>
        {/* Not limited to the two rows above on purpose - this can ask about
            any SKU, using the read-only tools in backend/src/llm/tools.js. */}
        {askState && !askState.loading && (
          <div style={{ marginTop: 12, paddingTop: 12, borderTop: "1px solid var(--border)" }}>
            {askState.available ? (
              <div style={{ fontSize: "var(--text-base)", lineHeight: 1.7, whiteSpace: "pre-line" }}>{askState.answer}</div>
            ) : (
              <div style={{ fontSize: "var(--text-sm)", color: "var(--text-muted)" }}>
                Couldn't get an answer{askState.reason ? `: ${askState.reason}` : "."}
              </div>
            )}
          </div>
        )}
      </div>

      <Section
        icon={Flame}
        iconColor="var(--red)"
        title="Nearest stockout"
        count={stockoutRows.length}
        empty="Nothing projected to run out or breach safety stock right now."
      >
        {stockoutRows.length > 0 && (
          <Table columns={["Product", "Health", "Stockout in", "Covered?", "Action", ""]}>
            {stockoutRows.map(({ sku: s, proj, nearest, isStockout }) => (
              <tr key={s.sku_id} style={{ borderBottom: "1px solid var(--border)" }}>
                <Td>
                  <div style={{ fontWeight: 600 }}>{s.product_name}</div>
                  <div style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)" }}>{s.sku_id}</div>
                </Td>
                <Td><HealthPill status={s.health_status} /></Td>
                <Td>
                  <div style={{ fontWeight: 600 }}>
                    {nearest.days === 0 ? "Today" : `${nearest.days} day${nearest.days === 1 ? "" : "s"}`}
                  </div>
                  <div style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)" }}>
                    {isStockout ? "stockout" : "safety breach"} · {nearest.iso}
                  </div>
                </Td>
                <Td>
                  {s.covered_by_po ? (
                    <span style={{ fontSize: "var(--text-xs)", color: "var(--green-text)", fontWeight: 600 }}>
                      ✓ PO arrives day {s.incoming_eta_days ?? "?"}
                    </span>
                  ) : (
                    <span style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)" }}>-</span>
                  )}
                </Td>
                <Td>
                  {s.suggested_order_qty > 0 ? (
                    <Link to="/alerts" style={{ fontSize: "var(--text-sm)", fontWeight: 700, color: "var(--blue-text)", display: "inline-block", padding: "6px 0" }}>
                      Order {s.suggested_order_qty} MT →
                    </Link>
                  ) : (
                    <Link to={`/inventory/${s.sku_id}/forecast`} style={{ fontSize: "var(--text-sm)", fontWeight: 700, color: "var(--text-secondary)", display: "inline-block", padding: "6px 0" }}>
                      Watch →
                    </Link>
                  )}
                </Td>
                <Td><WhyButton onClick={() => askAI("stockout", s, `${s.product_name}: ${nearest.days} days to ${isStockout ? "stockout" : "safety breach"}`)} /></Td>
              </tr>
            ))}
          </Table>
        )}
      </Section>

      <div style={{ height: 20 }} />

      <MarketSignals />

      <div style={{ height: 20 }} />

      <Section
        icon={EyeOff}
        iconColor="var(--purple)"
        title="Blind spots"
        titleTip={{
          what: "SKUs where a figure elsewhere in the app can't be trusted yet - either there isn't enough history, or an onboarded field was left blank.",
          how: "Not a risk in itself: it's an honesty check on the OTHER numbers, so you know which ones to lean on and which to double-check before acting.",
        }}
        count={blindSpotRows.length}
        empty="Every SKU has enough data behind its figures right now."
      >
        {blindSpotRows.length > 0 && (
          <Table columns={["Product", "What's missing", "Why it matters", "Fix", ""]}>
            {blindSpotRows.map(({ sku: s, reason }) => (
              <tr key={s.sku_id} style={{ borderBottom: "1px solid var(--border)" }}>
                <Td>
                  <div style={{ fontWeight: 600 }}>{s.product_name}</div>
                  <div style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)" }}>{s.sku_id}</div>
                </Td>
                <Td>{reason.whatsMissing}</Td>
                <Td style={{ color: "var(--text-secondary)" }}>{reason.why}</Td>
                <Td>
                  {reason.fixLink ? (
                    <Link to={reason.fixLink} style={{ fontSize: "var(--text-sm)", fontWeight: 700, color: "var(--blue-text)" }}>
                      {reason.fix} →
                    </Link>
                  ) : (
                    <span style={{ fontSize: "var(--text-sm)", color: "var(--text-muted)" }}>{reason.fix}</span>
                  )}
                </Td>
                <Td><WhyButton onClick={() => askAI("blindspot", s, `${s.product_name}: ${reason.whatsMissing}`)} /></Td>
              </tr>
            ))}
          </Table>
        )}
      </Section>

      {aiModal && (
        <Modal title="Why?" onClose={() => setAiModal(null)}>
          <div style={{ fontSize: "var(--text-xs)", fontWeight: 700, color: "var(--text-muted)", marginBottom: 10 }}>
            {aiModal.label}
          </div>
          {aiModal.loading ? (
            <div style={{ fontSize: "var(--text-sm)", color: "var(--text-muted)" }}>Thinking…</div>
          ) : aiModal.available ? (
            <div style={{ fontSize: "var(--text-base)", lineHeight: 1.7, whiteSpace: "pre-line" }}>
              {aiModal.explanation}
            </div>
          ) : (
            <div style={{ fontSize: "var(--text-sm)", color: "var(--text-muted)" }}>
              AI explanation isn't available right now{aiModal.reason ? `: ${aiModal.reason}` : "."} The numbers in
              the row above are the real, checked figures either way.
            </div>
          )}
        </Modal>
      )}
    </div>
  );
}

function WhyButton({ onClick }) {
  return (
    <button type="button" onClick={onClick} title="Ask AI to explain this in plain words" style={{
      display: "flex", alignItems: "center", gap: 4, fontSize: "var(--text-xs)", fontWeight: 700,
      color: "var(--text-secondary)", background: "var(--surface-2)", border: "1px solid var(--border)",
      borderRadius: 99, padding: "4px 10px", cursor: "pointer", whiteSpace: "nowrap",
    }}>
      <Cpu size={12} /> Why?
    </button>
  );
}

function Section({ icon: Icon, iconColor, title, titleTip, count, empty, children }) {
  return (
    <div className="card" style={{ padding: "18px 20px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: count > 0 ? 14 : 4 }}>
        <Icon size={18} color={iconColor} />
        <h2 style={{ fontSize: "var(--text-lg)", fontWeight: 700, display: "flex", alignItems: "center", gap: 6 }}>
          {title}
          {titleTip && <ColHint label={title} what={titleTip.what} how={titleTip.how} />}
        </h2>
        <span style={{
          fontSize: "var(--text-xs)", fontWeight: 700, color: "var(--text-muted)",
          background: "var(--surface-2)", borderRadius: 99, padding: "2px 8px",
        }}>
          {count}
        </span>
      </div>
      {count === 0 ? (
        <div style={{ fontSize: "var(--text-sm)", color: "var(--text-muted)" }}>{empty}</div>
      ) : children}
    </div>
  );
}

function Table({ columns, children }) {
  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "var(--text-sm)" }}>
        <thead>
          <tr style={{ borderBottom: "1px solid var(--border)" }}>
            {columns.map((c) => (
              <th key={c} style={{
                textAlign: "left", padding: "8px 12px", fontSize: "var(--text-xs)", fontWeight: 600,
                color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: "0.03em",
              }}>
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

function Td({ children, style }) {
  return <td style={{ padding: "10px 12px", verticalAlign: "top", ...style }}>{children}</td>;
}

const HEALTH_COLOR = { RED: "var(--red)", ORANGE: "var(--orange)", YELLOW: "var(--yellow)", GREEN: "var(--green)" };
function HealthPill({ status }) {
  return (
    <span style={{
      fontSize: "var(--text-xs)", fontWeight: 700, color: HEALTH_COLOR[status] || "var(--text-muted)",
    }}>
      {status || "-"}
    </span>
  );
}
