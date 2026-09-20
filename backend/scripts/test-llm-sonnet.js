// Checks the model layer against how Claude Sonnet actually behaves, WITHOUT calling it. Nothing here spends
// credit: the wire layer is tested against tiny fake servers standing in for Ollama and the gateway, and the
// three pipelines (Why? on an alert, Action Items, Ask about your data) are fed scripted answers written the
// way Sonnet writes: markdown, backticks, em dashes, bullet glyphs, a lead-in, an answer that stops mid-sentence.
//   node backend/scripts/test-llm-sonnet.js
// Uses a throwaway database, never data/stocksense.db.
//
// Why this exists: llama3 was the only model the pipelines were ever measured on. Sonnet's habits differ, and
// the first paid call is the wrong place to find out. The one real paid check (sonnet-check.js) still runs
// last, once, with Stan's approval; this is everything that can be proven before it.

const assert = require("assert");
const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "stocksense-llm-"));
process.env.DATA_DIR = dir;
process.env.LLM_DAILY_CALL_LIMIT = "6";
execFileSync("node", [path.join(__dirname, "../src/db/seed.js")], { env: { ...process.env }, stdio: "ignore" });

let passed = 0;
const check = async (name, fn) => { await fn(); passed++; console.log("  ok  " + name); };

// A fake endpoint that speaks the Ollama chat shape (which is what the gateway speaks too).
function fakeServer(handler) {
  const seen = [];
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const parsed = body ? JSON.parse(body) : null;
      seen.push({ url: req.url, headers: req.headers, body: parsed });
      handler(req, res, parsed, seen.length);
    });
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve({ server, seen, url: `http://127.0.0.1:${server.address().port}` })));
}
const reply = (res, content, extra = {}) => {
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify({ message: { role: "assistant", content }, prompt_eval_count: 800, eval_count: 190, ...extra }));
};

(async () => {
  // ── Part 1: the wire layer, real provider.js against fake servers ─────────────────────────────────────────
  const gw = await fakeServer((req, res, body, n) => {
    if (body.messages[1].content.includes("FORCE_403") && n === 1) { res.statusCode = 403; return res.end("{}"); }
    if (body.messages[1].content.includes("FORCE_EMPTY")) return reply(res, "   ");
    if (body.messages[1].content.includes("FORCE_500")) { res.statusCode = 500; return res.end("{}"); }
    if (body.messages[1].content.includes("FORCE_LENGTH")) return reply(res, "It stops after", { done_reason: "length" });
    reply(res, "Finished sentence.");
  });
  const local = await fakeServer((req, res) => reply(res, "from the local model", { done_reason: "stop" }));
  process.env.LLM_GATEWAY_URL = gw.url;
  const fakeCredential = `fake-${Date.now().toString(36)}`; // generated per run, never a real value
  process.env.LLM_GATEWAY_API_KEY = fakeCredential;
  process.env.OLLAMA_URL = local.url;
  const provider = require("../src/llm/provider");
  const { chat, LlmUnavailable } = provider;
  const paid = (user) => chat({ system: "s", user, tier: "cloud", timeoutMs: 15_000 });

  console.log("wire layer (fake gateway, fake Ollama)");
  await check("a paid call sends the key, uses the cloud token cap, and reads token usage", async () => {
    const r = await paid("hello");
    assert.strictEqual(r.provider, "gateway");
    assert.strictEqual(r.text, "Finished sentence.");
    assert.deepStrictEqual(r.usage, { input_tokens: 800, output_tokens: 190 });
    assert.strictEqual(gw.seen[0].headers["x-api-key"], fakeCredential);
    assert.strictEqual(gw.seen[0].body.options.num_predict, 420);
    assert.strictEqual(r.truncated, false);
  });
  await check("the local tier keeps its own, smaller cap and never touches the gateway", async () => {
    const before = gw.seen.length;
    const r = await chat({ system: "s", user: "hi", tier: "local" });
    assert.strictEqual(r.provider, "ollama");
    assert.strictEqual(local.seen[0].body.options.num_predict, 280);
    assert.strictEqual(gw.seen.length, before);
  });
  await check("an endpoint that stopped at the token limit is reported as truncated", async () => {
    const r = await paid("FORCE_LENGTH");
    assert.strictEqual(r.truncated, true);
  });
  await check("an empty message and a server error both surface as LlmUnavailable", async () => {
    await assert.rejects(paid("FORCE_EMPTY"), LlmUnavailable);
    await assert.rejects(paid("FORCE_500"), (e) => e instanceof LlmUnavailable && /500/.test(e.message));
  });

  // The cap is 6. Four paid attempts were made above (a success, a truncated reply, an empty one and a 500):
  // every attempt counts, failures included, so two more fit and the next is refused.
  await check("the daily cap counts attempts, and stops a call before it reaches the network", async () => {
    const before = gw.seen.length;
    await paid("fills the 5th");
    await paid("fills the 6th");
    assert.strictEqual(gw.seen.length, before + 2);
    await assert.rejects(paid("over the cap"), (e) => e instanceof LlmUnavailable && /Daily cap of 6/.test(e.message));
    assert.strictEqual(gw.seen.length, before + 2, "the capped call must not reach the gateway");
  });

  await check("a failed answer reaches the screen in plain words, and other messages are left alone", async () => {
    const technical = new LlmUnavailable("The model's answer failed the explanation checks after 3 attempts (wrote figures directly instead of using placeholders: {two_history}{MONTHS}1:)");
    const ask = provider.plainReason(technical, "ask");
    assert.ok(!/placeholder|\{|attempts/.test(ask), ask);
    assert.ok(/TJ-25KG/.test(ask), "it should suggest what to try");
    const why = provider.plainReason(technical, "why");
    assert.ok(!/placeholder|\{|attempts/.test(why) && /unaffected/.test(why), why);
    assert.strictEqual(provider.plainReason(new LlmUnavailable("Daily cap of 6 paid calls reached, so no more credit is spent today.")), "Daily cap of 6 paid calls reached, so no more credit is spent today.");
  });
  await check("a dash bullet run on after a colon goes on its own line; an ordinary dash is left alone", async () => {
    const { cleanFormatting } = require("../src/llm/tone");
    assert.strictEqual(cleanFormatting("It will last: - Current stock: 29 days\n- Demand: 5.58"), "It will last:\n- Current stock: 29 days\n- Demand: 5.58");
    assert.strictEqual(cleanFormatting("A well-known rule - not a bullet."), "A well-known rule - not a bullet.");
  });
  await check("the Settings text names the paid model in words, and the raw id stays for pricing", async () => {
    assert.strictEqual(provider.friendlyModel("global.anthropic.claude-sonnet-4-5-20250929-v1:0"), "Claude Sonnet 4.5");
    assert.strictEqual(provider.friendlyModel("llama3"), "llama3");
    const cloud = provider.listModes({ ok: true, reason: null, pinRequired: false }).find((m) => m.id === "cloud");
    assert.ok(/^Claude Sonnet 4\.5 through the hackathon gateway/.test(cloud.detail), cloud.detail);
    assert.ok(/claude-sonnet-4-5/.test(provider.providerInfo("cloud").model), "the raw id is kept for the audit trail");
  });

  // ── Part 2: the three pipelines with Sonnet-style answers ─────────────────────────────────────────────────
  const scripted = { queue: [], calls: [] };
  provider.chat = async ({ system, user }) => {
    scripted.calls.push({ system, user });
    const next = scripted.queue.shift();
    if (next === undefined) throw new Error("the pipeline made more model calls than the test scripted");
    if (next instanceof Error) throw next;
    const r = typeof next === "string" ? { text: next } : next;
    return { provider: "gateway", model: "claude-sonnet-4-5", usage: { input_tokens: 800, output_tokens: 190 }, truncated: false, ...r };
  };
  const script = (...replies) => { scripted.queue = [...replies]; scripted.calls = []; };

  const { getDb } = require("../src/db/init");
  const { buildAnalytics } = require("../src/engines/index");
  const db = getDb();
  const analytics = buildAnalytics(db);
  const { runExplanation } = require("../src/llm/explain");
  const { buildSlots } = require("../src/llm/slots");
  const sku = analytics.skus.find((s) => s.sku_id === "TJ-25KG");
  const alert = analytics.alerts.find((a) => a.sku_id === "TJ-25KG" && a.alert_type === "STOCKOUT_RISK");
  assert.ok(sku && alert, "the seed should give TJ-25KG a stockout alert");
  const slots = buildSlots(sku, alert);
  for (const k of ["product", "available_stock", "demand_rate"]) assert.ok(slots[k], `slot ${k} should be offered`);

  const CLEAN = "{product} is running low: {available_stock} is on hand and it sells {demand_rate}. Place the replenishment order.";
  const runWhy = () => runExplanation({ sku, alert, callModel: (a) => provider.chat(a) });
  const noMarkup = (t) => { assert.ok(!/\*\*|`|—|–|^\s*[#•]/m.test(t), `markup or dashes survived: ${t.slice(0, 160)}`); };

  console.log("\nWhy? on an alert (runExplanation)");
  await check("a clean answer is accepted on the first attempt", async () => {
    script(CLEAN);
    const out = await runWhy();
    assert.strictEqual(out.attempts, 1);
    assert.strictEqual(out.spent.model_calls, 1);
    noMarkup(out.rendered);
  });
  await check("bold, backticks, an em dash and a bullet glyph are removed, not retried", async () => {
    script("**{product}** is running low — `{available_stock}` is on hand, and it sells {demand_rate}.\n• Place the replenishment order.");
    const out = await runWhy();
    assert.strictEqual(out.attempts, 1, "cleaning must not cost a paid retry");
    noMarkup(out.rendered);
    assert.ok(out.rendered.includes(sku.product_name));
  });
  await check("a unit written after a placeholder (\"{available_stock} MT\") is fixed by rule, not retried and billed again", async () => {
    script("{product} is running low: {available_stock} MT is on hand and it sells {demand_rate} a day. Place the replenishment order.");
    const out = await runWhy();
    assert.strictEqual(out.attempts, 1);
    assert.ok(!/MT MT|MT per day a day/.test(out.rendered), out.rendered);
  });
  await check("\"a A class item\" (the class letter is a value) is corrected to \"an A class item\"", async () => {
    script("{product} is a {value_class} class item and it sells {demand_rate}. Place the replenishment order.");
    const out = await runWhy();
    assert.ok(/ is an A class item/.test(out.rendered), out.rendered);
  });
  await check("a lead-in like \"Here's the explanation:\" is stripped", async () => {
    script("Here's the explanation:\n\n" + CLEAN);
    const out = await runWhy();
    assert.ok(!/here'?s the explanation/i.test(out.rendered));
  });
  await check("an answer that stops mid-sentence is never shown, and the retry is used", async () => {
    script("{product} is running low: {available_stock} is on hand and it sells", CLEAN);
    const out = await runWhy();
    assert.strictEqual(out.attempts, 2);
    assert.strictEqual(out.spent.model_calls, 2, "both calls are counted, because both are billed");
    assert.ok(/replenishment order/i.test(out.rendered));
  });
  await check("the endpoint reporting a token-limit stop counts as cut off even if the text looks finished", async () => {
    script({ text: CLEAN, truncated: true }, CLEAN);
    const out = await runWhy();
    assert.strictEqual(out.attempts, 2);
  });
  await check("cut off every time: no explanation is shown, all three billed calls are recorded", async () => {
    script("It stops here and", "It stops here and", "It stops here and");
    await assert.rejects(runWhy(), (e) => e instanceof LlmUnavailable && e.spent.model_calls === 3);
  });
  await check("a numbered list (digits) is rejected and retried", async () => {
    script("1. {product} is low.\n2. Order more.", CLEAN);
    const out = await runWhy();
    assert.strictEqual(out.attempts, 2);
  });

  const { explainActionItem } = require("../src/llm/explainActionItem");
  const item = { nearest: { days: 12 }, isStockout: true };
  const AI_SLOTS = ["product", "days_left"]; // discovered below rather than assumed
  console.log("\nAction Items Why? (explainActionItem)");
  let actionSlot;
  await check("the slot menu the action item pipeline offers can be read from its own prompt", async () => {
    script("- placeholder probe.");
    await explainActionItem({ kind: "stockout", sku, item: { ...item, nearest: { days: 11 } }, tier: "cloud" }).catch(() => {});
    const menu = scripted.calls[0].user.match(/\{([a-z_]+)\}/g) || [];
    assert.ok(menu.length > 0, "the prompt should list placeholders");
    actionSlot = menu[0];
  });
  const bullets = () => `- ${actionSlot} is what matters here.\n- Decide what to order.`;
  await check("Sonnet's bold, bullet glyphs and dashes come out clean, in one call", async () => {
    script(`**Key point** — ${actionSlot} matters.\n• Decide what to order.`);
    const out = await explainActionItem({ kind: "stockout", sku, item: { ...item, nearest: { days: 12 } }, tier: "cloud" });
    assert.strictEqual(scripted.calls.length, 1);
    noMarkup(out.text);
    assert.ok(out.model.includes("claude"));
  });
  await check("a doubled unit in an action item answer is fixed by rule, in one call", async () => {
    script("- A new order takes {lead_time} days to arrive.\n- Decide what to order.");
    const out = await explainActionItem({ kind: "stockout", sku, item: { ...item, nearest: { days: 14 } }, tier: "cloud" });
    assert.strictEqual(scripted.calls.length, 1);
    assert.ok(out.text.length > 0);
  });
  await check("a repeat of the same question is served from cache with no model call", async () => {
    script();
    const out = await explainActionItem({ kind: "stockout", sku, item: { ...item, nearest: { days: 12 } }, tier: "cloud" });
    assert.strictEqual(out.cached, true);
    assert.strictEqual(scripted.calls.length, 0);
  });
  await check("a cut-off action item answer is retried and the good one shown", async () => {
    script(`- ${actionSlot} is what matters and you should`, bullets());
    const out = await explainActionItem({ kind: "stockout", sku, item: { ...item, nearest: { days: 13 } }, tier: "cloud" });
    assert.strictEqual(scripted.calls.length, 2);
    assert.ok(/Decide what to order/.test(out.text));
  });

  await check("a delivery gap is stated by the system, and a bullet promising new stock arrives in time is removed", async () => {
    // The live answer that prompted this: 45 days to deliver, 28 days of stock, and Sonnet told the manager to order
    // now "so the new stock arrives before you run low".
    script("- Your supplier takes {lead_time} to deliver, so an order now arrives after you run out.\n- Order now so the new stock arrives before you run low.\n- You should order more to avoid running out.\n- Decide what to order.");
    const out = await explainActionItem({ kind: "stockout", sku, item: { ...item, nearest: { days: 16 } }, tier: "cloud" });
    assert.strictEqual(scripted.calls.length, 1);
    assert.ok(/would arrive about \d+ days after it runs out/.test(out.text), out.text);
    assert.ok(!/arrives before you run low|avoid running out/.test(out.text), out.text);
    assert.ok(/arrives after you run out/.test(out.text) && /Decide what to order/.test(out.text), "the true bullets stay: " + out.text);
    assert.ok(/Say nothing about when an order would arrive/.test(scripted.calls[0].user), "the prompt tells the model to leave timing to the system");
  });
  await check("with no delivery gap the same wording is true, so it stays and no gap sentence is added", async () => {
    script("- Order now so the new stock arrives before you run low.\n- Decide what to order.");
    const out = await explainActionItem({ kind: "stockout", sku: { ...sku, lead_time_days: 10 }, item: { ...item, nearest: { days: 61 } }, tier: "cloud" });
    assert.ok(/arrives before you run low/.test(out.text), out.text);
    assert.ok(!/would arrive about/.test(out.text), out.text);
  });

  const { askDatabase } = require("../src/llm/askDatabase");
  const { paidSpend } = require("../src/llm/spend");
  const ask = (q) => askDatabase({ question: q, db, analytics, tier: "cloud" });
  console.log("\nAsk about your data (askDatabase)");
  await check("a tool request wrapped in prose and backticks is found, then a clean answer is returned", async () => {
    script("I'll look that up.\n\n`CALL: sku_facts(TJ-25KG)`", "**Here is what I found:** {one_product} has {one_available} on hand.\n• Lead time is {one_lead_time}.");
    const out = await ask("how is TJ-25KG doing?");
    assert.strictEqual(out.toolCalls.length, 1);
    assert.ok(out.toolCalls[0].ok);
    noMarkup(out.text);
    assert.ok(/Thai Jasmine/.test(out.text));
  });
  await check("a final answer that is cut off is retried, not shown", async () => {
    script("CALL: sku_facts(TJ-25KG)", "{one_product} has {one_available} on hand and the", "{one_product} has {one_available} on hand.");
    const out = await ask("how is TJ-25KG doing?");
    assert.ok(!/and the$/.test(out.text));
  });
  await check("a heading, a blank line and bullets keep their line breaks all the way through (real Sonnet shape)", async () => {
    script("CALL: compare_skus(TJ-25KG, VF-10KG)", "**{one_a_product} vs {one_b_product} Comparison:**\n\n- {one_a_product} is {one_a_health} health.\n\n- {one_b_product} is {one_b_health} health.");
    const out = await ask("compare TJ-25KG and VF-10KG");
    assert.ok(/Comparison:\n\n- Thai Jasmine 25KG is RED health\.\n\n- Vietnam Fragrant 10KG is ORANGE health\./.test(out.text), JSON.stringify(out.text));
  });
  await check("a model narrating its own progress before the answer is not shown that opening paragraph", async () => {
    script("CALL: sku_facts(TJ-25KG)", "Looking at the facts, I have comprehensive data for this product. I can now provide a complete answer.\n\n- {one_product} is {one_health} health.");
    const out = await ask("how is TJ-25KG doing?");
    assert.ok(!/Looking at the facts|I can now provide/.test(out.text), out.text);
    assert.ok(/Thai Jasmine 25KG is RED health/.test(out.text));
  });
  await check("the overstock alert is not offered the value of ALL the stock, which a model reads as the value of the excess", async () => {
    const over = analytics.alerts.find((a) => a.alert_type === "OVERSTOCK");
    const overSku = analytics.skus.find((x) => x.sku_id === over.sku_id);
    assert.ok(!buildSlots(overSku, over).capital_tied_up, "OVERSTOCK must not offer capital_tied_up");
    assert.ok(buildSlots(overSku, over).carrying_cost, "the excess-specific carrying cost stays");
    const slow = analytics.alerts.find((a) => a.alert_type === "SLOW_MOVING");
    assert.ok(buildSlots(analytics.skus.find((x) => x.sku_id === slow.sku_id), slow).capital_tied_up, "SLOW_MOVING keeps it: there it is the right figure");
  });
  await check("an answer given before any lookup is refused (no guessing about a SKU)", async () => {
    script("TJ-25KG does not exist.", "TJ-25KG does not exist.", "TJ-25KG does not exist.");
    await assert.rejects(ask("tell me about TJ-25KG"), LlmUnavailable);
  });
  await check("a paid Ask that fails after billed calls still leaves a row the spend ledger can see", async () => {
    const before = paidSpend(db);
    script("CALL: sku_facts(TJ-25KG)", "cut off and", "cut off and", "cut off and");
    await assert.rejects(ask("how is TJ-25KG doing?"), LlmUnavailable);
    const after = paidSpend(db);
    assert.strictEqual(after.failed, before.failed + 1);
    assert.ok(after.modelCalls >= before.modelCalls + 4, "every billed call in the failed run is counted");
    assert.ok(after.usd > before.usd);
  });

  gw.server.close(); local.server.close();
  fs.rmSync(dir, { recursive: true, force: true });
  console.log(`\n${passed} checks passed`);
})().catch((e) => { console.error(e); process.exit(1); });
