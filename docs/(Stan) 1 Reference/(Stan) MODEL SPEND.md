# (Stan) Model spend ledger

> **For Stan to read.** Every paid model call the team makes, and the running total, so usage can be
> moderated against the budget. Update it BEFORE running `npm run seed`, which erases the audit trail
> these figures come from.

## The budget

| | USD |
| --- | ---: |
| AWS-sponsored credit, shared by hosting and model calls | 100.00 |
| Hosting estimate, Lightsail Nano (USD 7 a month, billed hourly) for a 15 day lease | about 3.50 |
| **Model calls to date (below)** | **0.0663** |
| Left, approximately | about 96.43 |

**Why this matters beyond cost:** hosting and model calls draw on the same sponsored pool, and going
over it may pause the AWS account and affect competition standing. A visitor spending model credit
can take the live site down with it, which is why the paid tier is PIN gated and capped.

## What one call costs

Measured from the calls below, Claude Sonnet 4.5 through the organizers' gateway:

- **One explanation, first attempt accepted:** about 860 input and 190 output tokens, **about USD 0.0055**.
- **Worst case, three attempts:** about **USD 0.017**.
- **An Action Items Why?:** about 550 input and 50 to 120 output tokens, **about USD 0.002 to 0.003**.
- **An Ask question** (one lookup, one answer): **about USD 0.004 to 0.010**.
- **A repeated Why? on the same alert with unchanged stock:** served from cache, **free**.
- **The daily cap** (200 paid calls by default) bounds a bad day at about **USD 1.20**.

For scale, USD 1 buys roughly 180 fresh explanations.

## Ledger

Prices: Anthropic list price, Sonnet 4.5 at USD 3 per million input and USD 15 per million output
tokens. The gateway uses Bedrock's global endpoint, which is standard price. This is an estimate; the
organizers' figure for the team key is authoritative.

| # | When (SGT) | What | Where | Calls | Tokens in / out | USD | Running total |
| --- | --- | --- | --- | ---: | ---: | ---: | ---: |
| 1 | 14 Sep 21:43 | First gateway key test, VF-10KG overstock | Stan's Mac | 1 | 853 / 183 | 0.0053 | 0.0053 |
| 2 | 14 Sep 22:03 | Checking the overstock placeholder fix, same alert | Stan's Mac | 1 | 862 / 203 | 0.0056 | 0.0109 |
| 3 | 14 Sep 23:38 | Checking the REORDER fix, TW-25KG (fixed the wrong threshold; found a new pairing error) | Stan's Mac | 1 | 874 / 192 | 0.0055 | 0.0164 |
| 4 | 15 Sep 07:24 | Sonnet check after the waterproofing work, REORDER TW-25KG only (accepted first try, figures correct) | Stan's Mac | 1 | 804 / 159 | 0.0048 | 0.0212 |
| 5 | 20 Sep 17:28:10 | Final check, alert Why? STOCKOUT_RISK TJ-25KG (accepted first try) | Stan's Mac | 1 | 772 / 141 | 0.0044 | 0.0256 |
| 6 | 20 Sep 17:28:16 | Final check, alert Why? OVERSTOCK VF-10KG (accepted first try; a wording slip found, see devlog) | Stan's Mac | 1 | 840 / 207 | 0.0056 | 0.0312 |
| 7 | 20 Sep 17:28:21 | Final check, alert Why? IDLE JP-5KG (accepted first try) | Stan's Mac | 1 | 814 / 147 | 0.0046 | 0.0358 |
| 8 | 20 Sep 17:28:29 | Final check, alert Why? SLOW_MOVING VF-10KG (accepted first try) | Stan's Mac | 1 | 891 / 252 | 0.0065 | 0.0423 |
| 9 | 20 Sep 17:28:34 | Final check, alert Why? AGEING JP-5KG (accepted first try) | Stan's Mac | 1 | 818 / 134 | 0.0045 | 0.0468 |
| 10 | 20 Sep 17:28:39 | Final check, Action Items Why? stockout TJ-25KG | Stan's Mac | 1 | 547 / 115 | 0.0034 | 0.0502 |
| 11 | 20 Sep 17:28:41 | Final check, Action Items Why? blind spot JP-5KG | Stan's Mac | 1 | 467 / 49 | 0.0021 | 0.0523 |
| 12 | 20 Sep 17:28:48 | Final check, Ask: TJ-25KG compared with VF-10KG (one lookup, one answer) | Stan's Mac | 2 | 1544 / 339 | 0.0097 | 0.0620 |
| 13 | 20 Sep 17:28:54 | Final check, Ask: recent demand for BM-5KG (one lookup, one answer) | Stan's Mac | 2 | 957 / 98 | 0.0043 | 0.0663 |

## How to update this

1. From `backend/`, run `node scripts/spend.js`. It lists every paid call in this machine's audit trail
   with its tokens and cost, failed attempts included.
2. Add any rows not already above, and update the running total and the budget table.
3. Only then run `npm run seed`. The seed prints a warning with the amount it is about to erase.

## What this ledger cannot see

- **Calls made on another machine or on the deployed server.** They are in that database's audit trail.
  After deploy day, the Lightsail container's own calls are lost whenever it redeploys, so check
  Settings → AWS Bedrock ("N of 200 paid calls today") and note significant usage here by hand.
- **The organizers' actual billing rate**, if it differs from list price.
