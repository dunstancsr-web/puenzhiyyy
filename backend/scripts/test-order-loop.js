// Walks one order request through the whole loop on a THROWAWAY database and checks the two promises
// the loop makes: an unapproved order never reaches Goods In, and stock rises only at the receipt, which
// also closes the request with no click from the office.
//   node backend/scripts/test-order-loop.js
// Never touches data/stocksense.db: it seeds a temp folder and points the server code at it.

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "stocksense-loop-"));
process.env.DATA_DIR = dir;
execFileSync("node", [path.join(__dirname, "../src/db/seed.js")], { env: { ...process.env, DATA_DIR: dir }, stdio: "ignore" });

const express = require("express");
const { getDb } = require("../src/db/init");
const app = express();
app.use(express.json());
app.use("/api", require("../src/routes/inventory"));
app.use("/api", require("../src/routes/warehouse"));

let passed = 0;
const check = async (name, fn) => { await fn(); passed++; console.log("  ok  " + name); };

(async () => {
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const call = async (method, url, body) => {
    const r = await fetch(base + url, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
    return { status: r.status, body: await r.json() };
  };
  const db = getDb();
  const onHand = (sku) => db.prepare(`SELECT on_hand_qty FROM inventory_positions WHERE sku_id = ?`).get(sku).on_hand_qty;
  const operator = db.prepare(`SELECT id FROM operators WHERE role IN ('receiving','both') AND active = 1`).get().id;
  const SKU = "TJ-25KG";

  console.log("order request to receipt");
  const made = await call("POST", "/order-requests", { sku_id: SKU, quantity: 40, reason: "loop test" });
  const req = made.body.data;
  const poNo = `PO-${req.request_no}`;
  const stockBefore = onHand(SKU);

  await check("before approval there is no purchase order for Goods In", async () => {
    await call("PATCH", `/order-requests/${req.id}`, { status: "acknowledged" });
    await call("PATCH", `/order-requests/${req.id}`, { status: "po_raised" });
    assert.strictEqual(db.prepare(`SELECT COUNT(*) n FROM purchase_orders WHERE po_number = ?`).get(poNo).n, 0);
    const early = await call("POST", "/warehouse/inbound/receive", { po_number: poNo, received_qty: 40, operator_id: operator });
    assert.strictEqual(early.status, 404);
    assert.strictEqual(onHand(SKU), stockBefore);
  });

  await check("approving creates the order, still without moving stock", async () => {
    const ok = await call("PATCH", `/order-requests/${req.id}`, { status: "approved" });
    assert.strictEqual(ok.status, 200);
    const po = db.prepare(`SELECT * FROM purchase_orders WHERE po_number = ?`).get(poNo);
    assert.ok(po && po.status === "open" && po.ordered_qty === 40 && po.sku_id === SKU);
    assert.strictEqual(db.prepare(`SELECT po_number FROM order_requests WHERE id = ?`).get(req.id).po_number, poNo);
    assert.strictEqual(onHand(SKU), stockBefore);
  });

  await check("receiving the order raises stock and closes the request", async () => {
    const got = await call("POST", "/warehouse/inbound/receive", { po_number: poNo, received_qty: 40, operator_id: operator });
    assert.strictEqual(got.status, 201);
    assert.strictEqual(onHand(SKU), stockBefore + 40);
    const row = db.prepare(`SELECT status FROM order_requests WHERE id = ?`).get(req.id);
    assert.strictEqual(row.status, "received");
    const steps = db.prepare(`SELECT status FROM order_request_events WHERE request_id = ? ORDER BY id`).all(req.id).map((e) => e.status);
    assert.deepStrictEqual(steps, ["open", "acknowledged", "po_raised", "approved", "received"]);
  });

  await check("a request that was never approved is untouched by other receipts", async () => {
    const other = (await call("POST", "/order-requests", { sku_id: SKU, quantity: 5 })).body.data;
    const open = db.prepare(`SELECT po_number FROM purchase_orders WHERE status = 'open' LIMIT 1`).get();
    await call("POST", "/warehouse/inbound/receive", { po_number: open.po_number, received_qty: db.prepare(`SELECT ordered_qty q FROM purchase_orders WHERE po_number = ?`).get(open.po_number).q, operator_id: operator });
    assert.strictEqual(db.prepare(`SELECT status FROM order_requests WHERE id = ?`).get(other.id).status, "open");
  });

  server.close();
  fs.rmSync(dir, { recursive: true, force: true });
  console.log(`\n${passed} checks passed`);
})().catch((e) => { console.error(e); process.exit(1); });
