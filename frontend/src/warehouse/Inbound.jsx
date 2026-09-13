import React, { useState, useEffect, useCallback } from "react";
import { Link } from "react-router-dom";
import {
  ScanLine, PackageCheck, CheckCircle2, AlertTriangle, Truck, ChevronRight,
} from "lucide-react";
import { api } from "../api/inventory";
import Login from "./Login";
import { HandheldHeader, Instruction, Keypad, Fact, HowThisWorks, FloorError } from "./Handheld";

// ─────────────────────────────────────────────────────────────────────────────
// GOODS IN: RECEIVING (TASK-47)
//
// Four steps, one decision each, against an expected delivery.
//
//   1  pick the delivery       which purchase order is on the dock
//   2  verify the SKU          scan or key the code, checked against the PO
//   3  count it                how many MT actually arrived
//   4  confirm                 review, explain any variance, commit
//
// Receiving against a purchase order rather than free form is the whole point.
// It gives the system an expected quantity to compare against, which is what
// turns "someone typed a number" into "195 arrived against 200 expected, five
// short, damaged in transit" and closes the PO so the tonnes are not counted
// twice, once on hand and once as expected incoming.
// ─────────────────────────────────────────────────────────────────────────────

const STEPS = 4;

const HOW = [
  "Pick the delivery that is in front of you from the list of what is expected today.",
  "Scan the SKU code on the pallet, or key it in. The app checks it matches the delivery.",
  "Count the stock and key in how many MT actually arrived.",
  "Check the summary, explain any difference from what was expected, and confirm.",
];

// Split by direction. Offering "Over shipped by supplier" as an explanation for
// a SHORT receipt is offering an answer that cannot be true, and a list where
// some options are impossible is a list the operator has to think about.
const SHORT_REASONS = [
  "Damaged in transit",
  "Short shipped by supplier",
  "Partial delivery, balance to follow",
  "Counting correction",
];
const OVER_REASONS = [
  "Over shipped by supplier",
  "Earlier shortfall made up",
  "Counting correction",
];

const fmt = (n) => Number(n).toLocaleString("en-SG", { maximumFractionDigits: 2 });

export default function Inbound() {
  const [operator, setOperator] = useState(null);
  const [step, setStep] = useState(1);

  const [deliveries, setDeliveries] = useState(null);
  const [loadError, setLoadError] = useState(null);

  const [po, setPo] = useState(null);
  const [scan, setScan] = useState("");
  const [qty, setQty] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [receipt, setReceipt] = useState(null);

  const loadDeliveries = useCallback(() => {
    setLoadError(null);
    api.getInbound().then(setDeliveries).catch((e) => setLoadError(e.message));
  }, []);

  useEffect(() => { if (operator) loadDeliveries(); }, [operator, loadDeliveries]);

  if (!operator) return <Login purpose="receiving" onSignedIn={setOperator} />;

  const reset = () => {
    setPo(null); setScan(""); setQty(""); setReason(""); setError(null); setReceipt(null); setStep(1);
    loadDeliveries();
  };

  const back = () => {
    setError(null);
    if (step === 1) return;
    setStep((s) => s - 1);
  };

  const variance = po && qty !== "" ? +(Number(qty) - po.ordered_qty).toFixed(2) : 0;

  const confirm = async () => {
    setBusy(true);
    setError(null);
    try {
      const out = await api.receiveGoods({
        po_number: po.po_number,
        received_qty: Number(qty),
        operator_id: operator.id,
        variance_reason: variance !== 0 ? reason : undefined,
      });
      setReceipt(out);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  // ── Done ───────────────────────────────────────────────────────────────────
  if (receipt) {
    const short = receipt.variance_qty < 0;
    const over = receipt.variance_qty > 0;
    return (
      <div className="hh-screen">
        <HandheldHeader title="Goods In" operator={operator} onSignOut={() => setOperator(null)} />
        <div className="hh-body">
          <div style={{ textAlign: "center", padding: "14px 0 4px" }}>
            <div style={{
              width: 62, height: 62, borderRadius: "50%", background: "var(--green-light)",
              display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 14px",
            }}>
              <CheckCircle2 size={31} color="var(--green)" />
            </div>
            <h2 style={{ fontSize: 21, fontWeight: 700 }}>Stock received</h2>
            <p style={{ fontSize: 14, color: "var(--text-secondary)", marginTop: 5 }}>
              It is live in the system now.
            </p>
          </div>

          {/* Styled as the document it stands in for. A GRN is what the driver
              waits for and what accounts match the invoice against, so giving it
              a number and a face makes the step feel finished. */}
          <div style={{
            border: "1px solid var(--border)", borderRadius: 14, overflow: "hidden",
            background: "var(--card-bg)",
          }}>
            <div style={{
              padding: "11px 15px", background: "var(--surface-2)",
              borderBottom: "1px solid var(--border)",
              display: "flex", justifyContent: "space-between", alignItems: "center",
            }}>
              <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.05em", color: "var(--text-muted)" }}>
                GOODS RECEIVED NOTE
              </span>
              <span style={{ fontSize: 14, fontWeight: 700, fontFamily: "monospace" }}>
                {receipt.movement_no}
              </span>
            </div>
            <div style={{ padding: "10px 15px 14px" }}>
              <Fact label="Product" value={receipt.product_name} />
              <Fact label="Expected" value={`${fmt(receipt.expected_qty)} MT`} />
              <Fact label="Received" value={`${fmt(receipt.received_qty)} MT`} strong />
              {receipt.variance_qty !== 0 && (
                <Fact
                  label={short ? "Short by" : "Over by"}
                  value={`${fmt(Math.abs(receipt.variance_qty))} MT`}
                  tone={short ? "var(--red)" : "var(--purple)"}
                  strong
                />
              )}
              <div style={{ height: 1, background: "var(--border)", margin: "9px 0" }} />
              <Fact label="Stock on hand" value={`${fmt(receipt.on_hand_before)} to ${fmt(receipt.on_hand_after)} MT`} strong />
              <Fact label="Available to sell" value={`${fmt(receipt.available_qty)} MT`} />
              <Fact label="Received by" value={receipt.operator} />
            </div>
          </div>

          {(short || over) && (
            <div style={{
              background: "var(--yellow-light)", border: "1px solid var(--border)",
              borderRadius: 12, padding: "12px 14px", fontSize: 13.5, lineHeight: 1.55,
              display: "flex", gap: 10,
            }}>
              <AlertTriangle size={16} color="var(--yellow)" style={{ flexShrink: 0, marginTop: 2 }} />
              <span>
                The variance is on the record against {receipt.movement_no}. Purchasing will see it
                when they reconcile this delivery against the supplier invoice.
              </span>
            </div>
          )}

          <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 4 }}>
            <button className="hh-tap hh-tap--primary" onClick={reset}>Receive another delivery</button>
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

  // ── Step 1: which delivery ────────────────────────────────────────────────
  if (step === 1) {
    return (
      <div className="hh-screen">
        <HandheldHeader title="Goods In" operator={operator} onSignOut={() => setOperator(null)}
          steps={STEPS} step={1} />
        <div className="hh-body">
          <Instruction detail="These are the purchase orders still open. Pick the one whose pallets are on the dock.">
            Which delivery has arrived?
          </Instruction>

          <FloorError message={loadError} />

          {deliveries === null && !loadError && (
            <div style={{ color: "var(--text-muted)", fontSize: 14, padding: "20px 0" }}>Loading…</div>
          )}

          {deliveries && deliveries.length === 0 && (
            <div style={{ textAlign: "center", padding: "34px 10px", color: "var(--text-secondary)" }}>
              <Truck size={26} color="var(--text-muted)" />
              <div style={{ fontSize: 15, fontWeight: 600, marginTop: 10, color: "var(--text-primary)" }}>
                Nothing is expected
              </div>
              <div style={{ fontSize: 13.5, marginTop: 6, lineHeight: 1.5 }}>
                Every open purchase order has been received. If a delivery turns up anyway, purchasing
                needs to raise a PO before it can be booked in.
              </div>
            </div>
          )}

          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {(deliveries || []).map((d) => (
              <button key={d.po_number} className="hh-tap"
                onClick={() => { setPo(d); setScan(""); setError(null); setStep(2); }}
                style={{ padding: "13px 15px", textAlign: "left", display: "flex", alignItems: "center", gap: 12 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                    <span style={{ fontFamily: "monospace", fontSize: 13, color: "var(--text-muted)" }}>
                      {d.po_number}
                    </span>
                  </div>
                  <div style={{ fontSize: 15.5, fontWeight: 700, marginTop: 2 }}>{d.product_name}</div>
                  <div style={{ fontSize: 13, color: "var(--text-secondary)", marginTop: 3, fontWeight: 400 }}>
                    {fmt(d.ordered_qty)} MT expected · due {d.eta}
                  </div>
                  <div style={{ fontSize: 12.5, color: "var(--text-muted)", marginTop: 2, fontWeight: 400 }}>
                    {d.supplier}
                  </div>
                </div>
                <ChevronRight size={18} color="var(--text-muted)" />
              </button>
            ))}
          </div>

          <HowThisWorks title="Receiving a delivery, start to finish" steps={HOW} />
        </div>
      </div>
    );
  }

  // ── Step 2: verify the SKU ────────────────────────────────────────────────
  if (step === 2) {
    const typed = scan.trim().toUpperCase();
    const matches = typed === po.sku_id;
    const wrong = typed.length > 0 && !matches;

    return (
      <div className="hh-screen">
        <HandheldHeader title="Goods In" operator={operator} onBack={back}
          onSignOut={() => setOperator(null)} steps={STEPS} step={2} />
        <div className="hh-body">
          <Instruction detail="Scan the code on the pallet label, or key it in. This is the check that stops the right quantity being booked against the wrong product.">
            Confirm what you are holding
          </Instruction>

          <div style={{
            border: "1px solid var(--border)", borderRadius: 14, padding: "13px 15px",
            background: "var(--surface-2)",
          }}>
            <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 3 }}>
              {po.po_number} should be
            </div>
            <div style={{ fontSize: 16, fontWeight: 700 }}>{po.product_name}</div>
            <div style={{ fontSize: 13, color: "var(--text-secondary)", marginTop: 3 }}>
              {po.rice_variety} · {po.packaging_size} · {po.country_of_origin}
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
                  padding: "17px 0", fontSize: 17, fontWeight: 600, letterSpacing: "0.02em",
                  color: "var(--text-primary)", minWidth: 0,
                  // Deliberately NOT textTransform: uppercase. That styles the
                  // placeholder as well, so the hint shouted "SCAN OR TYPE THE
                  // SKU CODE" at the operator. The value is uppercased on
                  // comparison instead, which is where it actually matters.
                }}
              />
              {matches && <CheckCircle2 size={19} color="var(--green)" />}
            </div>

            {wrong && (
              <div style={{ fontSize: 13.5, color: "var(--red)", marginTop: 9, lineHeight: 1.5 }}>
                That code is not {po.sku_id}. If the pallet really is a different product, go back and
                pick the delivery that matches it.
              </div>
            )}
          </div>

          {/* A real scanner emits the code as keystrokes. There is no scanner
              here, so tapping the expected code stands in for pulling the
              trigger. Labelled honestly rather than dressed up as a scan. */}
          <button className="hh-tap" onClick={() => setScan(po.sku_id)}
            style={{ fontSize: 14, fontWeight: 600, color: "var(--text-secondary)" }}>
            No scanner? Tap to enter {po.sku_id}
          </button>

          <div style={{ marginTop: "auto", display: "flex", flexDirection: "column", gap: 10 }}>
            <button className="hh-tap hh-tap--primary" disabled={!matches}
              onClick={() => { setQty(""); setError(null); setStep(3); }}>
              {matches ? "Confirmed, count it" : "Scan to continue"}
            </button>
          </div>

          <HowThisWorks title="Receiving a delivery, start to finish" steps={HOW} />
        </div>
      </div>
    );
  }

  // ── Step 3: count it ──────────────────────────────────────────────────────
  if (step === 3) {
    const entered = qty !== "" && Number(qty) >= 0;
    return (
      <div className="hh-screen">
        <HandheldHeader title="Goods In" operator={operator} onBack={back}
          onSignOut={() => setOperator(null)} steps={STEPS} step={3} />
        <div className="hh-body">
          <Instruction detail={`Count what is physically there, not what the paperwork says. ${po.product_name} was ordered as ${fmt(po.ordered_qty)} MT.`}>
            How much actually arrived?
          </Instruction>

          <Keypad value={qty} onChange={setQty} suffix="MT" max={po.ordered_qty} />

          {/* Live feedback, framed as information rather than as an error. A
              short delivery is a fact about the world, not a mistake by the
              person counting it. */}
          {entered && variance !== 0 && (
            <div style={{
              fontSize: 13.5, lineHeight: 1.5, padding: "11px 13px", borderRadius: 12,
              background: "var(--yellow-light)", border: "1px solid var(--border)",
            }}>
              That is <strong>{fmt(Math.abs(variance))} MT {variance < 0 ? "short of" : "more than"}</strong>{" "}
              the {fmt(po.ordered_qty)} MT expected. You will be asked why on the next screen.
            </div>
          )}
          {entered && variance === 0 && (
            <div style={{
              fontSize: 13.5, padding: "11px 13px", borderRadius: 12,
              background: "var(--green-light)", border: "1px solid var(--border)",
            }}>
              Matches the expected quantity exactly.
            </div>
          )}

          <div style={{ marginTop: "auto", display: "flex", flexDirection: "column", gap: 10 }}>
            <button className="hh-tap hh-tap--primary" disabled={!entered}
              onClick={() => { setReason(""); setError(null); setStep(4); }}>
              Continue
            </button>
          </div>

          <HowThisWorks title="Receiving a delivery, start to finish" steps={HOW} />
        </div>
      </div>
    );
  }

  // ── Step 4: review and confirm ────────────────────────────────────────────
  const needsReason = variance !== 0;
  const canConfirm = !busy && (!needsReason || reason.trim().length > 0);

  return (
    <div className="hh-screen">
      <HandheldHeader title="Goods In" operator={operator} onBack={back}
        onSignOut={() => setOperator(null)} steps={STEPS} step={4} />
      <div className="hh-body">
        <Instruction detail="Nothing has changed yet. Confirming updates stock for everyone, immediately.">
          Check this before you confirm
        </Instruction>

        <div style={{ border: "1px solid var(--border)", borderRadius: 14, padding: "6px 15px 12px" }}>
          <Fact label="Delivery" value={po.po_number} />
          <Fact label="Product" value={po.product_name} />
          <Fact label="Expected" value={`${fmt(po.ordered_qty)} MT`} />
          <Fact label="You counted" value={`${fmt(qty)} MT`} strong />
          {needsReason && (
            <Fact
              label={variance < 0 ? "Short by" : "Over by"}
              value={`${fmt(Math.abs(variance))} MT`}
              tone={variance < 0 ? "var(--red)" : "var(--purple)"}
              strong
            />
          )}
          <div style={{ height: 1, background: "var(--border)", margin: "9px 0" }} />
          <Fact label="Stock after" value={`${fmt(po.on_hand_qty + Number(qty))} MT`} strong />
          <Fact label="Received by" value={operator.name} />
        </div>

        {needsReason && (
          <div>
            <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 9 }}>
              Why is it {variance < 0 ? "short" : "over"}?
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {(variance < 0 ? SHORT_REASONS : OVER_REASONS).map((r) => (
                <button key={r} className="hh-tap" onClick={() => setReason(r)}
                  style={{
                    minHeight: 48, fontSize: 14, textAlign: "left", padding: "0 14px",
                    borderColor: reason === r ? "var(--blue)" : "var(--border)",
                    background: reason === r ? "var(--blue-light)" : "var(--card-bg)",
                    color: reason === r ? "var(--blue)" : "var(--text-primary)",
                  }}>
                  {r}
                </button>
              ))}
            </div>
            <p style={{ fontSize: 12.5, color: "var(--text-muted)", marginTop: 9, lineHeight: 1.5 }}>
              This goes on the record against the delivery, so purchasing can settle it with the supplier.
            </p>
          </div>
        )}

        <FloorError message={error} />

        <div style={{ marginTop: "auto", display: "flex", flexDirection: "column", gap: 10 }}>
          <button className="hh-tap hh-tap--primary" disabled={!canConfirm} onClick={confirm}>
            {busy ? "Recording…" : (
              <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                <PackageCheck size={18} /> Confirm {fmt(qty)} MT received
              </span>
            )}
          </button>
          {needsReason && !reason && (
            <div style={{ fontSize: 12.5, color: "var(--text-muted)", textAlign: "center" }}>
              Pick a reason to continue
            </div>
          )}
        </div>

        <HowThisWorks title="Receiving a delivery, start to finish" steps={HOW} />
      </div>
    </div>
  );
}
