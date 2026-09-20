// One row per step an order request has been through (order_request_events), append-only. Shared by the
// Control Tower route that moves a request and the Goods In route that closes it on receipt, so both
// write the timeline the same way.
function addRequestEvent(db, requestId, status, actor, note) {
  db.prepare(`INSERT INTO order_request_events (request_id, status, actor, note) VALUES (?, ?, ?, ?)`)
    .run(requestId, status, actor, note || null);
}

module.exports = { addRequestEvent };
