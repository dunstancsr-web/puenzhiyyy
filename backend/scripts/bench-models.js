// ─────────────────────────────────────────────────────────────────────────────
// MODEL DRIFT BENCHMARK
//
// Run:  node scripts/bench-models.js [model ...]   (from backend/, API running)
//
// Generates a real explanation for every live alert with every named model, and
// scores each one with the same verifier the app uses in production. The point
// is to choose a local model on measured rule-breaking rather than on
// reputation, because the failure that matters here is specific and testable:
// does it copy the figures it was given, or does it quietly restate them.
//
// Deliberately bypasses the response cache and the tier system, and talks to
// ollama directly, so every model answers the identical prompt from cold.
// ─────────────────────────────────────────────────────────────────────────────

const { buildFacts, verifyExplanation, SYSTEM } = require("../src/llm/explain");

const API = "http://localhost:4000/api";
const OLLAMA = process.env.OLLAMA_URL || "http://localhost:11434";
// --repeat N runs every alert N times per model. One pass over 7 alerts cannot
// separate a 6/7 model from a 5/7 one: that is a single alert of difference,
// and generation is not deterministic even at temperature 0.2. Repeats are the
// difference between a number and a result.
const args = process.argv.slice(2);
const repeatFlag = args.indexOf("--repeat");
const REPEATS = repeatFlag >= 0 ? Number(args[repeatFlag + 1]) || 1 : 1;
const MODELS = args.filter((a, i) => !a.startsWith("--") && i !== repeatFlag + 1);
if (!MODELS.length) MODELS.push("llama3", "llama3.1:8b", "qwen3:8b");

async function generate(model, system, user) {
  const started = Date.now();
  const res = await fetch(`${OLLAMA}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      stream: false,
      think: false,
      options: { temperature: 0.2, num_predict: 280 },
      messages: [{ role: "system", content: system }, { role: "user", content: user }],
    }),
  });
  if (!res.ok) throw new Error(`${model}: HTTP ${res.status}`);
  const body = await res.json();
  return {
    text: (body.message?.content || "").trim(),
    ms: Date.now() - started,
    reason: body.done_reason || "?",
  };
}

// qwen3 and other reasoning models emit a <think> block before the answer. It
// is not part of what a user would see, so scoring it would punish the model
// for figures it worked through and then discarded.
const stripThinking = (s) => s.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();

(async () => {
  const [skus, alerts] = await Promise.all([
    fetch(`${API}/skus`).then((r) => r.json()).then((d) => d.data),
    fetch(`${API}/alerts`).then((r) => r.json()).then((d) => d.data),
  ]);
  console.log(`${alerts.length} live alerts x ${REPEATS} run(s), ${MODELS.length} models\n`);

  const summary = [];
  for (const model of MODELS) {
    let clean = 0, totalMs = 0, failed = 0;
    const allIssues = [];
    console.log(`── ${model} ${"─".repeat(Math.max(0, 58 - model.length))}`);

    const runs = [];
    for (let r = 0; r < REPEATS; r++) for (const a of alerts) runs.push(a);
    for (const alert of runs) {
      const sku = skus.find((s) => s.sku_id === alert.sku_id);
      const facts = buildFacts(sku, alert);
      const user = `Here are the figures for this alert.\n\n${facts}\n\nExplain why this was flagged and what the manager should do.`;
      try {
        const out = await generate(model, SYSTEM, user);
        const text = stripThinking(out.text);

        // An empty answer contains no numbers, so the verifier finds no drift
        // and scores it clean. That is exactly how the first run of this
        // benchmark reported qwen3:8b at 7/7: it had returned nothing at all,
        // every time, and a perfect score for saying nothing went unnoticed.
        // Absence of evidence was being read as evidence of correctness.
        const check = text.length < 80
          ? { ok: false, issues: [`empty or truncated response (${text.length} chars, ${out.reason})`] }
          : verifyExplanation(text, facts);
        totalMs += out.ms;
        if (check.ok) clean++; else allIssues.push(...check.issues);
        if (!check.ok || REPEATS === 1) {
          console.log(
            `  ${check.ok ? "clean" : "DRIFT"}  ${String(out.ms).padStart(6)}ms  ${alert.sku_id.padEnd(9)} ${alert.alert_type.padEnd(14)} ${check.issues.join("; ")}`
          );
        }
      } catch (err) {
        failed++;
        console.log(`  ERROR              ${alert.sku_id.padEnd(9)} ${err.message}`);
      }
    }

    const scored = runs.length - failed;
    summary.push({ model, clean, scored, avgMs: scored ? Math.round(totalMs / scored) : 0, issues: allIssues });
    console.log("");
  }

  console.log("── summary ".padEnd(64, "─"));
  console.log("  model              clean       avg latency");
  for (const s of summary) {
    const pct = s.scored ? Math.round((s.clean / s.scored) * 100) : 0;
    console.log(`  ${s.model.padEnd(18)} ${String(s.clean + "/" + s.scored).padEnd(11)} ${String(s.avgMs + "ms").padEnd(10)} ${pct}%`);
  }

  console.log("\n── most common drift ".padEnd(64, "─"));
  const counts = {};
  for (const s of summary) {
    for (const i of s.issues) {
      const kind = i.split(":")[0].replace(/"[^"]*"/, "...").trim();
      counts[`${s.model} | ${kind}`] = (counts[`${s.model} | ${kind}`] || 0) + 1;
    }
  }
  const rows = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  if (!rows.length) console.log("  none");
  for (const [k, n] of rows) console.log(`  ${String(n).padStart(3)}x  ${k}`);
})();
