import React, { useEffect, useState } from "react";
import { Newspaper, ExternalLink, History } from "lucide-react";
import { api } from "../api/inventory";

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
      <span style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)", fontWeight: 600 }}>Read as</span>
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
          <summary style={{ cursor: "pointer", fontSize: "var(--text-xs)", color: "var(--text-secondary)", fontWeight: 600 }}>
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
            {affected === 0 && <strong> None of your products are affected.</strong>}
          </span>
        ) : null}
      </div>

      {a.not_affected.length > 0 && (
        <div style={{ marginTop: 6, fontSize: "var(--text-sm)", color: "var(--green-text)", fontWeight: 600 }}>
          Not affected: {a.not_affected.map((n) => `${n.product_name}, ${n.reason}`).join("; ")}
        </div>
      )}

      {affected > 0 && <div style={{ marginTop: 8 }}>{a.exposures.map((e) => <Exposure key={e.sku_id} e={e} />)}</div>}

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

export default function MarketSignals() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [pick, setPick] = useState("");
  const [needsDemo, setNeedsDemo] = useState(false);
  const [scanNote, setScanNote] = useState(null);
  const [scanning, setScanning] = useState(false);

  useEffect(() => {
    api.getMarketSignals().then(setData).catch((e) => setError(e.message));
  }, []);

  const run = async (fn) => {
    setBusy(true); setError(null); setNeedsDemo(false);
    try { setData(await fn()); } catch (e) { setError(e.message); setNeedsDemo(!!e.needsDemo); } finally { setBusy(false); }
  };

  const scan = async () => {
    setBusy(true); setScanning(true); setError(null); setNeedsDemo(false); setScanNote(null);
    try {
      const d = await api.scanSignals();
      setData(d);
      const s = d.scan;
      setScanNote(
        `Checked ${s.fetched} headlines from the last 3 weeks in ${s.seconds} seconds: ${s.added} new, ${s.merged} merged into existing stories, ` +
        `${s.not_relevant} not relevant${s.already_read ? `, ${s.already_read} already read` : ""}` +
        `${s.waiting ? `, ${s.waiting} older ones waiting for the next scan` : ""}. Read by ${s.reader}.`
      );
    } catch (e) { setError(e.message); setNeedsDemo(!!e.needsDemo); } finally { setBusy(false); setScanning(false); }
  };

  const catalog = data?.catalog || [];
  const signals = data?.signals || [];

  return (
    <div className="card" style={{ padding: "18px 20px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <Newspaper size={20} color="var(--blue-strong)" />
        <h2 style={{ fontSize: "var(--text-lg)", fontWeight: 700 }}>Market signals</h2>
      </div>
      <p style={{ fontSize: "var(--text-sm)", color: "var(--text-secondary)", marginTop: 6, lineHeight: 1.55, maxWidth: 760 }}>
        News that could delay or tighten supply, checked against your stock. How many days an event costs comes from a
        fixed table, not from the article or a model, and what it does to each product uses the same projection as the
        rest of the app. Nothing is ordered until you decide.
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
          <div style={{ display: "flex", gap: 10, marginTop: 14, alignItems: "center", flexWrap: "wrap" }}>
            <History size={16} color="var(--text-muted)" />
            <select aria-label="Replay a real past event" className="ms-select" value={pick} onChange={(e) => setPick(e.target.value)} disabled={busy || catalog.length === 0}
              style={{ fontSize: "var(--text-sm)", padding: "9px 12px", borderRadius: 10, border: "1px solid var(--border)", background: "var(--card-bg)", color: "var(--text-primary)", maxWidth: "100%" }}>
              <option value="">{catalog.length ? "Replay a real past event..." : "Every past event is loaded"}</option>
              {catalog.map((c) => <option key={c.fixture_id} value={c.fixture_id}>{c.published_at} · {c.headline}</option>)}
            </select>
            <Btn disabled={busy || !pick} title={pick ? undefined : "Choose a past event first"} onClick={() => run(async () => { const d = await api.replaySignal(pick); setPick(""); return d; })}>
              Load
            </Btn>
            <span style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)" }}>
              Runs a real 2022 to 2024 event against today's stock, as if it were breaking news.
            </span>
          </div>

          <div style={{ display: "flex", gap: 10, marginTop: 10, alignItems: "center", flexWrap: "wrap" }}>
            <Newspaper size={16} color="var(--text-muted)" />
            {/* One primary per surface: Scan leads only while there is nothing waiting for a decision;
                once a signal is pending, its own Add buffer button is the primary action. */}
            <Btn primary={signals.every((x) => x.status !== "pending")} disabled={busy} onClick={scan}>
              {scanning ? "Reading the news..." : "Scan the news now"}
            </Btn>
            <span style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)" }}>
              {scanning ? "Fetching headlines and reading them. This can take about 30 seconds." : "Looks for recent rice supply news about the countries you buy from. Nothing is added to your figures until you accept it."}
            </span>
          </div>
          {scanNote && <div style={{ marginTop: 8, fontSize: "var(--text-xs)", color: "var(--text-secondary)", lineHeight: 1.5 }}>{scanNote}</div>}

          {signals.length === 0 && (
            <div style={{ marginTop: 14, fontSize: "var(--text-sm)", color: "var(--text-secondary)" }}>
              No signals yet. Replay a past event above to see what would have been advised.
            </div>
          )}

          {signals.map((s) => (
            <SignalCard key={s.id} s={s} busy={busy} meta={data} onDecide={(id, d) => run(() => api.decideSignal(id, d))} onCorrect={(id, body) => run(() => api.correctSignal(id, body))} />
          ))}

          {data.playbook && (
            <details style={{ marginTop: 16 }}>
              <summary className="ms-summary" style={{ cursor: "pointer", fontSize: "var(--text-sm)", fontWeight: 600, color: "var(--text-secondary)" }}>
                The table the days come from
              </summary>
              <div style={{ marginTop: 10, overflowX: "auto" }}>
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
