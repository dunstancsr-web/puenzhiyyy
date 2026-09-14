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
  return SCENARIO ? prepareDataFor(SCENARIO) : null;
}

async function prepareDataFor(name) {
  const scenario = SCENARIOS[name];
  if (!scenario) {
    console.error(`Unknown scenario "${name}". Available: ${Object.keys(SCENARIOS).join(", ")}`);
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
// Live in src/llm/semantic.js since TASK-96, shared with the production
// verifier, so a check fixed in one place is fixed in both. Production now
// folds them into runExplanation's own check, so a contradiction here shows up
// as a dangerous issue on the run rather than a separate count.
const { semanticIssues } = require("../src/llm/semantic");

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
// The fields the semantic checks read, kept with each saved answer so a
// re-score does not depend on the database still holding the same values.
const pickSku = (s) => ({
  sku_id: s.sku_id, inventory_position: s.inventory_position, on_hand_qty: s.on_hand_qty,
  available_qty: s.available_qty, max_stock: s.max_stock, reorder_point_policy: s.reorder_point_policy,
  suggested_order_qty: s.suggested_order_qty,
});

async function rescore(file) {
  const { isDangerous } = require("../src/llm/explain");
  const saved = JSON.parse(fs.readFileSync(file, "utf8"));
  // Files saved before TASK-96 kept only sku_id and inventory_position. Fill
  // in the rest from the same scenario's data so the named-figure check has
  // something to compare against. Note the reorder rule changed in TASK-95, so
  // an older REORDER alert's threshold is re-read from today's data too.
  if (saved.runs.some((r) => r.sku.on_hand_qty === undefined || r.sku.suggested_order_qty === undefined)) {
    const data = saved.scenario ? await prepareDataFor(saved.scenario) : null;
    const { getDb } = require("../src/db/init");
    const { buildAnalytics } = require("../src/engines");
    const live = buildAnalytics(getDb()).skus;
    for (const r of saved.runs) {
      const l = live.find((x) => x.sku_id === r.sku.sku_id);
      if (l) r.sku = { ...pickSku(l), ...r.sku, on_hand_qty: l.on_hand_qty, available_qty: l.available_qty, max_stock: l.max_stock, reorder_point_policy: l.reorder_point_policy, suggested_order_qty: l.suggested_order_qty };
    }
    if (data) fs.rmSync(data.tmpDir, { recursive: true, force: true });
  }
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
        const attemptIssues = [];
        try {
          if (LEGACY) {
            const facts = buildFacts(sku, alert);
            const out = await ollama(model, SYSTEM, `Here are the figures for this alert.\n\n${facts}\n\nExplain why this was flagged and what the manager should do.`);
            text = out.text; calls = 1; finalMode = "freetext";
            issues = verifyExplanation(text, facts).issues;
          } else {
            // Records WHY each rejected attempt was rejected, read from the
            // correction the pipeline sends on the next call. Retries are the
            // cost driver on the paid tier, so the reasons are what to fix.
            const out = await runExplanation({ sku, alert, callModel: ({ system, user }) => {
              const m = user.match(/Your previous answer broke the rules: ([\s\S]*?)\.\nWrite it again/);
              if (m) attemptIssues.push(m[1].split(" :: ")[0].slice(0, 160));
              return ollama(model, system, user);
            } });
            text = out.rendered; calls = out.spent.model_calls; finalMode = out.mode;
            issues = out.check.issues;
            if (out.mode === "slots" && out.spent.model_calls === 1) t.firstTry++;
          }
          // An empty answer contains no numbers, so every check above passes
          // it. The first version of this benchmark scored a model 7/7 for
          // returning nothing at all. Liveness before quality.
          if (text.length < 80) issues = [...issues, `empty or truncated response (${text.length} chars)`];
          // Re-applied here for the legacy path, which bypasses the pipeline,
          // and merged without duplicates for the production path, which has
          // already folded them into its own issues.
          sem = [...new Set([...issues.filter((i) => i.startsWith("contradicts the alert")), ...semanticIssues(text, sku, alert)])];
          issues = issues.filter((i) => !i.startsWith("contradicts the alert"));
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
        savedRuns.push({ model, alert, sku: pickSku(sku), finalMode, calls, ms, issues, text, attemptIssues });

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
