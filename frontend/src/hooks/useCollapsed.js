import { useState, useEffect } from "react";

// Per-section collapse state, persisted so a user's "I don't need this
// widget" choice survives a reload — a one-time preference, not a per-visit
// toggle. Defaults to whatever `defaultOpen` the caller passes. Shared
// between Dashboard and Alerts so both pages' collapsible sections agree on
// storage-key shape and behavior.
export function useCollapsed(key, defaultOpen) {
  const storageKey = `dash-section-open:${key}`;
  const [open, setOpen] = useState(() => {
    try {
      const v = localStorage.getItem(storageKey);
      return v === null ? defaultOpen : v === "1";
    } catch { return defaultOpen; }
  });
  useEffect(() => {
    try { localStorage.setItem(storageKey, open ? "1" : "0"); } catch { /* private mode etc. */ }
  }, [storageKey, open]);
  return [open, setOpen];
}
