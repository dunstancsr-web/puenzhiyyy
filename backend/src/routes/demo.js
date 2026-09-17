const express = require("express");
const router = express.Router();
const { enterDemoMode, exitDemoMode, isDemoModeActive, isInDemoContext } = require("../db/init");

// ─────────────────────────────────────────────────────────────────────────────
// DEMO MODE (MVP2 Day 7). Three small routes managing the shared in-memory
// sandbox — see db/init.js for the actual switching mechanism. No PIN, no
// login: Stan is the one demoing this live, and it can never reach the real
// database regardless of who clicks it (rules.md's "Working rules" gate on
// paid model spend, not on this — nothing here costs anything).
// ─────────────────────────────────────────────────────────────────────────────

const COOKIE_NAME = "stocksense_demo";
// No httpOnly: the frontend badge reads this cookie's presence isn't actually
// needed client-side (status comes from GET /demo/status), but keeping it
// readable costs nothing and avoids ever needing document.cookie tricks later.
const COOKIE_OPTS = { sameSite: "lax", path: "/" };

router.post("/demo/enter", (req, res) => {
  enterDemoMode();
  res.cookie(COOKIE_NAME, "1", COOKIE_OPTS);
  res.json({ success: true, data: { active: true } });
});

router.post("/demo/exit", (req, res) => {
  // Shared, not per-visitor (see db/init.js): exiting ends the sandbox for
  // anyone else currently in it too, matching "Stan is the one demoing this
  // live" rather than pretending this is a private session.
  exitDemoMode();
  res.clearCookie(COOKIE_NAME, { path: "/" });
  res.json({ success: true, data: { active: false } });
});

router.get("/demo/status", (req, res) => {
  const cookies = req.headers.cookie || "";
  const hasCookie = cookies.split(";").map((c) => c.trim()).includes(`${COOKIE_NAME}=1`);
  res.json({ success: true, data: { active: hasCookie && isDemoModeActive() } });
});

// Fills the sandbox with the same 10-SKU dataset `npm run seed` builds for the
// real database — safe here specifically because seed()'s own getDb() call
// resolves to whatever database THIS request is running against, and
// isInDemoContext() (checked, not just the cookie) refuses to run at all
// unless that's the demo sandbox. Lets someone exploring the demo skip past
// onboarding's upload step instead of needing a CSV on hand.
router.post("/demo/seed-sample", (req, res) => {
  if (!isInDemoContext()) {
    return res.status(403).json({ success: false, message: "Sample data can only be seeded in demo mode." });
  }
  try {
    require("../db/seed").seed();
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Failed to seed sample data" });
  }
});

module.exports = router;
module.exports.COOKIE_NAME = COOKIE_NAME;
