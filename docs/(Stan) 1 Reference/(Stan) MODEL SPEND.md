# (Stan) Model spend ledger

> **For Stan to read.** Every paid model call the team makes, and the running total, so usage can be
> moderated against the budget. Update it BEFORE running `npm run seed`, which erases the audit trail
> these figures come from.

## The budget

| | USD |
| --- | ---: |
| AWS-sponsored credit, shared by hosting and model calls | 100.00 |
| Hosting estimate, Lightsail Nano (USD 7 a month, billed hourly) for a 15 day lease | about 3.50 |
| **Model calls to date (below)** | **0.0212** |
| Left, approximately | about 96.48 |

**Why this matters beyond cost:** hosting and model calls draw on the same sponsored pool, and going
over it may pause the AWS account and affect competition standing. A visitor spending model credit
can take the live site down with it, which is why the paid tier is PIN gated and capped.

## What one call costs

Measured from the calls below, Claude Sonnet 4.5 through the organizers' gateway:

- **One explanation, first attempt accepted:** about 860 input and 190 output tokens, **about USD 0.0055**.
- **Worst case, three attempts:** about **USD 0.017**.
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
