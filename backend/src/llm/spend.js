// ─────────────────────────────────────────────────────────────────────────────
// MODEL SPEND, COUNTED FROM THE AUDIT TRAIL (TASK-93)
//
// Every paid explanation writes an LLM_CALL row with its token totals, failed
// attempts included (see `spent` in explain.js). This turns those rows into an
// estimated USD figure, so the team can see what the shared credit has cost.
//
// One implementation, used by both scripts/spend.js and the seed. The seed
// wipes audit_log, which would silently erase the only record of spend, so it
// reports what it is about to erase first. Two separate calculations of the
// same figure is how this repo has been bitten before.
//
// ESTIMATE, NOT AN INVOICE. Prices are Anthropic's published list prices for
// the models used, checked 15 Sep 2026 (Sonnet 4.5 USD 3 in / 15 out per
// million tokens, Haiku 4.5 USD 1 / 5). The gateway's model id starts with
// "global.", and Bedrock's GLOBAL endpoints are standard price; regional ones
// carry a 10% premium, which would not apply here. Two things this cannot see:
//   - the organizers' gateway may bill at a different rate than list price, and
//   - calls made from another machine, or on the deployed server, are in THAT
//     database's audit trail, not this one.
// The authoritative number is whatever the organizers report for the team key.
// ─────────────────────────────────────────────────────────────────────────────

// USD per million tokens, [input, output].
const PRICES = {
  "claude-sonnet-4-5": [3, 15],
  "claude-haiku-4-5": [1, 5],
};

function priceFor(model = "") {
  const m = String(model).toLowerCase();
  if (m.includes("haiku")) return { key: "claude-haiku-4-5", rates: PRICES["claude-haiku-4-5"] };
  // Sonnet is the gateway's model and the more expensive of the two, so an
  // unrecognised paid model is priced as Sonnet: over-estimating is the safe
  // direction for a budget.
  return { key: "claude-sonnet-4-5", rates: PRICES["claude-sonnet-4-5"] };
}

const PAID_PROVIDERS = new Set(["gateway", "anthropic"]);

/**
 * @param {import("better-sqlite3").Database} db
 * @returns {{ calls: Array, explanations: number, failed: number, modelCalls: number,
 *             inputTokens: number, outputTokens: number, usd: number }}
 */
function paidSpend(db) {
  const rows = db.prepare(
    `SELECT id, sku_id, created_at, input_data, output_data
       FROM audit_log WHERE event_type = 'LLM_CALL' ORDER BY id`
  ).all();

  const calls = [];
  for (const r of rows) {
    let input, output;
    try { input = JSON.parse(r.input_data || "{}"); output = JSON.parse(r.output_data || "{}"); }
    catch { continue; }
    if (!PAID_PROVIDERS.has(input.provider)) continue;

    const inTok = Number(output.input_tokens) || 0;
    const outTok = Number(output.output_tokens) || 0;
    const { rates } = priceFor(input.model);
    calls.push({
      id: r.id,
      at: r.created_at,
      sku: r.sku_id,
      alert: input.alert_type,
      provider: input.provider,
      model: input.model,
      failed: !!output.failed,
      // Rows written before TASK-93 have no model_calls and logged only the
      // final attempt. Every such row in this repo had attempts: 1, so their
      // figures are complete, but a pre-TASK-93 row with more attempts would
      // be an undercount and is flagged rather than silently trusted.
      modelCalls: Number(output.model_calls) || Number(output.attempts) || 1,
      undercount: output.model_calls == null && Number(output.attempts) > 1,
      inputTokens: inTok,
      outputTokens: outTok,
      usd: (inTok * rates[0] + outTok * rates[1]) / 1e6,
    });
  }

  const sum = (k) => calls.reduce((a, c) => a + c[k], 0);
  return {
    calls,
    explanations: calls.filter((c) => !c.failed).length,
    failed: calls.filter((c) => c.failed).length,
    modelCalls: sum("modelCalls"),
    inputTokens: sum("inputTokens"),
    outputTokens: sum("outputTokens"),
    usd: sum("usd"),
  };
}

module.exports = { paidSpend, PRICES };
