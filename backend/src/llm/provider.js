// ─────────────────────────────────────────────────────────────────────────────
// LLM PROVIDER (TASK-11)
//
// One `chat()` call, three backends behind it, selected by LLM_PROVIDER.
//
//   ollama     local, free, offline. The development default.
//   gateway    the hackathon organizers' AWS Bedrock gateway, Ollama compatible
//              with an X-API-Key header. Fronts Claude Sonnet 4.5.
//   anthropic  the Anthropic API directly, against the team's own credit.
//
// The split exists for a budget reason rather than an architectural one. The
// team shares a single $100 credit pool with no per developer limit, so a loop
// in one person's branch spends everyone's. Local ollama costs nothing, so
// development, refactors and accidental double clicks are free, and a metered
// backend is reserved for demos and recording.
//
// All three take the same {role, content} message shape. The differences are
// the URL, the auth header, and where the system prompt goes: Anthropic takes
// it as a top level field, the Ollama shape takes it as the first message.
//
// The API key is read from the environment and never logged, never returned in
// a response, and never written to the audit trail.
// ─────────────────────────────────────────────────────────────────────────────

// ── Three tiers, in increasing order of what they cost you ───────────────────
//
//   rules  no model at all. The deterministic trace in frontend/src/lib/
//          explain.js is the whole explanation. Free, offline, always correct.
//   local  llama3 on this machine. Free and unlimited, slower, less precise.
//   cloud  AWS Bedrock through the organizers' gateway, or the Anthropic API.
//          METERED. Spends the team's shared credit on every uncached call.
//
// `cloud` is deliberately hard to reach by accident. It is never the startup
// default, it cannot be entered unless credentials are actually configured, and
// switching into it takes a separate explicit request. A tier that spends money
// should not be reachable by a config typo.
const MODES = ["rules", "local", "cloud"];

// The startup tier. Defaults to local, and LLM_DEFAULT_MODE deliberately cannot
// select cloud: paid spending starts from a human action in the running app,
// never from a file someone copied.
const DEFAULT_MODE = (() => {
  const m = (process.env.LLM_DEFAULT_MODE || "local").toLowerCase();
  return m === "rules" || m === "local" ? m : "local";
})();

let activeMode = DEFAULT_MODE;

// Which concrete backend `cloud` resolves to. The organizers' gateway is
// preferred over the direct Anthropic API when both are configured, because it
// is the route they intend teams to use.
function cloudProvider() {
  if (process.env.LLM_GATEWAY_URL && process.env.LLM_GATEWAY_API_KEY) return "gateway";
  if (process.env.ANTHROPIC_API_KEY) return "anthropic";
  return null;
}

const PROVIDER = (process.env.LLM_PROVIDER || "ollama").toLowerCase();
const MAX_TOKENS = Number(process.env.LLM_MAX_OUTPUT_TOKENS) || 280;

// Rolling call counter for the paid path only. In memory on purpose: it resets
// when the process restarts, which is the right behaviour for a dev guard. A
// durable quota belongs on the billing side, not in this file.
const DAILY_LIMIT = Number(process.env.LLM_DAILY_CALL_LIMIT ?? 200);
let paidCalls = [];

function underDailyLimit() {
  if (!DAILY_LIMIT) return true;
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  paidCalls = paidCalls.filter((t) => t > cutoff);
  return paidCalls.length < DAILY_LIMIT;
}

class LlmUnavailable extends Error {
  constructor(message) {
    super(message);
    this.name = "LlmUnavailable";
  }
}

// Standard Ollama /api/chat, shared by two callers.
//
//   LLM_PROVIDER=ollama    a local daemon, no auth
//   LLM_PROVIDER=gateway   the hackathon organizers' AWS Bedrock gateway, which
//                          is deliberately Ollama compatible: same POST
//                          /api/chat, same message shape, plus an X-API-Key
//                          header. That compatibility is the whole reason this
//                          file needed almost no change to support it.
//
// `retries` exists for the gateway only. It answers 403 on rapid successive
// requests (the starter kit's own client backs off 3s, 6s, 9s), which is a rate
// limit wearing a permissions status code, so a 403 here is retried rather than
// treated as an auth failure.
async function callOllamaCompatible({ baseUrl, model, apiKey, retries, system, user, signal }) {
  const url = `${baseUrl.replace(/\/+$/, "")}/api/chat`;
  const headers = { "Content-Type": "application/json" };
  if (apiKey) headers["X-API-Key"] = apiKey;

  const body = JSON.stringify({
    model,
    stream: false,
    // Reasoning models (qwen3 and friends) spend their output budget on an
    // internal monologue before answering. With num_predict capped for cost,
    // qwen3:8b burned all 280 tokens thinking and returned an EMPTY message.
    // Ignored by models that do not think, so it is safe to send always.
    think: false,
    // Nested under `options`, which is the Ollama wire format that LangChain's
    // ChatOllama sends and therefore what the gateway is built to accept.
    options: { temperature: 0.2, num_predict: MAX_TOKENS },
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
  });

  let lastErr;
  for (let attempt = 1; attempt <= retries; attempt++) {
    let res;
    try {
      res = await fetch(url, { method: "POST", headers, signal, body });
    } catch (err) {
      // Distinguish "not reachable" from "reachable but refused", the same
      // discrimination frontend/src/api/inventory.js makes for the backend.
      // Telling someone their prompt failed when the daemon is simply not up
      // sends them debugging the wrong thing.
      throw new LlmUnavailable(
        `Cannot reach the model at ${url}. ${apiKey ? "Check LLM_GATEWAY_URL and that the gateway is up." : 'Start it with "ollama serve", or set LLM_PROVIDER=none.'} (${err.message})`
      );
    }

    if (res.status === 403 && attempt < retries) {
      await new Promise((r) => setTimeout(r, 3000 * attempt));
      lastErr = new LlmUnavailable("gateway returned 403 (rate limited) after retries");
      continue;
    }
    if (!res.ok) {
      throw new LlmUnavailable(
        res.status === 401 || res.status === 403
          ? `Model endpoint rejected the request (${res.status}). Check LLM_GATEWAY_API_KEY.`
          : `Model endpoint returned ${res.status}`
      );
    }

    const bodyJson = await res.json();
    const text = bodyJson?.message?.content?.trim();
    if (!text) throw new LlmUnavailable("Model endpoint returned an empty message");

    return {
      text,
      model,
      provider: apiKey ? "gateway" : "ollama",
      usage: {
        input_tokens: bodyJson.prompt_eval_count ?? null,
        output_tokens: bodyJson.eval_count ?? null,
      },
    };
  }
  throw lastErr || new LlmUnavailable("Model endpoint failed");
}

function callOllama(args) {
  return callOllamaCompatible({
    baseUrl: process.env.OLLAMA_URL || "http://localhost:11434",
    model: process.env.OLLAMA_MODEL || "llama3",
    apiKey: null,
    retries: 1,
    ...args,
  });
}

function callGateway(args) {
  const baseUrl = process.env.LLM_GATEWAY_URL;
  const apiKey = process.env.LLM_GATEWAY_API_KEY;
  if (!baseUrl || !apiKey) {
    throw new LlmUnavailable(
      "LLM_GATEWAY_URL and LLM_GATEWAY_API_KEY must both be set. See backend/.env.example."
    );
  }
  return callOllamaCompatible({
    baseUrl,
    model: process.env.LLM_GATEWAY_MODEL || "global.anthropic.claude-sonnet-4-5-20250929-v1:0",
    apiKey,
    retries: 3,
    ...args,
  });
}

async function callAnthropic({ system, user, signal }) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) {
    throw new LlmUnavailable(
      "ANTHROPIC_API_KEY is not set. Copy backend/.env.example to backend/.env and fill it in."
    );
  }
  if (!underDailyLimit()) {
    throw new LlmUnavailable(
      `Daily cap of ${DAILY_LIMIT} paid calls reached. Switch LLM_PROVIDER to ollama, or raise LLM_DAILY_CALL_LIMIT if this is deliberate.`
    );
  }

  const model = process.env.ANTHROPIC_MODEL || "claude-haiku-4-5-20251001";
  let res;
  try {
    res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      signal,
      headers: {
        "content-type": "application/json",
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model,
        max_tokens: MAX_TOKENS,
        temperature: 0.2,
        system,
        messages: [{ role: "user", content: user }],
      }),
    });
  } catch (err) {
    throw new LlmUnavailable(`Could not reach the Anthropic API: ${err.message}`);
  }

  if (!res.ok) {
    // Read the error body for the message, but never echo headers or the key.
    let detail = "";
    try {
      const b = await res.json();
      detail = b?.error?.message || "";
    } catch { /* non JSON error body, status alone will do */ }
    throw new LlmUnavailable(`Anthropic API returned ${res.status}${detail ? `: ${detail}` : ""}`);
  }

  paidCalls.push(Date.now());
  const body = await res.json();
  const text = body?.content?.map((c) => c.text).filter(Boolean).join("").trim();
  if (!text) throw new LlmUnavailable("Anthropic API returned no text content");

  return {
    text,
    model,
    provider: "anthropic",
    usage: {
      input_tokens: body.usage?.input_tokens ?? null,
      output_tokens: body.usage?.output_tokens ?? null,
    },
  };
}

/**
 * Send one prompt. Resolves to { text, model, provider, usage }.
 * Throws LlmUnavailable for every "no model answered" case, so callers have a
 * single error type to fall back on.
 *
 * @param {object} opts
 * @param {string} opts.system
 * @param {string} opts.user
 * @param {number} [opts.timeoutMs] default 60s, because a cold local model on a
 *   laptop can genuinely take 20s or more (measured: llama3 at about 20s).
 */
async function chat({ system, user, timeoutMs = 60_000 }) {
  if (activeMode === "rules") {
    throw new LlmUnavailable("Rule-based mode is active, so no model is called.");
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const args = { system, user, signal: controller.signal };
    if (activeMode === "local") return await callOllama(args);

    const cp = cloudProvider();
    if (cp === "gateway") return await callGateway(args);
    if (cp === "anthropic") return await callAnthropic(args);
    throw new LlmUnavailable("No cloud credentials are configured. See backend/.env.example.");
  } finally {
    clearTimeout(timer);
  }
}

// What the UI is allowed to know. Deliberately never includes a key, and never
// whether a key LOOKS valid, only whether one is present at all.
function listModes() {
  const cp = cloudProvider();
  return [
    {
      id: "rules",
      label: "Rule-based",
      detail: "Computed from live figures by the rules in design.md. No model, no cost.",
      cost: "free",
      available: true,
    },
    {
      id: "local",
      label: "Local model",
      detail: `${process.env.OLLAMA_MODEL || "llama3"} running on this machine. Free and unlimited, slower to answer.`,
      cost: "free",
      available: true,
    },
    {
      id: "cloud",
      label: "AWS Bedrock",
      detail: cp === "gateway"
        ? `${process.env.LLM_GATEWAY_MODEL || "Claude Sonnet 4.5"} through the hackathon gateway. Spends shared AWS credit.`
        : cp === "anthropic"
          ? `${process.env.ANTHROPIC_MODEL || "Claude Haiku"} through the Anthropic API. Spends shared credit.`
          : "Not configured. Add gateway or Anthropic credentials to backend/.env.",
      cost: "metered",
      available: !!cp,
      provider: cp,
    },
  ];
}

function getMode() {
  return activeMode;
}

/**
 * Switch tier. Returns the new mode.
 * Throws on an unknown tier, or on cloud without configured credentials, so a
 * UI can never put the app into a paid state that does not actually work.
 */
function setMode(mode) {
  const m = String(mode || "").toLowerCase();
  if (!MODES.includes(m)) throw new Error(`Unknown mode "${mode}". Use rules, local or cloud.`);
  if (m === "cloud" && !cloudProvider()) {
    throw new Error("Cloud mode needs credentials in backend/.env. Nothing was changed.");
  }
  activeMode = m;
  return activeMode;
}

// Kept for the audit trail and the modal byline.
function providerInfo() {
  const cp = cloudProvider();
  return {
    mode: activeMode,
    provider: activeMode === "local" ? "ollama" : activeMode === "cloud" ? cp : "rules",
    model:
      activeMode === "local" ? (process.env.OLLAMA_MODEL || "llama3")
      : activeMode === "cloud" && cp === "gateway" ? (process.env.LLM_GATEWAY_MODEL || "claude-sonnet-4-5")
      : activeMode === "cloud" && cp === "anthropic" ? (process.env.ANTHROPIC_MODEL || "claude-haiku-4-5-20251001")
      : null,
    configured: activeMode !== "cloud" || !!cp,
  };
}

module.exports = { chat, providerInfo, listModes, getMode, setMode, LlmUnavailable };
