// ─────────────────────────────────────────────────────────────────────────────
// MARKET SIGNAL ROUTES
//
// The feature in one line: news moves what a SKU's stock is worth to you, the
// engine says how, and a person decides. Nothing here calls a model and nothing
// here places an order. See engines/signals.js for the maths and why the days
// come from a table.
//
//   GET  /api/market-signals               every signal with its portfolio assessment,
//                                          plus the replay events not yet loaded
//   POST /api/market-signals/replay        { fixture_id } load a real past event
//   POST /api/market-signals/:id/decision  { decision: approve | dismiss | withdraw }
//
// Approving adds a risk_events row (the buffer the reorder point already reads),
// scoped by variety, so every existing figure reflects it and can be traced back
// to the signal. It is the only write that touches anything but this table.
// ─────────────────────────────────────────────────────────────────────────────

const express = require("express");
const router = express.Router();
const { getDb } = require("../db/init");
const { EVENTS, logEvent } = require("../db/audit");
const { buildAnalytics } = require("../engines/index");
const { assessSignal, playbookDays, PLAYBOOK, EVENT_TYPES, SEVERITIES, DIRECTIONS } = require("../engines/signals");
const { MAX_BUFFER_DAYS } = require("../engines/riskbuffer");
const { REPLAY_EVENTS } = require("../db/replayEvents");
const crypto = require("crypto");
const { sandboxOnlyWhenPublic } = require("../middleware/sandboxGuard");
const { buildQueries, fetchHeadlines } = require("../signals/feed");
const { contextFrom, readHeadline } = require("../signals/reader");
const { chat, resolveTier } = require("../llm/provider");

// A separate, scoped model choice, like ASK_DATABASE_MODEL: this is a classification
// task and is tuned on its own, not shared with the Why? button's benchmarked model.
const SIGNAL_READER_MODEL = process.env.SIGNAL_READER_MODEL || "llama3.1:8b";
const SCAN_COOLDOWN_MS = 45_000;   // a public server must not let a button hammer a news site and a model
const MAX_MODEL_READS = 16;        // per scan (about 20 seconds on the local model); the rest wait for the next one
const SCAN_BUDGET_MS = 75_000;
// How far back a scan may look, in whole days. The page reads these limits from the server (see the
// payload below), so there is one owner. A month is the ceiling because a scan reads at most
// MAX_MODEL_READS headlines: a longer window mostly finds older stories that wait for the next scan.
const SCAN_DAYS = { min: 1, max: 30, default: 14 };
let lastScanAt = 0;
let scanning = false;

const parseList = (raw) => {
  if (!raw) return null;
  try { const v = JSON.parse(raw); return Array.isArray(v) ? v : null; } catch { return null; }
};
const toRow = (r) => ({
  ...r,
  affects_varieties: parseList(r.affects_varieties),
  excludes_varieties: parseList(r.excludes_varieties),
  also_reported_by: parseList(r.also_reported_by) || [],
});
const round1 = (n) => Math.round(n * 10) / 10;

function listSignals(db) {
  const { skus } = buildAnalytics(db);
  const rows = db.prepare(`
    SELECT * FROM market_signals
     ORDER BY CASE status WHEN 'pending' THEN 0 WHEN 'approved' THEN 1 ELSE 2 END, published_at DESC, id DESC
  `).all().map(toRow);

  const bySku = new Map(skus.map((k) => [k.sku_id, k]));
  const signals = rows.map((s) => {
    const assessment = assessSignal(s, skus);
    // What approving would really do to each product's buffer. The engine caps the
    // total (riskbuffer.js), and a product already carrying an earlier event may
    // gain less than the signal's own figure, so the button must not overpromise.
    // Once approved the buffer is already inside risk_buffer_days, so only pending
    // signals get a before and after.
    if (s.status === "pending" && assessment.playbook) {
      const add = round1((assessment.playbook[0] + assessment.playbook[1]) / 2);
      for (const e of assessment.exposures) {
        const now = bySku.get(e.sku_id)?.risk_buffer_days ?? 0;
        e.buffer_now_days = now;
        e.buffer_after_days = round1(Math.min(MAX_BUFFER_DAYS, now + add));
        e.buffer_capped = now + add > MAX_BUFFER_DAYS;
      }
    }
    return { ...s, assessment };
  });
  const loaded = new Set(rows.map((r) => r.fixture_id));
  const catalog = REPLAY_EVENTS
    .filter((e) => !loaded.has(e.fixture_id))
    .map(({ fixture_id, published_at, headline, source_name }) => ({ fixture_id, published_at, headline, source_name }));
  const origins = [...new Set(skus.map((k) => k.country_of_origin).filter(Boolean))];
  return { signals, catalog, playbook: PLAYBOOK, max_buffer_days: MAX_BUFFER_DAYS, scan_days: SCAN_DAYS, origins, event_types: EVENT_TYPES, severities: SEVERITIES, directions: DIRECTIONS };
}

router.get("/market-signals", (req, res) => {
  try {
    res.json({ success: true, data: listSignals(getDb()) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Failed to load market signals" });
  }
});

router.post("/market-signals/replay", sandboxOnlyWhenPublic, (req, res) => {
  const fixture = REPLAY_EVENTS.find((e) => e.fixture_id === req.body?.fixture_id);
  if (!fixture) return res.status(404).json({ success: false, message: "Unknown replay event" });
  try {
    const db = getDb();
    db.prepare(`
      INSERT OR IGNORE INTO market_signals
        (headline, summary, source_name, source_url, published_at, country_of_origin, supplier,
         event_type, severity, direction, affects_varieties, excludes_varieties, origin, extracted_by, fixture_id)
      VALUES (@headline, @summary, @source_name, @source_url, @published_at, @country_of_origin, @supplier,
              @event_type, @severity, @direction, @affects_varieties, @excludes_varieties, 'replay', 'hand', @fixture_id)
    `).run({
      supplier: null,
      ...fixture,
      affects_varieties: fixture.affects_varieties ? JSON.stringify(fixture.affects_varieties) : null,
      excludes_varieties: fixture.excludes_varieties ? JSON.stringify(fixture.excludes_varieties) : null,
    });
    res.status(201).json({ success: true, data: listSignals(db) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Failed to load the replay event" });
  }
});

// POST /api/market-signals/scan
//   Fetch recent rice headlines, keep the ones that look relevant, read each into the
//   fixed shape (a LOCAL model, else a wordlist), and add what survives as PENDING live
//   signals. Nothing is accepted and nothing is ordered here. The paid tier is
//   unreachable from this route (see signals/reader.js).
router.post("/market-signals/scan", sandboxOnlyWhenPublic, async (req, res) => {
  // Checked first, so a bad request neither starts a scan nor uses up the cooldown.
  const days = req.body?.days == null ? SCAN_DAYS.default : Number(req.body.days);
  if (!Number.isInteger(days) || days < SCAN_DAYS.min || days > SCAN_DAYS.max) {
    return res.status(400).json({ success: false, message: `Choose a whole number of days from ${SCAN_DAYS.min} to ${SCAN_DAYS.max}.` });
  }
  const wait = SCAN_COOLDOWN_MS - (Date.now() - lastScanAt);
  if (scanning) return res.status(409).json({ success: false, message: "A scan is already running." });
  if (wait > 0) return res.status(429).json({ success: false, message: `Scanned a moment ago. Try again in ${Math.ceil(wait / 1000)} seconds.` });
  scanning = true;
  lastScanAt = Date.now();
  const started = Date.now();
  try {
    const db = getDb();
    const skus = db.prepare(`SELECT country_of_origin, supplier FROM skus WHERE active = 1`).all();
    const ctx = contextFrom(skus);
    if (!ctx.origins.length) {
      return res.status(400).json({ success: false, message: "Add products first: the scan looks for news about the countries you buy from." });
    }

    const { items, errors } = await fetchHeadlines(buildQueries(ctx.origins, days), { maxAgeDays: days + 7 });
    const hash = (it) => crypto.createHash("sha1").update(it.link).digest("hex").slice(0, 16);
    const seenStmt = db.prepare(`SELECT 1 FROM signal_seen WHERE url_hash = ?`);
    const markSeen = db.prepare(`INSERT OR IGNORE INTO signal_seen (url_hash, verdict) VALUES (?, ?)`);
    const insert = db.prepare(`
      INSERT OR IGNORE INTO market_signals
        (headline, summary, source_name, source_url, published_at, country_of_origin, supplier,
         event_type, severity, direction, affects_varieties, excludes_varieties, origin, extracted_by, fixture_id)
      VALUES (@headline, NULL, @source_name, @source_url, @published_at, @country_of_origin, NULL,
              @event_type, @severity, @direction, @affects_varieties, NULL, 'live', @extracted_by, @fixture_id)`);

    const findTwin = db.prepare(`
      SELECT id, also_reported_by FROM market_signals
       WHERE origin = 'live' AND status != 'dismissed' AND country_of_origin = ? AND event_type = ? AND direction = ?
         AND ABS(julianday(published_at) - julianday(?)) <= 7
       ORDER BY id LIMIT 1`);
    const tally = { fetched: items.length, already_read: 0, not_relevant: 0, merged: 0, added: 0, by_model: 0, by_rules: 0, waiting: 0, errors };
    let modelReads = 0;
    const deps = { chatFn: chat, resolveTierFn: resolveTier, model: SIGNAL_READER_MODEL };

    for (const it of items) {
      const h = hash(it);
      if (seenStmt.get(h)) { tally.already_read++; continue; }
      if (Date.now() - started > SCAN_BUDGET_MS) { tally.waiting++; continue; }

      const r = await readHeadline(it, ctx, deps);
      if (r.by && String(r.by).startsWith("model")) modelReads++;
      if (r.status === "signal") {
        // The same story reported by several outlets is ONE signal with several
        // sources, not several cards asking the same question.
        const twin = findTwin.get(r.read.country_of_origin, r.read.event_type, r.read.direction, it.published_at);
        if (twin) {
          const also = parseList(twin.also_reported_by) || [];
          if (also.length < 6) also.push({ title: it.title, source: it.source, url: it.link });
          db.prepare(`UPDATE market_signals SET also_reported_by = ? WHERE id = ?`).run(JSON.stringify(also), twin.id);
          tally.merged++;
          markSeen.run(h, "merged");
          continue;
        }
        insert.run({
          headline: it.title, source_name: it.source, source_url: it.link, published_at: it.published_at,
          country_of_origin: r.read.country_of_origin, event_type: r.read.event_type, severity: r.read.severity,
          direction: r.read.direction,
          affects_varieties: r.read.affects_varieties ? JSON.stringify(r.read.affects_varieties) : null,
          extracted_by: r.by, fixture_id: `live:${h}`,
        });
        tally.added++;
        if (String(r.by).startsWith("model")) tally.by_model++; else tally.by_rules++;
        markSeen.run(h, "signal");
      } else {
        tally.not_relevant++;
        markSeen.run(h, r.status);
      }
      // Bound the slow part. Anything past the cap is left unread, not marked seen,
      // so the next scan picks it up.
      if (modelReads >= MAX_MODEL_READS) {
        const rest = items.slice(items.indexOf(it) + 1).filter((x) => !seenStmt.get(hash(x)));
        tally.waiting += rest.length;
        break;
      }
    }

    tally.seconds = Math.round((Date.now() - started) / 100) / 10;
    tally.reader = resolveTier("local") === "local" ? `model ${SIGNAL_READER_MODEL} on this machine` : "wordlist only (no local model on this server)";
    res.json({ success: true, data: { ...listSignals(db), scan: tally } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "The news scan failed" });
  } finally {
    scanning = false;
  }
});

// PATCH /api/market-signals/:id  { country_of_origin, event_type, severity, direction }
//   A person correcting how a headline was read. The reader is right about three
//   times in four, so the screen lets the reading be fixed; the assessment is
//   arithmetic and simply recomputes. Only a pending signal can be corrected.
router.patch("/market-signals/:id", sandboxOnlyWhenPublic, (req, res) => {
  try {
    const db = getDb();
    const sig = db.prepare(`SELECT * FROM market_signals WHERE id = ?`).get(req.params.id);
    if (!sig) return res.status(404).json({ success: false, message: "No such signal" });
    if (sig.status !== "pending") return res.status(409).json({ success: false, message: `Already ${sig.status}` });

    const b = req.body || {};
    const origins = db.prepare(`SELECT DISTINCT country_of_origin AS c FROM skus WHERE active = 1 AND country_of_origin IS NOT NULL`).all().map((x) => x.c);
    const country = origins.find((o) => o.toLowerCase() === String(b.country_of_origin || "").toLowerCase());
    if (!country) return res.status(400).json({ success: false, message: "Pick one of the countries you buy from" });
    if (!EVENT_TYPES.includes(b.event_type)) return res.status(400).json({ success: false, message: "Unknown event type" });
    if (!SEVERITIES.includes(b.severity)) return res.status(400).json({ success: false, message: "Unknown severity" });
    if (!DIRECTIONS.includes(b.direction)) return res.status(400).json({ success: false, message: "Unknown direction" });

    const before = { country_of_origin: sig.country_of_origin, event_type: sig.event_type, severity: sig.severity, direction: sig.direction };
    const after = { country_of_origin: country, event_type: b.event_type, severity: b.severity, direction: b.direction };
    if (JSON.stringify(before) === JSON.stringify(after)) return res.json({ success: true, data: listSignals(db) });

    const by = /corrected by a person/.test(sig.extracted_by) ? sig.extracted_by : `${sig.extracted_by} (corrected by a person)`;
    db.prepare(`UPDATE market_signals SET country_of_origin = ?, event_type = ?, severity = ?, direction = ?, extracted_by = ? WHERE id = ?`)
      .run(after.country_of_origin, after.event_type, after.severity, after.direction, by, sig.id);
    logEvent(EVENTS.SIGNAL_DECIDED, {
      input: { signal_id: sig.id, headline: sig.headline, decision: "edit", before, after },
      output: { status: "pending" },
    });
    res.json({ success: true, data: listSignals(db) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Failed to correct the signal" });
  }
});

router.post("/market-signals/:id/decision", sandboxOnlyWhenPublic, (req, res) => {
  const { decision } = req.body || {};
  const decidedBy = String(req.body?.decided_by || "Manager").slice(0, 60);
  if (!["approve", "dismiss", "withdraw", "reopen"].includes(decision)) {
    return res.status(400).json({ success: false, message: "decision must be approve, dismiss, withdraw or reopen" });
  }
  try {
    const db = getDb();
    const sig = db.prepare(`SELECT * FROM market_signals WHERE id = ?`).get(req.params.id);
    if (!sig) return res.status(404).json({ success: false, message: "No such signal" });

    let riskEventId = sig.risk_event_id;
    let bufferDays = null;
    let status;

    if (decision === "approve") {
      if (sig.status !== "pending") return res.status(409).json({ success: false, message: `Already ${sig.status}` });
      const range = sig.direction === "tightens" ? playbookDays(sig.event_type, sig.severity) : null;
      if (!range) {
        return res.status(400).json({ success: false, message: "This signal eases pressure, so there is no buffer to add. Acknowledge it instead." });
      }
      // The midpoint of the playbook range: a single number the reorder point can
      // carry, chosen so neither end of the range is ignored.
      bufferDays = round1((range[0] + range[1]) / 2);
      status = "approved";
      db.transaction(() => {
        const info = db.prepare(`
          INSERT INTO risk_events
            (label, country_of_origin, supplier, severity, buffer_days_add, active, is_illustrative, notes, affects_varieties, excludes_varieties)
          VALUES (?, ?, ?, ?, ?, 1, 0, ?, ?, ?)`)
          .run(sig.headline.slice(0, 140), sig.country_of_origin, sig.supplier, sig.severity, bufferDays,
            `From market signal #${sig.id} (${sig.source_name || "source"}), approved by ${decidedBy}`,
            sig.affects_varieties, sig.excludes_varieties);
        riskEventId = info.lastInsertRowid;
        db.prepare(`UPDATE market_signals SET status = 'approved', decided_at = datetime('now'), decided_by = ?, risk_event_id = ? WHERE id = ?`)
          .run(decidedBy, riskEventId, sig.id);
      })();
    } else if (decision === "dismiss") {
      if (sig.status !== "pending") return res.status(409).json({ success: false, message: `Already ${sig.status}` });
      status = "dismissed";
      db.prepare(`UPDATE market_signals SET status = 'dismissed', decided_at = datetime('now'), decided_by = ? WHERE id = ?`).run(decidedBy, sig.id);
    } else if (decision === "reopen") {
      // The undo for a dismissal (including "Acknowledge all"). Only a dismissed signal can come back: an
      // approved one has already added a buffer, and taking that back is a withdrawal, which is its own step.
      if (sig.status !== "dismissed") return res.status(409).json({ success: false, message: "Only a dismissed signal can be reopened" });
      status = "pending";
      db.prepare(`UPDATE market_signals SET status = 'pending', decided_at = NULL, decided_by = NULL WHERE id = ?`).run(sig.id);
    } else {
      if (sig.status !== "approved") return res.status(409).json({ success: false, message: "Only an approved signal can be withdrawn" });
      status = "withdrawn";
      db.transaction(() => {
        if (sig.risk_event_id) db.prepare(`UPDATE risk_events SET active = 0 WHERE id = ?`).run(sig.risk_event_id);
        db.prepare(`UPDATE market_signals SET status = 'withdrawn', decided_at = datetime('now'), decided_by = ? WHERE id = ?`).run(decidedBy, sig.id);
      })();
    }

    logEvent(EVENTS.SIGNAL_DECIDED, {
      input: { signal_id: sig.id, headline: sig.headline, decision, decided_by: decidedBy, origin: sig.origin },
      output: { status, risk_event_id: riskEventId, buffer_days: bufferDays },
    });

    res.json({ success: true, data: listSignals(db) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Failed to record the decision" });
  }
});

module.exports = router;
