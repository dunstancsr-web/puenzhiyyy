import { api } from "../api/inventory";

// The one way INTO demo mode from the interface. A full page load, deliberately: every page
// fetches its own data on mount, so a reload guarantees nothing on screen still shows the
// database that was just swapped out (see DemoModeBadge).
export async function enterDemoMode() {
  await api.enterDemoMode();
  window.location.href = "/";
}
