import React, { useEffect, useState } from "react";
import { Newspaper, ExternalLink, History } from "lucide-react";
import { api } from "../api/inventory";
import ColHint from "./ColHint";
import WorkingNote from "./WorkingNote";

// ─────────────────────────────────────────────────────────────────────────────
// MARKET SIGNALS (Action Items)
//
// News that could delay or tighten supply, checked against YOUR stock. Every
// figure on this card comes from engines/signals.js: the days an event costs are
// read from a small visible table (never from a model or from the article), and
// what they do to each product is the same projection the rest of the app uses.
// Nothing here orders anything. Approving only adds a buffer to the reorder
// point, and a person does that.
//
// Loaded events are real past ones ("replay"), shown against today's stock, so
// the answer to "would this have helped" can be seen without a live feed.
// ─────────────────────────────────────────────────────────────────────────────

const EVENT_LABEL = {
  export_restriction: "Export restriction",
  port_logistics: "Port or shipping delay",
  availability_tightening: "Supply tightening",
  weather_harvest: "Weather or harvest",
};

const URGENCY = {
  act_now:       { label: "Order now",    color: "var(--red-text)",    bg: "var(--red-light)" },
  order_soon:    { label: "Order soon",   color: "var(--orange-text)", bg: "var(--orange-light)" },
  monitor:       { label: "Monitor",      color: "var(--green-text)",  bg: "var(--green-light)" },
  informational: { label: "For your information", color: "var(--text-secondary)", bg: "var(--surface-2)" },
};

const DIRECTION_LABEL = { tightens: "Tightens supply", eases: "Eases supply", neutral: "No clear effect" };
const SEVERITY_LABEL = { low: "Low", medium: "Medium", high: "High" };

// Who classified the headline, in words a manager can weigh. A person's correction
// is shown as such, because it is the most trustworthy reading on the screen.
function readBy(extractedBy) {
  const s = String(extractedBy || "");
  const corrected = /corrected by a person/.test(s);
  const base = s.replace(/ \(corrected by a person\)/, "");
  const who = base.startsWith("model:") ? `AI (${base.slice(6)}, on this machine)` : base === "rules" ? "a keyword list" : base === "hand" ? "an analyst" : base;
  return corrected ? `${who}, then corrected by a person` : `Read by ${who}`;
}

// The ⓘ help icon sitting at the end of a line of text.
const Help = (props) => <span style={{ display: "inline-flex", verticalAlign: "middle", marginLeft: 6 }}><ColHint {...props} /></span>;

// How far back a scan looks. The presets cover what people actually mean; "Custom" is a whole number
// of days within the limits the server sends (data.scan_days), so the page and the server cannot disagree.
const WINDOW_PRESETS = [
  { value: "3", label: "Last 3 days" },
  { value: "7", label: "Last week" },
  { value: "14", label: "Last 2 weeks" },
  { value: "30", label: "Last month" },
];
const dayWord = (n) => (n === 1 ? "day" : "days");

const fmt = (n) => Number(n).toLocaleString("en-SG", { maximumFractionDigits: 1 });
const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;

function orderBy(high) {
  if (high.latest_order_in_days == null) return "No rush";
  if (high.latest_order_in_days <= 0) return "Today, already late";
  return `Within ${plural(high.latest_order_in_days, "day")}`;
}

// One primary, everything else quiet (the same rule as Alerts' ActionButton).
function Btn({ primary, disabled, onClick, children, title }) {
  return (
    <button type="button" disabled={disabled} onClick={onClick} className="ms-btn" title={title} style={{
      padding: "9px 16px", borderRadius: "var(--radius)", fontSize: "var(--text-sm)", fontWeight: 600,
      cursor: disabled ? "default" : "pointer", opacity: disabled ? 0.6 : 1, whiteSpace: "nowrap",
      background: primary ? "var(--blue-strong)" : "var(--card-bg)", color: primary ? "#fff" : "var(--text-secondary)",
      border: `1px solid ${primary ? "var(--blue-strong)" : "var(--border)"}`,
    }}>{children}</button>
  );
}

function Pill({ u }) {
  const c = URGENCY[u] || URGENCY.informational;
  return (
    <span style={{
      fontSize: "var(--text-xs)", fontWeight: 700, color: c.color, background: c.bg,
      borderRadius: 99, padding: "3px 10px", whiteSpace: "nowrap",
    }}>{c.label}</span>
  );
}

// Labels above the results, each with a plain-English explanation. Hidden on phones, where each
// result stacks and carries its own values (see .signal-head in index.css).
function ExposureHeader() {
  const H = ({ children, hint }) => (
    <div style={{ display: "flex", alignItems: "center", gap: 4 }}>{children}{hint && <ColHint {...hint} />}</div>
  );
  return (
    <div className="signal-row signal-head" style={{ paddingBottom: 6 }}>
      <H>Product</H>
      <H hint={{
        label: "stock cover",
        what: "How many days your stock lasts at your normal selling pace. Lead time is how long a new order takes to arrive.",
        how: "If cover is shorter than the lead time plus the delay, you would run out before new stock lands.",
      }}>Stock cover</H>
      <H hint={{
        label: "suggested order",
        what: "How much to order so you are back at your target stock once the delay is counted.",
        how: "\"More than normal\" is the extra this news adds on top of your usual suggested order. This is advice only. Nothing is ordered.",
      }}>Suggested order</H>
      <H hint={{
        label: "order by",
        what: "The latest day you can order and still have it arrive before you run out.",
        how: "\"Today, already late\" means an order placed now would still arrive after the stock runs out. \"No rush\" means you have plenty of time.",
      }}>Order by</H>
      <H hint={{
        label: "urgency",
        what: "How pressing this is for the product, judged on the bad end of the range.",
        how: "Order now: you would run out before a new order could arrive.\nOrder soon: you have two weeks or less to order in time.\nMonitor: nothing to do yet, keep an eye on it.",
      }}>Urgency</H>
    </div>
  );
}

function Exposure({ e }) {
  if (!e.low) {
    return (
      <div style={{ padding: "10px 0", borderTop: "1px solid var(--border)", fontSize: "var(--text-sm)" }}>
        <strong>{e.product_name}</strong> <span style={{ color: "var(--text-muted)" }}>{e.sku_id}</span>
        <span style={{ color: "var(--text-secondary)" }}> · same {e.match_reason.replace("same ", "")}, easing so nothing to add</span>
      </div>
    );
  }
  const { low, high } = e;
  const already = high.days_without_stock_without_signal;
  return (
    <div className="signal-row" style={{ padding: "12px 0", borderTop: "1px solid var(--border)", fontSize: "var(--text-sm)" }}>
      <div>
        <div style={{ fontWeight: 600 }}>{e.product_name}</div>
        <div style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)" }}>{e.sku_id} · {e.match_reason}</div>
        {e.buffer_after_days != null && (
          <div style={{ fontSize: "var(--text-xs)", color: e.buffer_capped ? "var(--orange-text)" : "var(--text-muted)", marginTop: 2 }}>
            Buffer {fmt(e.buffer_now_days)} to {fmt(e.buffer_after_days)} days{e.buffer_capped ? ", capped" : ""}
            <Help label="safety buffer"
              what="The extra days of stock kept in reserve, on top of your normal safety stock. This shows the reserve now, and what it becomes if you add the buffer for this signal."
              how={"\"Capped\" means the total reached the 30 day maximum, so it cannot grow further."} />
          </div>
        )}
      </div>
      <div>
        <div style={{ fontWeight: 600 }}>{e.days_of_cover == null ? "No demand" : `${e.days_of_cover} days cover`}</div>
        <div style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)" }}>{e.lead_time_days} day lead time</div>
      </div>
      <div>
        <div style={{ fontWeight: 600 }}>
          {low.order_qty_mt === high.order_qty_mt ? `${fmt(high.order_qty_mt)} MT` : `${fmt(low.order_qty_mt)} to ${fmt(high.order_qty_mt)} MT`}
        </div>
        <div style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)" }}>
          {high.extra_over_normal_mt > 0 ? `${fmt(high.extra_over_normal_mt)} MT more than normal` : "no more than normal"}
        </div>
      </div>
      <div>
        <div style={{ fontWeight: 600 }}>{orderBy(high)}</div>
        {(already > 0 || high.days_added_by_signal > 0) && (
          <div style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)", lineHeight: 1.45 }}>
            {already > 0
              ? `Already short by ${plural(already, "day")} before this news`
              : `Runs out ${plural(high.days_without_stock, "day")} before a new order lands`}
            {already > 0 && high.days_added_by_signal > 0 ? `, and it adds ${high.days_added_by_signal} more` : ""}
          </div>
        )}
      </div>
      <Pill u={e.urgency} />
    </div>
  );
}

// "Read as": the four fields the reader chose, editable while the signal is pending.
// The reader is right about three headlines in four, so a person can fix it, and the
// assessment below is arithmetic and recomputes at once.
function ReadingEditor({ s, meta, busy, onSave }) {
  const [draft, setDraft] = useState({ country_of_origin: s.country_of_origin, event_type: s.event_type, severity: s.severity, direction: s.direction });
  useEffect(() => {
    setDraft({ country_of_origin: s.country_of_origin, event_type: s.event_type, severity: s.severity, direction: s.direction });
  }, [s.country_of_origin, s.event_type, s.severity, s.direction]);
  const changed = draft.country_of_origin !== s.country_of_origin || draft.event_type !== s.event_type
    || draft.severity !== s.severity || draft.direction !== s.direction;
  const sel = { fontSize: "var(--text-sm)", padding: "8px 10px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--card-bg)", color: "var(--text-primary)" };
  const set = (k) => (e) => setDraft((d) => ({ ...d, [k]: e.target.value }));
  return (
    <div style={{ marginTop: 10, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
      <span style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)", fontWeight: 600, display: "inline-flex", alignItems: "center", gap: 4 }}>
        Read as
        <ColHint label="how the headline was read"
          what="The reader's best guess at four things about the headline: which country, what kind of event, how serious, and whether it tightens or eases supply."
          how="It is usually right, not always. If something looks wrong, change it and press Save correction. The advice below recalculates straight away." />
      </span>
      <select className="ms-select" style={sel} value={draft.country_of_origin} onChange={set("country_of_origin")} disabled={busy} aria-label="Country">
        {meta.origins.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
      <select className="ms-select" style={sel} value={draft.event_type} onChange={set("event_type")} disabled={busy} aria-label="Event type">
        {meta.event_types.map((t) => <option key={t} value={t}>{EVENT_LABEL[t] || t}</option>)}
      </select>
      <select className="ms-select" style={sel} value={draft.severity} onChange={set("severity")} disabled={busy} aria-label="Severity">
        {meta.severities.map((v) => <option key={v} value={v}>{SEVERITY_LABEL[v]} severity</option>)}
      </select>
      <select className="ms-select" style={sel} value={draft.direction} onChange={set("direction")} disabled={busy} aria-label="Direction">
        {meta.directions.map((d) => <option key={d} value={d}>{DIRECTION_LABEL[d]}</option>)}
      </select>
      {changed && <Btn disabled={busy} onClick={() => onSave(s.id, draft)}>Save correction</Btn>}
    </div>
  );
}

function SignalCard({ s, busy, onDecide, onCorrect, meta }) {
  const a = s.assessment;
  const eases = s.direction === "eases";
  const affected = a.exposures.length;
  const worst = a.exposures.find((e) => e.high);
  const decided = s.status !== "pending";

  return (
    <div style={{
      border: "1px solid var(--border)", borderRadius: 14, padding: "16px 18px", marginTop: 14,
      background: decided ? "var(--surface-2)" : "var(--card-bg)", opacity: s.status === "dismissed" ? 0.7 : 1,
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "baseline" }}>
        <div style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)", fontWeight: 600 }}>
          {s.published_at} · {EVENT_LABEL[s.event_type] || s.event_type} · {s.country_of_origin || s.supplier}
          {s.origin === "replay" && <span style={{ marginLeft: 8, color: "var(--purple-text)" }}>Past event, replayed</span>}
          {s.origin === "live" && <span style={{ marginLeft: 8, color: "var(--blue-text)" }}>Live news</span>}
        </div>
        {decided && (
          <span style={{ fontSize: "var(--text-xs)", fontWeight: 700, color: "var(--text-secondary)", textTransform: "capitalize" }}>{s.status}</span>
        )}
      </div>

      <div style={{ fontSize: "var(--text-base)", fontWeight: 700, marginTop: 6, lineHeight: 1.35 }}>{s.headline}</div>
      {s.summary && <div style={{ fontSize: "var(--text-sm)", color: "var(--text-secondary)", marginTop: 4, lineHeight: 1.5 }}>{s.summary}</div>}
      {s.source_url && (
        <a href={s.source_url} target="_blank" rel="noreferrer" className="touch-44" style={{
          display: "inline-flex", alignItems: "center", gap: 5, marginTop: 2, padding: "5px 0", minHeight: 28, fontSize: "var(--text-xs)", color: "var(--blue-text)", fontWeight: 600, textDecoration: "none",
        }}>
          {s.source_name || "Source"} <ExternalLink size={12} />
        </a>
      )}

      {s.also_reported_by.length > 0 && (
        <details style={{ marginTop: 6 }}>
          <summary className="ms-summary" style={{ cursor: "pointer", fontSize: "var(--text-xs)", color: "var(--text-secondary)", fontWeight: 600 }}>
            Also reported by {plural(s.also_reported_by.length, "other source")}
          </summary>
          <ul style={{ margin: "6px 0 0", paddingLeft: 18, fontSize: "var(--text-xs)", lineHeight: 1.6 }}>
            {s.also_reported_by.map((a) => (
              <li key={a.url}><a href={a.url} target="_blank" rel="noreferrer" className="ms-link touch-44" style={{ color: "var(--blue-text)", textDecoration: "none" }}>{a.title}</a>{a.source ? <span style={{ color: "var(--text-muted)" }}> · {a.source}</span> : null}</li>
            ))}
          </ul>
        </details>
      )}

      {s.origin === "live" && (
        <div style={{ marginTop: 8, fontSize: "var(--text-xs)", color: "var(--text-muted)" }}>{readBy(s.extracted_by)}. Check the headline before relying on it.</div>
      )}
      {s.origin === "live" && s.status === "pending" && meta && <ReadingEditor s={s} meta={meta} busy={busy} onSave={onCorrect} />}

      <div style={{ marginTop: 12, fontSize: "var(--text-sm)", lineHeight: 1.5 }}>
        {eases ? (
          <span style={{ color: "var(--text-secondary)" }}>
            This eases pressure, so there is no buffer to add.
            {affected > 0 ? ` It touches ${affected} of your products.` : " None of your products are affected."}
          </span>
        ) : a.playbook ? (
          <span>
            Assumed to cost <strong>{a.playbook[0]} to {a.playbook[1]} days</strong> of supply
            <span style={{ color: "var(--text-muted)" }}> ({(EVENT_LABEL[s.event_type] || s.event_type).toLowerCase()}, {s.severity} severity, from the table below)</span>.
            <Help label="the assumed days"
              what="How many extra days of supply this kind of event usually costs. It comes from a fixed table at the bottom of this card, not from the article."
              how="The low number is a mild case and the high number a bad case. The row used depends on the kind of event and how serious it is. These are assumptions, not measurements." />
            {affected === 0 && <strong> None of your products are affected.</strong>}
          </span>
        ) : null}
      </div>

      {a.not_affected.length > 0 && (
        <div style={{ marginTop: 6, fontSize: "var(--text-sm)", color: "var(--green-text)", fontWeight: 600 }}>
          Not affected: {a.not_affected.map((n) => `${n.product_name}, ${n.reason}`).join("; ")}
        </div>
      )}

      {affected > 0 && (
        <div style={{ marginTop: 10 }}>
          {!eases && <ExposureHeader />}
          {a.exposures.map((e) => <Exposure key={e.sku_id} e={e} />)}
        </div>
      )}

      {s.status === "pending" && (
        <div style={{ display: "flex", gap: 10, marginTop: 14, alignItems: "center", flexWrap: "wrap" }}>
          {!eases && a.playbook && affected > 0 && (
            <Btn primary disabled={busy} onClick={() => onDecide(s.id, "approve")}>
              {busy ? "Saving…" : `Add a ${fmt((a.playbook[0] + a.playbook[1]) / 2)} day buffer`}
            </Btn>
          )}
          <Btn disabled={busy} onClick={() => onDecide(s.id, "dismiss")}>
            {eases || affected === 0 ? "Acknowledge" : "Dismiss"}
          </Btn>
          {!eases && affected > 0 && worst && (
            <span style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)" }}>
              Adds to the reorder point for the products above. Nothing is ordered.
              <Help label="the safety buffer"
                what="A buffer makes StockSense tell you to reorder earlier, by adding extra days of stock to each affected product's reorder point. It does not place an order."
                how={"Add a buffer if you think the news is real and matters to you. Dismiss it if it does not.\nYou can withdraw a buffer later."} />
            </span>
          )}
        </div>
      )}
      {s.status === "approved" && (
        <div style={{ display: "flex", gap: 10, marginTop: 12, alignItems: "center" }}>
          <span style={{ fontSize: "var(--text-sm)", color: "var(--text-secondary)" }}>Buffer is active in the reorder points.</span>
          <Btn disabled={busy} onClick={() => onDecide(s.id, "withdraw")}>Withdraw</Btn>
        </div>
      )}
    </div>
  );
}

// Two ways to add a signal, chosen one at a time. A segmented control (not two rows of buttons)
// because they are alternatives for the same job, and showing both at once read as two steps of one
// process. The control also decides which signals are listed below it: real headlines and rehearsals
// of past events are different things and must not share one list, or a rehearsal reads as news. A
// blue count on a tab is how many signals in it still wait for a decision, so nothing hides in the
// other tab.
const MODES = [
  { id: "live", label: "Live news", Icon: Newspaper },
  { id: "past", label: "Past events", Icon: History },
];

function ModeSwitch({ mode, onChange, disabled, waiting }) {
  const move = (e) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    onChange(mode === "live" ? "past" : "live");
  };
  return (
    <div role="tablist" aria-label="How to add a signal" onKeyDown={disabled ? undefined : move} style={{
      display: "inline-flex", padding: 3, gap: 2, borderRadius: 11, background: "var(--surface-2)", maxWidth: "100%",
    }}>
      {MODES.map(({ id, label, Icon }) => {
        const on = mode === id;
        return (
          <button key={id} type="button" role="tab" id={`ms-tab-${id}`} aria-selected={on} aria-controls="ms-panel"
            tabIndex={on ? 0 : -1} disabled={disabled} onClick={() => onChange(id)} className="ms-btn" style={{
              display: "inline-flex", alignItems: "center", gap: 7, padding: "8px 16px", borderRadius: 9, border: "none",
              fontSize: "var(--text-sm)", fontWeight: 600, cursor: disabled ? "default" : "pointer",
              background: on ? "var(--card-bg)" : "transparent",
              color: on ? "var(--text-primary)" : "var(--text-secondary)",
              boxShadow: on ? "var(--shadow)" : "none", opacity: disabled && !on ? 0.6 : 1,
            }}>
            <Icon size={15} /> {label}
            {waiting[id] > 0 && (
              <span aria-label={`${waiting[id]} waiting for your decision`} style={{
                minWidth: 18, height: 18, padding: "0 5px", borderRadius: 9, background: "var(--blue-strong)", color: "#fff",
                fontSize: "var(--text-xs)", fontWeight: 700, lineHeight: "18px", textAlign: "center",
              }}>{waiting[id]}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}

export default function MarketSignals() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [pick, setPick] = useState("");
  const [needsDemo, setNeedsDemo] = useState(false);
  const [scanNote, setScanNote] = useState(null);
  const [scanning, setScanning] = useState(false);
  const [mode, setMode] = useState("live");
  const [windowChoice, setWindowChoice] = useState("14"); // a preset's value, or "custom"
  const [customDays, setCustomDays] = useState("10");

  useEffect(() => {
    api.getMarketSignals().then(setData).catch((e) => setError(e.message));
  }, []);

  const run = async (fn) => {
    setBusy(true); setError(null); setNeedsDemo(false);
    try { setData(await fn()); } catch (e) { setError(e.message); setNeedsDemo(!!e.needsDemo); } finally { setBusy(false); }
  };

  const limits = data?.scan_days || { min: 1, max: 30, default: 14 };
  const days = windowChoice === "custom" ? Number(customDays) : Number(windowChoice);
  const daysOk = Number.isInteger(days) && days >= limits.min && days <= limits.max;

  const scan = async () => {
    if (!daysOk) return;
    setBusy(true); setScanning(true); setError(null); setNeedsDemo(false); setScanNote(null);
    try {
      const d = await api.scanSignals(days);
      setData(d);
      const s = d.scan;
      setScanNote(
        `Checked ${s.fetched} headlines from the last ${days} ${dayWord(days)} in ${s.seconds} seconds: ${s.added} new, ${s.merged} merged into existing stories, ` +
        `${s.not_relevant} not relevant${s.already_read ? `, ${s.already_read} already read` : ""}` +
        `${s.waiting ? `, ${s.waiting} older ones waiting for the next scan` : ""}. Read by ${s.reader}.`
      );
    } catch (e) { setError(e.message); setNeedsDemo(!!e.needsDemo); } finally { setBusy(false); setScanning(false); }
  };

  const catalog = data?.catalog || [];
  const signals = data?.signals || [];
  const isPast = (x) => x.origin === "replay";
  const shown = signals.filter((x) => (mode === "past" ? isPast(x) : !isPast(x)));
  const waiting = {
    live: signals.filter((x) => !isPast(x) && x.status === "pending").length,
    past: signals.filter((x) => isPast(x) && x.status === "pending").length,
  };

  return (
    <div className="card" style={{ padding: "18px 20px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <Newspaper size={20} color="var(--blue-strong)" />
        <h2 style={{ fontSize: "var(--text-lg)", fontWeight: 700 }}>Market signals</h2>
        <ColHint label="market signals"
          what="Rice supply news, like an export ban or a port strike, checked against your stock. StockSense works out which products it could leave short, and by when."
          how={"1. Add a signal, from live news or a past event.\n2. Read what it means for each product.\n3. Decide: add a safety buffer, or dismiss it.\nNothing is ordered for you."} />
      </div>
      <p style={{ fontSize: "var(--text-sm)", color: "var(--text-secondary)", marginTop: 6, lineHeight: 1.55, maxWidth: 640 }}>
        News that could delay or tighten rice supply, checked against your stock. Nothing is ordered until you decide.
      </p>

      {error && (
        <div role="alert" style={{ marginTop: 12, color: "var(--red-text)", fontSize: "var(--text-sm)" }}>
          {error}
          {needsDemo && (
            <div style={{ marginTop: 8 }}>
              <a href={`${window.location.pathname}?demo=1&sample=1`} style={{ color: "#fff", background: "var(--blue-strong)", padding: "12px 16px", borderRadius: "var(--radius)", fontWeight: 600, textDecoration: "none", display: "inline-block", minHeight: 44 }}>
                Join the demo and continue
              </a>
            </div>
          )}
        </div>
      )}
      {data === null && !error && <div style={{ marginTop: 12, color: "var(--text-muted)", fontSize: "var(--text-sm)" }}>Loading…</div>}

      {data && (
        <>
          <div style={{ marginTop: 16 }}>
            <ModeSwitch mode={mode} onChange={setMode} disabled={busy} waiting={waiting} />
          </div>

          <div role="tabpanel" id="ms-panel" aria-labelledby={`ms-tab-${mode}`} style={{ marginTop: 12 }}>
            {mode === "live" ? (
              <>
                <p style={{ fontSize: "var(--text-sm)", color: "var(--text-secondary)", lineHeight: 1.5, maxWidth: 640, margin: 0 }}>
                  Checks rice supply headlines about the countries you buy from.
                  <Help label="live news"
                    what="StockSense searches recent news for rice supply stories about the countries you buy from, then reads each headline to work out what happened."
                    how="A small AI model running locally does the reading, or a simple keyword list when no model is available. Either can misread a headline, so check it and correct it if needed. It only reads headlines. It never touches your numbers." />
                </p>
                <div style={{ display: "flex", gap: 10, marginTop: 10, alignItems: "center", flexWrap: "wrap" }}>
                  <label style={{ fontSize: "var(--text-sm)", color: "var(--text-secondary)", display: "inline-flex", alignItems: "center", gap: 8 }}>
                    Look back
                    <select className="ms-select" value={windowChoice} onChange={(e) => setWindowChoice(e.target.value)} disabled={busy}
                      style={{ fontSize: "var(--text-sm)", padding: "9px 12px", borderRadius: 10, border: "1px solid var(--border)", background: "var(--card-bg)", color: "var(--text-primary)" }}>
                      {WINDOW_PRESETS.map((w) => <option key={w.value} value={w.value}>{w.label}</option>)}
                      <option value="custom">Custom...</option>
                    </select>
                  </label>
                  {windowChoice === "custom" && (
                    <label style={{ fontSize: "var(--text-sm)", color: "var(--text-secondary)", display: "inline-flex", alignItems: "center", gap: 8 }}>
                      <input type="number" inputMode="numeric" min={limits.min} max={limits.max} step={1} value={customDays}
                        onChange={(e) => setCustomDays(e.target.value)} disabled={busy} aria-label="Number of days to look back"
                        aria-invalid={!daysOk} className="ms-select"
                        style={{ width: 84, fontSize: "var(--text-sm)", padding: "9px 12px", borderRadius: 10, border: `1px solid ${daysOk ? "var(--border)" : "var(--red)"}`, background: "var(--card-bg)", color: "var(--text-primary)" }} />
                      days
                    </label>
                  )}
                  {/* One primary per surface: this leads only while nothing waits for a decision; once a
                      signal is pending, its own Add buffer button is the primary action. */}
                  <Btn primary={shown.every((x) => x.status !== "pending")} disabled={busy || !daysOk} onClick={scan}>
                    {scanning ? "Reading the news..." : "Scan the news"}
                  </Btn>
                </div>
                {windowChoice === "custom" && !daysOk && (
                  <div role="alert" style={{ marginTop: 8, fontSize: "var(--text-xs)", color: "var(--red-text)" }}>
                    Enter a whole number of days from {limits.min} to {limits.max}.
                  </div>
                )}
                {daysOk && days > 14 && !scanning && (
                  <div style={{ marginTop: 8, fontSize: "var(--text-xs)", color: "var(--text-muted)", lineHeight: 1.5, maxWidth: 640 }}>
                    A longer look back finds more headlines, but one scan reads about 16 of them. If some are left over, scan again to read the rest.
                  </div>
                )}
                {scanning && (
                  <div style={{ marginTop: 10 }}>
                    <WorkingNote label="Fetching headlines and reading each one" expectedSeconds={30} />
                  </div>
                )}
              </>
            ) : (
              <>
                <p style={{ fontSize: "var(--text-sm)", color: "var(--text-secondary)", lineHeight: 1.5, maxWidth: 640, margin: 0 }}>
                  Real 2022 to 2024 events, run against today's stock as if they were breaking news. It shows what the advice would have been.
                  <Help label="past events"
                    what="Real supply shocks from 2022 to 2024, like India's rice export ban. We treat one as if it just happened and run it against your stock as it is today."
                    how={"It is a rehearsal, to see how the advice works. It does not mean the event is happening now.\nAdding a buffer from a past event changes your real reorder points, so choose Dismiss if you only want to look."} />
                </p>
                <div style={{ display: "flex", gap: 10, marginTop: 10, alignItems: "center", flexWrap: "wrap" }}>
                  <select aria-label="Choose a past event" className="ms-select" value={pick} onChange={(e) => setPick(e.target.value)} disabled={busy || catalog.length === 0}
                    style={{ flex: "1 1 280px", minWidth: 0, fontSize: "var(--text-sm)", padding: "9px 12px", borderRadius: 10, border: "1px solid var(--border)", background: "var(--card-bg)", color: "var(--text-primary)" }}>
                    <option value="">{catalog.length ? "Choose an event..." : "Every past event is already loaded"}</option>
                    {catalog.map((c) => <option key={c.fixture_id} value={c.fixture_id}>{c.published_at} · {c.headline}</option>)}
                  </select>
                  <Btn primary={shown.every((x) => x.status !== "pending")} disabled={busy || !pick} title={pick ? undefined : "Choose a past event first"}
                    onClick={() => run(async () => { const d = await api.replaySignal(pick); setPick(""); return d; })}>
                    Run this event
                  </Btn>
                </div>
              </>
            )}
          </div>
          {mode === "live" && scanNote && <div style={{ marginTop: 10, fontSize: "var(--text-xs)", color: "var(--text-secondary)", lineHeight: 1.5 }}>{scanNote}</div>}

          {signals.length === 0 ? (
            <div style={{ marginTop: 20, paddingTop: 14, borderTop: "1px solid var(--border)" }}>
              <div style={{ fontSize: "var(--text-sm)", fontWeight: 600 }}>No signals yet. Here is how this works.</div>
              <ol style={{ margin: "8px 0 0", paddingLeft: 20, fontSize: "var(--text-sm)", color: "var(--text-secondary)", lineHeight: 1.6, maxWidth: 640 }}>
                <li><strong>Add a signal.</strong> Scan today's news, or run a past event to see it in a few seconds.</li>
                <li><strong>Read what it means.</strong> Which products it could leave short, and the latest day to order.</li>
                <li><strong>You decide.</strong> Add a safety buffer, or dismiss it. Nothing is ordered for you.</li>
              </ol>
            </div>
          ) : (
            <div style={{ marginTop: 20, paddingTop: 14, borderTop: "1px solid var(--border)", fontSize: "var(--text-xs)", fontWeight: 700, letterSpacing: "0.05em", textTransform: "uppercase", color: "var(--text-muted)" }}>
              {mode === "past" ? "Past events you have run" : "Live news signals"} · {shown.length}
            </div>
          )}
          {signals.length > 0 && shown.length === 0 && (
            <div style={{ marginTop: 10, fontSize: "var(--text-sm)", color: "var(--text-secondary)" }}>
              {mode === "past"
                ? "You have not run a past event yet. Choose one above to see what the advice would have been."
                : "No live signals yet. Scan the news to check today's headlines."}
              {waiting[mode === "past" ? "live" : "past"] > 0 && (
                <> {waiting[mode === "past" ? "live" : "past"]} in {mode === "past" ? "Live news" : "Past events"} still {waiting[mode === "past" ? "live" : "past"] === 1 ? "waits" : "wait"} for your decision.</>
              )}
            </div>
          )}

          {shown.map((s) => (
            <SignalCard key={s.id} s={s} busy={busy} meta={data} onDecide={(id, d) => run(() => api.decideSignal(id, d))} onCorrect={(id, body) => run(() => api.correctSignal(id, body))} />
          ))}

          {data.playbook && (
            <details style={{ marginTop: 16 }}>
              <summary className="ms-summary" style={{ cursor: "pointer", fontSize: "var(--text-sm)", fontWeight: 600, color: "var(--text-secondary)" }}>
                How the days are worked out
              </summary>
              <div style={{ marginTop: 10, overflowX: "auto" }}>
                <p style={{ fontSize: "var(--text-sm)", color: "var(--text-secondary)", margin: "0 0 10px", lineHeight: 1.5, maxWidth: 640 }}>
                  How many days an event costs comes from this fixed table, not from the article or a model. What it does to each
                  product uses the same projection as the rest of the app.
                </p>
                <table style={{ borderCollapse: "collapse", fontSize: "var(--text-sm)" }}>
                  <thead>
                    <tr style={{ textAlign: "left", color: "var(--text-muted)", fontSize: "var(--text-xs)" }}>
                      <th style={{ padding: "6px 16px 6px 0" }}>Event</th><th style={{ padding: "6px 16px" }}>Low</th><th style={{ padding: "6px 16px" }}>Medium</th><th style={{ padding: "6px 16px" }}>High</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(data.playbook).map(([type, row]) => (
                      <tr key={type} style={{ borderTop: "1px solid var(--border)" }}>
                        <td style={{ padding: "7px 16px 7px 0", fontWeight: 600 }}>{EVENT_LABEL[type] || type}</td>
                        {["low", "medium", "high"].map((k) => <td key={k} style={{ padding: "7px 16px" }}>{row[k][0]} to {row[k][1]} days</td>)}
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)", marginTop: 8, lineHeight: 1.5, maxWidth: 640 }}>
                  These are assumptions, sized like the risk events already seeded in the app, not measurements. If a row
                  looks wrong for your business, it is the thing to change.
                </p>
              </div>
            </details>
          )}
        </>
      )}
    </div>
  );
}
