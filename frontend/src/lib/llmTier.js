import { useEffect, useState } from "react";

// ─────────────────────────────────────────────────────────────────────────────
// WHICH TIER THIS VISITOR CHOSE, AND THEIR PAID PASS (TASK-90)
//
// The explanation tier used to be one setting on the server, shared by every
// visitor. It now lives here, in each browser, and travels with each "Why?"
// request. Two things are stored, deliberately in two different places:
//
//   the CHOICE (rules / local / cloud)  localStorage. A preference, so it is
//                                       fine for it to outlive the tab.
//   the PASS the demo PIN unlocked      sessionStorage. A spending permission,
//                                       so it dies with the tab and never
//                                       lingers on a shared demo laptop after
//                                       the person who typed the PIN has left.
//
// Settings writes both; Actions Needed reads both. They stay in step through one
// window event, because both can be on screen at once (Settings is in the
// sidebar beside the Actions Needed page) and a storage event only fires in OTHER tabs.
//
// Every storage access is wrapped: private windows, blocked site data and
// some embedded browsers throw on access, and a thrown read must degrade to
// "no choice made", never to a blank page.
// ─────────────────────────────────────────────────────────────────────────────

const CHOICE_KEY = "stocksense.explainTier";
const PASS_KEY = "stocksense.demoPass";
const EVENT = "stocksense:llm-tier";

function read(storage, key) {
  try { return window[storage].getItem(key); } catch { return null; }
}
function write(storage, key, value) {
  try {
    if (value == null) window[storage].removeItem(key);
    else window[storage].setItem(key, value);
  } catch { /* storage unavailable: the choice simply does not persist */ }
  window.dispatchEvent(new Event(EVENT));
}

export function getTierChoice() {
  const v = read("localStorage", CHOICE_KEY);
  return v === "rules" || v === "local" || v === "cloud" ? v : null;
}

export function setTierChoice(tier) {
  write("localStorage", CHOICE_KEY, tier);
}

/** The unexpired pass, or null. An expired one is removed on read. */
export function getPass() {
  const raw = read("sessionStorage", PASS_KEY);
  if (!raw) return null;
  try {
    const p = JSON.parse(raw);
    if (p && typeof p.pass === "string" && Number(p.expiresAt) > Date.now()) return p;
  } catch { /* corrupt entry, fall through and clear it */ }
  // Removed WITHOUT announcing it. getPass runs during render, and dispatching
  // the change event from inside a render would make React update other
  // components mid-render. Nothing needs telling: every reader gets null
  // from here on anyway.
  try { window.sessionStorage.removeItem(PASS_KEY); } catch { /* unavailable */ }
  return null;
}

export function setPass(p) {
  write("sessionStorage", PASS_KEY, p ? JSON.stringify({ pass: p.pass, expiresAt: p.expiresAt }) : null);
}

export function clearPass() {
  write("sessionStorage", PASS_KEY, null);
}

/**
 * The tier a request should actually use, given what the server offers.
 * A choice the server cannot honour falls back to the server default rather
 * than being sent anyway: a visitor whose pass expired should get a free
 * explanation that works, not a paid one that is refused.
 *
 * @param {{ mode: string, modes: Array }} server  response of GET /llm/mode
 */
export function effectiveTier(server, choice = getTierChoice(), pass = getPass()) {
  const fallback = server?.mode || "rules";
  if (!choice || !server?.modes) return fallback;
  const m = server.modes.find((x) => x.id === choice);
  if (!m || !m.available) return fallback;
  if (m.id === "cloud" && m.requiresPin && !pass) return fallback;
  return choice;
}

/** Re-renders when the choice or the pass changes anywhere on the page. */
export function useLlmTier() {
  const snapshot = () => ({ choice: getTierChoice(), pass: getPass() });
  const [state, setState] = useState(snapshot);
  useEffect(() => {
    const update = () => setState(snapshot());
    window.addEventListener(EVENT, update);
    window.addEventListener("storage", update);
    // The pass expires on its own clock, with no event to announce it. A
    // minute's resolution is plenty for a two hour pass.
    const timer = setInterval(update, 60_000);
    return () => {
      window.removeEventListener(EVENT, update);
      window.removeEventListener("storage", update);
      clearInterval(timer);
    };
  }, []);
  return state;
}
