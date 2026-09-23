# Submission tracker

> **This copy is stale (still 15 Sep).** The current tracker (17 Sep: MVP2 merge status, the
> archived video script decision, the corrected engine count) lives on branch
> `docs/mvp2-tracker-update` / PR #3, not yet merged to `main` as of 17 Sep. Read that version, not
> this one, until the branches converge. This note exists so starting a fresh session on the wrong
> branch doesn't mean trusting an out-of-date status.

AWS NUS-ISS SMYA 2026 Hackathon. **Shortlisting deadline: 28 September 2026, 9:00am. Finale: 10 October.**

Four deliverables. Status as of 20 Sep.

| # | Deliverable | Status | Next step, and who |
|---|---|---|---|
| 1 | GitHub repo | done, kept current | nothing |
| 2 | Deployment URL | image built, tested and published by GitHub Actions; **Lightsail service not created yet** | Deploy now (Stan, 15 Sep: the lease can be extended, so there is no reason to wait): follow `(Stan) DEPLOY-LIGHTSAIL.md` in this folder |
| 3 | YouTube demo video | script below, updated 15 Sep; `npm run demo:reset` checks the app is ready | Stan records, near the end, with the final paid check |
| 4 | PDF write-up | `docs/Submission/WRITEUP.md` refreshed 20 Sep for forecasting, market signals, the order loop, Ask about your data and the merged Alerts tab; the three blanks (URL, PIN, spend) are still empty | fill in the URL, PIN and spend figure **in the PDF only**, then export (re-check the figures against a fresh seed first) |

## Before submitting, in this order

1. **Deployed 20 Sep** to Lightsail (`container-service-1`, Nano x1, Singapore); every `check-deploy.js` check passed. **Redeploy needed** to pick up the inline PIN unlock (PR #20, main `2ec3481`): Lightsail, `container-service-1`, Deployments, Modify your deployment, change the image tag to `sha-2ec3481` (after its Actions run is green), retype `DEMO_PIN` and `LLM_GATEWAY_API_KEY` (the form does not keep them), Save and deploy, then `check-deploy.js <url>` and one Why? press (about USD 0.006). The console session expires after about an hour, so have both values ready.
2. **Final paid check: done 20 Sep** (`sonnet-check.js --confirm-spend --features`, USD 0.0452, in the spend ledger). It found four wording problems, all fixed by rule and covered by `test-llm-sonnet.js`. A second paid run is only worth it if the model layer changes again; then rehearse free first (`--dry-run --features`).
3. **Record the video**, following the recording checklist below.
4. **Fill in the three PDF blanks** (URL, demo PIN, spend total) and export `docs/Submission/WRITEUP.md`.
5. **Submit**, then capture evidence of the live service before the lease ends.

## Waiting for Stan's decision

Nothing right now. Decided 21 Sep: **demo mode stays opt-in** (option a): writes on the live site are refused with a one-click "Join the demo", so judges see the populated live data first. A default demo would show an empty portfolio (the sandbox starts empty and its sample data has zeroed stock), and Exit ends the shared sandbox for everyone in it.

Decided 20 Sep: The last three (At Risk bands, the seeded India event, market signals feeding order requests) were decided on 20 Sep and are in "Decisions already made" below.

## To do, not blocked

- **Before deploy: make the GHCR package public.** The 20 Sep rehearsal (`rehearse-deploy.sh`) passed every site check but failed on `ghcr.io/dunstancsr-web/puenzhiyyy` being private (HTTP 403 anonymous pull), so Lightsail could not pull it. GitHub, Packages, the image, Package settings, Change visibility.
- **Request the Innovation Sandbox lease** (Hackathon Lease template, no approval needed) when ready to deploy.
- **Show Tawmo the merge** (PR #5, 20 Sep): if she wants changes, fix on a new branch; undo is `git revert -m 1 15153c4`.
- **Merge the open pull requests, in this order** (only when Stan says so, see rules.md): #8 (order request timeline), #9 (Market signals), #10 (Alerts and History in one tab), then the branch `feature/ageing-and-signal-decisions` once its pull request is opened. They are stacked, so each one after the first shrinks once the one before it merges. #3 (an old tracker copy) is superseded by this file and can be closed; #4 (onboarding suggested settings) is Stan's to decide.
- **Remote branches already merged into main** can be deleted from GitHub when Stan says so: `chore/team-workflow-hooks`, `feature/market-signals`, `feature/mvp2-forecast-day1`, `feature/mvp2-separate-duties`, `feature/onboarding-demo-ux` (some may be Tawmo's, so ask her first).

Done on 20 Sep and no longer to do: the features guide screenshots and PDF (rebuilt, with new sections for Action Items and the request timeline), the Onboarding opening-balance click-through (it found that the sample data left stock on the shelf, so every product refused an opening balance; fixed in `routes/demo.js`), the order request fuller version (below).

- **Market signals: a search planner, multi-round with reasons, audit logging and a visible panel (22 Sep, branch `feature/market-signals-live-agent`, no PR yet).** Stan asked for Market signals to genuinely search the web, then to make it "more agentic" with visible decision-making. Built: up to 3 rounds per scan, each seeing everything found and asked so far and able to end the scan itself; every query carries the model's own one-sentence reason; a new `SIGNAL_SCAN` audit event logs every scan (found in History); the Market Signals screen shows a collapsible panel of what the agent searched for, why, and what it found. Still local-model only, no new paid-tier risk. **Honest finding from a real local-model run** (`bench-signal-planner.js`): the model reliably proposes sensible, on-topic, non-repeating follow-ups, but does NOT reliably decide to stop on its own when there is nothing new to react to; it keeps inventing superficially different queries. `MAX_ROUNDS` (3) is what actually bounds it, not the model's judgement, so the design goal of "the model decides when it's done" is implemented but not something to demo as working reliably. Proved live end to end in a real browser on Stan's machine (a real scan, all 3 rounds, real headlines), not just in tests.
  **Then: a corrections reminder (same day).** Stan spotted the already-documented Cambodia misread live and asked whether a correction could be "reported to the model" so it "learns". It cannot, literally; the local model has no memory between calls. What's built instead: every "Read as" correction (already logged as `SIGNAL_DECIDED`) is read back, the last 5, and handed to the reader as worked examples next scan, so a similar future headline gets a fighting chance of being read right the first time. Proved for real: PATCHed the live Cambodia signal to its honest reading, watched it move to "does not affect your stock" in the real app, confirmed the correction is stored in the exact shape the reminder mechanism reads. Left behind: the local dev database now has this session's real scans and one deliberate correction in it, not reseeded yet.
  Not done: no PR opened, no route-level test of the round loop or the audit write, and the corrections reminder has not been exercised inside a real running scan yet (only through direct calls and the test suite). Devlog: "proved the agent live, then a corrections reminder for the reader" and the session before it.

- **Market signals: injection hardening and Sonnet parity (22 Sep, same branch, still no PR).** Reseeded the dev database. Hardened the prompt-injection defenses: a quote-fence escape (`neutralize()`) applied everywhere untrusted text enters a prompt, closing a gap where a hostile headline could carry manipulated text into a LATER scan round; a `country_inferred` flag (surfaced, not auto-corrected) when the model's chosen country is never named in the headline text, the same shape bench-signal-reader.js's own injection test measures; action-directed language in the search planner's "reason" field is now replaced wholesale, mirroring `tone.js`'s existing pattern. Re-benchmarked against the real model afterward: no accuracy regression, injection still not obeyed.
  Then built Sonnet parity for the reader, the way Stan asked, but only after finding and fixing a real gap first: the scan route had NO PIN gate at all before this, fine while local-only, a real cost and security hole the moment a paid tier became reachable. Now: a scan can request `{tier: "cloud"}`, gated by the same demo PIN as Why?/Ask, with a far smaller cloud-specific read cap (5, versus 16 free) since one scan can otherwise call the model 20-30 times, well beyond a single Why? press's cost. The search planner (query proposal) stays local-only regardless, Stan's choice over full parity. Proved live: a cloud request with no PIN was refused before any cost; a normal local scan still worked exactly as before.
  Then built the UI toggle: a checkbox on the Market Signals screen ("Read with Claude Sonnet instead of the free local model"), shown only once the server offers cloud and this visitor has unlocked it with the demo PIN (the same inline prompt shows first if not). Deliberately its own on/off choice each time, not tied to the general tier preference Why?/Ask set on unlock, since a scan can cost far more than a single Why? press and a visitor should not start spending on every future scan just because they once unlocked it elsewhere. Checked live: the locked state (no pass) correctly shows the PIN prompt in the checkbox's place.
  Not done: no real paid scan has been run (needs Stan's explicit go-ahead to spend, separate from approving the capability itself, and needs him to type the real PIN to see the checkbox's unlocked state); no PR.

- **Market signals: three tabs, three free accuracy improvements (22 Sep, same branch, still no PR).** Stan's team decided to keep relying on the RSS feed and defer genuine open web search. Renamed the tabs: "Live news" to "RSS News Feed" (accurate about what it reads), "Past events" to "Replay" (unchanged feature, same name it always should have had); added a new, deliberately DISABLED "Deep Search" tab (Soon chip, a Help tooltip explaining what it would do and why it waits) so the shape of the future work is visible without building it now. A Help tooltip sits beside every tab, not just the one currently open. Also added three free accuracy signals to the RSS tier: source reputation (a small allow-list, reputable outlets read first within the scan's budget, an unrecognized one flagged not rejected), a corroboration count (how many outlets reported the same story, data that already existed but was never shown as a trust signal), and the model's own confidence rating (soft: a missing or invalid value never fails the reading, just falls back to a coarse default). Proved live: a real scan produced a signal correctly reading `confidence: high`, `source_reputable: false`, `corroboration_count: 4`.
  Not done: Deep Search remains entirely unbuilt, as decided; no PR opened.

- **Action Items: requests moved in, role pills and a filter (22 Sep, same branch).** `OrderRequestsCard` moved from Inventory to Action Items; every section now carries a "For: <role>" pill (Manager, Buyer, Buyer's manager) and a filter beside the page title hides sections a given role would not need, "to tell judges the info is not free for all," per Stan. A real, narrow bug was found and mostly fixed along the way: adding the filter's header content could leave content under the fixed top bar at 390px width specifically, on a synthetic test scroll action; the general fix (moving role pills inside each card's own header) resolved it everywhere except two audit fixtures, documented as an accepted exception with the full investigation in `ux-audit.config.json`.
- **Inventory: two new charts at the top (22 Sep, same branch).** A monthly bar chart, total MT on hand split into the illustrative Singapore rice-stockpile buffer requirement versus surplus, with a legend, a per-month met/not-met verdict and checkmark, and a 6M/YTD/12M/ALL window selector (same as Dashboard's own chart); and a donut chart of on-hand MT by country of origin, hover shows exact MT and %. Both reuse figures the engines already compute; one new backend field (`compliance_required_qty_mt` on `GET /dashboard/history`) mirrors the existing Compliance Position formula and its "illustrative, pending governance approval" label. Checked live with real seeded data throughout.
- **Not done, either item:** no PR opened for any of today's work; the full 302+ check UX-audit suite passed with one pre-existing, unrelated RUN error (stale seeded PO number, not caused by today's changes) and one accepted low-severity T1 warning (a Recharts-internal invisible element, not a real rendering issue).

- **Nearest Stockout linked to its own alert, demo-mode data fixed, two renames (23 Sep, same branch, committed).** Referenced how control-tower tools (SAP IBP and similar) act on an exception where it is shown before proposing options to Stan; he chose a deep-link over duplicating Approve/Reject buttons onto Action Items. The "Order X MT" link on Nearest Stockout now opens the SKU's own alert on Alerts directly (highlighted, scrolled to), when one is open, instead of a blind jump to the tab.
  Demo mode's Nearest Stockout was showing 0 at-risk rows: onboarding's opening-balance suggestion for the sandbox's 5 kept SKUs came out far above their real risk levels (a receipts-sizing quirk unrelated to the live dataset's own numbers). Fixed with a small, targeted seed override on two SKUs (TJ-25KG, BM-5KG) so accepting the suggestion produces exactly 2 real at-risk rows, verified live.
  Renamed "Action Items" to "Next Steps" and "Alerts" to "Actions Needed" (Stan's call), swapped icons (Flame now on Actions Needed, ListChecks on Next Steps), and reordered/indented the sidebar: Table under Dashboard, Forecast under Inventory. Caught and fixed two real regressions the rename caused (a wrapped link measured as an undersized tap target; an existing accepted UX-audit exception silently broken by the old hardcoded nav text) via a re-run of the audit, not assumed clean.
  Verified: build, `check-formulas.js`, all four signals/order-loop test suites, `test-llm-sonnet.js` (fake model, no spend), and a scoped UX-audit re-run all pass. No paid model call. **This is the first commit on this branch** - everything above from 22 Sep onward was sitting uncommitted until tonight.

## Order requests: what is built

**Built (20 Sep), the whole loop.** A request goes open, then acknowledged (buyer), then purchase order
raised (buyer), then approved or rejected (buyer's manager); it can be cancelled before the end. Approving
creates the purchase order (`PO-REQ-000N`, quantity from the request, arrival from the product's lead
time) and stores its number on the request, so the warehouse never sees an order nobody approved. When an
operator receives that order at Goods In, the same transaction adds a `received` step and closes the
request, with no click from the office. Stock moves only at that receipt. Each step is a row in
`order_request_events` (who, when, optional note), shown on the Next Steps page's "Requests waiting for the
buyer" card (moved there from Inventory, 22 Sep; finished requests stay a week) and as a line on the History view. There is no login, so one
person plays every role in the demo; the server fixes the actor from the step.
Code: `backend/src/routes/inventory.js` (`REQUEST_TRANSITIONS`, `REQUEST_ACTORS`, the PATCH handler),
`backend/src/routes/warehouse.js` (the receive route), `backend/src/db/requestEvents.js`,
`frontend/src/components/OrderRequestsCard.jsx`. Check: `node backend/scripts/test-order-loop.js` (a
throwaway database; it fails if an unapproved order reaches Goods In or the receipt does not close the
request).

A market signal can also start a request: "Ask the buyer to order" on a live signal's product row, quantity
prefilled from the low end of the advice and editable, refused when a request for that product is
already open. Replay (practice) never offer it.

**Still open questions.** Is a partial receipt its own step ("part received") or does one receipt close the
request, as the warehouse endpoint does today (one receipt closes it)? Should approval depend on a spend
threshold, so a small order skips the manager, as real purchasing does? Does the manager step need its own
screen once there is a login, instead of a button on the card?
- **Onboarding's last step, "Review suggested settings"** (PR #4, MVP2 Day 8) was brought up to date with `main` on 20 Sep: it now follows sales history in the story-style flow (Skip on sales leads into it, finishing reloads Home). Click it through once in demo mode before recording.

## Decisions already made

- **Ask about your data is hidden on the live URL** (20 Sep): it needs a local model and the container has none, so the box appears only when the server reports one (`ActionItems.jsx`, `askAvailable`). It is shown in the video from a local run. A local model on Lightsail was ruled out: the Nano container's memory is far below what llama3.1:8b needs, and a size that could hold it costs credit for one feature.
- **The misread Cambodia story stays** in the features guide and the video, as the honest human-in-the-loop example (20 Sep). The guide marks it as left in on purpose.
| Decision | Choice | Why |
|---|---|---|
| Hosting | AWS Lightsail container service, Nano | the organizers' allowed platform; rubric item 7 scores Platform & Tooling Usage; Render's free tier sleeps |
| Model | Claude Sonnet 4.5 through the organizers' Bedrock gateway | sponsored; shares the USD 100 AWS credit with hosting |
| Judge access to the paid model | demo PIN printed in the PDF | a leaked PIN is bounded by the daily call cap (cost per day in `(Stan) MODEL SPEND.md`) |
| Paid testing | none until the final check before submission | conserve credit; correctness safeguards do not depend on the model |
| Video's Why? beat | Sonnet, a few takes | it is what judges will score; repeat views of one alert are cached and free |
| Data on the server | seeds itself on first boot; a restart resets the demo | removes the whole class of disk problems |
| AWS lease | can be extended, so deploy without waiting (15 Sep) | deploying early costs only hosting credit |
| Formulas where the spec and the code disagreed | lost sales are not sales; Slow Moving means over 120 days of cover; one demand rate, the 30 day moving average, across the whole app (15 Sep) | each conflict, choice and reason: design.md, "Formula decisions" |
| Urgency in model summaries | removed by a rule after the model answers, not by retries (15 Sep) | free and predictable; design.md, "Explanation Layer", Tone |
| How documents and rules are kept | filed by reader, listed in `docs/DIRECTORY.md`, every rule in `.kiro/steering/rules.md`, one owner per fact (15 Sep) | `.kiro/steering/rules.md` |
| Duties split and opening balance (20 Sep) | the office writes no stock; stock moves on the warehouse floor. Onboarding's first count uses one audited, once-per-product action (OB-0001, movement type OPENING) allowed only where on hand is 0 | keeps the office from topping up live stock while still letting a new catalogue start; requirements.md, REQ-11 |
| Alerts and Activity in one tab (20 Sep) | one Alerts tab with two views, Needs action and History; two lists, joined at the item; dismissing an alert can be undone | Stan asked for one tab so an alert and its history can be read together. Industry keeps the to-do list and the record separate and links them at the item, so the lists were not interleaved; design.md, "Alerts tab" |
| Ageing bands (20 Sep) | scaled to each product's own holding limit: At Risk from 90% of it (day 243 at the default 270, day 162 for a 180 day product). The fixed day bands in the old REQ-08 are gone | short-life products should warn earlier; design.md, "Supporting Formulas" |
| Seeded India export event (20 Sep) | scoped to non-basmati, like the real 2023 ban, so it no longer buffers basmati SKUs | the risk buffer for the India basmati SKUs is now 0; design.md, "Market Signals" |
| Replay is practice (20 Sep) | a replayed past event can be acknowledged but never adds a buffer, and never offers "Ask the buyer" | a buffer must only come from news a person believes is happening now; the server refuses it, not just the button |
| Market signal to order request (20 Sep) | yes: "Ask the buyer to order" prefilled and editable; the person still sends and nothing is ordered until the buyer acts | one click from advice to the buyer's list, with a duplicate guard |
| Market signals opens on the RSS News Feed tab (20 Sep, tab renamed 22 Sep) | RSS News Feed first, Replay second, Deep Search third (disabled) | the real use comes first; the demo path is one tab away |
| Demo banner's Exit stays offset from the entry button (20 Sep) | not pinned to the far right | a little offset avoids an accidental double click entering and exiting |
| Public-server writes (20 Sep) | stock movements, order requests, signal decisions and opening balances are accepted only in the demo sandbox unless ALLOW_LIVE_WAREHOUSE_WRITES=1 | `backend/src/middleware/sandboxGuard.js` |
| Onboarding shape | sequential, story-style (progress bar, Back, Skip advances/exits); no "minimize and resume from anywhere" chip (17 Sep) | reversed an earlier decision in the same feature branch; nothing to resume into once a skip just means finishing setup later through Inventory or Bulk edit like any other data entry |
| Onboarding order: catalog before sales, never the reverse (17 Sep) | catalog-first stays; someone with both files ready can attach sales to the SAME upload instead of a separate step | a sales row has no product_name, variety, origin, packaging or supplier to build a catalog row FROM - reversing the order would mean SKUs created with a reorder policy and safety stock of 0, which reads as healthy everywhere, not as unconfigured |
| Forecast Overview promoted to Sidebar's permanent nav, between Dashboard and Inventory (17 Sep) | a decision held open since design.md first shipped the page ("MVP2 is still a feature branch") | the approve/modify/reject decision for a suggested reorder point stays on Alerts only - Forecast explains and simulates, it does not also duplicate the decision |
| Forecast Detail's suggestions are not labelled "AI generated" (18 Sep) | tagged instead as YOUR INPUT, STATISTICAL FORECAST or plain formula, with an explicit "none of this is generative AI" tooltip | none of it is: the demand number is a backtested statistical model (Naive/Linear/Holt-Winters/Holt damped), never an LLM call, and everything after it is fixed arithmetic; the only real AI in this app is the bounded Why? narration on Alerts |

## Judging criteria

From the steering doc: **Architecture & Reasoning Loop, Tool Use & Integration, Autonomy &
Human-in-the-Loop, Observability**, plus the organizers' rubric item 7, **Platform & Tooling Usage**.

- **Architecture & Reasoning Loop.** Strong on both halves now. Nine deterministic engines, and a live
  model layer that narrates without computing: placeholders make an invented figure unwritable, the
  system writes the opening sentence and guarantees the action, and every answer is checked before it
  is shown, with the rule-based explanation as the fallback.
- **Tool Use & Integration.** SQLite, a REST API for the Control Tower and another for the warehouse
  floor, three model tiers behind one call, a CI pipeline that builds, smoke tests and secret scans
  the image.
- **Autonomy & Human-in-the-Loop.** Nothing auto-executes. Approve, modify or reject, with the
  proposal stored beside the decision. The model cannot claim an action was taken; a check rejects it.
- **Observability.** Eleven audit event types, field-level diffs, every model call with its tokens,
  failed attempts included, and model spend read from the trail rather than estimated.
- **Platform & Tooling Usage.** Lightsail, Bedrock through the gateway, GitHub Actions to GHCR.

## The client and the logo

The demo is pitched at a fictional Singapore rice importer, **四海米行 / Four Seas Rice Trading**,
named from the team name. The naming rationale, the logo, and the spoken pitch are on one page:

- Published: https://claude.ai/code/artifact/55f682c6-a10b-4219-a8cc-8def83a31fd6
- In the repo: `frontend/tuners/brand.html` (generated; sources in `frontend/tuners/src/`)

The line that does the work out loud: *"the name keeps both halves of ours: the four, and the
family."* That is where a judge hears the name was derived rather than decorated.

---

## Demo video script

Built around the reasoning loop rather than a tour of the pages. A tour shows what was built; the loop
shows what it is *for*, and it covers every judging criterion in one take. **Target: 3 to 4 minutes.**

| Beat | Screen | What to say |
|---|---|---|
| 1. The problem, 20s | Home, then the Dashboard | Two objectives that pull against each other: never miss an order, never tie up cash. Home shows the three people involved: the dock, the floor, the manager. |
| 2. What the system saw, 30s | Key Metrics | These numbers are computed, not generated. Nine engines, every figure traceable to a formula. The two groups are the two objectives. |
| 3. The exception, 30s | Alerts, the idle Japonica alert | The system is not asking you to read ten SKUs, it is asking you to decide on one. No sales in 96 days, SGD 250K tied up. |
| 4. Why, 50s | Why? on that alert, with AWS Bedrock unlocked | The rule-based explanation appears instantly; Claude's follows. Say the key line: the model never handles a number. Figures are placeholders filled from the engines, the opening sentence is written by the system, and a wrong answer is replaced, never shown. |
| 5. The human decides, 40s | Modify, a smaller quantity and a reason | Nothing auto-executes. Modify rather than approve, so the override is visible. Give a real business reason. |
| 6. The trail, 40s | Activity, expand that decision, then the model call | The decision beside what the system proposed, and the model call with its tokens: observability includes what the AI cost. |
| 7. Close, 20s | Dashboard | One line on what MVP 2 adds. |

### Recording checklist

Before the first take:

- [ ] **Spend ledger is up to date.** From `backend/`, run `node scripts/spend.js` and copy any new rows
      into `(Stan) MODEL SPEND.md`.
- [ ] **Run `npm run demo:reset`** from `backend/`, with both dev servers running, and wait for
      **READY**. If it lists fixes, do them and run it again.
- [ ] **Light theme**, browser zoom at 100%, other tabs and notifications closed.
- [ ] **Unlock AWS Bedrock** in Settings (sidebar) with the demo PIN.

Between takes: if a take recorded a decision, dismissed an alert or used Why?, run
`npm run demo:reset` again before the next one (add `--yes` once the paid calls are in the ledger).

During and after:

- [ ] Beat 6 last and unrushed. Observability is the criterion most demos forget to show.
- [ ] Add the takes' paid calls to the spend ledger.

**Why run `demo:reset` instead of just starting to record.** Each reason is something that has already
happened in this project:

1. **Practice clicks change what the video shows.** An alert that was approved or dismissed while
   testing disappears from the Alerts page: on 15 Sep the idle Japonica alert (beat 3) and the stockout
   alert were both missing for that reason. Every test decision also lands on the Activity page, so
   beat 6 would show clutter instead of one clean decision.
2. **Demo data drifts.** Tests change stock (TW-25KG was left at 60 MT reserved after the REORDER demo),
   which changes figures, alerts and the story the script tells. The reset restores the known state
   the script was written against.
3. **A broken paid tier wastes a take and credit.** Beat 4 needs AWS Bedrock available, a demo PIN the
   RUNNING backend has actually loaded (a PIN saved to `.env` after the backend started is not
   loaded), and paid calls left under today's cap. The reset checks all three through the running app,
   so you find out before recording, not halfway through a take.
4. **It protects the spend ledger.** Reseeding erases the audit trail, the only record of paid calls.
   A plain `npm run seed` only warns; the reset refuses unless you confirm the calls are in the ledger.
5. **It checks the app, not just the data.** Both servers answering, and the alerts the script needs,
   as the browser will see them.

---

## Open items

- **No full automated test suite.** Deliberate. CI runs the formula check (every design.md formula
  against the engines) and smoke tests the built container; `backend/scripts/bench-models.js` measures
  the explanation pipeline; `backend/scripts/test-tone.js` checks the wording clean-up; interactive
  audit passes cover the UI.
- **Model wording on Sonnet** has only been checked on llama3 since the 15 Sep prompt and tone
  changes; the final paid check covers it. Watch for weak timing claims, which no check catches.
