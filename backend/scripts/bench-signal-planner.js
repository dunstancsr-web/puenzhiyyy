// Watches the search planner think, on the free local model, across several
// simulated rounds. Not a pass/fail check (test-signal-planner.js is that, on a
// fake model); this is for reading what a REAL model actually proposes and why,
// after any change to the prompt in src/signals/planner.js:
//   node backend/scripts/bench-signal-planner.js
// It never calls a paid tier: planQueries() is only ever given the local tier.
// No network fetch happens here either: the "signals found so far" at each round
// are a fixed script, not a real scan, so this is fast and free to re-run.

const { chat, resolveTier } = require("../src/llm/provider");
const { contextFrom } = require("../src/signals/reader");
const P = require("../src/signals/planner");

const MODEL = process.env.SIGNAL_READER_MODEL || "llama3.1:8b";

const ctx = contextFrom([
  { country_of_origin: "Thailand", supplier: "A" }, { country_of_origin: "Vietnam", supplier: "B" },
  { country_of_origin: "India", supplier: "C" }, { country_of_origin: "Japan", supplier: "D" },
  { country_of_origin: "Philippines", supplier: "E" },
]);

// A scripted scan: what the fixed queries are pretended to have found, one entry
// added per round so the model sees a growing picture, the same shape it would
// see in a real scan via routes/signals.js's recentSignals query.
const SCENARIO = [
  { country_of_origin: "India", event_type: "export_restriction", severity: "high", headline: "India bans exports of non-basmati white rice with immediate effect" },
];

(async () => {
  if (resolveTier("local") !== "local") { console.log("No local model on this machine; nothing to watch."); return; }
  console.log(`model ${MODEL}, up to ${P.MAX_ROUNDS} rounds, seeded with one signal (an India export ban)\n`);

  const asked = [];
  let signalsSoFar = [...SCENARIO];
  for (let round = 1; round <= P.MAX_ROUNDS; round++) {
    const t0 = Date.now();
    const proposed = await P.planQueries(ctx, signalsSoFar, { chatFn: chat, resolveTierFn: resolveTier, model: MODEL }, asked);
    const ms = Date.now() - t0;
    console.log(`round ${round} (${ms}ms):`);
    if (!proposed.length) {
      console.log("  (nothing proposed, the model considers this scan done)\n");
      break;
    }
    for (const { query, reason } of proposed) {
      console.log(`  "${query}"`);
      console.log(`    reason: ${reason}`);
    }
    asked.push(...proposed.map((p) => p.query));
    // Simulate this round finding one more, weaker signal, so round 2+ has
    // something new to react to, the same way a real scan's own reading would.
    signalsSoFar = [...signalsSoFar, { country_of_origin: "Vietnam", event_type: "port_logistics", severity: "low", headline: `A follow-up story found in round ${round}` }];
    console.log();
  }
  console.log(`searches asked across the run: ${asked.length ? asked.join("; ") : "(none)"}`);
})();
