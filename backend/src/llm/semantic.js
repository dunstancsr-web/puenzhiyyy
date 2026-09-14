// ─────────────────────────────────────────────────────────────────────────────
// SEMANTIC CHECKS: sentences that are wrong while every figure is real (TASK-96)
//
// verifyExplanation (explain.js) proves each FIGURE came from the engine.
// These catch the failure it cannot see, which is real figures put in the wrong
// relationship. Every check here exists because of an observed answer:
//
//   "580 MT exceeds the maximum policy level of 400 MT by 220 MT"      Sonnet
//      all three real; 580 is available stock, the overstock is on-hand
//   "our current stock level of 290 MT is reaching its maximum capacity" llama3
//      a low-stock REORDER alert described as full
//   "does not meet the approved reorder point (250 MT)"                 llama3
//      when the alert had fired on a different threshold
//   "The inventory position has reached 250 MT"                        Sonnet
//      250 was the reorder point; the position was 230
//
// ONE implementation, used by the production pipeline (runExplanation treats a
// hit as dangerous: retry, then reject) and by scripts/bench-models.js. The
// benchmark used to hold its own copy, which is how a check gets fixed in one
// place and not the other.
//
// A check here costs a paid retry whenever it fires, so each one is tested
// against the real failures above, against correct sentences, and against
// every alert sentence the engine itself writes, which are correct by
// construction and must never be flagged. Every issue carries the offending
// sentence after " :: " so a false alarm can be read, not guessed at.
// ─────────────────────────────────────────────────────────────────────────────

const LOW_STOCK = new Set(["STOCKOUT_RISK", "REORDER"]);
const HIGH_STOCK = new Set(["OVERSTOCK", "SLOW_MOVING", "IDLE"]);

const NUM = "(\\d[\\d,]*(?:\\.\\d+)?)";
const toNumber = (s) => Number(String(s).replace(/,/g, ""));
const mtNumbers = (s) => [...s.matchAll(new RegExp(`${NUM}\\s*MT\\b`, "g"))].map((m) => toNumber(m[1]));
const close = (a, b) => Math.abs(a - b) <= 0.5;
const present = (v) => v !== null && v !== undefined && v !== "" && Number.isFinite(Number(v));

// A sentence that negates its own verb is giving the opposite advice to the
// one a keyword search would read. "Do not place any new orders" and "without
// carrying excess stock" are both correct, and both were flagged by earlier
// versions that had no negation handling.
// "before placing another order" defers ordering rather than advising it, and
// was flagged in the 15 Sep baseline. Deliberately "before" + an ordering verb
// only: "place an order before stock runs out" is still advice to order.
const NEGATED = /\b(not|no|never|without|avoid|stop|pause|halt|suspend|defer|delay|hold off|refrain|instead of|rather than)\b|n't\b|\bbefore\s+(?:placing|ordering|reordering|replenishing|buying)\b/i;

// Named quantities and the value(s) a figure attached to them must equal.
// "on hand" accepts available stock too, because the engine's own IDLE message
// says "78 MT on hand" for available stock; flagging the engine's wording in
// the model's mouth would be a false alarm.
function namedQuantities(sku) {
  return [
    { label: "inventory position", pattern: "inventory position", values: [sku.inventory_position] },
    { label: "on-hand stock", pattern: "(?:stock\\s+)?on[- ]hand(?:\\s+stock)?", values: [sku.on_hand_qty, sku.available_qty] },
    { label: "available stock", pattern: "available(?:\\s+stock)?", values: [sku.available_qty] },
    { label: "maximum stock level", pattern: "maximum", values: [sku.max_stock] },
    { label: "reorder point", pattern: "(?:approved\\s+)?reorder\\s+(?:point|level|threshold)", values: [sku.reorder_point_policy] },
  ].map((q) => ({ ...q, values: q.values.filter(present).map(Number) }))
   .filter((q) => q.values.length);
}

// The figure ATTACHED to a name, never "any figure in the same sentence":
//   forward   "inventory position has reached 250 MT", "maximum policy level of 400 MT",
//             "reorder point (250 MT)"
//   reverse   "620 MT on hand"
// Filler between name and figure is limited to a few qualifying words and one
// linking word, so "the inventory position is at or below the reorder point of
// 250 MT" attaches 250 to the reorder point, not to the position.
function attachedFigures(sentence, q) {
  const forward = new RegExp(
    `\\b${q.pattern}(?:\\s+(?:stock|level|policy|allowed|point|figure))*\\s*` +
    `(?:\\(|:|of|is|was|at|sits at|stands at|totals|totalling|reached|has reached|now at)?\\s*${NUM}\\s*MT\\b`,
    "gi"
  );
  const reverse = new RegExp(`${NUM}\\s*MT\\s+(?:of\\s+)?(?:the\\s+)?${q.pattern}\\b`, "gi");
  return [...sentence.matchAll(forward), ...sentence.matchAll(reverse)].map((m) => toNumber(m[1]));
}

/**
 * @param {string} text   the explanation as a reader would see it
 * @param {object} sku    enriched SKU (inventory_position, on_hand_qty, available_qty, max_stock, reorder_point_policy)
 * @param {object} alert  { alert_type, ... }
 * @returns {string[]}    "kind: detail :: offending sentence"
 */
function semanticIssues(text, sku = {}, alert = {}) {
  const issues = [];
  const sentences = String(text).split(/(?<=[.!?])\s+/);

  for (const raw of sentences) {
    const s = raw.trim();
    if (!s) continue;

    // 1. "A exceeds / is below B by C" must satisfy |A - B| = C. Positional: the
    //    two compared quantities come BEFORE "by", the difference right after.
    if (/(exceed|above|over|below|under|short|less than|more than)/i.test(s)) {
      const m = s.match(new RegExp(`^(.*)\\bby\\s+${NUM}\\s*MT\\b`, "i"));
      if (m) {
        const before = mtNumbers(m[1]);
        if (before.length >= 2) {
          const [a, b] = before.slice(-2);
          const diff = toNumber(m[2]);
          if (!close(Math.abs(a - b), diff)) issues.push(`contradicts the alert: arithmetic does not hold, ${a} vs ${b} "by" ${diff} MT :: ${s}`);
        }
      }
    }

    // 2. Direction. Stock DESCRIBED as full on a low-stock alert, or ordering
    //    advised on a too-much-stock alert, unless the sentence negates it.
    if (LOW_STOCK.has(alert.alert_type) && !NEGATED.test(s) &&
        /\b(reach(es|ing)?|near(ing)?|at|above|exceed(s|ing)?|over)\s+(its|the|our|a)?\s*(maximum|max|capacity|ceiling)\b|\btoo much stock\b|\boverstock(ed)?\b|\bexcess stock\b/i.test(s)) {
      issues.push(`contradicts the alert: describes a low-stock alert as too much stock :: ${s}`);
    }
    if (HIGH_STOCK.has(alert.alert_type) && !NEGATED.test(s) &&
        /\b(place|placing|raise|initiate)\b[^.]{0,30}\b(order|replenish)|\border more\b|\breorder now\b/i.test(s)) {
      issues.push(`contradicts the alert: suggests ordering more on a too-much-stock alert :: ${s}`);
    }

    // Claims that an action has ALREADY been taken. This app's whole design is
    // that a person approves every action, so an explanation saying "the
    // supplier has been informed" asserts something that did not happen, on
    // the one axis judges score most closely (human in the loop). Seen once in
    // 96 benchmark answers, and never in a correct one.
    if (/\b(?:has|have|had) been (?:informed|notified|contacted|placed|ordered|cancell?ed|escalated|sent|raised|approved)\b|\bwe(?: have|'ve)(?: already)? (?:contacted|informed|notified|placed|ordered|cancell?ed|escalated|approved)\b/i.test(s)) {
      issues.push(`contradicts the alert: claims an action was already taken, but every action waits for manager approval :: ${s}`);
    }

    // 3. A quantity attached to ORDERING must be the one the engine recommends.
    //    "we should reorder 20 MT" on a stockout alert, where 20 is the supplier
    //    minimum and the card says 597, is wrong advice with a real figure. A
    //    figure introduced as a minimum ("minimum order of 20 MT", "min 20 MT")
    //    is not a recommendation and is skipped.
    const orderValues = [sku.suggested_order_qty, alert.ai_recommendation_qty].filter(present).map((v) => Math.round(Number(v)));
    if (orderValues.length) {
      const orderRe = new RegExp(`\\b(minimum|min\\.?)?\\s*(?:re)?order(?:ing)?\\s+(?:of\\s+|for\\s+|quantity\\s+(?:of\\s+)?)?(?:~|about\\s+|approximately\\s+)?${NUM}\\s*MT\\b`, "gi");
      for (const m of s.matchAll(orderRe)) {
        const before = s.slice(Math.max(0, m.index - 20), m.index);
        if (m[1] || /\b(minimum|min\.?)\s*$/i.test(before)) continue;
        const v = toNumber(m[2]);
        if (!orderValues.some((x) => close(x, v))) {
          issues.push(`contradicts the alert: recommends ordering ${v} MT, but the suggested order is ${orderValues[orderValues.length - 1]} MT :: ${s}`);
        }
      }
    }

    // 4. A figure attached to a named quantity must be that quantity's value.
    for (const q of namedQuantities(sku)) {
      for (const v of attachedFigures(s, q)) {
        if (!q.values.some((x) => close(x, v))) {
          issues.push(`contradicts the alert: gives the ${q.label} as ${v} MT, but it is ${q.values[0]} MT :: ${s}`);
        }
      }
    }
  }
  return [...new Set(issues)];
}

module.exports = { semanticIssues };
