// ─────────────────────────────────────────────────────────────────────────────
// ASK DATABASE (19 Sep) - open-ended follow-up questions, the tier past
// Action Items' fixed "Why?" button. That button works because the question
// is always known in advance (why THIS row), so every fact it might need can
// be pre-loaded and named as a placeholder before the model ever runs. A
// free-form question ("why is BM-5KG different from JP-5KG?") isn't known in
// advance, so nothing can be pre-loaded - the model has to be able to ASK for
// facts partway through, which is a different shape of problem, not a bigger
// prompt. This is the domain doc's Step 14 ("Agent Explanation and
// Investigation") tier: read-only tools, never raw stock-table access, never
// a write.
//
// The digit-ban guarantee from explain.js/explainActionItem.js still holds,
// it just grows during the conversation instead of being fixed up front:
// each tool call adds a fresh batch of named placeholders (prefixed by call
// number so two calls about two different SKUs can never collide), and the
// FINAL answer is validated against every placeholder handed out so far, not
// a list decided before the question was asked.
//
// No native "function calling" API is used, on purpose: this app's local
// tier is llama3 through Ollama, which does not support it reliably, and
// every other model-facing feature here already uses a plain-text protocol
// instead (the {placeholder} scheme itself is one). One line, "CALL:
// tool_name(args)", parsed the same strict way validateSlotted already
// parses placeholders - the whole answer, not a line buried in prose.
// ─────────────────────────────────────────────────────────────────────────────

const { chat, resolveTier, LlmUnavailable } = require("./provider");
const { validateSlotted, renderSlots, stripPreamble } = require("./slots");
const { calmTone, stripSelfCommentary } = require("./tone");
const { EVENTS, logEvent } = require("../db/audit");
const { TOOLS, runTool } = require("./tools");
const { FIELD_GLOSSARY } = require("./fieldGlossary");

const MAX_TOOL_CALLS = 2; // bounds both cost (paid tier) and how long a question can run
// 3, not 2 (19 Sep): the single most common failure live was llama3 writing
// "{days_of_cover} days" - doubling the unit, since the value already reads
// "12 days". validateSlotted already catches this correctly (never shown to
// the owner), but 2 attempts often wasn't enough room for the model to
// self-correct on the same mistake twice. One more, still free on the local
// tier, gives it a better chance without changing what's allowed through.
const MAX_ANSWER_ATTEMPTS = 3;

// Local-tier only (provider.js's `model` override does nothing for cloud -
// see its own comment). Tested directly against Ollama before adopting
// (19 Sep): 3 of 3 runs correctly substituted a real SKU id, against
// plain llama3's frequent literal "SKU_ID" echo. NOT the same as
// OLLAMA_MODEL in .env, on purpose - that default is llama3, chosen by
// bench-models.js for Alerts' explanations specifically, and flipping it
// here would have silently regressed an already-benchmarked feature to fix
// a different one. Override with ASK_DATABASE_MODEL if a future benchmark
// says otherwise.
const ASK_DATABASE_MODEL = process.env.ASK_DATABASE_MODEL || "llama3.1:8b";

const DESCRIBE = {
  product: "the product name", health: "the health status (RED/ORANGE/YELLOW/GREEN)",
  movement_class: "how fast this moves: Fast, Normal, Slow or Idle",
  on_hand: FIELD_GLOSSARY.on_hand_qty.label, available: FIELD_GLOSSARY.available_qty.label,
  demand_rate: FIELD_GLOSSARY.avg_daily_usage_30d.label, days_of_cover: "how long current stock will last at that demand rate",
  lead_time: FIELD_GLOSSARY.lead_time_days.label, reorder_point: FIELD_GLOSSARY.reorder_point_policy.label,
  suggested_order: FIELD_GLOSSARY.suggested_order_qty.label, target_stock: FIELD_GLOSSARY.target_stock.label,
};

const ASK_SYSTEM = `You are answering a small business owner's question about their own rice
inventory data. Explain things simply, like to an 18 year old: short sentences, no jargon.

You do not have any figures yet. You have three tools to ask for them:
  sku_facts(SKU_ID)
  compare_skus(SKU_ID, SKU_ID)
  recent_history(SKU_ID, MONTHS)

If you need information you don't have, reply with EXACTLY ONE line and nothing else:
CALL: tool_name(argument, argument)

Once you have enough information, write the final answer. THE ONE RULE FOR THE FINAL
ANSWER: you may not write any digit anywhere. Every number and date must be a
placeholder from the list you were given, written exactly as {placeholder_name}. Real
values are substituted afterwards and already include their units.

  CORRECT:  "It has {available} on hand."
  WRONG:    "It has 160 MT on hand."
  WRONG:    "It has {available} MT on hand."   (added a unit)

Other rules for the final answer:
1. Use only placeholders you were actually given. Nothing else exists.
2. No hedging: no "about", "roughly", "approximately".
3. Short bullet points, one idea per line, 3 to 6 bullets.
4. Never use an em dash or en dash.
5. If a tool told you a SKU doesn't exist, say so plainly - do not guess or invent figures for it.`;

function fmtToolCall(name, args) { return `${name}(${args.join(", ")})`; }

function flattenSkuFacts(prefix, result) {
  const slots = {};
  for (const [k, v] of Object.entries(result.facts)) {
    slots[`${prefix}_${k}`] = { value: v, describes: `${DESCRIBE[k] || k} for ${result.product_name}` };
  }
  return slots;
}

// Letters only, never a digit - caught live (19 Sep): the first version
// prefixed slots "t1_", "t2b_" etc, and the model dutifully wrote
// "{t1_product}" exactly as instructed. But slots.js's PLACEHOLDER regex
// only recognises `[a-z_]+` inside braces, and its digit-ban scan has no
// idea a brace-wrapped token is a placeholder name rather than a stated
// figure - so a placeholder whose OWN name contains a digit fails the very
// check that is supposed to wave real placeholders through. No slot name
// anywhere in this app may contain a digit; ordinal words instead of
// numbers is what keeps that true while still letting calls stack.
const ORDINALS = ["one", "two", "three", "four", "five", "six"];
function callWord(callIndex) { return ORDINALS[callIndex - 1] || "extra"; }

function slotsFromToolResult(callIndex, name, result) {
  const word = callWord(callIndex);
  if (name === "sku_facts") return flattenSkuFacts(word, result);
  if (name === "compare_skus") {
    return { ...flattenSkuFacts(`${word}_a`, result.a), ...flattenSkuFacts(`${word}_b`, result.b) };
  }
  if (name === "recent_history") {
    return { [`${word}_history`]: { value: result.summary, describes: `recent monthly sales for ${result.product_name}, oldest to newest` } };
  }
  return {};
}

function describeSlotList(slots) {
  return Object.entries(slots).map(([k, v]) => `  {${k}} ${v.describes}`).join("\n");
}

// Caught live (19 Sep): by far the dominant failure across repeated runs
// against real llama3/llama3.1 was "{one_days_of_cover} days" - the model
// adding a unit word after a placeholder whose value already reads "12
// days" or "45 days". validateSlotted correctly rejects this every time (so
// it never reached an owner), but on some questions it happened on every
// retry, using up the whole budget for one repeated habit. Auto-corrected
// here instead, the same "collapse a known artifact" move renderSlots
// already makes for doubled periods and a repeated product-name prefix:
// strip the trailing unit word ONLY when the placeholder's own value
// already ends with that exact unit, so a placeholder that DOESN'T already
// carry a unit (a plain number, say) is left alone for validateSlotted to
// judge normally.
function stripDoubledUnits(raw, slots) {
  return raw.replace(
    /\{([a-z_]+)\}(\s*)('?s?\s*)(days?|months?|weeks?|years?|MT|SGD|tonnes?)\b/gi,
    (whole, name, sp, poss, unit) => {
      const slot = slots[name];
      if (!slot) return whole;
      const already = new RegExp(`${unit}s?$`, "i").test(String(slot.value).trim());
      return already ? `{${name}}` : whole;
    }
  );
}

async function askDatabase({ question, db, analytics, tier }) {
  tier = resolveTier(tier);
  const slots = {};
  let toolCalls = 0; // every attempt, success or failure - bounds cost/latency
  let successfulToolCalls = 0; // only real, grounded lookups - gates whether an answer is trusted
  const spent = { model_calls: 0, input_tokens: 0, output_tokens: 0 };
  const started = Date.now();
  const toolLog = [];

  const toolMenu = Object.values(TOOLS).map((t) => `  ${t.describe}`).join("\n");

  // Caught live (19 Sep): most failures traced back to the model never
  // successfully naming a real SKU, even when the owner had already typed
  // one - it echoed the literal word "SKU_ID" from the tool description, or
  // invented "{placeholder_SKU_ID}". Rather than lean harder on the model to
  // extract and retype an id correctly, extract it deterministically here
  // and hand it over pre-found: real catalog ids are known ahead of time,
  // so this is a plain substring match, not a guess. Doesn't help a question
  // that names a PRODUCT rather than an id ("the basmati one") - a harder,
  // separate problem, not attempted here.
  const mentioned = analytics.skus
    .map((s) => s.sku_id)
    .filter((id) => question.toUpperCase().includes(id.toUpperCase()));
  const hint = mentioned.length
    ? `\n\nSKU ids already found in that question, spelled exactly right: ${mentioned.join(", ")}. Use these exact strings in your tool calls - do not retype or reformat them.`
    : "";
  let transcript = `The owner's question: "${question}"${hint}`;

  let attemptsAtAnswer = 0;
  for (let round = 1; round <= MAX_TOOL_CALLS + MAX_ANSWER_ATTEMPTS; round++) {
    const forceAnswer = toolCalls >= MAX_TOOL_CALLS;
    const knownFacts = Object.keys(slots).length
      ? `\n\nFacts available to you so far:\n${describeSlotList(slots)}`
      : "";
    const user = `${transcript}${knownFacts}` +
      (forceAnswer
        ? "\n\nYou have used all the tool calls available. Answer now using only the facts above; do not request another tool."
        : "\n\nIf you need more information, reply with one CALL: line. Otherwise write the final answer.");

    let result;
    try {
      result = await chat({ system: ASK_SYSTEM, user, tier, model: ASK_DATABASE_MODEL });
    } catch (err) {
      throw Object.assign(err, { spent });
    }
    spent.model_calls += 1;
    spent.input_tokens += result.usage?.input_tokens || 0;
    spent.output_tokens += result.usage?.output_tokens || 0;

    const text = result.text.trim();
    // Searches ANYWHERE in the text, not anchored to the whole response.
    // Caught live (19 Sep): llama3 wrote "To find out why... I'll use the
    // compare_skus tool...\n\nCALL: compare_skus(A, B) Waiting for the
    // results.." - real intent to call a tool, wrapped in chatter the
    // system prompt didn't ask for. An anchored ^...$ match missed it
    // entirely and the whole garbled thing fell through as a "final
    // answer" attempt instead. Small models don't reliably emit ONLY the
    // instructed format; find the instruction inside whatever else they
    // wrote instead of requiring the whole response to be it.
    const callMatch = !forceAnswer && text.match(/CALL:\s*(\w+)\(([^)]*)\)/i);

    if (callMatch) {
      const name = callMatch[1].toLowerCase();
      // Strips surrounding quotes, not just whitespace - caught live (19
      // Sep): the model wrote CALL: compare_skus("TJ-25KG", "JP-5KG"), the
      // literal quote characters survived into the sku_id passed to
      // runTool, and the exact-match lookup in tools.js failed against the
      // real, unquoted "TJ-25KG" - so the tool correctly reported "not
      // found," and the model then correctly-but-wrongly repeated that a
      // real SKU didn't exist. Not a hallucination; a parsing bug that fed
      // the tool a string that could never have matched anything.
      // Strips a leading "NAME =" / "NAME =>" too, not just quotes - seen
      // from llama3.1:8b (19 Sep, tested directly against Ollama before
      // switching the default): it writes named-argument style,
      // "sku_facts(SKU_ID = 'BR-10KG')" or "SKU_ID => 'BR-10KG'", correctly
      // identifying the real value but wrapping it in syntax no tool here
      // expects. Order matters: strip the name/operator prefix first, then
      // whatever quotes are left around the actual value.
      const args = callMatch[2].split(",")
        .map((s) => s.trim().replace(/^[A-Za-z_]+\s*=>?\s*/, "").trim().replace(/^["']+|["']+$/g, ""))
        .filter(Boolean);
      const def = TOOLS[name];
      if (!def || args.length < 1) {
        transcript += `\n\nYou requested an invalid tool call. Available tools:\n${toolMenu}`;
        continue;
      }
      const toolResult = runTool(db, analytics, name, args);
      toolCalls += 1;
      toolLog.push({ name, args, ok: toolResult.ok });
      if (!toolResult.ok) {
        // Caught live (19 Sep): a run where BOTH allowed attempts failed
        // (once on a literal "SKU_ID" the model copied from the tool
        // description, once on a real-looking but still-wrong id) still
        // reached the final round with toolCalls > 0 but zero real facts -
        // the old gate below only checked "was a tool called," not "did one
        // ever succeed," so the model was told to "answer now" and guessed
        // "BM-5KG doesn't exist" for a SKU that's actually in the catalog.
        // Budget exhausted with nothing grounded is a real failure, not a
        // reason to ask for a guess - fail honestly instead of one more
        // round trip that can only produce an ungrounded answer.
        if (toolCalls >= MAX_TOOL_CALLS && successfulToolCalls === 0) {
          throw Object.assign(new LlmUnavailable(
            `Every lookup failed (${toolLog.map((t) => `${t.name}(${t.args.join(", ")})`).join("; ")}), so there's nothing real to answer from.`
          ), { spent });
        }
        transcript += `\n\nYou called ${fmtToolCall(name, args)}. Result: ${toolResult.error}`;
        continue;
      }
      successfulToolCalls += 1;
      Object.assign(slots, slotsFromToolResult(toolCalls, name, toolResult));
      transcript += `\n\nYou called ${fmtToolCall(name, args)}. It succeeded; the new facts are in the list below.`;
      continue;
    }

    // Treat as a final-answer attempt.
    attemptsAtAnswer += 1;

    // Caught live (19 Sep): with zero tool calls made, the model answered
    // "TJ-25KG doesn't exist. JP-5KG doesn't exist." - both false, and
    // nothing had checked either claim against real data. The digit-ban
    // guarantee doesn't catch this: no digit was written, so validateSlotted
    // had nothing to reject. A false claim in plain words is a different
    // failure than a wrong number, and needs a different, mechanical rule -
    // not the semantic verifier explain.js has (deliberately not ported
    // here, see the file header), just "you may not answer at all until you
    // have looked something up." Cheap, and it directly closes this gap.
    // successfulToolCalls, not toolCalls: a run where every attempt FAILED
    // (see the comment above, on a literal "SKU_ID" echo) still had
    // toolCalls > 0, and the old version of this check let that count as
    // "looked something up" - it hadn't. Only a real success grounds an
    // answer.
    if (successfulToolCalls === 0) {
      if (attemptsAtAnswer >= MAX_ANSWER_ATTEMPTS) {
        throw Object.assign(new LlmUnavailable(
          "The model tried to answer without ever successfully looking up real data."
        ), { spent });
      }
      transcript += "\n\nYou answered without a successful tool call. You have no real facts yet - every claim " +
        "you just made is unverified. Call a tool before answering anything, even to say a SKU doesn't exist.";
      continue;
    }

    const cleanedText = stripDoubledUnits(text, slots);
    const structural = validateSlotted(cleanedText, slots, { requireFigures: false });
    if (!structural.ok) {
      if (attemptsAtAnswer >= MAX_ANSWER_ATTEMPTS) {
        throw Object.assign(new LlmUnavailable(
          `The model's answer failed the explanation checks after ${attemptsAtAnswer} attempts (${structural.issues.join("; ")}).`
        ), { spent });
      }
      transcript += `\n\nYour last answer broke the rules: ${structural.issues.join("; ")}. Write it again, correctly.`;
      continue;
    }

    let rendered = stripSelfCommentary(stripPreamble(renderSlots(cleanedText, slots))).trim();
    rendered = calmTone(rendered, { alert_type: "ASK_DATABASE" }, slots).text;

    logEvent(EVENTS.LLM_CALL, {
      skuId: null,
      input: { item_type: "ask_database", question, provider: result.provider, model: result.model, tool_calls: toolLog },
      output: { explanation: rendered, latency_ms: Date.now() - started, ...spent },
    });

    return { text: rendered, provider: result.provider, model: result.model, toolCalls: toolLog };
  }

  throw Object.assign(new LlmUnavailable("Could not reach a checked answer within the tool-call budget."), { spent });
}

module.exports = { askDatabase, MAX_TOOL_CALLS };
