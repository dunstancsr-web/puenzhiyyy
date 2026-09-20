// ─────────────────────────────────────────────────────────────────────────────
// SAME STORY DETECTION
//
// The same news arrives many times: syndicated copies, and one story reworded by each outlet (the Pakistan
// and Saudi Arabia food export story came in about eight wordings in one scan). Each copy should be ONE signal
// with several sources, not a new card asking the same question.
//
// The old test compared the model's READING (same country, event type and direction). The reader is not
// consistent, so the same headline could be read two ways and never match, and a signal the person had
// dismissed was not compared at all, so a syndicated copy brought it back. This compares the TEXT.
//
// A text score alone is wrong in a way that matters here: "India bans non-basmati exports" and "India lifts
// ban on non-basmati exports" score 0.63, and merging them would hide a lifting behind a ban. So two guards
// sit on top of the score, and a merge needs all of them. A wrong merge hides news; a missed one only costs a
// card, so every guard leans toward NOT merging.
//
// Thresholds were set on 236 real headlines fetched on 20 Sep 2026: every pair at or above 0.6 was either the
// same story or an irrelevant list article, and no pair of relevant different stories reached it.
// ─────────────────────────────────────────────────────────────────────────────

const SAME_STORY_SCORE = 0.6;   // enough when the country agrees
const ANY_COUNTRY_SCORE = 0.9;  // enough on its own, whatever country the reader chose
const MAX_DAYS_APART = 7;

const STOP = new Set("a an the of to in on for and or as at by is are was be with from that this its it new says say after over into amid".split(" "));

// Words that push the same subject in opposite directions. If two headlines use opposite ones, they are
// different developments however alike the rest looks.
const SIDES = [
  [/^(bans?|banned|imposes?|imposed|restricts?|restricted|curbs?|curbed|suspends?|suspended|halts?|halted|blocks?|blocked)$/,
   /^(lifts?|lifted|scraps?|scrapped|removes?|removed|relaxes?|relaxed|resumes?|resumed|ends?|ended|eases|eased|reopens?|reopened)$/],
  [/^(rises?|rose|rising|hikes?|hiked|surges?|surged|jumps?|jumped|gains?|gained|climbs?|climbed|higher|increases?|increased)$/,
   /^(falls?|fell|falling|drops?|dropped|cuts?|declines?|declined|slumps?|slumped|lower|decreases?|decreased|plunges?|plunged)$/],
];

// Spellings that differ between outlets but mean the same thing, folded to one form before comparing.
function canon(title) {
  return String(title || "")
    .toLowerCase()
    .replace(/[‘’`]/g, "'")
    .replace(/\b(gov't|govt)\b/g, "government")
    .replace(/\btonnes?\b|\btons?\b/g, "tonnes")
    .replace(/\busd\s*/g, "$")
    .replace(/\$\s*(\d[\d,.]*)\s*(billion|bn|b)\b/g, "$$$1bn")
    .replace(/(\d[\d,.]*)\s*(billion|bn)\b/g, "$$$1bn")
    .replace(/\b(pc|percent|per cent)\b|%/g, " pct ")
    .replace(/'s\b/g, "");
}

function tokens(title) {
  return canon(title).replace(/[^a-z0-9$\s-]/g, " ").split(/\s+/).filter((w) => w && !STOP.has(w));
}

const numbers = (title) => new Set((canon(title).match(/\d[\d,]*\.?\d*/g) || []).map((n) => n.replace(/,/g, "").replace(/\.$/, "")));

function similarity(a, b) {
  const A = new Set(tokens(a));
  const B = new Set(tokens(b));
  let both = 0;
  for (const w of A) if (B.has(w)) both++;
  return both / (A.size + B.size - both || 1);
}

/** True when the headlines point opposite ways on the same subject ("bans" against "lifts"). */
function opposed(a, b) {
  const wa = tokens(a);
  const wb = tokens(b);
  // Each headline is judged by the FIRST direction word it uses, because the verb comes early and later words
  // are often the object: "India lifts ban on..." is a lifting although it also contains "ban", and "rates rise
  // as lower rainfall fuels..." is a rise although it also contains "lower". If two headlines disagree on that
  // first word they are not merged. Where this errs it errs toward NOT merging ("ban lifted" against "lifts
  // ban" are the same story and stay apart), which costs a card, not a hidden headline.
  const side = (words, [x, y]) => {
    for (const w of words) { if (x.test(w)) return "x"; if (y.test(w)) return "y"; }
    return null;
  };
  return SIDES.some((pair) => {
    const sa = side(wa, pair);
    const sb = side(wb, pair);
    return sa && sb && sa !== sb;
  });
}

/** Two headlines that both state figures must share one, or they are reporting different developments. */
function figuresAgree(a, b) {
  const na = numbers(a);
  const nb = numbers(b);
  if (!na.size || !nb.size) return true;
  for (const n of na) if (nb.has(n)) return true;
  return false;
}

/**
 * Is `item` the same story as an existing signal?
 *   item:  { title, published_at, country_of_origin }   (country is the reader's, may be null)
 *   sig:   { headline, also_reported_by: [{ title }], country_of_origin, published_at }
 * A signal is compared through its own headline AND the other wordings already merged into it, so a story
 * that drifts in wording over a day (each copy close to the last, not to the first) still gathers.
 */
function sameStory(item, sig) {
  const days = Math.abs(Date.parse(item.published_at) - Date.parse(sig.published_at)) / 86_400_000;
  if (!(days <= MAX_DAYS_APART)) return false;
  const others = [sig.headline, ...(sig.also_reported_by || []).map((x) => x.title)].filter(Boolean);
  const sameCountry = !!item.country_of_origin && item.country_of_origin === sig.country_of_origin;
  return others.some((t) => {
    const score = similarity(item.title, t);
    return (score >= ANY_COUNTRY_SCORE || (score >= SAME_STORY_SCORE && sameCountry))
      && !opposed(item.title, t) && figuresAgree(item.title, t);
  });
}

/** The first signal in `candidates` that `item` is a repeat of, or null. */
const findSameStory = (item, candidates) => candidates.find((c) => sameStory(item, c)) || null;

module.exports = { sameStory, findSameStory, similarity, opposed, figuresAgree, SAME_STORY_SCORE, ANY_COUNTRY_SCORE, MAX_DAYS_APART };
