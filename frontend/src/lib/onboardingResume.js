// Shared between Onboarding.jsx and OnboardingResumeChip.jsx so both read and
// write the same two keys the same way — a per-browser convenience (see
// useCollapsed.js for the same try/catch-on-private-mode pattern), never
// sent to the server and never a substitute for real onboarding state.
const STEP_KEY = "onboarding:step";
const MINIMIZED_KEY = "onboarding:minimized";

export function getSavedStep() {
  try {
    const v = Number(localStorage.getItem(STEP_KEY));
    return v >= 1 && v <= 3 ? v : 1;
  } catch { return 1; }
}

export function isMinimized() {
  try { return localStorage.getItem(MINIMIZED_KEY) === "1"; } catch { return false; }
}

export function saveMinimized(step) {
  try {
    localStorage.setItem(STEP_KEY, String(step));
    localStorage.setItem(MINIMIZED_KEY, "1");
  } catch { /* private mode etc. */ }
}

// Called both when the user resumes (chip clicked) and when a step's own
// "done" action fires (upload applied, skip clicked) — either way, there is
// nothing left to resume into.
export function clearMinimized() {
  try {
    localStorage.removeItem(STEP_KEY);
    localStorage.removeItem(MINIMIZED_KEY);
  } catch { /* private mode etc. */ }
}
