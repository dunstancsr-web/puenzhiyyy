# Submission tracker

AWS NUS-ISS SMYA 2026 Hackathon. **Shortlisting deadline: 28 September 2026, 9:00am. Finale: 10 October.**

Four deliverables. Status as of 15 Sep.

| # | Deliverable | Status | Next step, and who |
|---|---|---|---|
| 1 | GitHub repo | done, kept current | nothing |
| 2 | Deployment URL | image built, tested and published by GitHub Actions; **Lightsail service not created yet** | Stan starts the AWS lease once the organizers answer on Slack, then follows `docs/(Stan) DEPLOY-LIGHTSAIL.md` |
| 3 | YouTube demo video | script below, updated 15 Sep | Stan records, near the end, with the final paid check |
| 4 | PDF write-up | `WRITEUP.md` refreshed 15 Sep, screenshots current except the Activity one | fill in the URL, PIN and spend figure **in the PDF only**, then export |

## Before submitting, in this order

1. **Deploy** and run `node backend/scripts/check-deploy.js <url>` against the live service.
2. **Final paid check**: `node backend/scripts/sonnet-check.js --confirm-spend` (about USD 0.035 for
   all six alert types). Add the rows to `docs/(Stan) MODEL SPEND.md`.
3. **Record the video** on freshly seeded data (`npm run seed` from `backend/`).
4. **Fill in the three PDF blanks** (URL, demo PIN, spend total) and export `WRITEUP.md`.
5. **Submit**, then capture evidence of the live service before the lease ends.

## Decisions already made

| Decision | Choice | Why |
|---|---|---|
| Hosting | AWS Lightsail container service, Nano | the organizers' allowed platform; rubric item 7 scores Platform & Tooling Usage; Render's free tier sleeps |
| Model | Claude Sonnet 4.5 through the organizers' Bedrock gateway | sponsored; shares the USD 100 AWS credit with hosting |
| Judge access to the paid model | demo PIN printed in the PDF | a leaked PIN is bounded by the 200 calls a day cap, about USD 1.20 |
| Paid testing | none until the final check before submission | conserve credit; correctness safeguards do not depend on the model |
| Video's Why? beat | Sonnet, a few takes | it is what judges will score; repeat views of one alert are cached and free |
| Data on the server | seeds itself on first boot; a restart resets the demo | removes the whole class of disk problems |

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

Recording notes:
- `npm run seed` immediately before, so alerts and the audit trail replay cleanly.
- Light theme, and unlock AWS Bedrock in Settings with the demo PIN before starting.
- Beat 6 last and unrushed. Observability is the criterion most demos forget to show.
- **Recapture `docs/images/activity-audit-record.jpg`** from beat 6 for the write-up; the current one
  shows the old design.

---

## Open items

- **No automated test suite.** Deliberate. CI smoke tests the built container, the benchmark
  (`backend/scripts/bench-models.js`) measures the explanation pipeline, and the interactive audit
  passes cover the UI.
- **Stockout and ageing wording on Sonnet** has only been checked on llama3 since the 15 Sep prompt
  change; the final paid check covers it.
- **`render.yaml`** is an unused fallback from before the Lightsail decision.
