#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// SONNET CHECK: one paid explanation per alert type, only when asked (TASK-98)
//
// Run from backend/:
//   node scripts/sonnet-check.js                   the plan and estimated cost. No calls.
//   node scripts/sonnet-check.js --dry-run         the exact same run on free local llama3.
//   node scripts/sonnet-check.js --confirm-spend   the real thing, on the paid gateway.
//   add --only REORDER                             one alert type instead of all six.
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

const { getDb } = require("../src/db/init");
const { buildAnalytics } = require("../src/engines");
const { explainAlert, LlmUnavailable } = require("../src/llm/explain");
const { paidSpend } = require("../src/llm/spend");

// Measured on llama3 after TASK-96: 1.06 model calls per explanation, and one
// Sonnet explanation costs about USD 0.0055 at list price.
const USD_PER_CALL = 0.0055;
const CALLS_PER_EXPLANATION = 1.06;

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

  if (CONFIRM) {
    const rows = paidSpend(db).calls.slice(before);
    const usd = rows.reduce((a, r) => a + r.usd, 0);
    const calls = rows.reduce((a, r) => a + r.modelCalls, 0);
    console.log(`Paid this run: ${calls} model call(s) over ${rows.length} explanation(s), about USD ${usd.toFixed(4)}.`);
    console.log("Add these to docs/(Stan) 1 Reference/(Stan) MODEL SPEND.md (SGT = UTC + 8):");
    for (const r of rows) console.log(`  ${r.at} UTC | Sonnet check, ${r.sku} ${r.alert}${r.failed ? " (failed)" : ""} | ${r.modelCalls} | ${r.inputTokens} / ${r.outputTokens} | ${r.usd.toFixed(4)}`);
  }
})();
