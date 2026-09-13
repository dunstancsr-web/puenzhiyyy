import { useState, useEffect } from "react";

// ─────────────────────────────────────────────────────────────────────────────
// WHAT KIND OF DEVICE IS THIS? (TASK-80)
//
// Home says "For this device" over one group of workspaces, and until now that
// was a hardcoded claim: Control Tower was always the answer, so opening the
// page on a phone told the user that the desktop workspace was the one for the
// phone. A label that asserts something the code never checks is worse than no
// label, so this checks it.
//
// THE SIGNAL IS `pointer: coarse`, NOT WIDTH.
//
// Width answers "how much room is there", which is the right question for
// layout and the wrong one here. A desktop window dragged narrow is still a
// desktop with a mouse, and a tablet held in landscape is still a touch device
// at 1024px. `pointer: coarse` asks whether the PRIMARY input is a finger,
// which is the actual question behind "can you use a barcode scanner and one
// hand on this?".
//
// It is not a perfect signal and is not treated as one. A laptop with a
// touchscreen reports coarse on some browsers, so this only ever changes the
// ORDER AND LABELLING of the workspaces. Nothing is hidden, and every
// workspace stays one tap away, so being wrong costs a reader some scrolling
// rather than access.
//
// User-agent sniffing was the other option and was rejected: it is a list of
// strings that goes stale, browsers actively lie in it, and it answers "what
// is this software called" rather than "how is this being touched".
// ─────────────────────────────────────────────────────────────────────────────

const COARSE = "(pointer: coarse)";

function readCoarse() {
  try {
    return typeof window.matchMedia === "function" && window.matchMedia(COARSE).matches;
  } catch {
    // Some embedded webviews throw rather than returning false. A desktop
    // answer is the safer default: it puts the analysis workspace first, and
    // the floor flows are still right there under the second label.
    return false;
  }
}

/** Returns "handheld" or "desktop". Follows the device if it changes. */
export default function useDeviceClass() {
  const [coarse, setCoarse] = useState(readCoarse);

  // A tablet switching to a paired keyboard and trackpad flips this while the
  // page is open, and it is the same listener shape the theme uses.
  useEffect(() => {
    let mq;
    try {
      mq = window.matchMedia(COARSE);
    } catch {
      return;
    }
    if (!mq || typeof mq.addEventListener !== "function") return;
    const onChange = (e) => setCoarse(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  return coarse ? "handheld" : "desktop";
}
