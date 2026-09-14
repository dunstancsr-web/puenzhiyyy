#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// DEPLOYMENT CHECK (TASK-92)
//
// Run:  node backend/scripts/check-deploy.js <url>
//       node backend/scripts/check-deploy.js --image-only
//
// Checks a LIVE deployment the way the GitHub Actions build checked the image,
// plus the things only a real host can show: that it is served over HTTPS,
// that the paid tier is configured and PIN-gated, and that the published image
// can be pulled anonymously (Lightsail cannot pull a private image).
//
// Needs no PIN and no key, and spends no credit. It deliberately never calls
// the model: proving the gateway answers is one click in the browser after
// unlocking, and is left to a person so a script cannot spend by accident.
//
// One side effect, stated rather than hidden: it submits ONE wrong PIN to
// prove the rate limiter is live. That uses one of the five tries for this
// machine's address for the next 15 minutes and writes nothing to the audit
// trail (only lockouts are recorded).
//
// Exit code 0 when every required check passes, 1 otherwise, so it can gate a
// script. Warnings do not fail the run.
// ─────────────────────────────────────────────────────────────────────────────

const IMAGE = "dunstancsr-web/puenzhiyyy";
const SEEDED_VALUE = 3711450;

const args = process.argv.slice(2);
const imageOnly = args.includes("--image-only");
const base = (args.find((a) => !a.startsWith("--")) || "").replace(/\/+$/, "");

let failures = 0;
let warnings = 0;
const pass = (m) => console.log(`  PASS  ${m}`);
const fail = (m) => { console.log(`  FAIL  ${m}`); failures++; };
const warn = (m) => { console.log(`  WARN  ${m}`); warnings++; };

async function get(path, opts = {}) {
  const res = await fetch(base + path, { redirect: "manual", ...opts });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* not JSON, text is still available */ }
  return { status: res.status, text, json };
}

// GHCR serves public images to anonymous clients through a token it issues
// without credentials. A private package refuses the manifest even with that
// token, which is exactly the failure Lightsail would hit.
async function checkImagePublic() {
  console.log("\nPublished image");
  try {
    const tokenRes = await fetch(`https://ghcr.io/token?scope=repository:${IMAGE}:pull&service=ghcr.io`);
    const { token } = await tokenRes.json();
    const res = await fetch(`https://ghcr.io/v2/${IMAGE}/manifests/latest`, {
      method: "HEAD",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.oci.image.index.v1+json, application/vnd.docker.distribution.manifest.v2+json, application/vnd.oci.image.manifest.v1+json",
      },
    });
    if (res.status === 200) pass(`ghcr.io/${IMAGE} can be pulled anonymously (public)`);
    else fail(`ghcr.io/${IMAGE} cannot be pulled anonymously (HTTP ${res.status}). It is still private, so Lightsail will fail to pull it. Make the package public on GitHub first.`);
  } catch (err) {
    fail(`could not reach ghcr.io to check the image: ${err.message}`);
  }
}

async function checkSite() {
  console.log(`\nSite: ${base}`);

  if (base.startsWith("https://")) pass("served over HTTPS");
  else if (/^http:\/\/(localhost|127\.0\.0\.1)/.test(base)) warn("plain http on localhost: fine for testing this script, not for the real deployment");
  else fail("not HTTPS. A Lightsail container service URL is always https://, check the address");

  const health = await get("/api/health");
  if (health.status === 200 && health.json?.status === "ok") pass("/api/health answers ok");
  else return fail(`/api/health returned HTTP ${health.status}. The container is not up; open the Lightsail Logs tab`);

  for (const path of ["/", "/alerts"]) {
    const page = await get(path);
    if (page.status === 200 && page.text.includes('<div id="root">')) pass(`${path} serves the built app`);
    else fail(`${path} returned HTTP ${page.status} without the app shell`);
  }

  const stats = await get("/api/dashboard/stats");
  const value = stats.json?.data?.totalInventoryValue;
  if (value === SEEDED_VALUE) pass(`database seeded (inventory value ${value.toLocaleString("en-SG")})`);
  else if (typeof value === "number") warn(`inventory value is ${value}, not the seeded ${SEEDED_VALUE}. Fine if someone edited stock since the container started`);
  else fail(`/api/dashboard/stats did not return inventory data (HTTP ${stats.status})`);

  const mode = (await get("/api/llm/mode")).json?.data;
  if (!mode) return fail("/api/llm/mode did not answer");
  const tier = (id) => mode.modes.find((m) => m.id === id) || {};
  if (mode.mode === "rules") pass("default explanation tier is rules");
  else fail(`default tier is "${mode.mode}", expected rules. Is NODE_ENV=production set?`);
  if (tier("local").available === false) pass("local model not offered");
  else fail("local model offered on a server. Remove OLLAMA_URL, or check NODE_ENV=production");

  const cloud = tier("cloud");
  if (cloud.available && cloud.requiresPin) {
    pass(`paid tier configured and PIN-gated (${cloud.provider}, cap ${cloud.usage?.dailyLimit ?? "none"} calls/day, ${cloud.usage?.usedToday ?? 0} used)`);
  } else if (!cloud.provider) {
    fail("paid tier has no credentials. Set LLM_GATEWAY_URL and LLM_GATEWAY_API_KEY in the deployment's environment variables");
  } else {
    fail(`paid tier unavailable: ${cloud.detail}`);
  }

  const locked = (await get("/api/alerts/explain", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sku_id: "VF-10KG", alert_type: "OVERSTOCK", tier: "cloud" }),
  })).json?.data;
  if (locked && locked.available === false && locked.locked === true) pass("a paid request without a pass is refused before any model call");
  else fail("a paid request without a pass was NOT refused as locked");

  const wrong = await get("/api/llm/unlock", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pin: "not-the-pin-check-deploy" }),
  });
  if (wrong.status === 401 && /tries? left/.test(wrong.json?.message || "")) pass(`wrong PIN rejected and counted: "${wrong.json.message}"`);
  else if (wrong.status === 429) warn(`this address is currently locked out: "${wrong.json?.message}". The limiter is live; wait 15 min to rerun`);
  else fail(`unexpected answer to a wrong PIN: HTTP ${wrong.status} ${wrong.json?.message || ""}`);
}

(async () => {
  if (!imageOnly && !/^https?:\/\//.test(base)) {
    console.log("Usage: node backend/scripts/check-deploy.js https://<service>.<id>.<region>.cs.amazonlightsail.com");
    console.log("       node backend/scripts/check-deploy.js --image-only");
    process.exit(2);
  }
  await checkImagePublic();
  if (!imageOnly) await checkSite();
  console.log(`\n${failures ? `${failures} FAILED` : "all required checks passed"}${warnings ? `, ${warnings} warning(s)` : ""}`);
  if (!failures && !imageOnly) console.log("Last step, by hand: unlock with the demo PIN in Settings and press Why? on one alert (about USD 0.006).");
  process.exit(failures ? 1 : 0);
})();
