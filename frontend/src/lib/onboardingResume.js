// Whether onboarding has been dismissed (skipped or finished) so Home stops
// forcing it onto a still-empty catalog. A per-browser convenience (see
// useCollapsed.js for the same try/catch-on-private-mode pattern), never sent
// to the server and never a substitute for real onboarding state.
//
// Onboarding itself no longer tracks a resumable step: it's a sequential,
// story-style flow now (skip moves forward, back moves back, closing exits),
// not a "minimize here, hop back in from anywhere" journey. There is nothing
// to resume into, since a dismissed catalog is set up the normal way
// afterward, through Inventory or Bulk edit, not through this screen again.
const DISMISSED_KEY = "onboarding:dismissed";

export function isDismissed() {
  try { return localStorage.getItem(DISMISSED_KEY) === "1"; } catch { return false; }
}

export function dismissOnboarding() {
  try { localStorage.setItem(DISMISSED_KEY, "1"); } catch { /* private mode etc. */ }
}

// Called when a step's own upload actually finishes, so a catalog that later
// goes empty again (a fresh seed, say) gets the wizard rather than inheriting
// a stale dismissal from this run.
export function clearDismissal() {
  try { localStorage.removeItem(DISMISSED_KEY); } catch { /* private mode etc. */ }
}
