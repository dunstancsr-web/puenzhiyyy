// ─────────────────────────────────────────────────────────────────────────────
// TONE: deterministic clean-up of the model's wording (15 Sep 2026)
//
// Three fixes applied to the model's text after it is rendered, in the same
// spirit as the system-written opening sentence and the appended approved
// action: things a prompt could only ask for are guaranteed instead, with no
// retry and no paid call.
//
// 1. Invented urgency. Only a STOCKOUT_RISK alert is urgent. On every other
//    alert, llama3 kept writing "take immediate action", "swift action" and "as
//    soon as possible" even with a rule against it (about 5 answers in 36 after
//    the rule, 8 before), and the words moved between alert types as the prompt
//    changed. They are removed here instead: "take immediate action" becomes
//    "take action", "move it as soon as possible" becomes "move it". Descriptions
//    are left alone ("not selling quickly enough" is a fact, not a demand).
//
// 2. Leaked placeholder names. The model occasionally writes a slot name as a
//    bare word ("reducing time_since_sale"), which no brace-based check sees. It
//    becomes plain words ("time since sale"), never a value: some figures are
//    withheld from the model on purpose, and filling one in could recreate the
//    false pairings that withholding prevents.
//
// 3. "I recommend that Escalate to QA and commercial." The model introduces the
//    engine's action, which begins with a capital, as a clause. The lead-in is
//    dropped so the action stands as its own sentence.
//
// Never touches a sentence containing the engine's recommended action, and the
// system's opening sentence is added after this runs.
// ─────────────────────────────────────────────────────────────────────────────

const URGENT_OK = new Set(["STOCKOUT_RISK"]);

const article = (next) => (/^[aeiou]/i.test(next) ? "an" : "a");

function calmSentence(s) {
  let out = s;
  // "take immediate action", "swift steps", "urgent measures"
  out = out.replace(/\b(?:immediate|swift|urgent|prompt|rapid|quick)\s+(action|actions|steps|measures|attention)\b/gi, "$1");
  // "an urgent order" -> "an order", "a swift review" -> "a review"
  out = out.replace(/\b(an?)\s+(?:urgent|immediate|swift)\s+(\w+)/gi, (m, a, next) => {
    const art = article(next);
    return `${a[0] === "A" ? art[0].toUpperCase() + art.slice(1) : art} ${next}`;
  });
  // trailing adverbial phrases
  out = out.replace(/,?\s+(?:as soon as possible|as quickly as possible|without delay|right away|at once|immediately|urgently|swiftly|promptly)\b/gi, "");
  // "if we don't move it soon", "not ordering soon": drop a sentence-final or
  // clause-final "soon", but not "as soon as" (handled above) or "sooner".
  out = out.replace(/\s+soon\b(?!\s+as)(?=\s*[.,;:!?]|\s+(?:and|or|but|to|so)\b|$)/gi, "");
  // "move it quickly" but not "quickly enough", "more quickly", "less quickly"
  out = out.replace(/(?<!\b(?:more|less|as|so|too))\s+quickly\b(?!\s+(?:enough|as))/gi, "");
  // leading "Immediately, ..." / "Urgently, ..."
  out = out.replace(/^(\s*)(?:immediately|urgently|swiftly),\s*(\w)/i, (m, sp, c) => sp + c.toUpperCase());
  return out.replace(/\s{2,}/g, " ").replace(/\s+([.,;:!?])/g, "$1");
}

/**
 * @param {string} text          rendered model text, before the system opening is added
 * @param {object} alert         { alert_type, recommended_action }
 * @param {object} slots         slot map from buildSlots, used only for its names
 * @returns {{ text: string, changes: string[] }}
 */
function calmTone(text, alert = {}, slots = {}) {
  const changes = [];
  let out = String(text);

  // 3. "I recommend that Escalate to QA and commercial." The model introduces
  // the engine's action, which starts with a capital, as if it were a clause.
  // Drop the lead-in so the action reads as its own sentence. Any alert type.
  const leadIn = /(?:\b(?:In light of (?:this|these (?:factors|circumstances))|Therefore|Given this|As a result),\s*)?\bI (?:would )?recommend(?: that)?(?: we| the manager)?[:,]?\s+(?=[A-Z])/g;
  if (leadIn.test(out)) {
    out = out.replace(leadIn, "");
    changes.push("recommendation lead-in removed before the action");
  }

  // 2. Bare slot names, any alert type. Only names with an underscore, which
  // cannot be ordinary English words.
  for (const name of Object.keys(slots)) {
    if (!name.includes("_")) continue;
    const re = new RegExp(`(?<![{\\w])${name}(?![}\\w])`, "g");
    if (re.test(out)) {
      out = out.replace(re, name.replace(/_/g, " "));
      changes.push(`placeholder name "${name}" written as words`);
    }
  }

  // 1. Urgency, non-stockout alerts only, sentence by sentence.
  if (!URGENT_OK.has(alert.alert_type)) {
    const action = alert.recommended_action || null;
    out = out
      .split(/(?<=[.!?])(\s+)/)
      .map((part) => {
        if (/^\s+$/.test(part) || (action && part.includes(action))) return part;
        const calmed = calmSentence(part);
        if (calmed !== part) changes.push(`urgency removed: "${part.trim().slice(0, 60)}"`);
        return calmed;
      })
      .join("");
  }

  return { text: out, changes };
}

module.exports = { calmTone };
