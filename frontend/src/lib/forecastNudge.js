// A one-time nudge pointing a manager at Forecast Overview right after they
// actually add data (onboarding's catalog/sales upload, or "Try with sample
// data"), the moment "your data is being used" is truest. Armed there, shown
// once on Dashboard, then gone: a banner that reappears on every visit stops
// being a nudge and starts being furniture. Per-browser only, same
// try/catch-on-private-mode pattern as onboardingResume.js.
const NUDGE_KEY = "forecast:nudge";

export function isNudgePending() {
  try { return localStorage.getItem(NUDGE_KEY) === "1"; } catch { return false; }
}

export function armForecastNudge() {
  try { localStorage.setItem(NUDGE_KEY, "1"); } catch { /* private mode etc. */ }
}

export function dismissForecastNudge() {
  try { localStorage.removeItem(NUDGE_KEY); } catch { /* private mode etc. */ }
}
