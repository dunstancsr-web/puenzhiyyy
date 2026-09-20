import React, { useState, useEffect, useCallback, useMemo } from "react";
import { modelLabel } from "../lib/modelName";
import {
  PackagePlus, SlidersHorizontal, Truck, BellRing, BellOff,
  UserCheck, Cpu, ChevronRight, FileSearch, KeyRound, ShieldAlert,
  ArrowDownToLine, ArrowUpFromLine, Newspaper, Send, RotateCcw,
} from "lucide-react";
import LoadingState from "./LoadingState";
import ErrorState from "./ErrorState";
import { api } from "../api/inventory";
import { useLiveRefresh } from "../hooks/useLiveRefresh";

// ─────────────────────────────────────────────────────────────────────────────
// ACTIVITY FEED (TASK-31) - the read side of the audit log. Since 20 Sep this is the
// "History" view inside the Alerts tab (pages/Alerts.jsx), not a page of its own: Stan
// asked for the two to share a tab so an alert and what happened to it can be read side
// by side. The list stays a separate list on purpose (a to-do list and a record are
// different things), and the tab links them at the item.
//
// `audit_log` was in the schema from day one and nothing wrote to it, so there
// was no way to answer "what did the system actually do" without opening the
// database. backend/src/db/audit.js fills the write side; this page makes it
// legible.
//
// The design rule here is that raw JSON is not observability. Every event is
// rendered as a sentence a rice-trading manager could read, with the stored
// input/output payload one deliberate click away for anyone who wants to audit
// the machinery rather than the decision.
// ─────────────────────────────────────────────────────────────────────────────

const TYPE_META = {
  ALERT_TRIGGERED:    { icon: BellRing,          color: "var(--red-text)",    label: "Alert raised" },
  DECISION_RECORDED:  { icon: UserCheck,         color: "var(--blue-text)",   label: "Manager decision" },
  // Reorder Loop step 7: the Control Tower's one write. A request to the buyer,
  // never a stock change.
  ORDER_REQUESTED:    { icon: Send,              color: "var(--blue-text)",   label: "Order requested" },
  // A later step on that request (acknowledged, purchase order raised, approved, rejected or cancelled).
  ORDER_REQUEST_UPDATED: { icon: Send,           color: "var(--blue-text)",   label: "Order request update" },
  // RESTOCK is retired (Reorder Loop step 7 removed the office restock action),
  // kept here so any pre-existing audit rows still render rather than showing a
  // raw event code, the same reason LLM_MODE_CHANGED's renderer was kept.
  RESTOCK:            { icon: Truck,             color: "var(--green-text)",  label: "Stock received" },
  SKU_UPDATED:        { icon: SlidersHorizontal, color: "var(--yellow)", label: "Policy changed" },
  SKU_CREATED:        { icon: PackagePlus,       color: "var(--purple-text)", label: "SKU added" },
  ALERT_ACKNOWLEDGED: { icon: BellOff,           color: "var(--text-muted)", label: "Alert dismissed" },
  ALERT_REOPENED:     { icon: RotateCcw,         color: "var(--blue-text)",  label: "Alert reopened" },
  LLM_CALL:           { icon: Cpu,               color: "var(--purple-text)", label: "AI explanation" },
  // Handheld floor movements (TASK-46). Until 15 Sep these had no entry and
  // rendered as the raw event code with no detail and no filter chip.
  GOODS_RECEIVED:     { icon: ArrowDownToLine,   color: "var(--green-text)",  label: "Goods in" },
  OPENING_BALANCE_SET: { icon: PackagePlus,    color: "var(--green-text)",  label: "Opening balance" },
  GOODS_ISSUED:       { icon: ArrowUpFromLine,   color: "var(--orange-text)", label: "Goods out" },
  // TASK-90. Unlocking is a spending decision and reads like one; a lockout is
  // the only security event in this log, so it takes the alarm colour.
  LLM_UNLOCKED:          { icon: KeyRound,    color: "var(--yellow)", label: "Paid AI unlocked" },
  LLM_UNLOCK_LOCKED_OUT: { icon: ShieldAlert, color: "var(--red-text)",    label: "PIN lockout" },
  // MVP2 step 1: the onboarding sales-history upload.
  SALES_HISTORY_IMPORTED: { icon: FileSearch, color: "var(--blue-text)", label: "Sales history uploaded" },
  // A person accepting, dismissing or withdrawing a market signal.
  SIGNAL_DECIDED: { icon: Newspaper, color: "var(--blue-text)", label: "Market signal" },
};

// The filter chips, grouped. There are 16 event types and a row of 16 chips is a legend, not a control;
// six categories, ordered as the loop the app implements (what the system saw, what a person did about it,
// what physically changed), is something a person can scan. A category only shows once it has events.
const CATEGORIES = [
  { id: "alerts",   label: "Alerts and decisions", types: ["ALERT_TRIGGERED", "ALERT_ACKNOWLEDGED", "ALERT_REOPENED", "DECISION_RECORDED"] },
  { id: "orders",   label: "Orders and stock",     types: ["ORDER_REQUESTED", "ORDER_REQUEST_UPDATED", "GOODS_RECEIVED", "GOODS_ISSUED", "OPENING_BALANCE_SET", "RESTOCK"] },
  { id: "signals",  label: "Market signals",       types: ["SIGNAL_DECIDED"] },
  { id: "products", label: "Products and data",    types: ["SKU_UPDATED", "SKU_CREATED", "SALES_HISTORY_IMPORTED"] },
  { id: "ai",       label: "AI and access",        types: ["LLM_CALL", "LLM_UNLOCKED", "LLM_UNLOCK_LOCKED_OUT"] },
];

export const PAGE_HINT = {
  what: "Every action the system took and every decision a person made in response, in the order they happened.",
  how: "Each line says what triggered it, what the system worked out, and what changed. Nothing here can be edited or deleted. Open a line to see the exact numbers the system was given and what it returned.",
};

// Field names are stored as database columns. Spell them the way the rest of
// the UI does, so a policy change reads the same here as on the SKU it changed.
const FIELD_LABELS = {
  reorder_point_policy: "Reorder point",
  min_stock: "Minimum stock",
  target_stock: "Target stock",
  max_stock: "Maximum stock",
  safety_stock_pct: "Safety stock",
  lead_time_days: "Lead time",
  target_service_level: "Service level",
  min_order_qty: "Minimum order",
  unit_cost_sgd: "Unit cost",
  unit_price_sgd: "Unit price",
  reserved_qty: "Reserved",
  quality_hold_qty: "Quality hold",
  product_name: "Product name",
  supplier: "Supplier",
  rice_variety: "Variety",
  grade: "Grade",
  country_of_origin: "Origin",
  brand: "Brand",
  packaging_size: "Packaging",
};

const FIELD_UNITS = {
  lead_time_days: " days",
  safety_stock_pct: "%",
  reorder_point_policy: " MT",
  min_stock: " MT",
  target_stock: " MT",
  max_stock: " MT",
  min_order_qty: " MT",
  reserved_qty: " MT",
  quality_hold_qty: " MT",
};

// The names the Alerts tiles use, so an event about an alert reads in the same words as the alert did.
const ALERT_LABEL = {
  STOCKOUT_RISK: "Stockout Risk", REORDER: "Reorder", OVERSTOCK: "Overstock", SLOW_MOVING: "Slow Moving",
  IDLE: "Idle Stock", AGEING: "Ageing", POLICY_CHANGE_SUGGESTED: "Policy Suggestion",
};
const alertLabel = (type) => ALERT_LABEL[type] || String(type || "alert").replace(/_/g, " ").toLowerCase();

const num = (n) => Number(n).toLocaleString("en-SG", { maximumFractionDigits: 2 });

// Alert copy from the engines already ends in a full stop, so composing it into
// a sentence here produced "consider a targeted promotion..". Trim whatever
// terminal punctuation the source brought before adding our own.
const unpunctuated = (s) => (typeof s === "string" ? s.replace(/[.!?\s]+$/, "") : s);

const fieldValue = (key, v) => {
  if (v === null || v === undefined || v === "") return "not set";
  if (Number.isFinite(Number(v)) && FIELD_UNITS[key]) return `${num(v)}${FIELD_UNITS[key]}`;
  if (key === "target_service_level") return `${num(Number(v) * 100)}%`;
  if (key === "unit_cost_sgd" || key === "unit_price_sgd") return `$${num(v)}`;
  return String(v);
};

// SQLite writes created_at as "YYYY-MM-DD HH:MM:SS" in UTC with no zone marker,
// so Date() would read it as local time and show every event hours off. The
// explicit "Z" is what makes the relative times below correct.
const parseStamp = (raw) => (raw ? new Date(`${String(raw).replace(" ", "T")}Z`) : null);

function relativeTime(raw) {
  const d = parseStamp(raw);
  if (!d || Number.isNaN(d.getTime())) return "";
  const secs = Math.round((Date.now() - d.getTime()) / 1000);
  if (secs < 60) return "just now";
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs} hr ago`;
  const days = Math.round(hrs / 24);
  if (days < 7) return `${days} day${days === 1 ? "" : "s"} ago`;
  return d.toLocaleDateString("en-SG", { day: "numeric", month: "short" });
}

const clockTime = (raw) => {
  const d = parseStamp(raw);
  return d && !Number.isNaN(d.getTime()) ? d.toLocaleTimeString("en-SG", { hour: "numeric", minute: "2-digit" }) : "";
};

// "Today", "Yesterday", then the date, in the reader's own time zone (events are stored in UTC).
function dayLabel(raw) {
  const d = parseStamp(raw);
  if (!d || Number.isNaN(d.getTime())) return "Earlier";
  const day = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((day(new Date()) - day(d)) / 86_400_000);
  if (diff === 0) return "Today";
  if (diff === 1) return "Yesterday";
  return d.toLocaleDateString("en-SG", { weekday: "long", day: "numeric", month: "short", year: d.getFullYear() === new Date().getFullYear() ? undefined : "numeric" });
}

const exactTime = (raw) => {
  const d = parseStamp(raw);
  return d && !Number.isNaN(d.getTime())
    ? d.toLocaleString("en-SG", { dateStyle: "medium", timeStyle: "short" })
    : "";
};

// ── Event to sentence ────────────────────────────────────────────────────────
// Returns { headline, detail }. Written defensively: a row may predate a change
// to what an event stores, so every field access tolerates a missing payload
// rather than blanking the whole page.
export function describe(event) {
  const i = event.input_data || {};
  const o = event.output_data || {};
  const sku = event.sku_name || event.sku_id || "a SKU";

  switch (event.event_type) {
    case "ALERT_TRIGGERED":
      return {
        headline: o.message || `${i.alert_type || "Alert"} on ${sku}`,
        detail: i.triggered_value != null && i.threshold_value != null
          ? `Measured ${num(i.triggered_value)} against a threshold of ${num(i.threshold_value)}. Recommended: ${unpunctuated(o.recommended_action) || "review"}.`
          : o.recommended_action || null,
      };

    case "ALERT_ACKNOWLEDGED":
      return {
        headline: `Dismissed the ${alertLabel(i.alert_type)} alert on ${sku}`,
        detail: "Dismissed by the manager. It stays out of the list, even if the condition still holds, unless it is reopened.",
      };

    case "ALERT_REOPENED":
      return {
        headline: `Reopened the ${alertLabel(i.alert_type)} alert on ${sku}`,
        detail: "Back in the list to decide again, if the condition still holds.",
      };

    case "DECISION_RECORDED": {
      const verb = { approved: "Approved", modified: "Modified", rejected: "Rejected" }[o.manager_action] || o.manager_action;
      let detail = i.ai_recommendation ? `System proposed: ${unpunctuated(i.ai_recommendation)}.` : null;
      if (o.delta_qty != null && o.delta_qty !== 0) {
        const dir = o.delta_qty > 0 ? "raised" : "cut";
        detail = `${detail ? `${detail} ` : ""}Manager ${dir} the quantity by ${num(Math.abs(o.delta_qty))} MT, to ${num(o.manager_quantity)} MT.`;
      }
      if (o.policy_applied?.reorder_point_policy != null) {
        detail = `${detail ? `${detail} ` : ""}Approved reorder point is now ${num(o.policy_applied.reorder_point_policy)} MT.`;
      }
      if (o.manager_reason) detail = `${detail ? `${detail} ` : ""}Reason given: "${o.manager_reason}"`;
      return { headline: `${verb} the recommendation for ${sku}`, detail };
    }

    case "ORDER_REQUESTED": {
      const parts = [`Sent to the buyer${o.request_no ? ` as ${o.request_no}` : ""}. Stock is unchanged until the delivery is received.`];
      if (i.reason) parts.push(`Reason given: "${i.reason}"`);
      return {
        headline: `Requested ${num(i.quantity_mt)} MT of ${sku}`,
        detail: parts.join(" "),
      };
    }

    case "ORDER_REQUEST_UPDATED": {
      // The status now stored is the step just taken; input.from is where it was.
      const said = {
        acknowledged: "acknowledged by the buyer",
        po_raised: "turned into a purchase order by the buyer, waiting for manager approval",
        approved: `approved by the buyer's manager${o.po_number ? `, purchase order ${o.po_number} is now expected at Goods In` : ""}`,
        received: "received at Goods In, so the request is closed",
        rejected: "rejected by the buyer's manager",
        cancelled: "cancelled",
      }[o.status] || `moved to ${o.status}`;
      const parts = [o.status === "received" ? "Stock rose by the quantity received." : "Stock is unchanged."];
      if (i.note && o.status !== "received") parts.push(`${o.status === "rejected" ? "Reason given" : "Note"}: "${i.note}"`);
      return {
        headline: `${i.request_no || "Request"} for ${sku} ${said}`,
        detail: parts.join(" "),
      };
    }

    case "RESTOCK":
      return {
        headline: `Received ${num(i.quantity_mt)} MT of ${sku}`,
        detail: `On hand went ${num(i.on_hand_before)} to ${num(o.on_hand_after)} MT. Available to promise is now ${num(o.available_qty)} MT.`,
      };

    case "GOODS_RECEIVED": {
      const parts = [`${o.movement_no || "Receipt"} against ${i.po_number || "a purchase order"}${i.operator ? `, by ${i.operator}` : ""}.`];
      if (i.variance_qty) {
        parts.push(`${num(Math.abs(i.variance_qty))} MT ${i.variance_qty > 0 ? "more" : "less"} than the ${num(i.expected_qty)} MT expected${i.variance_reason ? `: ${unpunctuated(i.variance_reason)}` : ""}.`);
      }
      if (o.on_hand_before != null && o.on_hand_after != null) parts.push(`On hand went ${num(o.on_hand_before)} to ${num(o.on_hand_after)} MT.`);
      return { headline: `Received ${num(i.received_qty)} MT of ${sku}`, detail: parts.join(" ") };
    }

    case "OPENING_BALANCE_SET":
      return {
        headline: `Opening balance of ${num(i.quantity_mt)} MT set for ${sku}`,
        detail: `${o.movement_no || "Opening balance"}, entered during onboarding for a product with no stock. On hand went ${num(i.on_hand_before)} to ${num(o.on_hand_after)} MT.`,
      };

    case "SIGNAL_DECIDED": {
      const verb = { approve: "Accepted", dismiss: "Dismissed", withdraw: "Withdrew", reopen: "Reopened", edit: "Corrected the reading of" }[i.decision] || "Decided";
      return {
        headline: `${verb} market signal: ${i.headline || "news event"}`,
        detail: [
          i.decided_by ? `By ${i.decided_by}.` : null,
          o.buffer_days != null ? `Added a ${num(o.buffer_days)} day buffer to the reorder points it applies to.` : null,
          i.decision === "withdraw" ? "The buffer it added was switched off." : null,
          i.decision === "reopen" ? "It is back in the list, waiting for a decision." : null,
        ].filter(Boolean).join(" ") || null,
      };
    }

    case "GOODS_ISSUED": {
      const parts = [`${o.movement_no || "Pick"} against ${i.so_number || "a sales order"}${i.operator ? `, by ${i.operator}` : ""}.`];
      if (i.short_by > 0) {
        parts.push(`${num(i.short_by)} MT short of the ${num(i.ordered_qty)} MT ordered${i.short_reason ? `: ${unpunctuated(i.short_reason)}` : ""}.`);
      }
      if (o.on_hand_before != null && o.on_hand_after != null) parts.push(`On hand went ${num(o.on_hand_before)} to ${num(o.on_hand_after)} MT.`);
      return { headline: `Picked ${num(i.picked_qty)} MT of ${sku}${i.customer ? ` for ${i.customer}` : ""}`, detail: parts.join(" ") };
    }

    case "SKU_UPDATED": {
      const changes = i.changes || {};
      const keys = Object.keys(changes);
      const phrases = keys.map(
        (k) => `${FIELD_LABELS[k] || k} ${fieldValue(k, changes[k].from)} to ${fieldValue(k, changes[k].to)}`
      );
      return {
        headline: `${keys.length} field${keys.length === 1 ? "" : "s"} changed on ${sku}`,
        // Listed in full rather than truncated: which thresholds a person moved,
        // and to what, is the entire reason to keep this record.
        detail: phrases.join(" · ") || null,
      };
    }

    case "SKU_CREATED":
      return {
        headline: `${i.product_name || sku} added to the catalogue`,
        detail: o.reorder_point_suggested != null
          ? `Classified ${o.abc_class || "unclassified"}. The engines suggested a reorder point of ${num(o.reorder_point_suggested)} MT and ${num(o.safety_stock_mt)} MT of safety stock.`
          : null,
      };

    case "LLM_CALL":
      // Since TASK-93 a paid explanation that gave up after spending tokens is
      // also recorded, so its cost is counted. It must not read as a success.
      if (o.failed) {
        return {
          headline: `AI explanation attempted for ${sku}, no usable answer`,
          detail: `${o.model_calls || o.attempts || 1} model call(s) spent. ${o.reason || ""}`.trim(),
        };
      }
      return {
        headline: `AI explanation generated for ${sku}`,
        detail: i.model ? `Model: ${modelLabel(i.model)}` : null,
      };

    case "LLM_UNLOCKED":
      return {
        headline: "A visitor unlocked paid AI explanations with the demo PIN",
        detail: o.expires_at
          ? `Their pass expires ${new Date(o.expires_at).toLocaleString("en-SG", { dateStyle: "medium", timeStyle: "short" })}.`
          : null,
      };

    case "LLM_UNLOCK_LOCKED_OUT":
      return {
        headline: "Too many wrong demo PINs, unlocking was blocked",
        detail: o.reason || null,
      };

    case "SALES_HISTORY_IMPORTED": {
      const range = i.date_range ? `${i.date_range.from} to ${i.date_range.to}` : null;
      return {
        headline: `${num(o.inserted)} sale${o.inserted === 1 ? "" : "s"} added from an uploaded file`,
        detail: [
          i.sku_count ? `${i.sku_count} SKU${i.sku_count === 1 ? "" : "s"}` : null,
          range,
        ].filter(Boolean).join(" · ") || null,
      };
    }

    default:
      return { headline: event.event_type.replace(/_/g, " ").toLowerCase(), detail: null };
  }
}

// ── Raw payload disclosure ───────────────────────────────────────────────────

function Payload({ label, value }) {
  return (
    <div style={{ minWidth: 0, flex: "1 1 260px" }}>
      <div style={{
        fontSize: "var(--text-xs)", fontWeight: 600, letterSpacing: "0.04em", textTransform: "uppercase",
        color: "var(--text-muted)", marginBottom: 6,
      }}>
        {label}
      </div>
      <pre style={{
        margin: 0, padding: "10px 12px", borderRadius: "var(--radius)",
        background: "var(--surface-2)", border: "1px solid var(--border)",
        fontSize: "var(--text-xs)", lineHeight: 1.55, color: "var(--text-secondary)",
        // A payload can be wider than the card. Scroll it inside its own box
        // rather than letting it widen the page.
        overflowX: "auto", whiteSpace: "pre-wrap", wordBreak: "break-word",
      }}>
        {value == null ? "null" : JSON.stringify(value, null, 2)}
      </pre>
    </div>
  );
}

// timeStyle: "relative" ("2 hr ago"), "clock" ("10:42 pm", for a list already grouped under day headings) or
// "exact" ("20 Sep 2026, 10:42 pm", for a strip with no day headings). The full date and time is always the tooltip.
export function EventRow({ event, isLast, timeStyle = "relative", actions = null, override = null }) {
  const [open, setOpen] = useState(false);
  const meta = TYPE_META[event.event_type] || { icon: FileSearch, color: "var(--text-muted)", label: event.event_type };
  const Icon = meta.icon;
  const { headline, detail } = override || describe(event);

  return (
    <div style={{ display: "flex", gap: 14, position: "relative" }}>
      {/* rail: icon plus the connector down to the next event */}
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", flexShrink: 0 }}>
        <div style={{
          width: 30, height: 30, borderRadius: "50%", flexShrink: 0,
          display: "flex", alignItems: "center", justifyContent: "center",
          background: "var(--surface-2)", border: "1px solid var(--border)", color: meta.color,
        }}>
          <Icon size={15} />
        </div>
        {!isLast && <div style={{ flex: 1, width: 1, background: "var(--border)", marginTop: 4 }} />}
      </div>

      <div style={{ flex: 1, minWidth: 0, paddingBottom: isLast ? 0 : 20 }}>
        <div style={{
          display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap",
          justifyContent: "space-between",
        }}>
          <span style={{ fontSize: "var(--text-xs)", fontWeight: 600, color: meta.color, letterSpacing: "0.01em" }}>
            {meta.label}
          </span>
          <span
            style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)", flexShrink: 0 }}
            title={exactTime(event.created_at)}
          >
            {timeStyle === "clock" ? clockTime(event.created_at) : timeStyle === "exact" ? exactTime(event.created_at) : relativeTime(event.created_at)}
          </span>
        </div>

        <div style={{ fontSize: "var(--text-sm)", fontWeight: 600, color: "var(--text-primary)", marginTop: 2 }}>
          {headline}
        </div>

        {detail && (
          <div style={{ fontSize: "var(--text-xs)", color: "var(--text-secondary)", marginTop: 3, lineHeight: 1.55 }}>
            {detail}
          </div>
        )}
        {actions && <div style={{ marginTop: 6, display: "flex", gap: 8, flexWrap: "wrap" }}>{actions}</div>}

        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="touch-44"
          style={{
            display: "inline-flex", alignItems: "center", gap: 4, marginTop: 4, padding: "6px 0",
            border: "none", background: "none", cursor: "pointer",
            fontSize: "var(--text-xs)", fontWeight: 600, color: "var(--text-muted)",
          }}
        >
          <ChevronRight
            size={12}
            style={{ transform: open ? "rotate(90deg)" : "none", transition: "transform 0.15s ease" }}
          />
          {open ? "Hide record" : "Show record"}
        </button>

        {open && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginTop: 10 }}>
            <Payload label="Input - what the system saw" value={event.input_data} />
            <Payload label="Output - what it did" value={event.output_data} />
          </div>
        )}
      </div>
    </div>
  );
}

// ── The feed ─────────────────────────────────────────────────────────────────

const PAGE = 200;

// A small text button for the actions on a row ("Open alert", "Reopen alert").
function RowAction({ onClick, children }) {
  return (
    <button type="button" onClick={onClick} className="touch-44" style={{
      padding: "4px 10px", borderRadius: "var(--radius)", border: "1px solid var(--border)", background: "var(--card-bg)",
      fontSize: "var(--text-xs)", fontWeight: 600, color: "var(--text-secondary)", cursor: "pointer",
    }}>{children}</button>
  );
}

// skuId: only this product's events. activeAlertIds / dismissedAlertIds: alert ids currently open, and
// currently dismissed, so a row can offer the right link. refreshKey: bump it to reload quietly.
export default function ActivityFeed({ skuId, activeAlertIds, dismissedAlertIds, onOpenAlert, onReopenAlert, refreshKey }) {
  const [events, setEvents] = useState([]);
  const [counts, setCounts] = useState({});
  const [category, setCategory] = useState("ALL");
  // One exact event type, chosen from the Type menu (the old page had a chip per type; the five group chips
  // are coarser, so this keeps the fine filter one click away). "" means every type in the chosen group.
  const [typeFilter, setTypeFilter] = useState("");
  const [limit, setLimit] = useState(PAGE);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const types = typeFilter || (category === "ALL" ? undefined : CATEGORIES.find((c) => c.id === category)?.types.join(","));

  // Filtering happens on the server so the limit applies to the filtered set, not to a page of mixed events
  // that might hold none of the chosen kind. `quiet` reloads without replacing the list with a spinner, so
  // a refresh never makes what you were reading vanish.
  const load = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    setError(null);
    try {
      const res = await api.getAuditLog({ eventType: types, skuId: skuId || undefined, limit });
      setEvents(res?.events || []);
      setCounts(res?.counts || {});
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [types, skuId, limit]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (refreshKey) load(true); }, [refreshKey]); // eslint-disable-line react-hooks/exhaustive-deps
  useLiveRefresh(() => { load(true); });
  // Changing the product or the category starts again from the first page.
  useEffect(() => { setLimit(PAGE); }, [category, typeFilter, skuId]);
  // A group chip clears the exact type; picking a type selects its group so the chip shows where you are.
  const chooseCategory = (id) => { setCategory(id); setTypeFilter(""); };
  const chooseType = (t) => {
    setTypeFilter(t);
    if (t) setCategory(CATEGORIES.find((c) => c.types.includes(t))?.id || "ALL");
  };
  // Every type that has occurred, grouped by its category, for the Type menu.
  const typeGroups = CATEGORIES
    .map((c) => ({ ...c, present: c.types.filter((t) => counts[t] > 0) }))
    .filter((c) => c.present.length > 0);
  const typeOptionCount = typeGroups.reduce((n, c) => n + c.present.length, 0);

  const total = useMemo(() => Object.values(counts).reduce((a, b) => a + b, 0), [counts]);
  const chips = CATEGORIES
    .map((c) => ({ ...c, count: c.types.reduce((n, t) => n + (counts[t] || 0), 0) }))
    .filter((c) => c.count > 0);

  // Newest first, under a heading per day.
  const days = useMemo(() => {
    const out = [];
    for (const e of events) {
      const label = dayLabel(e.created_at);
      if (!out.length || out[out.length - 1].label !== label) out.push({ label, events: [] });
      out[out.length - 1].events.push(e);
    }
    return out;
  }, [events]);

  // Events are newest first, so the first dismissal seen for an alert is its latest. Only that one offers
  // Reopen: an alert dismissed, reopened and dismissed again has two dismissal rows but is dismissed once.
  const latestDismissal = useMemo(() => {
    const seen = new Map();
    for (const e of events) {
      if (e.event_type === "ALERT_ACKNOWLEDGED" && e.input_data?.alert_id != null && !seen.has(e.input_data.alert_id)) seen.set(e.input_data.alert_id, e.id);
    }
    return seen;
  }, [events]);

  const actionsFor = (e) => {
    const i = e.input_data || {};
    const o = e.output_data || {};
    if (e.event_type === "ALERT_TRIGGERED" && activeAlertIds?.has(o.alert_id) && onOpenAlert) {
      return <RowAction onClick={() => onOpenAlert(o.alert_id)}>Open alert</RowAction>;
    }
    if (e.event_type === "ALERT_ACKNOWLEDGED" && dismissedAlertIds?.has(i.alert_id) && latestDismissal.get(i.alert_id) === e.id && onReopenAlert) {
      return <RowAction onClick={() => onReopenAlert(i.alert_id)}>Reopen alert</RowAction>;
    }
    return null;
  };

  return (
    <div>
      {/* Only categories that have actually occurred get a chip: a row of zeroes is a legend pretending to be a control. */}
      {chips.length > 1 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 16, alignItems: "center" }} role="group" aria-label="Filter the history">
          {[{ id: "ALL", label: "All", count: total }, ...chips].map((c) => {
            const isActive = category === c.id;
            return (
              <button key={c.id} type="button" onClick={() => chooseCategory(c.id)} aria-pressed={isActive} className="ms-btn" style={{
                display: "inline-flex", alignItems: "center", gap: 6, padding: "6px 13px", borderRadius: 99, cursor: "pointer",
                fontSize: "var(--text-xs)", fontWeight: 600,
                border: `1px solid ${isActive ? "var(--text-primary)" : "var(--border)"}`,
                background: isActive ? "var(--text-primary)" : "var(--card-bg)",
                color: isActive ? "var(--card-bg)" : "var(--text-secondary)",
                transition: "background 0.15s ease, color 0.15s ease, border-color 0.15s ease",
              }}>
                {c.label}
                <span style={{ opacity: 0.65, fontWeight: 500 }}>{c.count}</span>
              </button>
            );
          })}
          {typeOptionCount > 1 && (
            <select aria-label="Filter by exact event type" className="ms-select" value={typeFilter} onChange={(e) => chooseType(e.target.value)} style={{
              marginLeft: "auto", padding: "6px 10px", borderRadius: "var(--radius)", border: "1px solid var(--border)",
              background: "var(--card-bg)", color: "var(--text-secondary)", fontSize: "var(--text-xs)", fontWeight: 600, cursor: "pointer",
            }}>
              <option value="">Any type</option>
              {typeGroups.map((g) => (
                <optgroup key={g.id} label={g.label}>
                  {g.present.map((t) => <option key={t} value={t}>{(TYPE_META[t]?.label || t)} ({counts[t]})</option>)}
                </optgroup>
              ))}
            </select>
          )}
        </div>
      )}

      <div className="card" style={{ padding: 22 }}>
        {loading && <LoadingState label="Loading history…" />}
        {!loading && error && <ErrorState message={error} onRetry={() => load()} />}

        {!loading && !error && events.length === 0 && (
          <div style={{ textAlign: "center", padding: "56px 20px" }}>
            <FileSearch size={26} color="var(--text-muted)" />
            <div style={{ fontSize: "var(--text-sm)", fontWeight: 600, color: "var(--text-primary)", marginTop: 12 }}>
              {skuId || category !== "ALL" || typeFilter ? "Nothing matches this filter" : "Nothing recorded yet"}
            </div>
            <div style={{ fontSize: "var(--text-xs)", color: "var(--text-secondary)", marginTop: 6, maxWidth: 420, marginInline: "auto", lineHeight: 1.6 }}>
              {skuId || category !== "ALL" || typeFilter
                ? "Try another category or type, or choose All products."
                : "This record fills itself as the system runs. Alerts, decisions, stock movements and policy changes appear here as they happen."}
            </div>
          </div>
        )}

        {!loading && !error && days.map((day, di) => (
          <section key={day.label} aria-label={day.label} style={{ marginTop: di === 0 ? 0 : 26 }}>
            <h2 style={{
              fontSize: "var(--text-xs)", fontWeight: 700, letterSpacing: "0.05em", textTransform: "uppercase",
              color: "var(--text-muted)", margin: "0 0 14px",
            }}>{day.label}</h2>
            {day.events.map((e, idx) => (
              <EventRow key={e.id} event={e} isLast={idx === day.events.length - 1} timeStyle="clock" actions={actionsFor(e)} />
            ))}
          </section>
        ))}

        {!loading && !error && events.length >= limit && limit < 1000 && (
          <div style={{ marginTop: 22, textAlign: "center" }}>
            <button type="button" onClick={() => setLimit((n) => n + PAGE)} className="ms-btn" style={{
              padding: "8px 18px", borderRadius: "var(--radius)", border: "1px solid var(--border)", background: "var(--card-bg)",
              fontSize: "var(--text-sm)", fontWeight: 600, color: "var(--text-secondary)", cursor: "pointer",
            }}>Show older events</button>
          </div>
        )}
      </div>
    </div>
  );
}
