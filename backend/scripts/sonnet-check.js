#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// SONNET CHECK: one paid explanation per alert type, only when asked (TASK-98)
//
// Run from backend/:
//   node scripts/sonnet-check.js                   the plan and estimated cost. No calls.
//   node scripts/sonnet-check.js --dry-run         the exact same run on free local llama3.
//   node scripts/sonnet-check.js --confirm-spend   the real thing, on the paid gateway.
//   add --only REORDER                             one alert type instead of all six.
//   add --features                                 ALSO check Next Steps "Why?" (stockout and blind spot)
//                                                  and two "Ask about your data" questions, through the
//                                  running server's own routes, so the PIN gate and error paths are exercised.
//
// It refuses to touch the paid tier without --confirm-spend, because the key
// draws on the shared AWS credit that also pays for hosting, and Stan decides
// when that is spent (see docs/(Stan) 1 Reference/(Stan) MODEL SPEND.md).
//
// Runs the production path, explainAlert, so the audit trail records every
// call and scripts/spend.js prices it. Uses the database the dev server uses,
// so it explains the alerts currently live there. Prints each explanation,
// what the checks found, and the ledger rows to add.
// ─────────────────────────────────────────────────────────────────────────────

const path = require("path");
try { process.loadEnvFile(path.join(__dirname, "../.env")); } catch (err) { if (err.code !== "ENOENT") throw err; }

const args = process.argv.slice(2);
const CONFIRM = args.includes("--confirm-spend");
const DRY = args.includes("--dry-run");
const onlyIdx = args.indexOf("--only");
const ONLY = onlyIdx >= 0 ? args[onlyIdx + 1] : null;
const FEATURES = args.includes("--features");
const BASE = process.env.CHECK_BASE_URL || "http://localhost:4000";

const { getDb } = require("../src/db/init");
const { buildAnalytics } = require("../src/engines");
const { explainAlert, LlmUnavailable } = require("../src/llm/explain");
const { paidSpend } = require("../src/llm/spend");

// Measured on llama3 after TASK-96: 1.06 model calls per explanation, and one
// Sonnet explanation costs about USD 0.0055 at list price.
const USD_PER_CALL = 0.0055;
const CALLS_PER_EXPLANATION = 1.06;


// Next Steps "Why?" (renamed from Action Items, 23 Sep) and "Ask about your data", through the running server. Going through HTTP on purpose:
// it is the path a visitor takes, so the tier, the PIN gate, the cache and the "never a 500" contract are all
// exercised, which calling the functions directly would skip.
async function checkFeatures(tier, skus) {
  // The paid tier needs the same PIN pass a visitor gets. The PIN comes from this machine's own backend/.env and
  // goes only to the local server; it is never printed or written anywhere. A failed unlock stops the feature
  // checks before any call is made, so a misconfiguration cannot spend anything.
  const headers = { "content-type": "application/json" };
  if (tier === "cloud") {
    const pin = (process.env.DEMO_PIN || "").trim();
    let unlocked = null;
    if (pin) {
      const r = await fetch(BASE + "/api/llm/unlock", { method: "POST", headers, body: JSON.stringify({ pin }) }).catch(() => null);
      unlocked = r && r.ok ? (await r.json()).data?.pass : null;
    }
    if (!unlocked) {
      console.log(`## Next Steps and Ask ... not run: could not unlock the paid tier on ${BASE} (is the server running, and DEMO_PIN set in backend/.env?). Nothing was spent on them.\n`);
      return;
    }
    headers["X-Demo-Unlock"] = unlocked;
  }
  const post = async (route, body) => {
    const res = await fetch(BASE + route, { method: "POST", headers, body: JSON.stringify({ ...body, tier }) });
    return { status: res.status, body: await res.json().catch(() => null) };
  };
  const show = (label, r) => {
    const d = r.body?.data;
    if (d?.available) console.log(`## ${label} ... ${d.provider}${d.cached ? ", cached (no call)" : ""}\n\n${String(d.explanation || d.answer).replace(/^/gm, "   ")}\n`);
    else console.log(`## ${label} ... no usable answer: ${d?.reason || `HTTP ${r.status}`}${d?.locked ? " (PIN pass needed: unlock in Settings, or this server has no pass check)" : ""}\n`);
  };
  for (const kind of ["stockout", "blindspot"]) {
    let done = false;
    for (const s of skus) {
      const r = await post("/api/action-items/explain", { sku_id: s.sku_id, kind });
      if (r.status === 404) continue; // nothing to explain for this SKU
      show(`Next Steps ${kind} ${s.sku_id}`, r);
      done = true;
      break;
    }
    if (!done) console.log(`## Next Steps ${kind} ... no SKU in this database has one, so not checked\n`);
  }
  const ids = skus.map((s) => s.sku_id);
  const questions = [
    `How is ${ids[0]} doing compared with ${ids[1] || ids[0]}?`,
    `What has the recent demand for ${ids[2] || ids[0]} looked like?`,
  ];
  for (const q of questions) show(`Ask: ${q}`, await post("/api/ask-database", { question: q }));
}

(async () => {
  const db = getDb();
  const { skus, alerts } = buildAnalytics(db);
  const order = ["STOCKOUT_RISK", "REORDER", "OVERSTOCK", "IDLE", "SLOW_MOVING", "AGEING"];
  const picked = order
    .filter((t) => !ONLY || t === ONLY)
    .map((t) => alerts.find((a) => a.alert_type === t))
    .filter(Boolean);

  const estimate = picked.length * CALLS_PER_EXPLANATION * USD_PER_CALL;
  console.log(`Alerts to explain (${picked.length}): ${picked.map((a) => `${a.alert_type} ${a.sku_id}`).join(", ")}`);
  const missing = order.filter((t) => (!ONLY || t === ONLY) && !alerts.some((a) => a.alert_type === t));
  if (missing.length) console.log(`Not live in this database, so not checked: ${missing.join(", ")}`);
  console.log(`Estimated paid cost: about USD ${estimate.toFixed(3)} (worst case, every explanation retried twice: USD ${(picked.length * 3 * USD_PER_CALL).toFixed(3)})`);
  if (FEATURES) {
    // Two action item explanations (about one call each) and two Ask questions (a lookup then an answer, up to
    // five calls each in the worst case, each carrying a longer prompt than an alert explanation).
    console.log(`With --features: + 2 Next Steps Why? and 2 Ask questions, about USD 0.05 more (worst case about USD 0.15).`);
  }

  if (!CONFIRM && !DRY) {
    console.log("\nNo calls made. Add --dry-run to rehearse on free llama3, or --confirm-spend to use the paid gateway.");
    return;
  }
  const tier = CONFIRM ? "cloud" : "local";
  console.log(`\nTier: ${tier}${CONFIRM ? " (PAID)" : " (free rehearsal)"}\n`);

  const before = paidSpend(db).calls.length;
  for (const alert of picked) {
    const sku = skus.find((s) => s.sku_id === alert.sku_id);
    process.stdout.write(`## ${alert.alert_type} ${alert.sku_id} ... `);
    try {
      const out = await explainAlert(sku, alert, { tier });
      console.log(`${out.provider}, ${out.mode}${out.cached ? ", cached (no call)" : ""}\n`);
      console.log(out.text.replace(/^/gm, "   ") + "\n");
    } catch (err) {
      if (!(err instanceof LlmUnavailable)) throw err;
      console.log(`no usable answer: ${err.message}\n   (the reader would see the rule-based explanation)\n`);
    }
  }

  if (FEATURES) await checkFeatures(tier, skus);

  if (CONFIRM) {
    const rows = paidSpend(db).calls.slice(before);
    const usd = rows.reduce((a, r) => a + r.usd, 0);
    const calls = rows.reduce((a, r) => a + r.modelCalls, 0);
    console.log(`Paid this run: ${calls} model call(s) over ${rows.length} explanation(s), about USD ${usd.toFixed(4)}.`);
    console.log("Add these to docs/(Stan) 1 Reference/(Stan) MODEL SPEND.md (SGT = UTC + 8):");
    for (const r of rows) console.log(`  ${r.at} UTC | Sonnet check, ${r.sku || "any"} ${r.alert || ""}${r.failed ? " (failed)" : ""} | ${r.modelCalls} | ${r.inputTokens} / ${r.outputTokens} | ${r.usd.toFixed(4)}`);
  }
})();
