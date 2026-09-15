#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// DEMO RESET: put the app in the state the demo video needs, and prove it
//
// Run from backend/, with both dev servers running:
//   npm run demo:reset
//
// 1. Refuses to erase paid model calls that may not be in the spend ledger yet,
//    unless you pass --yes (the seed wipes the audit trail they live in).
// 2. Reseeds the demo data.
// 3. Asks the RUNNING servers, not the database, whether each thing the video
//    script depends on is really there: both servers up, the idle Japonica
//    alert for beat 3, and a paid tier that can be unlocked with the demo PIN
//    for beat 4. The beats themselves are defined in the submission tracker,
//    "Demo video script"; this file only checks them.
//
// Prints READY or a list of what to fix. Spends nothing and never calls a model.
// Why it exists, and when to run it: the recording checklist in the submission tracker.
// ─────────────────────────────────────────────────────────────────────────────

const path = require("path");
const { execFileSync } = require("child_process");
try { process.loadEnvFile(path.join(__dirname, "../.env")); } catch (err) { if (err.code !== "ENOENT") throw err; }

const API = process.env.DEMO_API || "http://localhost:4000";
const WEB = process.env.DEMO_WEB || "http://localhost:5173";
const YES = process.argv.includes("--yes");

const problems = [];
const ok = (msg) => console.log(`  ok    ${msg}`);
const bad = (msg, fix) => { console.log(`  FIX   ${msg}`); problems.push(fix || msg); };

async function get(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { status: res.status, json };
}

(async () => {
  // ── 1. Paid calls about to be erased ─────────────────────────────────────
  const { getDb } = require("../src/db/init");
  const { paidSpend } = require("../src/llm/spend");
  const paid = paidSpend(getDb()).calls;
  if (paid.length && !YES) {
    console.log(`This database holds ${paid.length} paid model call record(s). Reseeding erases them.`);
    console.log("Run `node scripts/spend.js`, make sure every row is in the spend ledger, then run again with --yes.");
    process.exit(2);
  }

  // ── 2. Reseed ────────────────────────────────────────────────────────────
  console.log("Reseeding the demo data...");
  execFileSync(process.execPath, [path.join(__dirname, "../src/db/seed.js")], { stdio: ["ignore", "ignore", "inherit"] });
  console.log("Checking what the running app now shows:\n");

  // ── 3. Ask the running servers ───────────────────────────────────────────
  try {
    const h = await get(`${API}/api/health`);
    h.status === 200 ? ok(`backend answering at ${API}`) : bad(`backend returned ${h.status}`, "Restart the backend: npm run dev:backend");
  } catch {
    bad(`backend not reachable at ${API}`, "Start the backend: npm run dev:backend (from the repo root)");
  }
  try {
    const w = await fetch(WEB, { signal: AbortSignal.timeout(5000) });
    w.ok ? ok(`frontend answering at ${WEB}`) : bad(`frontend returned ${w.status}`, "Restart the frontend: npm run dev:frontend");
  } catch {
    bad(`frontend not reachable at ${WEB}`, "Start the frontend: npm run dev:frontend (from the repo root)");
  }

  if (!problems.length) {
    // Beat 3: the idle Japonica alert.
    const alerts = (await get(`${API}/api/alerts`)).json?.data || [];
    const idle = alerts.find((a) => a.alert_type === "IDLE" && a.sku_id === "JP-5KG");
    idle ? ok(`beat 3: idle Japonica alert is showing ("${idle.message}")`)
         : bad("beat 3: the idle Japonica alert is missing", "The seed no longer produces IDLE on JP-5KG: check the seed scenarios in design.md");
    ok(`${alerts.length} alerts in total: ${[...new Set(alerts.map((a) => a.alert_type))].join(", ")}`);

    // Beat 4: a paid tier that can be unlocked.
    const mode = (await get(`${API}/api/llm/mode`)).json?.data;
    const cloud = mode?.modes?.find((m) => m.id === "cloud");
    if (!cloud?.available) {
      bad("beat 4: AWS Bedrock is not available on this server", "Check LLM_GATEWAY_URL and LLM_GATEWAY_API_KEY in backend/.env, then restart the backend");
    } else if (!cloud.requiresPin) {
      bad("beat 4: the running backend has no demo PIN", "Set DEMO_PIN in backend/.env, then restart the backend so it reads the file");
    } else {
      ok("beat 4: AWS Bedrock available, and the running backend has a demo PIN to unlock it");
      const u = cloud.usage;
      if (u && u.usedToday >= u.dailyLimit) bad("beat 4: today's paid call cap is used up", "Wait for tomorrow or raise LLM_DAILY_CALL_LIMIT");
      else if (u) ok(`beat 4: ${u.usedToday} of ${u.dailyLimit} paid calls used today`);
    }
  }

  console.log("");
  if (problems.length) {
    console.log("NOT READY. Fix, then run this again:");
    problems.forEach((p, i) => console.log(`  ${i + 1}. ${p}`));
    process.exit(1);
  }
  console.log("READY. Now follow \"Recording checklist\" in the submission tracker.");
})();
