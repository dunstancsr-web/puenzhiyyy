// ─────────────────────────────────────────────────────────────────────────────
// REPLAY EVENTS
//
// Real, past rice-trade events, hand-classified, so the market signal feature can
// show "if this had been today's news, here is what the agent would have said
// about THIS stock" without depending on a live feed. They are loaded on demand
// (routes/signals.js) and marked origin = 'replay'.
//
// The `headline` and `summary` are our own plain-language wording of what
// happened, NOT quotations from the linked sources. Dates and measures were
// checked against the linked sources on 19 Sep 2026 (see the devlog); the
// `event_type` / `severity` are our judgement, and the days each one costs are
// NOT here: they come from engines/signals.js's playbook.
//
// The set is chosen to show BOTH behaviours that matter:
//   - it warns where it should (basmati floor price, Thai and Vietnamese
//     spillover)
//   - it stays quiet where it should (India's non-basmati bans do not touch a
//     basmati SKU; an easing releases pressure instead of adding it)
// ─────────────────────────────────────────────────────────────────────────────

const REPLAY_EVENTS = [
  {
    fixture_id: "in-2022-09-broken-rice",
    published_at: "2022-09-08",
    headline: "India bans broken rice exports and puts a 20% duty on most other non-basmati rice",
    summary: "Announced 8 September 2022 after a weak monsoon. Basmati was outside the measure.",
    source_name: "CNBC",
    source_url: "https://www.cnbc.com/2022/09/09/india-restricts-rice-exports-after-below-average-monsoon-rainfall.html",
    country_of_origin: "India", event_type: "export_restriction", severity: "medium", direction: "tightens",
    affects_varieties: ["non-basmati"], excludes_varieties: null,
  },
  {
    fixture_id: "in-2023-07-non-basmati-ban",
    published_at: "2023-07-20",
    headline: "India bans exports of non-basmati white rice",
    summary: "DGFT Notification 20/2023, 20 July 2023. Covered about 27% of India's rice exports. Basmati was not included.",
    source_name: "Global Trade Alert",
    source_url: "https://www.globaltradealert.org/intervention/121287/export-ban/india-export-ban-imposed-on-non-basmati-white-rice-july-2023",
    country_of_origin: "India", event_type: "export_restriction", severity: "high", direction: "tightens",
    affects_varieties: ["non-basmati"], excludes_varieties: null,
  },
  {
    fixture_id: "th-2023-07-spillover",
    published_at: "2023-07-27",
    headline: "Buyers turn to Thai rice after India's ban and prices climb",
    summary: "With Indian non-basmati off the market, importers competed for other origins. A study of the ban reports price rises of up to 32% in key exporting countries.",
    source_name: "ScienceDirect",
    source_url: "https://www.sciencedirect.com/science/article/abs/pii/S0306919225000983",
    country_of_origin: "Thailand", event_type: "availability_tightening", severity: "medium", direction: "tightens",
    affects_varieties: null, excludes_varieties: null,
  },
  {
    fixture_id: "vn-2023-07-spillover",
    published_at: "2023-07-27",
    headline: "Buyers turn to Vietnamese rice after India's ban and prices climb",
    summary: "Same spillover as Thailand: demand redirected to other exporters, tightening what was available to importers.",
    source_name: "ScienceDirect",
    source_url: "https://www.sciencedirect.com/science/article/abs/pii/S0306919225000983",
    country_of_origin: "Vietnam", event_type: "availability_tightening", severity: "medium", direction: "tightens",
    affects_varieties: null, excludes_varieties: null,
  },
  {
    fixture_id: "in-2023-08-basmati-floor",
    published_at: "2023-08-27",
    headline: "India sets a US$1,200 per tonne minimum export price on basmati",
    summary: "Introduced 27 August 2023 to prevent non-basmati being shipped as basmati. Cut to US$950 in October 2023.",
    source_name: "World Grain",
    source_url: "https://www.world-grain.com/articles/18958-india-sets-minimum-export-price-on-basmati-rice",
    country_of_origin: "India", event_type: "export_restriction", severity: "medium", direction: "tightens",
    affects_varieties: ["basmati"], excludes_varieties: null,
  },
  {
    fixture_id: "in-2024-09-ban-lifted",
    published_at: "2024-09-28",
    headline: "India lifts its ban on non-basmati white rice exports",
    summary: "28 September 2024, with a US$490 per tonne minimum export price at first; the floor prices were removed in October 2024.",
    source_name: "Global Trade Alert",
    source_url: "https://globaltradealert.org/state-act/88765",
    country_of_origin: "India", event_type: "export_restriction", severity: "medium", direction: "eases",
    affects_varieties: ["non-basmati"], excludes_varieties: null,
  },
];

module.exports = { REPLAY_EVENTS };
