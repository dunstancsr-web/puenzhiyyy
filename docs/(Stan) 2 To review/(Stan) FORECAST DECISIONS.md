# (Stan) Demand forecast: three decisions before it goes live

> **For Stan to decide.** The forecast engine (the Reorder Loop steps 2-3) is built, tested and
> documented, but deliberately not yet wired into anything the app shows. Three choices are yours
> before it changes a figure. The engine, the formula and the backtest are in
> `.kiro/specs/mvp2-demand-forecast/design.md`; the numbers below come from `node backend/scripts/check-forecast.js`
> on the current seed (re-run it rather than trust a copied figure).

## What is done

- `backend/src/engines/forecast.js`: reads 24 months of monthly outflow per SKU, projects 3 months
  forward (Holt damped trend blended with same-month-last-year), and returns a daily rate in the same
  unit the rest of the app already uses.
- Every forecast carries a backtest (MAPE, the average percentage it was off on months it did not see),
  because the project's own rule is that an unvalidated forecast is worse than none.
- `backend/scripts/check-forecast.js`: an independent check that the engine matches the spec and that the
  backtest actually catches a bad forecast.

Nothing in the running app has changed. Today every engine reads the flat 30 day average, as decided on
15 Sep, and it still does.

## How the forecast compares to today's 30 day average (current seed)

| SKU | 30 day rate (today) | Forecast rate | Backtest MAPE | Read as |
|---|---:|---:|---:|---|
| TW-25KG | 4.60 | 4.38 | 8.9% | trustworthy |
| BM-25KG | 1.12 | 1.19 | 10.0% | trustworthy |
| PH-25KG | 3.67 | 3.16 | 11.7% | trustworthy |
| VF-25KG | 6.01 | 5.09 | 15.3% | sees a decline |
| BR-10KG | 0.55 | 0.51 | 15.4% | trustworthy |
| TJ-25KG | 5.58 | 6.11 | 16.5% | sees a rise |
| TJ-10KG | 5.66 | 4.63 | 16.6% | sees a decline |
| VF-10KG | 3.23 | 2.97 | 18.1% | watch |
| BM-5KG | 0.56 | 0.72 | 21.4% | sees a rise, less certain |
| JP-5KG | 0 | 0.01 | 100% | idle, do not trust |

The forecast agrees with the 30 day rate where demand is flat and diverges where there is a trend, which
is the point of having it. The idle SKU is correctly flagged as not forecastable.

## Decision 1: replace or blend

The forecast produces a daily demand rate. To use it, it either replaces `avg_daily_usage_30d` as the
one rate every engine reads, or blends with it. This matters because that rate feeds cover, safety
stock, the projection curve, suggested order quantity, ABC and the financials, so whichever you pick
moves figures across the whole app.

- **A. Replace.** The forecast becomes the demand rate. Most faithful to the Reorder Loop, but a bad
  forecast (see the trust gate) would flow everywhere at once.
- **B. Blend**, for example half forecast and half 30 day average. Softer, but reintroduces exactly the
  untested-weighting problem the 15 Sep decision removed when it deleted the old 50/50 blend.
- **C. Forecast only where the backtest says trust it** (Decision 2), else the 30 day average. My
  recommendation: it keeps the app on the proven rate wherever the forecast has not earned its place.

## Decision 2: the trust threshold

Below what MAPE is a forecast good enough to use, and what happens below it?

- Proposal: use the forecast when MAPE is present and below **25%**, otherwise fall back to the 30 day
  average. On the current seed that trusts 9 of 10 SKUs and correctly excludes the idle one.
- A tighter number (say 15%) trusts only the 5 or 6 steadiest SKUs. Your call on how cautious to be for
  a demo.

## Decision 3: how far to take the model

The first cut is a simple Holt plus seasonal blend, in Node, no new dependencies. Options:

- **Keep it** for the demo. It is explainable in one sentence and deterministic, which fits the "every
  figure traceable" story judges will score.
- **Upgrade** to Prophet, ARIMA or gradient boosting (the build map's candidates). Better on strong
  seasonality, but the Python ones mean a second service, and none of it is demo-visible beyond a
  slightly different number.

My recommendation: keep the simple model for submission, note the upgrade in the roadmap. The value on
show is the loop (forecast feeds safety stock feeds a human decision), not the model's sophistication.

## Once you decide

Say which option on each and I will wire it in behind the existing engines, re-run `check-forecast.js`
and `check-formulas.js`, take a before-and-after snapshot of every engine output on the same seed so we
can see exactly what moves, and update the spec and devlog. Until then the engine sits ready and changes
nothing.
