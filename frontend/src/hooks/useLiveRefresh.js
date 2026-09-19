import { useEffect, useRef } from "react";
import { api } from "../api/inventory";
import { subscribe, isStale, acknowledgeApplied } from "../lib/dataVersion";

// Keeps a Control Tower page current in DEMO MODE ONLY, and only when something
// actually changed.
//
// The warehouse handheld writes stock changes to the shared database, but a page
// only reads on load, so a manager watching the Dashboard would see nothing until
// they reloaded. In demo mode someone moves stock on a phone while the desktop is
// open, so the page re-fetches by itself. It does NOT re-fetch on a timer: it
// watches lib/dataVersion.js, one cheap shared check, and only pays for the full
// re-fetch when that says the data moved. Outside demo mode nothing happens here;
// NewDataPill offers a Refresh button instead, so the real deployment never
// changes numbers under someone who is reading them.
//
// `refresh` must be SILENT: replace the data in place, ignore failures, and never
// blank the screen or reset filters. The initial load keeps its own loading state.
export function useLiveRefresh(refresh) {
  const latest = useRef(refresh);
  latest.current = refresh;

  useEffect(() => {
    let cancelled = false;
    let unsubscribe = null;

    // Asked once per page visit. Entering or exiting demo mode does a full page
    // reload (see DemoModeBadge), so the answer cannot go stale while mounted.
    api.getDemoStatus()
      .then((d) => {
        if (cancelled || !d?.active) return;
        unsubscribe = subscribe(() => {
          if (isStale()) {
            latest.current();
            acknowledgeApplied();
          }
        });
      })
      .catch(() => {});

    return () => {
      cancelled = true;
      if (unsubscribe) unsubscribe();
    };
  }, []);
}
