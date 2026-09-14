// ─────────────────────────────────────────────────────────────────────────────
// DEMO ACCESS: who may spend the team's model credit (TASK-90)
//
// The metered tier used to be ONE global switch. On a laptop that meant one
// person; on a public URL it means every visitor, so a single judge (or bot)
// choosing "AWS Bedrock" turned on paid calls for everyone until someone turned
// it off. The credit is also the same USD 100 pool that pays for hosting, and
// the organizers can pause an account that overspends.
//
// So paid explanations are now unlocked PER VISITOR with a demo PIN:
//
//   1. The PIN lives only in the server's environment (DEMO_PIN). A PIN in the
//      frontend bundle is readable by anyone who opens devtools.
//   2. A correct PIN returns a signed, expiring pass. The browser tab holds it
//      and sends it with each paid request; nothing global changes.
//   3. Wrong guesses are rate limited per client AND in total, so neither one
//      machine nor many can walk the PIN space.
//
// The pass is stateless (HMAC signed), so there is no session table to store
// or clean up. The trade is that a pass cannot be revoked early, which is why
// it expires after two hours rather than days.
//
// This is a demo gate, not user authentication. It answers "may this browser
// spend credit for a while", which is the only question the hackathon build
// needs answered. Real accounts would replace it, not extend it.
// ─────────────────────────────────────────────────────────────────────────────

const crypto = require("crypto");

const IS_PRODUCTION = process.env.NODE_ENV === "production";

const PASS_TTL_MS = 2 * 60 * 60 * 1000;

// Per client: 5 wrong tries inside 15 minutes locks that client for 15 minutes.
const CLIENT_MAX_FAILS = 5;
const CLIENT_WINDOW_MS = 15 * 60 * 1000;
const CLIENT_LOCK_MS = 15 * 60 * 1000;

// Everyone together: past 30 wrong tries in 15 minutes, unlocking pauses for
// all clients. Per-client limits alone do nothing against guesses spread
// across many addresses. At this ceiling a 6 digit PIN takes on the order of a
// year to find by brute force, and a legitimate judge who hits it waits
// minutes, not days.
const GLOBAL_MAX_FAILS = 30;
const GLOBAL_WINDOW_MS = 15 * 60 * 1000;

// Below this length the global ceiling stops being meaningful protection, so a
// shorter PIN is refused in production rather than quietly accepted.
const MIN_PIN_LENGTH = 6;

// Signs passes. From the environment when set, so passes survive a restart;
// otherwise random per process, which simply means a restart asks everyone for
// the PIN again. Never logged.
const SECRET = process.env.DEMO_TOKEN_SECRET || crypto.randomBytes(32).toString("hex");

function configuredPin() {
  const pin = (process.env.DEMO_PIN || "").trim();
  return pin || null;
}

/**
 * Is a PIN needed before the metered tier can be used?
 * Always in production. In development only when one has been set, so the
 * local workflow does not change for anyone who has not opted in.
 */
function pinRequired() {
  return IS_PRODUCTION || !!configuredPin();
}

/**
 * Can the metered tier be unlocked at all? Production refuses to offer it
 * without a PIN of sensible length, because "no PIN configured" must mean
 * "paid calls are off", never "paid calls are open".
 */
function gateStatus() {
  const pin = configuredPin();
  if (!pinRequired()) return { ok: true, reason: null };
  if (!pin) return { ok: false, reason: "Paid explanations are switched off on this server (no demo PIN is configured)." };
  if (IS_PRODUCTION && pin.length < MIN_PIN_LENGTH) {
    return { ok: false, reason: `Paid explanations are switched off: the demo PIN must be at least ${MIN_PIN_LENGTH} characters.` };
  }
  return { ok: true, reason: null };
}

// ── Rate limiting ────────────────────────────────────────────────────────────
// In memory, so a restart clears it. Acceptable for a single demo instance; a
// fleet of instances would need a shared store.
const clientFails = new Map(); // clientKey -> { times: number[], lockedUntil: number }
let globalFails = [];

function prune(now) {
  globalFails = globalFails.filter((t) => now - t < GLOBAL_WINDOW_MS);
  for (const [k, v] of clientFails) {
    v.times = v.times.filter((t) => now - t < CLIENT_WINDOW_MS);
    if (!v.times.length && v.lockedUntil <= now) clientFails.delete(k);
  }
}

const minutes = (ms) => Math.max(1, Math.ceil(ms / 60000));

// Compares digests rather than the raw strings, so the comparison takes the
// same time whatever the input length (timingSafeEqual requires equal length).
function pinMatches(input) {
  const pin = configuredPin();
  if (!pin) return false;
  const a = crypto.createHash("sha256").update(String(input)).digest();
  const b = crypto.createHash("sha256").update(pin).digest();
  return crypto.timingSafeEqual(a, b);
}

/**
 * Try a PIN.
 * @returns {{ ok: true, pass: string, expiresAt: number }
 *         | { ok: false, status: number, reason: string, lockedOut?: boolean }}
 */
function tryUnlock(clientKey, input) {
  const gate = gateStatus();
  if (!gate.ok) return { ok: false, status: 403, reason: gate.reason };

  // Development without a PIN: nothing to check, hand out a pass anyway so the
  // frontend flow is the same shape everywhere.
  if (!pinRequired()) return issuePass();

  const now = Date.now();
  prune(now);

  const entry = clientFails.get(clientKey) || { times: [], lockedUntil: 0 };
  if (entry.lockedUntil > now) {
    return { ok: false, status: 429, lockedOut: true, reason: `Too many wrong PINs. Try again in ${minutes(entry.lockedUntil - now)} min.` };
  }
  if (globalFails.length >= GLOBAL_MAX_FAILS) {
    return { ok: false, status: 429, lockedOut: true, reason: `Unlocking is paused after too many wrong PINs. Try again in ${minutes(GLOBAL_WINDOW_MS - (now - globalFails[0]))} min.` };
  }

  if (typeof input !== "string" || !input.trim() || !pinMatches(input.trim())) {
    entry.times.push(now);
    globalFails.push(now);
    const left = CLIENT_MAX_FAILS - entry.times.length;
    if (left <= 0) {
      entry.lockedUntil = now + CLIENT_LOCK_MS;
      entry.times = [];
      clientFails.set(clientKey, entry);
      return { ok: false, status: 429, lockedOut: true, reason: `Too many wrong PINs. Try again in ${minutes(CLIENT_LOCK_MS)} min.` };
    }
    clientFails.set(clientKey, entry);
    return { ok: false, status: 401, reason: `That PIN is not right. ${left} ${left === 1 ? "try" : "tries"} left.` };
  }

  clientFails.delete(clientKey);
  return issuePass();
}

// ── Passes ───────────────────────────────────────────────────────────────────
const sign = (payload) => crypto.createHmac("sha256", SECRET).update(payload).digest("base64url");

function issuePass() {
  const expiresAt = Date.now() + PASS_TTL_MS;
  const payload = `v1.${expiresAt}.${crypto.randomBytes(9).toString("base64url")}`;
  return { ok: true, pass: `${payload}.${sign(payload)}`, expiresAt };
}

/** True only for an unexpired pass this server signed. */
function passValid(pass) {
  if (!pinRequired()) return true;
  if (!gateStatus().ok) return false;
  if (typeof pass !== "string") return false;
  const i = pass.lastIndexOf(".");
  if (i < 0) return false;
  const payload = pass.slice(0, i);
  const given = Buffer.from(pass.slice(i + 1));
  const expected = Buffer.from(sign(payload));
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) return false;
  const [version, exp] = payload.split(".");
  return version === "v1" && Number(exp) > Date.now();
}

module.exports = { pinRequired, gateStatus, tryUnlock, passValid, PASS_TTL_MS };
