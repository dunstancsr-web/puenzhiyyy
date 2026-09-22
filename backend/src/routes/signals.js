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
const { buildQueries, fetchHeadlines, sourceReputable } = require("../signals/feed");
const { contextFrom, readHeadline } = require("../signals/reader");
const { planQueries, MAX_ROUNDS } = require("../signals/planner");
const { findSameStory, MAX_DAYS_APART } = require("../signals/twins");
const { MAX_CORRECTIONS } = require("../signals/reader");
const { readEvents } = require("../db/audit");
const { chat, resolveTier, friendlyModel } = require("../llm/provider");
const demoAccess = require("../llm/demoAccess");

// A separate, scoped model choice, like ASK_DATABASE_MODEL: this is a classification
// task and is tuned on its own, not shared with the Why? button's benchmarked model.
const SIGNAL_READER_MODEL = process.env.SIGNAL_READER_MODEL || "llama3.1:8b";
const SCAN_COOLDOWN_MS = 45_000;   // a public server must not let a button hammer a news site and a model
const MAX_MODEL_READS = 16;        // per scan on the FREE local model (about 20 seconds); the rest wait for the next one
// PAID (22 Sep): the reader may run on Claude Sonnet instead, gated by the same demo
// PIN as Why?/Ask (see the scan route below). A cloud read costs real credit, so this
// cap is far smaller: a full 16 reads plus the agent's own extra headlines could be
// 20-30 paid calls in ONE press, a large slice of the shared LLM_DAILY_CALL_LIMIT for
// one click. The search planner (proposeQueries) is a separate decision and always
// stays on the free local model regardless of this, whatever the reader does; see
// planner.js, which never accepts a tier argument at all.
const MAX_MODEL_READS_CLOUD = 5;
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
const toRow = (r) => {
  const alsoReportedBy = parseList(r.also_reported_by) || [];
  return {
    ...r,
    affects_varieties: parseList(r.affects_varieties),
    excludes_varieties: parseList(r.excludes_varieties),
    also_reported_by: alsoReportedBy,
    // How many outlets reported this, counting the original: 1 means only one
    // source so far, which is not itself a reason to doubt it, just a fact for
    // a person weighing the signal alongside confidence and source_reputable.
    corroboration_count: 1 + alsoReportedBy.length,
    source_reputable: !!r.source_reputable,
  };
};
const round1 = (n) => Math.round(n * 10) / 10;

// The system's own memory of the reader's past mistakes (22 Sep): every time a
// person uses the "Read as" menus to fix a misread, that is already logged as a
// SIGNAL_DECIDED "edit" event (see the PATCH route below). This just reads the
// last few back out and hands them to reader.js as reminders, so the model does
// not have to make the same mistake on a similar headline every single scan.
// Reads more rows than MAX_CORRECTIONS from the log because not every
// SIGNAL_DECIDED event is an edit (approve, dismiss, withdraw, reopen also use
// it); filtering happens here, not in the query.
function recentCorrections() {
  return readEvents({ eventType: EVENTS.SIGNAL_DECIDED, limit: 50 })
    .filter((e) => e.input_data && e.input_data.decision === "edit")
    .slice(0, MAX_CORRECTIONS)
    .map((e) => ({ headline: e.input_data.headline, before: e.input_data.before, after: e.input_data.after }));
}

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
         event_type, severity, direction, affects_varieties, excludes_varieties, origin, extracted_by, fixture_id,
         confidence, source_reputable)
      VALUES (@headline, @summary, @source_name, @source_url, @published_at, @country_of_origin, @supplier,
              @event_type, @severity, @direction, @affects_varieties, @excludes_varieties, 'replay', 'hand', @fixture_id,
              'high', @source_reputable)
    `).run({
      supplier: null,
      ...fixture,
      affects_varieties: fixture.affects_varieties ? JSON.stringify(fixture.affects_varieties) : null,
      excludes_varieties: fixture.excludes_varieties ? JSON.stringify(fixture.excludes_varieties) : null,
      // A real, hand-entered historical event is confidence 'high' by definition: a
      // person verified it, not a model. source_reputable follows the same allow-list
      // as a live scan, so the flag means the same thing wherever it appears.
      source_reputable: sourceReputable(fixture.source_name) ? 1 : 0,
    });
    res.status(201).json({ success: true, data: listSignals(db) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Failed to load the replay event" });
  }
});

// POST /api/market-signals/scan
//   Fetch recent rice headlines, keep the ones that look relevant, read each into the
//   fixed shape (a LOCAL model by default, else a wordlist), and add what survives as
//   PENDING live signals. Nothing is accepted and nothing is ordered here.
//   Body may include { tier: "cloud" } (22 Sep) to read on Claude Sonnet instead of the
//   free local model, which needs the SAME demo PIN pass as Why?/Ask (X-Demo-Unlock
//   header), checked below exactly the way inventory.js's routes check it, and comes
//   with a far smaller per-scan read cap (see MAX_MODEL_READS_CLOUD above). The search
//   planner's own extra rounds always stay on the free local model regardless.
router.post("/market-signals/scan", sandboxOnlyWhenPublic, async (req, res) => {
  // Checked first, so a bad request neither starts a scan nor uses up the cooldown.
  const days = req.body?.days == null ? SCAN_DAYS.default : Number(req.body.days);
  if (!Number.isInteger(days) || days < SCAN_DAYS.min || days > SCAN_DAYS.max) {
    return res.status(400).json({ success: false, message: `Choose a whole number of days from ${SCAN_DAYS.min} to ${SCAN_DAYS.max}.` });
  }
  const wantsCloud = req.body?.tier === "cloud";
  if (wantsCloud && !demoAccess.passValid(req.get("X-Demo-Unlock"))) {
    const gate = demoAccess.gateStatus();
    return res.json({
      success: false,
      locked: gate.ok,
      message: gate.ok ? "Paid scanning is locked. Enter the demo PIN in Settings to unlock it." : gate.reason,
    });
  }
  const readerTier = wantsCloud ? "cloud" : "local";
  const maxModelReads = wantsCloud ? MAX_MODEL_READS_CLOUD : MAX_MODEL_READS;

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

    const fixedQueries = buildQueries(ctx.origins, days);
    const { items: fetched, errors } = await fetchHeadlines(fixedQueries, { maxAgeDays: days + 7 });
    // Reputable sources first (22 Sep): the model-read budget is limited (maxModelReads),
    // so within one scan, an outlet on feed.js's small allow-list is read before an
    // unrecognized one, stable otherwise (a JS sort is stable, so ties keep the feed's
    // own newest-first order). Nothing is ever dropped for being unrecognized, only
    // read later, and only when the budget is actually tight enough for order to matter.
    const items = [...fetched].sort((a, b) => Number(sourceReputable(b.source)) - Number(sourceReputable(a.source)));
    const hash = (it) => crypto.createHash("sha1").update(it.link).digest("hex").slice(0, 16);
    const seenStmt = db.prepare(`SELECT 1 FROM signal_seen WHERE url_hash = ?`);
    const markSeen = db.prepare(`INSERT OR IGNORE INTO signal_seen (url_hash, verdict) VALUES (?, ?)`);
    const insert = db.prepare(`
      INSERT OR IGNORE INTO market_signals
        (headline, summary, source_name, source_url, published_at, country_of_origin, supplier,
         event_type, severity, direction, affects_varieties, excludes_varieties, origin, extracted_by, fixture_id,
         confidence, source_reputable)
      VALUES (@headline, NULL, @source_name, @source_url, @published_at, @country_of_origin, NULL,
              @event_type, @severity, @direction, @affects_varieties, NULL, 'live', @extracted_by, @fixture_id,
              @confidence, @source_reputable)`);

    const findTwin = db.prepare(`
      SELECT id, also_reported_by FROM market_signals
       WHERE origin = 'live' AND status != 'dismissed' AND country_of_origin = ? AND event_type = ? AND direction = ?
         AND ABS(julianday(published_at) - julianday(?)) <= 7
       ORDER BY id LIMIT 1`);
    // Signals a new headline could be a repeat of: any live signal published within a week, in ANY state. A
    // dismissed one is included on purpose, so a syndicated copy cannot bring it back as a fresh question.
    const recentLive = db.prepare(`
      SELECT id, headline, also_reported_by, country_of_origin, published_at FROM market_signals
       WHERE origin = 'live' AND ABS(julianday(published_at) - julianday(?)) <= ${MAX_DAYS_APART}`);
    const tally = { fetched: items.length, agent_fetched: 0, already_read: 0, not_relevant: 0, merged: 0, added: 0, by_model: 0, by_rules: 0, waiting: 0, agent_queries: [], agent_rounds: [], errors };
    let modelReads = 0;
    let budgetExhausted = false;
    // Computed once per scan, not once per headline: the reminder list only
    // changes when a person corrects something, never mid-scan.
    const corrections = recentCorrections();
    const readerModel = wantsCloud ? (process.env.LLM_GATEWAY_MODEL || "claude-sonnet-4-5") : SIGNAL_READER_MODEL;
    // Two SEPARATE deps objects on purpose: readerDeps may carry tier "cloud" and a
    // cloud model id; plannerDeps never does, since planQueries's own chatFn call
    // hardcodes tier "local" regardless of what it is given, and passing a Sonnet
    // model id through as a local Ollama model override would just fail every local
    // call this scan, silently (planQueries swallows the error and returns no
    // queries, same as any other local-model-unavailable case, but for the wrong
    // reason). Keeping the objects separate avoids that mistake being possible.
    const readerDeps = { chatFn: chat, resolveTierFn: resolveTier, model: readerModel, corrections, tier: readerTier };
    const plannerDeps = { chatFn: chat, resolveTierFn: resolveTier, model: SIGNAL_READER_MODEL };

    // Reads one batch of headlines, mutating the shared tally and modelReads. Used
    // for both the fixed per-origin queries and, after them, the agent's own
    // queries, so the same caps (maxModelReads, SCAN_BUDGET_MS) bound both.
    async function readBatch(batch) {
      for (const it of batch) {
        const h = hash(it);
        if (seenStmt.get(h)) { tally.already_read++; continue; }
        if (Date.now() - started > SCAN_BUDGET_MS) { tally.waiting++; budgetExhausted = true; continue; }

        const r = await readHeadline(it, ctx, readerDeps);
        if (r.by && String(r.by).startsWith("model")) modelReads++;
        if (r.status === "signal") {
          // The same story reported by several outlets is ONE signal with several
          // sources, not several cards asking the same question.
          // Same story first, by the text of the headline (see signals/twins.js), then the older test by the
          // reader's reading. The text test comes first because the reader is not consistent: it can read one
          // headline two ways, and the reading test alone would then keep both.
          const sameStory = findSameStory(
            { title: it.title, published_at: it.published_at, country_of_origin: r.read.country_of_origin },
            recentLive.all(it.published_at).map((x) => ({ ...x, also_reported_by: parseList(x.also_reported_by) || [] })),
          );
          const twin = sameStory || findTwin.get(r.read.country_of_origin, r.read.event_type, r.read.direction, it.published_at);
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
            confidence: r.read.confidence || null,
            source_reputable: sourceReputable(it.source) ? 1 : 0,
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
        if (modelReads >= maxModelReads) {
          const rest = batch.slice(batch.indexOf(it) + 1).filter((x) => !seenStmt.get(hash(x)));
          tally.waiting += rest.length;
          budgetExhausted = true;
          break;
        }
      }
    }

    await readBatch(items);

    // The agentic step: up to MAX_ROUNDS rounds, each seeing what every earlier
    // round (fixed or agent) found and searched for, and each free to decide there
    // is nothing left worth searching for by returning an empty list, which ends
    // the loop early. Every round's queries and their yield are reported on the
    // tally, so a scan is never silently different from what the fixed query list
    // alone would have done.
    const knownLinks = new Set(items.map((it) => it.link));
    const askedQueries = [...fixedQueries];
    for (let round = 1; round <= MAX_ROUNDS && !budgetExhausted; round++) {
      const recentSignals = db.prepare(`
        SELECT country_of_origin, event_type, severity, headline FROM market_signals
         WHERE origin = 'live' ORDER BY id DESC LIMIT 8`).all();
      const agentQueries = await planQueries(ctx, recentSignals, plannerDeps, askedQueries);
      if (!agentQueries.length) break; // the model itself decided this scan is done
      askedQueries.push(...agentQueries.map((e) => e.query));
      const more = await fetchHeadlines(agentQueries.map((e) => e.query), { maxAgeDays: days + 7 });
      tally.errors.push(...more.errors);
      const fresh = more.items.filter((it) => !knownLinks.has(it.link));
      fresh.forEach((it) => knownLinks.add(it.link));
      await readBatch(fresh);
      // queries here are {query, reason} pairs: the reason is the model's own
      // words for why it asked, kept so a person reading this later sees the
      // thinking, not just the search string.
      tally.agent_rounds.push({ round, queries: agentQueries, fetched: fresh.length });
    }
    tally.agent_queries = tally.agent_rounds.flatMap((r) => r.queries);
    tally.agent_fetched = tally.agent_rounds.reduce((n, r) => n + r.fetched, 0);

    tally.seconds = Math.round((Date.now() - started) / 100) / 10;
    tally.reader = wantsCloud
      ? `${friendlyModel(readerModel)}, paid, capped at ${MAX_MODEL_READS_CLOUD} reads this scan`
      : resolveTier("local") === "local" ? `model ${SIGNAL_READER_MODEL} on this machine` : "wordlist only (no local model on this server)";
    tally.corrections_used = corrections.length;

    // Best-effort observability for the one step where a model chooses what to
    // look at. Logged even when the agent contributed nothing (agent_rounds is
    // empty), so "the agent looked and found nothing more" is as visible as
    // "the agent found three more leads".
    logEvent(EVENTS.SIGNAL_SCAN, {
      input: { days, fixed_queries: fixedQueries, corrections_used: corrections, reader_tier: readerTier },
      output: {
        fetched: tally.fetched, added: tally.added, by_model: tally.by_model, by_rules: tally.by_rules,
        agent_rounds: tally.agent_rounds, agent_fetched: tally.agent_fetched, seconds: tally.seconds,
        // paid_reads is the actual count of model calls this scan spent, when on the
        // cloud tier: the one figure the spend ledger needs, since chat()'s own paid
        // call counter is not otherwise attributable back to which feature spent it.
        paid_reads: wantsCloud ? tally.by_model : 0,
      },
    });
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
      // A replayed past event is practice: it shows what a signal would have done, and a buffer must only ever
      // come from news a person believes is happening now (Stan, 20 Sep).
      if (sig.origin === "replay") {
        return res.status(400).json({ success: false, message: "A past event is practice. It adds no buffer. Acknowledge it instead." });
      }
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
