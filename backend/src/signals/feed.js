// ─────────────────────────────────────────────────────────────────────────────
// NEWS FEED (Google News RSS search)
//
// Headlines and links only, no article text, no key, no account. Tested 19 Sep
// 2026: HTTP 200 with 37 items in about a second. GDELT was tried first and
// answered 429 asking for one request per five seconds, so it is the fallback,
// not the source.
//
// CAVEATS, on purpose stated where the code is: this is an unofficial route into
// Google News and its terms of use for automated access were NOT checked. Fine
// for a hackathon prototype; a production system would license a news feed. The
// scan is also rate limited by the route, so this can never be hammered from the
// UI.
//
// Network access is injected (`fetchImpl`) so tests never touch the internet.
// ─────────────────────────────────────────────────────────────────────────────

const DAY_MS = 86_400_000;
const MAX_ITEM_AGE_DAYS = 21;

const ENTITIES = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'", "&apos;": "'", "&nbsp;": " " };
const decode = (s) =>
  String(s || "")
    .replace(/<!\[CDATA\[(.*?)\]\]>/gs, "$1")
    .replace(/&(?:amp|lt|gt|quot|apos|nbsp|#39);/g, (m) => ENTITIES[m] || m)
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/** One query per origin we import from, plus one general one, each looking back 14 days. */
function buildQueries(origins) {
  const terms = "(export OR ban OR duty OR quota OR flood OR typhoon OR drought OR port OR strike OR price OR shortage)";
  const qs = origins.map((o) => `rice ${o} ${terms} when:14d`);
  qs.push(`rice exporters restrictions OR "export ban" OR "export duty" when:14d`);
  return qs;
}

const rssUrl = (q) => `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=en-SG&gl=SG&ceid=SG:en`;

/** Parse RSS text into headline items. Pure, so it can be tested on a fixture. */
function parseRss(xml) {
  const items = [];
  for (const m of String(xml).matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const block = m[1];
    const pick = (tag) => (block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`)) || [])[1];
    let title = decode(pick("title"));
    const source = decode(pick("source")) || null;
    // Google appends " - Publisher" to every title; the publisher is shown
    // separately, so the headline is stored without it.
    if (source && title.endsWith(` - ${source}`)) title = title.slice(0, -(source.length + 3)).trim();
    const link = decode(pick("link"));
    const when = new Date(decode(pick("pubDate")));
    if (!title || !link || Number.isNaN(when.getTime())) continue;
    items.push({ title, link, source, published_at: when.toISOString().slice(0, 10), published_ms: when.getTime() });
  }
  return items;
}

/**
 * Fetch every query in turn (spaced, never in parallel) and return one deduplicated,
 * newest-first list. A failed query is skipped and reported, not fatal.
 */
async function fetchHeadlines(queries, { fetchImpl = fetch, now = Date.now(), pauseMs = 400, timeoutMs = 8000 } = {}) {
  const seen = new Set();
  const items = [];
  const errors = [];
  for (const q of queries) {
    try {
      const res = await fetchImpl(rssUrl(q), {
        headers: { "User-Agent": "StockSense-hackathon-prototype/1.0" },
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      for (const it of parseRss(await res.text())) {
        if (now - it.published_ms > MAX_ITEM_AGE_DAYS * DAY_MS) continue;
        const key = it.link || it.title.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        items.push(it);
      }
    } catch (e) {
      errors.push(`${q.slice(0, 30)}: ${e.message}`);
    }
    if (pauseMs) await new Promise((r) => setTimeout(r, pauseMs));
  }
  items.sort((a, b) => b.published_ms - a.published_ms);
  return { items, errors };
}

module.exports = { buildQueries, parseRss, fetchHeadlines, rssUrl, decode, MAX_ITEM_AGE_DAYS };
