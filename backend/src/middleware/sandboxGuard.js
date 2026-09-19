// On a public deployment the handheld PINs are printed on the login screen and any
// visitor can reach the app, so a write that changes the one real database every
// other visitor is looking at (a stock movement, or accepting a market signal, which
// adds a buffer to real reorder points) is accepted only inside the demo sandbox.
// Reads stay open, and so does a development machine.
// ALLOW_LIVE_WAREHOUSE_WRITES=1 lifts it for the owner's own recording session on
// the live data. `needs_demo` lets the screen offer to join the sandbox instead of
// showing a dead end.

const { isInDemoContext } = require("../db/init");

function sandboxOnlyWhenPublic(req, res, next) {
  const isPublic = process.env.NODE_ENV === "production" && process.env.ALLOW_LIVE_WAREHOUSE_WRITES !== "1";
  if (isPublic && !isInDemoContext()) {
    return res.status(403).json({
      success: false,
      needs_demo: true,
      message: "Changes on this server are recorded in the demo sandbox only, so they cannot disturb the shared data. Join the demo to continue.",
    });
  }
  next();
}

module.exports = { sandboxOnlyWhenPublic };
