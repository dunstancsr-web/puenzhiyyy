#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// TONE TESTS: does src/llm/tone.js change what it should, and nothing else?
//
// Run from backend/:   node scripts/test-tone.js
//
// Real sentences from the llama3 benchmark on 15 Sep, plus correct sentences
// that must come through unchanged. Run after any edit to tone.js. Exit 1 on a
// failure. No model is called.
// ─────────────────────────────────────────────────────────────────────────────

const { calmTone } = require("../src/llm/tone");

const slots = { time_since_sale: {}, days_of_cover: {}, product: {} };
const ACTION = "Reduce or pause the next order.";

// [alert type, input, expected output, optional recommended action]
const CASES = [
  // urgency removed on non-stockout alerts
  ["IDLE", "It is essential to take swift action to free up this trapped capital and minimize losses.",
    "It is essential to take action to free up this trapped capital and minimize losses."],
  ["AGEING", "Move this stock to customers as soon as possible.", "Move this stock to customers."],
  ["REORDER", "I recommend that the manager takes immediate action by placing an order for 457 MT.",
    "I recommend that the manager takes action by placing an order for 457 MT."],
  ["AGEING", "Its quality is at risk of becoming compromised if we don't move it soon.",
    "Its quality is at risk of becoming compromised if we don't move it."],
  ["REORDER", "We need to consider the implications of not ordering soon.", "We need to consider the implications of not ordering."],
  ["SLOW_MOVING", "We should place an urgent order review with the supplier.", "We should place an order review with the supplier."],
  ["SLOW_MOVING", "Immediately, the manager should reduce the next order.", "The manager should reduce the next order."],
  ["OVERSTOCK", "With stock above the maximum, it's essential to address this issue promptly.",
    "With stock above the maximum, it's essential to address this issue."],
  // leaked placeholder names become words
  ["AGEING", "Move this stock out of the warehouse as quickly as possible by reducing time_since_sale.",
    "Move this stock out of the warehouse by reducing time since sale."],
  // "I recommend that" before the engine's capitalised action
  ["AGEING", "In light of this, I recommend that Escalate to QA and commercial. Move stock before it reaches the holding limit.",
    "Escalate to QA and commercial. Move stock before it reaches the holding limit.",
    "Escalate to QA and commercial. Move stock before it reaches the holding limit."],
  ["STOCKOUT_RISK", "I recommend that Place a replenishment order now (min 20 MT).", "Place a replenishment order now (min 20 MT)."],
  // must NOT change
  ["SLOW_MOVING", "This stock poses a risk to capital, as it is not generating sales quickly enough.", null],
  ["SLOW_MOVING", "Explore suppliers that can deliver products more quickly.", null],
  ["IDLE", "This critical situation means capital is stuck in unsold stock.", null],
  ["REORDER", "Order as soon as the budget allows, within the lead time.", null],
  ["STOCKOUT_RISK", "Place an urgent order immediately, as soon as possible.", null],
  ["AGEING", "Escalate to QA immediately and move stock before the limit.", null, "Escalate to QA immediately and move stock before the limit."],
  ["SLOW_MOVING", "I recommend reviewing the customer base before the next order.", null],
];

let failed = 0;
for (const [type, input, expected, action] of CASES) {
  const want = expected === null ? input : expected;
  const got = calmTone(input, { alert_type: type, recommended_action: action || ACTION }, slots).text;
  const ok = got === want;
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${type.padEnd(13)} ${expected === null ? "(unchanged) " : ""}${got}`);
  if (!ok) console.log(`      expected: ${want}`);
}
// A missing recommended action must not make every sentence look protected.
const bare = calmTone("Take immediate action now.", { alert_type: "IDLE" }, {}).text;
if (bare !== "Take action now.") { failed++; console.log(`FAIL  missing action: ${bare}`); } else console.log("PASS  missing recommended action still calms");

console.log(failed ? `\n${failed} failed` : `\nAll ${CASES.length + 1} passed`);
process.exit(failed ? 1 : 0);
