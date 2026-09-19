import React, { useState, useEffect, useCallback } from "react";
import { ChevronRight, ChevronDown } from "lucide-react";
import { api } from "../api/inventory";

// Requests waiting for the buyer (Reorder Loop step 7, with the timeline).
//
// The office half of the separated duties: what the Control Tower has asked the buyer for,
// and where each request has got to. It follows the usual purchasing flow, kept to the steps
// this app can show honestly: the office raises a request, the buyer acknowledges it and raises
// a purchase order, and the buyer's manager approves or rejects that order. Nothing here changes
// stock; stock moves only when the warehouse receives the delivery (the later step that will
// close a request automatically is in the submission tracker).
//
// There is no login, so in the demo one person plays every role. The card says so, and each step
// names who would do it in a real business. The server fixes the actor from the step itself.
// Hidden entirely when nothing is in progress, so it never adds empty chrome to the page.

const ACTIVE = "open,acknowledged,po_raised";

// What each status means to a reader, and the one step that moves it forward.
const STEP = {
  open:         { state: "Waiting for the buyer",       next: { status: "acknowledged", label: "Buyer acknowledges", who: "buyer" } },
  acknowledged: { state: "Buyer acknowledged",          next: { status: "po_raised", label: "Buyer raises purchase order", who: "buyer" } },
  po_raised:    { state: "Waiting for manager approval", next: { status: "approved", label: "Manager approves", who: "buyer's manager" } },
};

// One line per timeline entry: what happened, in plain words.
const EVENT_TEXT = {
  open: "Request sent to the buyer",
  acknowledged: "Buyer acknowledged the request",
  po_raised: "Buyer raised a purchase order and sent it for approval",
  approved: "Buyer's manager approved the purchase order",
  rejected: "Buyer's manager rejected the purchase order",
  cancelled: "Request cancelled",
};

// SQLite stamps are UTC without a zone; the explicit Z is what makes the local time right
// (the Activity page does the same).
const stamp = (raw) => {
  const d = raw ? new Date(`${String(raw).replace(" ", "T")}Z`) : null;
  return d && !Number.isNaN(d.getTime())
    ? d.toLocaleString("en-SG", { dateStyle: "medium", timeStyle: "short" })
    : "";
};

function Btn({ label, onClick, primary, disabled }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        padding: "5px 11px", borderRadius: 6, fontSize: "var(--text-xs)",
        fontWeight: primary ? 600 : 500,
        border: primary ? "1px solid var(--blue-strong)" : "1px solid var(--border)",
        background: primary ? "var(--blue-strong)" : "transparent",
        color: primary ? "#fff" : "var(--text-primary)",
        cursor: disabled ? "default" : "pointer", opacity: disabled ? 0.6 : 1,
      }}
    >
      {label}
    </button>
  );
}

// refreshKey: the page bumps it after raising a request, so a new one appears without a reload.
export default function OrderRequestsCard({ refreshKey }) {
  const [requests, setRequests] = useState([]);
  const [busyId, setBusyId] = useState(null);
  const [openId, setOpenId] = useState(null);       // whose timeline is expanded
  const [rejectingId, setRejectingId] = useState(null);
  const [rejectNote, setRejectNote] = useState("");
  const [error, setError] = useState(null);

  const load = useCallback(() => {
    api.getOrderRequests({ status: ACTIVE }).then(setRequests).catch(() => setRequests([]));
  }, []);
  useEffect(() => { load(); }, [load, refreshKey]);

  const move = async (id, status, note) => {
    setBusyId(id);
    setError(null);
    try {
      await api.updateOrderRequest(id, status, note);
      setRejectingId(null);
      setRejectNote("");
    } catch (err) {
      // A step that is no longer allowed (someone else moved it first) just refreshes the list.
      setError(err.message || "That step could not be recorded.");
    } finally {
      setBusyId(null);
      load();
    }
  };

  if (requests.length === 0) return null;

  return (
    <div className="card" style={{ padding: "14px 16px", marginBottom: 16 }}>
      <div style={{ fontSize: "var(--text-xs)", fontWeight: 700, letterSpacing: "0.05em", textTransform: "uppercase", color: "var(--text-muted)", marginBottom: 4 }}>
        Requests waiting for the buyer
      </div>
      <div style={{ fontSize: "var(--text-sm)", color: "var(--text-secondary)", marginBottom: 12 }}>
        In this demo you play each role. Every step says who would do it. Stock does not change until the delivery is received.
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        {requests.map((r) => {
          const step = STEP[r.status];
          const expanded = openId === r.id;
          const rejecting = rejectingId === r.id;
          const busy = busyId === r.id;
          return (
            <div key={r.id} style={{ borderTop: "1px solid var(--border)", paddingTop: 12 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: "var(--text-base)", fontWeight: 600 }}>
                    {r.quantity_mt} MT · {r.sku_name || r.sku_id}
                    <span style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)", fontWeight: 500 }}> · {r.request_no}</span>
                  </div>
                  <div style={{ fontSize: "var(--text-sm)", color: "var(--text-secondary)", marginTop: 2 }}>
                    {step ? step.state : r.status}
                    {r.reason ? ` · ${r.reason}` : ""}
                  </div>
                </div>

                {step && !rejecting && (
                  <div style={{ display: "flex", gap: 6, flexShrink: 0, flexWrap: "wrap" }}>
                    <Btn primary disabled={busy} label={busy ? "…" : step.next.label} onClick={() => move(r.id, step.next.status)} />
                    {r.status === "po_raised" && (
                      <Btn label="Reject" onClick={() => { setRejectingId(r.id); setRejectNote(""); }} />
                    )}
                    <Btn label="Cancel request" onClick={() => move(r.id, "cancelled")} />
                  </div>
                )}
              </div>

              {rejecting && (
                <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap", alignItems: "center" }}>
                  <input
                    value={rejectNote}
                    onChange={(e) => setRejectNote(e.target.value)}
                    placeholder="Why is the manager rejecting it?"
                    aria-label="Reason for rejecting"
                    style={{ flex: "1 1 240px", padding: "7px 10px", border: "1px solid var(--border)", borderRadius: "var(--radius)", fontSize: "var(--text-sm)", background: "var(--surface)", color: "var(--text-primary)" }}
                  />
                  <Btn primary disabled={busy || !rejectNote.trim()} label="Confirm rejection" onClick={() => move(r.id, "rejected", rejectNote.trim())} />
                  <Btn label="Back" onClick={() => setRejectingId(null)} />
                </div>
              )}

              <button
                onClick={() => setOpenId(expanded ? null : r.id)}
                aria-expanded={expanded}
                style={{ display: "inline-flex", alignItems: "center", gap: 4, marginTop: 8, padding: 0, background: "none", border: "none", cursor: "pointer", fontSize: "var(--text-xs)", fontWeight: 600, color: "var(--blue-text)" }}
              >
                {expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                Timeline ({r.events.length})
              </button>

              {expanded && (
                <ol style={{ listStyle: "none", margin: "8px 0 0", padding: 0, display: "flex", flexDirection: "column", gap: 6 }}>
                  {r.events.map((e, i) => (
                    <li key={i} style={{ fontSize: "var(--text-sm)", display: "flex", gap: 10, flexWrap: "wrap" }}>
                      <span style={{ color: "var(--text-muted)", minWidth: 140 }}>{stamp(e.created_at)}</span>
                      <span>
                        {EVENT_TEXT[e.status] || e.status}
                        <span style={{ color: "var(--text-muted)" }}> · {e.actor}</span>
                        {e.note && <span style={{ color: "var(--text-secondary)" }}>: {e.note}</span>}
                      </span>
                    </li>
                  ))}
                </ol>
              )}
            </div>
          );
        })}
      </div>

      {error && <div role="alert" style={{ marginTop: 10, fontSize: "var(--text-sm)", color: "var(--red-text)" }}>{error}</div>}
    </div>
  );
}
