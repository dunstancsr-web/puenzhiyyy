#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// MODEL SPEND REPORT (TASK-93)
//
// Run:  node scripts/spend.js          (from backend/)
//
// Lists every paid model call recorded in THIS machine's audit trail and the
// estimated USD it cost. Read-only. See src/llm/spend.js for what the estimate
// can and cannot see, and docs/(Stan) 1 Reference/(Stan) MODEL SPEND.md for the running ledger
// that survives reseeds.
// ─────────────────────────────────────────────────────────────────────────────

const { getDb } = require("../src/db/init");
const { paidSpend } = require("../src/llm/spend");

const s = paidSpend(getDb());

if (!s.calls.length) {
  console.log("No paid model calls in this database's audit trail.");
  process.exit(0);
}

const usd = (n) => `USD ${n.toFixed(4)}`;
console.log("Paid model calls in this database (estimated at list price):\n");
for (const c of s.calls) {
  console.log(
    `  #${String(c.id).padEnd(4)} ${c.at} UTC  ${String(c.sku).padEnd(8)} ${String(c.alert).padEnd(13)}` +
    ` ${c.failed ? "FAILED " : "ok     "} ${c.modelCalls} call(s)  ${String(c.inputTokens).padStart(5)} in / ${String(c.outputTokens).padStart(4)} out  ${usd(c.usd)}` +
    (c.undercount ? "  (logged before TASK-93, may undercount)" : "")
  );
}
console.log(
  `\n  ${s.explanations} explanation(s), ${s.failed} failed, ${s.modelCalls} model call(s), ` +
  `${s.inputTokens} in / ${s.outputTokens} out tokens`
);
console.log(`  Total: ${usd(s.usd)}`);
console.log("\nCopy new rows into docs/(Stan) 1 Reference/(Stan) MODEL SPEND.md before running npm run seed, which erases this trail.");
