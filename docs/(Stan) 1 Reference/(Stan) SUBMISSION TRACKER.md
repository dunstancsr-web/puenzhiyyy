# Submission tracker

> **This copy is stale (still 15 Sep).** The current tracker (17 Sep: MVP2 merge status, the
> archived video script decision, the corrected engine count) lives on branch
> `docs/mvp2-tracker-update` / PR #3, not yet merged to `main` as of 17 Sep. Read that version, not
> this one, until the branches converge. This note exists so starting a fresh session on the wrong
> branch doesn't mean trusting an out-of-date status.

AWS NUS-ISS SMYA 2026 Hackathon. **Shortlisting deadline: 28 September 2026, 9:00am. Finale: 10 October.**

Four deliverables. Status as of 15 Sep.

| # | Deliverable | Status | Next step, and who |
|---|---|---|---|
| 1 | GitHub repo | done, kept current | nothing |
| 2 | Deployment URL | image built, tested and published by GitHub Actions; **Lightsail service not created yet** | Deploy now (Stan, 15 Sep: the lease can be extended, so there is no reason to wait): follow `(Stan) DEPLOY-LIGHTSAIL.md` in this folder |
| 3 | YouTube demo video | script below, updated 15 Sep; `npm run demo:reset` checks the app is ready | Stan records, near the end, with the final paid check |
| 4 | PDF write-up | `docs/Submission/WRITEUP.md` refreshed 15 Sep, all three screenshots current | fill in the URL, PIN and spend figure **in the PDF only**, then export |

## Before submitting, in this order

1. **Deploy** and run `node backend/scripts/check-deploy.js <url>` against the live service.
2. **Final paid check**: run `node backend/scripts/sonnet-check.js` first, which prints the alerts and
   the estimated cost, then again with `--confirm-spend`. Add the rows to `(Stan) MODEL SPEND.md` in
   this folder.
3. **Record the video**, following the recording checklist below.
4. **Fill in the three PDF blanks** (URL, demo PIN, spend total) and export `docs/Submission/WRITEUP.md`.
5. **Submit**, then capture evidence of the live service before the lease ends.

## Waiting for Stan's decision

| Question | Options | Where the detail is |
|---|---|---|
| When does stock become "At Risk"? | **A.** keep the code: bands scaled to each product's own holding limit (At Risk from 90% of the limit). **B.** follow requirements.md REQ-08: fixed day bands (At Risk from day 271 for every product). Nothing changes on today's data; it matters for short-life products (Brown Rice's 180 day limit: A warns at day 162, B at day 271) | design.md, "Supporting Formulas", ageing status |

## To do, not blocked

- **Recapture two features-guide screenshots** that show old versions: `docs/Guide/images/11-inventory.jpg`
  (the table before the Edit button fix) and `16-why.jpg` (the summary before urgency wording was
  removed). Then rebuild the PDF: `python3 docs/Guide/build-pdf.py`.
- **Goods Out screens** (optional before submission): the API exists; Home shows the card as "Coming soon".
- **MVP2 Day 8 ("Review suggested settings" onboarding step) is built and verified**, on its own branch
  `feature/mvp2-onboarding-day8` (PR #4). Stan is holding all merges pending alignment with his
  teammate on the forecast-engine branch (`feature/demand-forecast-engine`).

## Decisions already made

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
