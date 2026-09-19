import { api } from "../api/inventory";

// One shared poller that answers a single question for the whole Control Tower:
// "has anything changed since this page's data was loaded?"
//
// It asks /api/data-version, a handful of indexed lookups, not the analytics, so
// it is cheap enough to run on the real deployment as well as in demo mode. What
// happens on a change differs by mode and is decided by the subscriber:
//   live  -> NewDataPill offers a Refresh button (nothing moves under the reader)
//   demo  -> useLiveRefresh re-fetches silently and NewDataPill flashes "Updated"
//
// Module level, not per component, so any number of subscribers share ONE timer
// and one request per interval. Runs only while at least one subscriber exists
// and the tab is visible.

const INTERVAL_MS = 15000;

let baseline = null;   // the version the page on screen was loaded against
let latest = null;     // the newest version the server has reported
let appliedAt = 0;     // when demo mode last applied a change, for the "Updated" note
let timer = null;
const subscribers = new Set();

const notify = () => subscribers.forEach((fn) => fn());

async function check() {
  if (document.visibilityState !== "visible") return;
  try {
    const { version } = await api.getDataVersion();
    latest = version;
    if (baseline === null) baseline = version;
    notify();
  } catch {
    /* A failed check is not a change. Try again next tick. */
  }
}

export function subscribe(fn) {
  subscribers.add(fn);
  if (!timer) {
    check();
    timer = setInterval(check, INTERVAL_MS);
    document.addEventListener("visibilitychange", check);
  }
  return () => {
    subscribers.delete(fn);
    if (subscribers.size === 0 && timer) {
      clearInterval(timer);
      timer = null;
      document.removeEventListener("visibilitychange", check);
    }
  };
}

export const isStale = () => baseline !== null && latest !== null && latest !== baseline;
export const getAppliedAt = () => appliedAt;

/** The page has just loaded fresh data (navigation, reload): the newest version is now "seen". */
export async function resetBaseline() {
  try {
    const { version } = await api.getDataVersion();
    baseline = latest = version;
    notify();
  } catch { /* leave as is */ }
}

/** Demo mode applied the change itself; note when, and treat the newest version as seen. */
export function acknowledgeApplied() {
  baseline = latest;
  appliedAt = Date.now();
  notify();
}
