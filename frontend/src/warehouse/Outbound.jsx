import React, { useState, useEffect, useCallback } from "react";
import { Link } from "react-router-dom";
import {
  ScanLine, PackageCheck, CheckCircle2, AlertTriangle, ClipboardList, ChevronRight,
} from "lucide-react";
import { api } from "../api/inventory";
import Login from "./Login";
import { HandheldHeader, Instruction, Keypad, Fact, HowThisWorks, FloorError, JoinDemo } from "./Handheld";

// ─────────────────────────────────────────────────────────────────────────────
// GOODS OUT: PICKING (mirrors Goods In, TASK-47)
//
// Four steps, one decision each, against an open customer order.
//
//   1  pick the order          which sales order is being loaded
//   2  verify the SKU          scan or key the code, checked against the order
//   3  count it                how many MT actually go on the truck
//   4  confirm                 review, explain any short pick, commit
//
// The asymmetry with receiving is the reason this is its own file rather than a
// mode of Inbound. A delivery can arrive over or under and both are facts. A pick
// cannot exceed the order or the stock physically on hand, so the keypad refuses
// to go past either limit and only a SHORT pick asks for a reason. Confirming
// releases the reservation the order held, which is what lets available stock
// recover instead of reserving tonnes that have already left the building.
// ─────────────────────────────────────────────────────────────────────────────

const STEPS = 4;

const HOW = [
  "Pick the customer order you are loading from the list of open orders.",
  "Scan the SKU code on the pallet, or key it in. The app checks it matches the order.",
  "Count the stock and key in how many MT are leaving.",
  "Check the summary, explain any short pick, and confirm.",
];

// A pick can only be short, never over, so there is a single list. Every option
// is a thing that can be true of a short pick.
const SHORT_REASONS = [
  "Not enough stock on the shelf",
  "Damaged stock set aside",
  "Customer accepted a partial delivery",
  "Counting correction",
];

const fmt = (n) => Number(n).toLocaleString("en-SG", { maximumFractionDigits: 2 });

export default function Outbound() {
  const [operator, setOperator] = useState(null);
  const [step, setStep] = useState(1);

  const [orders, setOrders] = useState(null);
  const [loadError, setLoadError] = useState(null);

  const [order, setOrder] = useState(null);
  const [scan, setScan] = useState("");
  const [qty, setQty] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [needsDemo, setNeedsDemo] = useState(false);
  const [note, setNote] = useState(null);

  const loadOrders = useCallback(() => {
    setLoadError(null);
    api.getOutbound().then(setOrders).catch((e) => setLoadError(e.message));
  }, []);

  useEffect(() => { if (operator) loadOrders(); }, [operator, loadOrders]);

  if (!operator) return <Login purpose="picking" duty="issue" onSignedIn={setOperator} />;

  const reset = () => {
    setOrder(null); setScan(""); setQty(""); setReason(""); setError(null); setNote(null); setStep(1);
    loadOrders();
  };

  const back = () => {
    setError(null);
    if (step === 1) return;
    setStep((s) => s - 1);
  };

  // The most this order can ship: what was asked for, or what is physically
  // there if that is less. Available is not the limit, because this order's own
  // reservation is already inside the gap between the two.
  const ceiling = order ? Math.min(order.ordered_qty, order.on_hand_qty ?? 0) : 0;
  const shortBy = order && qty !== "" ? +(order.ordered_qty - Number(qty)).toFixed(2) : 0;

  const confirm = async () => {
    setBusy(true);
    setError(null);
    setNeedsDemo(false);
    try {
      const out = await api.pickGoods({
        so_number: order.so_number,
        picked_qty: Number(qty),
        operator_id: operator.id,
        short_reason: shortBy > 0 ? reason : undefined,
      });
      setNote(out);
    } catch (e) {
      setError(e.message);
      setNeedsDemo(!!e.needsDemo);
    } finally {
      setBusy(false);
    }
  };

  // ── Done ───────────────────────────────────────────────────────────────────
  if (note) {
    const short = note.short_by > 0;
    return (
      <div className="hh-screen">
        <HandheldHeader title="Goods Out" operator={operator} onSignOut={() => setOperator(null)} />
        <div className="hh-body">
          <div style={{ textAlign: "center", padding: "14px 0 4px" }}>
            <div style={{
              width: 62, height: 62, borderRadius: "50%", background: "var(--green-light)",
              display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 14px",
            }}>
              <CheckCircle2 size={31} color="var(--green)" />
            </div>
            <h2 style={{ fontSize: "var(--text-lg)", fontWeight: 700 }}>Stock dispatched</h2>
            <p style={{ fontSize: "var(--text-sm)", color: "var(--text-secondary)", marginTop: 5 }}>
              It is live in the system now.
            </p>
          </div>

          {/* Styled as the document it stands in for: the delivery note the
              driver signs, the counterpart of the GRN on the receiving side. */}
          <div style={{
            border: "1px solid var(--border)", borderRadius: 14, overflow: "hidden",
            background: "var(--card-bg)",
          }}>
            <div style={{
              padding: "11px 15px", background: "var(--surface-2)",
              borderBottom: "1px solid var(--border)",
              display: "flex", justifyContent: "space-between", alignItems: "center",
            }}>
              <span style={{ fontSize: "var(--text-xs)", fontWeight: 700, letterSpacing: "0.05em", color: "var(--text-muted)" }}>
                DELIVERY NOTE
              </span>
              <span style={{ fontSize: "var(--text-sm)", fontWeight: 700, fontFamily: "monospace" }}>
                {note.movement_no}
              </span>
            </div>
            <div style={{ padding: "10px 15px 14px" }}>
              <Fact label="Customer" value={note.customer} />
              <Fact label="Product" value={note.product_name} />
              <Fact label="Ordered" value={`${fmt(note.ordered_qty)} MT`} />
              <Fact label="Dispatched" value={`${fmt(note.picked_qty)} MT`} strong />
              {short && (
                <Fact label="Short by" value={`${fmt(note.short_by)} MT`} tone="var(--red)" strong />
              )}
              <div style={{ height: 1, background: "var(--border)", margin: "9px 0" }} />
              <Fact label="Stock on hand" value={`${fmt(note.on_hand_before)} to ${fmt(note.on_hand_after)} MT`} strong />
              <Fact label="Available to sell" value={`${fmt(note.available_qty)} MT`} />
              <Fact label="Picked by" value={note.operator} />
            </div>
          </div>

          {short && (
            <div style={{
              background: "var(--yellow-light)", border: "1px solid var(--border)",
              borderRadius: 12, padding: "12px 14px", fontSize: "var(--text-sm)", lineHeight: 1.55,
              display: "flex", gap: 10,
            }}>
              <AlertTriangle size={16} color="var(--yellow)" style={{ flexShrink: 0, marginTop: 2 }} />
              <span>
                The shortfall is on the record against {note.movement_no}. Sales will see it when they
                follow up with {note.customer}.
              </span>
            </div>
          )}

          <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 4 }}>
            <button className="hh-tap hh-tap--primary" onClick={reset}>Pick another order</button>
            <Link to="/" className="hh-tap" style={{
              display: "flex", alignItems: "center", justifyContent: "center", textDecoration: "none",
            }}>
              Done for now
            </Link>
          </div>
        </div>
      </div>
    );
  }

  // ── Step 1: which order ───────────────────────────────────────────────────
  if (step === 1) {
    return (
      <div className="hh-screen">
        <HandheldHeader title="Goods Out" operator={operator} onSignOut={() => setOperator(null)}
          steps={STEPS} step={1} />
        <div className="hh-body">
          <Instruction detail="These are the customer orders still open, earliest due first. Pick the one you are loading.">
            Which order are you picking?
          </Instruction>

          <FloorError message={loadError} />

          {orders === null && !loadError && (
            <div style={{ color: "var(--text-muted)", fontSize: "var(--text-sm)", padding: "20px 0" }}>Loading…</div>
          )}

          {orders && orders.length === 0 && (
            <div style={{ textAlign: "center", padding: "34px 10px", color: "var(--text-secondary)" }}>
              <ClipboardList size={26} color="var(--text-muted)" />
              <div style={{ fontSize: "var(--text-sm)", fontWeight: 600, marginTop: 10, color: "var(--text-primary)" }}>
                Nothing to pick
              </div>
              <div style={{ fontSize: "var(--text-sm)", marginTop: 6, lineHeight: 1.5 }}>
                Every open order has been dispatched. New orders appear here as sales raises them.
              </div>
            </div>
          )}

          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {(orders || []).map((o) => (
              <button key={o.so_number} className="hh-tap"
                onClick={() => { setOrder(o); setScan(""); setError(null); setStep(2); }}
                style={{ padding: "13px 15px", textAlign: "left", display: "flex", alignItems: "center", gap: 12 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ fontFamily: "monospace", fontSize: "var(--text-xs)", color: "var(--text-muted)" }}>
                    {o.so_number}
                  </span>
                  <div style={{ fontSize: "var(--text-sm)", fontWeight: 700, marginTop: 2 }}>{o.product_name}</div>
                  <div style={{ fontSize: "var(--text-xs)", color: "var(--text-secondary)", marginTop: 3, fontWeight: 400 }}>
                    {fmt(o.ordered_qty)} MT · due {o.required_date}
                  </div>
                  <div style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)", marginTop: 2, fontWeight: 400 }}>
                    {o.customer}
                  </div>
                  {/* Said before the operator walks to the shelf, not after. */}
                  {!o.can_fulfil && (
                    <div style={{ fontSize: "var(--text-xs)", color: "var(--red-text)", marginTop: 4, fontWeight: 600 }}>
                      Only {fmt(o.on_hand_qty ?? 0)} MT on hand, this will be a short pick
                    </div>
                  )}
                </div>
                <ChevronRight size={18} color="var(--text-muted)" />
              </button>
            ))}
          </div>

          <HowThisWorks title="Picking an order, start to finish" steps={HOW} />
        </div>
      </div>
    );
  }

  // ── Step 2: verify the SKU ────────────────────────────────────────────────
  if (step === 2) {
    const typed = scan.trim().toUpperCase();
    const matches = typed === order.sku_id;
    const wrong = typed.length > 0 && !matches;

    return (
      <div className="hh-screen">
        <HandheldHeader title="Goods Out" operator={operator} onBack={back}
          onSignOut={() => setOperator(null)} steps={STEPS} step={2} />
        <div className="hh-body">
          <Instruction detail="Scan the code on the pallet label, or key it in. This is the check that stops the right quantity leaving as the wrong product.">
            Confirm what you are holding
          </Instruction>

          <div style={{
            border: "1px solid var(--border)", borderRadius: 14, padding: "13px 15px",
            background: "var(--surface-2)",
          }}>
            <div style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)", marginBottom: 3 }}>
              {order.so_number} for {order.customer} should be
            </div>
            <div style={{ fontSize: "var(--text-base)", fontWeight: 700 }}>{order.product_name}</div>
            <div style={{ fontSize: "var(--text-xs)", color: "var(--text-secondary)", marginTop: 3 }}>
              {order.packaging_size}
            </div>
          </div>

          <div>
            <div style={{
              display: "flex", alignItems: "center", gap: 9,
              border: `1px solid ${wrong ? "var(--red)" : matches ? "var(--green)" : "var(--border)"}`,
              borderRadius: 13, padding: "0 14px", background: "var(--card-bg)",
              transition: "border-color 0.15s ease",
            }}>
              <ScanLine size={19} color={matches ? "var(--green)" : "var(--text-muted)"} />
              <input
                value={scan}
                onChange={(e) => setScan(e.target.value)}
                placeholder="Scan or type the SKU code"
                autoFocus
                autoCapitalize="characters"
                autoCorrect="off"
                spellCheck={false}
                style={{
                  flex: 1, border: "none", outline: "none", background: "transparent",
                  padding: "17px 0", fontSize: "var(--text-base)", fontWeight: 600, letterSpacing: "0.02em",
                  color: "var(--text-primary)", minWidth: 0,
                }}
              />
              {matches && <CheckCircle2 size={19} color="var(--green)" />}
            </div>

            {wrong && (
              <div style={{ fontSize: "var(--text-sm)", color: "var(--red-text)", marginTop: 9, lineHeight: 1.5 }}>
                That code is not {order.sku_id}. If the pallet really is a different product, go back
                and pick the order that matches it.
              </div>
            )}
          </div>

          {/* No scanner here, so tapping the expected code stands in for pulling
              the trigger. Labelled honestly rather than dressed up as a scan. */}
          <button className="hh-tap" onClick={() => setScan(order.sku_id)}
            style={{ fontSize: "var(--text-sm)", fontWeight: 600, color: "var(--text-secondary)" }}>
            No scanner? Tap to enter {order.sku_id}
          </button>

          <div style={{ marginTop: "auto", display: "flex", flexDirection: "column", gap: 10 }}>
            <button className="hh-tap hh-tap--primary" disabled={!matches}
              onClick={() => { setQty(""); setError(null); setStep(3); }}>
              {matches ? "Confirmed, count it" : "Scan to continue"}
            </button>
          </div>

          <HowThisWorks title="Picking an order, start to finish" steps={HOW} />
        </div>
      </div>
    );
  }

  // ── Step 3: count it ──────────────────────────────────────────────────────
  if (step === 3) {
    const entered = qty !== "" && Number(qty) > 0;
    const overOrder = entered && Number(qty) > order.ordered_qty;
    const overStock = entered && Number(qty) > (order.on_hand_qty ?? 0);
    const valid = entered && !overOrder && !overStock;

    return (
      <div className="hh-screen">
        <HandheldHeader title="Goods Out" operator={operator} onBack={back}
          onSignOut={() => setOperator(null)} steps={STEPS} step={3} />
        <div className="hh-body">
          <Instruction detail={`Count what is going on the truck. ${order.customer} ordered ${fmt(order.ordered_qty)} MT, and ${fmt(order.on_hand_qty ?? 0)} MT is on hand.`}>
            How much is leaving?
          </Instruction>

          <Keypad value={qty} onChange={setQty} suffix="MT" max={order.ordered_qty} />

          {/* Unlike receiving, an over pick is refused, so this one is a real
              stop and is worded as a limit rather than as information. */}
          {overOrder && (
            <div style={{
              fontSize: "var(--text-sm)", lineHeight: 1.5, padding: "11px 13px", borderRadius: 12,
              background: "var(--red-light)", border: "1px solid var(--border)",
            }}>
              The order is only for <strong>{fmt(order.ordered_qty)} MT</strong>. You cannot send more than the customer ordered.
            </div>
          )}
          {!overOrder && overStock && (
            <div style={{
              fontSize: "var(--text-sm)", lineHeight: 1.5, padding: "11px 13px", borderRadius: 12,
              background: "var(--red-light)", border: "1px solid var(--border)",
            }}>
              Only <strong>{fmt(order.on_hand_qty ?? 0)} MT</strong> is on hand. You cannot ship what is not there.
            </div>
          )}
          {valid && shortBy > 0 && (
            <div style={{
              fontSize: "var(--text-sm)", lineHeight: 1.5, padding: "11px 13px", borderRadius: 12,
              background: "var(--yellow-light)", border: "1px solid var(--border)",
            }}>
              That is <strong>{fmt(shortBy)} MT short of</strong> the {fmt(order.ordered_qty)} MT ordered.
              You will be asked why on the next screen.
            </div>
          )}
          {valid && shortBy === 0 && (
            <div style={{
              fontSize: "var(--text-sm)", padding: "11px 13px", borderRadius: 12,
              background: "var(--green-light)", border: "1px solid var(--border)",
            }}>
              Matches the order exactly.
            </div>
          )}

          <div style={{ marginTop: "auto", display: "flex", flexDirection: "column", gap: 10 }}>
            <button className="hh-tap hh-tap--primary" disabled={!valid}
              onClick={() => { setReason(""); setError(null); setStep(4); }}>
              Continue
            </button>
            {ceiling < order.ordered_qty && (
              <button className="hh-tap" onClick={() => setQty(String(ceiling))}
                style={{ fontSize: "var(--text-sm)", fontWeight: 600, color: "var(--text-secondary)" }}>
                Pick all that is on hand ({fmt(ceiling)} MT)
              </button>
            )}
          </div>

          <HowThisWorks title="Picking an order, start to finish" steps={HOW} />
        </div>
      </div>
    );
  }

  // ── Step 4: review and confirm ────────────────────────────────────────────
  const needsReason = shortBy > 0;
  const canConfirm = !busy && (!needsReason || reason.trim().length > 0);

  return (
    <div className="hh-screen">
      <HandheldHeader title="Goods Out" operator={operator} onBack={back}
        onSignOut={() => setOperator(null)} steps={STEPS} step={4} />
      <div className="hh-body">
        <Instruction detail="Nothing has changed yet. Confirming updates stock for everyone, immediately.">
          Check this before you confirm
        </Instruction>

        <div style={{ border: "1px solid var(--border)", borderRadius: 14, padding: "6px 15px 12px" }}>
          <Fact label="Order" value={order.so_number} />
          <Fact label="Customer" value={order.customer} />
          <Fact label="Product" value={order.product_name} />
          <Fact label="Ordered" value={`${fmt(order.ordered_qty)} MT`} />
          <Fact label="You counted" value={`${fmt(qty)} MT`} strong />
          {needsReason && (
            <Fact label="Short by" value={`${fmt(shortBy)} MT`} tone="var(--red)" strong />
          )}
          <div style={{ height: 1, background: "var(--border)", margin: "9px 0" }} />
          <Fact label="Stock after" value={`${fmt(order.on_hand_qty - Number(qty))} MT`} strong />
          <Fact label="Picked by" value={operator.name} />
        </div>

        {needsReason && (
          <div>
            <div style={{ fontSize: "var(--text-sm)", fontWeight: 600, marginBottom: 9 }}>
              Why is it short?
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {SHORT_REASONS.map((r) => (
                <button key={r} className="hh-tap" onClick={() => setReason(r)}
                  style={{
                    minHeight: 48, fontSize: "var(--text-sm)", textAlign: "left", padding: "0 14px",
                    borderColor: reason === r ? "var(--blue)" : "var(--border)",
                    background: reason === r ? "var(--blue-light)" : "var(--card-bg)",
                    color: reason === r ? "var(--blue-text)" : "var(--text-primary)",
                  }}>
                  {r}
                </button>
              ))}
            </div>
            <p style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)", marginTop: 9, lineHeight: 1.5 }}>
              This goes on the record against the order, so sales can follow up with the customer.
            </p>
          </div>
        )}

        <FloorError message={error} />
        <JoinDemo show={needsDemo} />

        <div style={{ marginTop: "auto", display: "flex", flexDirection: "column", gap: 10 }}>
          <button className="hh-tap hh-tap--primary" disabled={!canConfirm} onClick={confirm}>
            {busy ? "Recording…" : (
              <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                <PackageCheck size={18} /> Confirm {fmt(qty)} MT dispatched
              </span>
            )}
          </button>
          {needsReason && !reason && (
            <div style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)", textAlign: "center" }}>
              Pick a reason to continue
            </div>
          )}
        </div>

        <HowThisWorks title="Picking an order, start to finish" steps={HOW} />
      </div>
    </div>
  );
}
