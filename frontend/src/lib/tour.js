// ─────────────────────────────────────────────────────────────────────────────
// THE DEMO TOUR: its steps, and where its state lives (components/DemoTour.jsx draws it).
//
// Five stops right after onboarding, so a first-time visitor is walked through the loop the app is built
// around: data in, the engines flag what matters, a person decides. The copy for step 3 is Stan's (21 Sep):
// Action Items settles immediate concerns, from stock running out to supply worries raised by the latest
// world news. The tour never mentions the demo PIN: the banner and the Why? box already ask for it.
//
// STATE has two parts. What was asked for, or how the last tour ended, is one word in localStorage (per browser):
//   "start-demo"  onboarding just finished: begin, but only if this browser is in the demo sandbox
//   "start"       someone pressed "Take the tour" in Settings: begin wherever they are
//   "closed"      the visitor left early
//   "done"        the visitor reached the end
// Whether a tour is UNDERWAY, and its step, live in sessionStorage (per tab): a reload resumes it, but a new tab
// never inherits a half-finished tour from another one.
// Every storage access is wrapped: a private window must degrade to "no tour", never to a blank page.
// ─────────────────────────────────────────────────────────────────────────────

const STATE_KEY = "stocksense.tour";
const STEP_KEY = "stocksense.tour.step";
const RUN_KEY = "stocksense.tour.running";
const EVENT = "stocksense:tour";

export const TOUR_STEPS = [
  {
    route: "/",
    targets: ['[data-tour="home-control-tower"]'],
    title: "Your data is in. Start here.",
    body: "The Control Tower is where a manager reviews stock and decides. Open it to see what your catalog and sales history produced.",
    next: "Open it",
  },
  {
    route: "/dashboard",
    targets: ['[data-tour="dashboard-metrics"]'],
    title: "This is the health of your stock today",
    body: "Key Metrics shows what you hold, how long it lasts, and what needs attention. Every figure comes from fixed rules, never from AI.",
    next: "Next",
  },
  {
    route: "/action-items",
    targets: ['[data-tour="action-nearest"]'],
    title: "What can't wait",
    body: "Action Items is for settling your immediate concerns, from stock that is about to run out to supply worries raised by the latest world news, which Market signals scans for you. Press Why? on a row for a plain English reason.",
    next: "Next",
  },
  {
    route: "/alerts",
    targets: ['[data-tour="alert-actions"]', '[role="tabpanel"]'],
    title: "Nothing happens without you",
    body: "Every recommendation waits for a person. Approve it, change it, or reject it, and your decision is recorded beside what the system proposed.",
    next: "Next",
  },
  {
    route: null,
    targets: [],
    title: "You've seen the loop",
    body: "Your data went in, the engines flagged what matters, and a person decides. Keep exploring:",
    next: "Finish",
    links: [
      { label: "Forecast", to: "/forecast" },
      { label: "Inventory", to: "/inventory" },
      { label: "Goods In, on a handheld", to: "/warehouse/inbound" },
    ],
  },
];

function read(storage, key) {
  try { return window[storage].getItem(key); } catch { return null; }
}
function write(storage, key, value) {
  try {
    if (value == null) window[storage].removeItem(key);
    else window[storage].setItem(key, value);
  } catch { /* storage unavailable: the tour simply does not persist */ }
}

const announce = () => window.dispatchEvent(new Event(EVENT));

export function getTourState() { return read("localStorage", STATE_KEY); }
export function setTourState(v) { write("localStorage", STATE_KEY, v); announce(); }
export function getTourStep() {
  const n = Number(read("sessionStorage", STEP_KEY));
  return Number.isInteger(n) && n >= 0 && n < TOUR_STEPS.length ? n : 0;
}
export function setTourStep(n) { write("sessionStorage", STEP_KEY, String(n)); }
export function isTourRunning() { return read("sessionStorage", RUN_KEY) === "1"; }
export function setTourRunning(on) { write("sessionStorage", RUN_KEY, on ? "1" : null); }

/** Onboarding just finished: begin the tour on Home, but only inside the demo sandbox. */
export function queueTourAfterOnboarding() { write("sessionStorage", STEP_KEY, "0"); setTourState("start-demo"); }

/** Someone chose "Take the tour": begin from the first step, wherever they are. */
export function startTour() { write("sessionStorage", STEP_KEY, "0"); setTourState("start"); }

/** Re-renders whoever listens when the tour state changes anywhere on the page. */
export function onTourChange(fn) {
  window.addEventListener(EVENT, fn);
  return () => window.removeEventListener(EVENT, fn);
}
