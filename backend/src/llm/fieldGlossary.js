// ─────────────────────────────────────────────────────────────────────────────
// FIELD GLOSSARY - the answer to "is our database AI-readable" (19 Sep).
//
// Research finding (see the devlog entry this lands with): an LLM never reads
// a database directly in this app, and shouldn't - that's the whole point of
// explain.js's buildFacts()/buildSlots(), which hand the model a labelled
// text block instead of table access. Column NAMING was already fine
// (on_hand_qty, not physical_stock - see terminology-map.md). The actual gap:
// what a figure MEANS was written out by hand in three separate places -
// db/init.js's inline SQL comments, the domain doc's data dictionary
// (reference/rice-inventory-technical-spec.md, Appendix A), and explain.js's
// buildFacts()/buildSlots() - with no one of them the source the others draw
// from. That's rules.md's "one source of truth" problem, just in prose
// instead of code.
//
// This file is that one source, for the fields Action Items' explanations
// need. It does NOT touch explain.js's existing, already-benchmarked labels
// for Alerts - rewriting those from a generic map risks changing exact
// wording that was tuned against real model failures (see explain.js's own
// comments). New code reads from here; old code is left alone on purpose.
// ─────────────────────────────────────────────────────────────────────────────

const FIELD_GLOSSARY = {
  avg_daily_usage_30d:        { label: "how fast this sells", unit: "MT per day" },
  available_qty:              { label: "stock available to sell right now", unit: "MT" },
  on_hand_qty:                { label: "total physical stock in the warehouse", unit: "MT" },
  lead_time_days:             { label: "how long the supplier takes to deliver a new order", unit: "days" },
  safety_stock_mt:            { label: "the buffer held on top of ordinary demand", unit: "MT" },
  target_stock:               { label: "the stock level policy aims to hold", unit: "MT" },
  reorder_point_policy:       { label: "the approved level a new order is due at", unit: "MT" },
  suggested_order_qty:        { label: "how much the formula suggests ordering", unit: "MT" },
  incoming_eta_days:          { label: "how many days until an order already placed arrives", unit: "days" },
  health_status:              { label: "the traffic-light status: RED needs attention now", unit: "" },
};

module.exports = { FIELD_GLOSSARY };
