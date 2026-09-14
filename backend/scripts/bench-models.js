// ─────────────────────────────────────────────────────────────────────────────
// MODEL BENCHMARK (TASK-11, rebuilt around the real pipeline in TASK-94)
//
// Run from backend/ (no API server needed, ollama must be running):
//   node scripts/bench-models.js                       llama3, every live alert, once
//   node scripts/bench-models.js llama3 --repeat 4     four passes, the number to trust
//   node scripts/bench-models.js --scenario reorder    adds a REORDER alert, see SCENARIOS
//   node scripts/bench-models.js --legacy              the old free-text-only benchmark
//
// WHAT CHANGED IN TASK-94, AND WHY IT MATTERS. This script used to build its
// own copy of the free-text prompt and score one model call. The app does not
// work that way: it asks for PLACEHOLDERS first, retries, and only falls back
// to free text on the third call. So the old score described a path judges
// almost never see, and its prompt was a copy that could drift from the real
// one. It now runs `runExplanation` from src/llm/explain.js, the exact function
// production runs, with only the model call swapped for a direct ollama call.
//
// WHAT IS MEASURED, per model:
//   first-try    placeholder answer accepted on the first call. The cheapest,
//                best outcome, and the one that keeps paid calls down.
//   final path   slots, freetext fallback, or failed entirely.
//   calls        model calls per explanation. On the paid tier this IS cost.
//   dangerous    a wrong or renamed figure the verifier caught.
//   contradicts  a sentence that is wrong while every figure in it is real,
//                which the verifier cannot see (see semanticIssues below).
//   usable       answered, no dangerous drift, no contradiction.
//
// Free: every call goes to local ollama. Never touches the paid gateway, and
// writes nothing to the database (scenarios run on a temporary copy).
// ─────────────────────────────────────────────────────────────────────────────

const fs = require("fs");
const os = require("os");
const path = require("path");

const args = process.argv.slice(2);
const flagValue = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
// --repeat N runs every alert N times per model. One pass cannot separate a
// 6/7 model from a 5/7 one, and generation is not deterministic even at
// temperature 0.2. Repeats are the difference between a number and a result.
const REPEATS = Number(flagValue("--repeat")) || 1;
const SCENARIO = flagValue("--scenario");
const LEGACY = args.includes("--legacy");
// --only REORDER (or any alert type) narrows a run to one kind of alert, so a
// suspect result can be re-examined without paying for the whole matrix.
const ONLY = flagValue("--only");
// --save FILE keeps every answer; --rescore FILE re-applies the checks to saved
// answers with no model calls. Separating generation from scoring means a fix
// to a CHECK is re-scored in seconds against the identical answers, instead of
// a fresh five minute run whose different answers muddy the comparison.
const SAVE = flagValue("--save");
const RESCORE = flagValue("--rescore");
const valueFlags = new Set(["--repeat", "--scenario", "--only", "--save", "--rescore"]);
const MODELS = args.filter((a, i) => !a.startsWith("--") && !valueFlags.has(args[i - 1]));
if (!MODELS.length) MODELS.push("llama3");

const OLLAMA = process.env.OLLAMA_URL || "http://localhost:11434";

// ── Scenarios ────────────────────────────────────────────────────────────────
// Alert types that the seeded demo data does not currently raise, recreated on
// a temporary COPY of the database so they can be measured without touching
// the real one. Each is a single, documented edit a user could make in the app.
const SCENARIOS = {
  reorder: {
    about: "TW-25KG reservations 30 -> 60 MT: position 230 MT falls to the approved reorder point 250 MT while cover stays above lead time, raising REORDER.",
    apply: (db) => db.prepare("UPDATE inventory_positions SET reserved_qty = 60 WHERE sku_id = 'TW-25KG'").run(),
  },
};

async function prepareData() {
  if (!SCENARIO) return null;
  const scenario = SCENARIOS[SCENARIO];
  if (!scenario) {
    console.error(`Unknown scenario "${SCENARIO}". Available: ${Object.keys(SCENARIOS).join(", ")}`);
    process.exit(2);
  }
  const Database = require("better-sqlite3");
  const sourceDir = process.env.DATA_DIR || path.join(__dirname, "../data");
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "stocksense-bench-"));
  // SQLite's backup API, not a file copy: the live database runs in WAL mode,
  // and copying the main file alone can miss writes still sitting in the log.
  const src = new Database(path.join(sourceDir, "stocksense.db"), { readonly: true });
  await src.backup(path.join(tmpDir, "stocksense.db"));
  src.close();
  const copy = new Database(path.join(tmpDir, "stocksense.db"));
  scenario.apply(copy);
  copy.close();
  // Must be set before any app module is required: db/init.js reads DATA_DIR
  // once, at load time.
  process.env.DATA_DIR = tmpDir;
  return { tmpDir, about: scenario.about };
}

// ── Semantic checks ──────────────────────────────────────────────────────────
// The verifier checks that every FIGURE is real. These catch sentences that are
// wrong although every figure in them is real, the failure class found on
// 14 Sep: "580 MT exceeds the maximum of 400 MT by 220 MT" (all three real,
// arithmetic false), and "290 MT is reaching its maximum capacity" on a
// low-stock alert. They live here, not in the production verifier, until they
// have been measured: a check that rejects good answers costs paid retries.
const LOW_STOCK = new Set(["STOCKOUT_RISK", "REORDER"]);
const HIGH_STOCK = new Set(["OVERSTOCK", "SLOW_MOVING", "IDLE"]);
const mtNumbers = (s) => [...s.matchAll(/(\d[\d,]*(?:\.\d+)?)\s*MT\b/g)].map((m) => Number(m[1].replace(/,/g, "")));

function semanticIssues(text, sku, alert) {
  const issues = [];
  const sentences = text.split(/(?<=[.!?])\s+/);

  // "A exceeds / is below B by C": three quantities in one sentence, joined by
  // "by", must satisfy |A - B| = C.
  //
  // Positional, not "the first three MT figures in the sentence": the two
  // compared quantities must come BEFORE "by" and the difference right AFTER
  // it. The first version flagged a correct sentence, "exceeds the maximum level
  // (400 MT) by 220 MT, with a further 200 MT inbound", by pairing 400 with the
  // unrelated 200 that followed.
  for (const s of sentences) {
    if (!/(exceed|above|over|below|under|short|less than|more than)/i.test(s)) continue;
    const m = s.match(/^(.*)\bby\s+(\d[\d,]*(?:\.\d+)?)\s*MT\b/i);
    if (!m) continue;
    const before = mtNumbers(m[1]);
    const diff = Number(m[2].replace(/,/g, ""));
    if (before.length >= 2) {
      const [a, b] = before.slice(-2);
      if (Math.abs(Math.abs(a - b) - diff) > 0.5) {
        issues.push(`arithmetic does not hold: ${a} vs ${b} "by" ${diff} MT :: ${s.trim()}`);
      }
    }
  }

  // Stock DESCRIBED as full, not the word "maximum" anywhere. A first version
  // matched the bare word and flagged a correct stockout explanation that cited
  // "the maximum stock level policy allows (700 MT)" as a sizing limit.
  const LOW_WORDS = /\b(reach(es|ing)?|near(ing)?|at|above|exceed(s|ing)?|over)\s+(its|the|our|a)?\s*(maximum|max|capacity|ceiling)\b|\btoo much stock\b|\boverstock(ed)?\b|\bexcess stock\b/i;
  const NEGATED = /\b(not|no|never|avoid|stop|pause|halt|suspend|defer|delay|hold off|refrain|instead of|rather than)\b|n't\b/i;
  const ORDER_MORE = /\b(place|placing|raise|initiate)\b[^.]{0,30}\b(order|replenish)|\border more\b|\breorder now\b/i;
  for (const s of sentences) {
    if (LOW_STOCK.has(alert.alert_type) && LOW_WORDS.test(s)) {
      issues.push(`describes a low-stock alert in too-much-stock terms :: ${s.trim()}`);
    }
    // Negation matters: "do not place any new orders" is exactly the right
    // advice on a too-much-stock alert. The first version of this check had no
    // negation handling and flagged it, which made 5 of 8 baseline
    // "contradictions" untrustworthy until they were re-read.
    if (HIGH_STOCK.has(alert.alert_type) && ORDER_MORE.test(s) && !NEGATED.test(s)) {
      issues.push(`suggests ordering more on a too-much-stock alert :: ${s.trim()}`);
    }
  }

  // The threshold a REORDER alert actually fired on is its threshold_value
  // (the SUGGESTED reorder point). Quoting any other "reorder point" figure
  // contradicts the alert card shown beside the summary.
  if (alert.alert_type === "REORDER" && alert.threshold_value != null) {
    // Only a figure ATTACHED to the phrase: "reorder point (250 MT)", "reorder
    // point of 250 MT", "250 MT reorder point". A first version took any MT
    // figure in the same sentence and flagged "an order of ~449 MT ... above
    // the reorder point", where 449 is the order quantity, not the threshold.
    const attached = /reorder (?:point|level|threshold)\s*(?:\(|of|at|is|was|:)?\s*(?:the\s+)?(\d[\d,]*(?:\.\d+)?)\s*MT|(\d[\d,]*(?:\.\d+)?)\s*MT\)?\s*reorder (?:point|level|threshold)/gi;
    for (const s of sentences) {
      for (const m of s.matchAll(attached)) {
        const v = Number((m[1] || m[2]).replace(/,/g, ""));
        if (Math.abs(v - Number(alert.threshold_value)) > 0.5) {
          issues.push(`quotes reorder point ${v} MT, but the alert fired at ${Math.round(alert.threshold_value)} MT :: ${s.trim()}`);
        }
      }
    }
  }
  return issues;
}

// ── Model call ───────────────────────────────────────────────────────────────
async function ollama(model, system, user) {
  const res = await fetch(`${OLLAMA}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model, stream: false, think: false,
      options: { temperature: 0.2, num_predict: 280 },
      messages: [{ role: "system", content: system }, { role: "user", content: user }],
    }),
  });
  if (!res.ok) throw new Error(`${model}: HTTP ${res.status}`);
  const body = await res.json();
  // qwen3 and other reasoning models emit a <think> block before the answer.
  // It is not what a user would see, so it is not scored.
  const text = (body.message?.content || "").replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
  return { text, model, provider: "ollama", usage: { input_tokens: body.prompt_eval_count ?? 0, output_tokens: body.eval_count ?? 0 } };
}

// ── Run ──────────────────────────────────────────────────────────────────────
async function rescore(file) {
  const { isDangerous } = require("../src/llm/explain");
  const saved = JSON.parse(fs.readFileSync(file, "utf8"));
  console.log(`Re-scoring ${saved.runs.length} saved answers from ${file} (no model calls)\n`);
  const t = {};
  for (const r of saved.runs) {
    const m = (t[r.model] ||= { runs: 0, contradicts: 0, dangerous: 0, usable: 0 });
    m.runs++;
    const sem = r.text ? semanticIssues(r.text, r.sku, r.alert) : [];
    const danger = r.finalMode === "failed" || isDangerous(r.issues) || /empty or truncated/.test(r.issues.join(" "));
    if (danger) m.dangerous++;
    if (sem.length) { m.contradicts++; console.log(`  CONTRA ${r.alert.sku_id.padEnd(8)} ${r.alert.alert_type.padEnd(13)} ${sem.map((x) => x.split(" :: ")[0]).join("; ")}`); for (const x of sem) console.log(`         > "${x.split(" :: ")[1]}"`); }
    if (!danger && !sem.length) m.usable++;
  }
  for (const [model, m] of Object.entries(t)) console.log(`\n  ${model}: ${m.runs} runs, ${m.dangerous} dangerous, ${m.contradicts} contradicts, ${Math.round((m.usable / m.runs) * 100)}% usable`);
}

async function main() {
  if (RESCORE) return rescore(RESCORE);
  const data = await prepareData();
  const { getDb } = require("../src/db/init");
  const { buildAnalytics } = require("../src/engines");
  const { runExplanation, buildFacts, verifyExplanation, isDangerous, SYSTEM } = require("../src/llm/explain");

  const all = buildAnalytics(getDb());
  const skus = all.skus;
  const alerts = ONLY ? all.alerts.filter((a) => a.alert_type === ONLY) : all.alerts;
  if (!alerts.length) { console.error(`No live ${ONLY} alerts${SCENARIO ? "" : " (try --scenario)"}.`); process.exit(2); }
  if (data) console.log(`Scenario "${SCENARIO}": ${data.about}\n(temporary copy at ${data.tmpDir}; the real database is untouched)\n`);
  console.log(`${alerts.length} live alerts (${[...new Set(alerts.map((a) => a.alert_type))].join(", ")}) x ${REPEATS} run(s), models: ${MODELS.join(", ")}`);
  console.log(`Path: ${LEGACY ? "LEGACY free text only, one call" : "production pipeline (placeholders, retries, free-text fallback)"}\n`);

  const summary = [];
  const savedRuns = [];
  for (const model of MODELS) {
    console.log(`── ${model} ${"─".repeat(Math.max(0, 58 - model.length))}`);
    const t = { runs: 0, firstTry: 0, slots: 0, freetext: 0, failed: 0, calls: 0, dangerous: 0, contradicts: 0, usable: 0, ms: 0, issues: [] };

    for (let r = 0; r < REPEATS; r++) {
      for (const alert of alerts) {
        const sku = skus.find((s) => s.sku_id === alert.sku_id);
        const started = Date.now();
        t.runs++;
        let text = "", issues = [], sem = [], finalMode = "failed", calls = 0;
        try {
          if (LEGACY) {
            const facts = buildFacts(sku, alert);
            const out = await ollama(model, SYSTEM, `Here are the figures for this alert.\n\n${facts}\n\nExplain why this was flagged and what the manager should do.`);
            text = out.text; calls = 1; finalMode = "freetext";
            issues = verifyExplanation(text, facts).issues;
          } else {
            const out = await runExplanation({ sku, alert, callModel: ({ system, user }) => ollama(model, system, user) });
            text = out.rendered; calls = out.spent.model_calls; finalMode = out.mode;
            issues = out.check.issues;
            if (out.mode === "slots" && out.spent.model_calls === 1) t.firstTry++;
          }
          // An empty answer contains no numbers, so every check above passes
          // it. The first version of this benchmark scored a model 7/7 for
          // returning nothing at all. Liveness before quality.
          if (text.length < 80) issues = [...issues, `empty or truncated response (${text.length} chars)`];
          sem = semanticIssues(text, sku, alert);
        } catch (err) {
          calls = err.spent?.model_calls ?? 0;
          issues = [err.message];
        }

        const ms = Date.now() - started;
        const danger = finalMode === "failed" || isDangerous(issues) || /empty or truncated/.test(issues.join(" "));
        t[finalMode]++; t.calls += calls; t.ms += ms;
        if (danger) t.dangerous++;
        if (sem.length) t.contradicts++;
        if (!danger && !sem.length) t.usable++;
        t.issues.push(...issues, ...sem);
        savedRuns.push({ model, alert, sku: { sku_id: sku.sku_id, inventory_position: sku.inventory_position }, finalMode, calls, ms, issues, text });

        const flag = finalMode === "failed" ? "FAILED" : danger ? "DANGER" : sem.length ? "CONTRA" : issues.length ? "tidy" : "clean";
        if (flag !== "clean" || REPEATS === 1) {
          console.log(`  ${flag.padEnd(6)} ${String(ms).padStart(6)}ms  ${alert.sku_id.padEnd(8)} ${alert.alert_type.padEnd(13)} ${finalMode.padEnd(8)} ${calls} call(s)  ${[...issues, ...sem.map((x) => x.split(" :: ")[0])].join("; ")}`);
          for (const x of sem) console.log(`         > "${(x.split(" :: ")[1] || "").replace(/\s+/g, " ")}"`);
        }
      }
    }
    summary.push({ model, ...t });
    console.log("");
  }

  console.log("── summary ".padEnd(96, "─"));
  console.log("  model          runs  first-try  slots  freetext  failed  calls/expl  dangerous  contradicts  usable   latency");
  for (const s of summary) {
    const pct = (n) => `${Math.round((n / s.runs) * 100)}%`;
    console.log(
      `  ${s.model.padEnd(14)} ${String(s.runs).padEnd(5)} ${pct(s.firstTry).padEnd(10)} ${String(s.slots).padEnd(6)} ${String(s.freetext).padEnd(9)} ${String(s.failed).padEnd(7)} ` +
      `${(s.calls / s.runs).toFixed(2).padEnd(11)} ${String(s.dangerous).padEnd(10)} ${String(s.contradicts).padEnd(12)} ${pct(s.usable).padEnd(8)} ${Math.round(s.ms / s.runs)}ms`
    );
  }

  console.log("\n── most common issues ".padEnd(96, "─"));
  const counts = {};
  for (const s of summary) for (const i of s.issues) {
    const kind = i.split(" :: ")[0].split(":")[0].replace(/"[^"]*"/g, "...").replace(/\d[\d,.]*/g, "N").trim();
    counts[`${s.model} | ${kind}`] = (counts[`${s.model} | ${kind}`] || 0) + 1;
  }
  const rows = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  if (!rows.length) console.log("  none");
  for (const [k, n] of rows.slice(0, 12)) console.log(`  ${String(n).padStart(3)}x  ${k}`);

  if (SAVE) {
    fs.writeFileSync(SAVE, JSON.stringify({ at: new Date().toISOString(), scenario: SCENARIO || null, repeats: REPEATS, legacy: LEGACY, runs: savedRuns }, null, 2));
    console.log(`\nSaved ${savedRuns.length} answers to ${SAVE}. Re-score with --rescore ${SAVE}.`);
  }
  if (data) fs.rmSync(data.tmpDir, { recursive: true, force: true });
}

// Exported so the semantic checks can be tested against known sentences
// without starting a benchmark run.
module.exports = { semanticIssues };
if (require.main === module) main();
