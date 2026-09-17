const express = require("express");
const router = express.Router();
const { enterDemoMode, exitDemoMode, isDemoModeActive } = require("../db/init");

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

module.exports = router;
module.exports.COOKIE_NAME = COOKIE_NAME;
