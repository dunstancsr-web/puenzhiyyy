# MVP 2 — Demand Forecast: Design

> The Reorder Loop (Stan's build map, signed off 16 Sep 2026) turns historical outflow into a forecast,
> the forecast into a suggested safety stock and reorder point, and still leaves a human to approve the
> order. This document owns the forecast engine, steps 2 and 3 of that loop. Steps 4 to 11 already exist
> in MVP1 (`../mvp1-inventory-visibility/design.md`). The external risk feed (step 8) is a later slice
> and is not covered here.
>
> **One source of truth.** The forecast formula lives here and nowhere else. MVP1's design.md roadmap
> links to this document rather than restating it.

## Scope of this pass

Built: a deterministic demand-forecast engine (`backend/src/engines/forecast.js`) that projects each
SKU's outflow forward and measures its own accuracy on held-out history.

Not built, and gated on Stan's decision (see "Open decisions" below): wiring the forecast into the
app-wide demand rate, into safety stock, or into the projection curve. The engine produces figures; it
does not yet change any figure the app shows.

## Why a backtest is not optional

MVP1 deliberately deferred forecasting with the reason, recorded in `requirements.md` "Explicitly
Deferred" (Step 10) and the write-up (§7), that an unvalidated forecast figure is worse than none. So
the engine never returns a forecast without an accuracy measure beside it, and the decision to trust a
forecast keys off that measure, not off the forecast's existence.

## Training signal

`inventory_history.issues_qty`: the monthly FULFILLED outflow per SKU, 24 months seeded. The seed builds
`issues_qty` from fulfilled sales only (`db/seed.js`), the same fulfilled-only demand the velocity engine
uses for the 30 day rate, so the forecast lives in the same demand world as the rest of the app rather
than defining "demand" a second way. Lost sales are excluded, as everywhere else.

The current (incomplete) month is excluded from the series, so a half-finished month never reads as a
demand collapse.

## Forecast formula (`backend/src/engines/forecast.js`)

All figures deterministic: same history in, same numbers out. No model, no randomness (REQ-21).

```
series          = monthly issues_qty per SKU, oldest first, current month excluded
MIN_MONTHS      = 6      -- below this, forecast is null and the caller keeps avg_daily_30d
SEASON          = 12     -- monthly data, yearly season

-- Holt damped level+trend, one pass, fixed coefficients (not fitted per SKU:
-- ~24 points would overfit; fixed values stay explainable and deterministic)
ALPHA = 0.4 (level)   BETA = 0.2 (trend)   PHI = 0.9 (trend damping)
  level_t = ALPHA * series_t + (1 - ALPHA) * (level_{t-1} + PHI * trend_{t-1})
  trend_t = BETA * (level_t - level_{t-1}) + (1 - BETA) * PHI * trend_{t-1}
  holt(h) = max(0, level_last + trend_last * Σ_{i=1..h} PHI^i)      -- damped, floored at 0

-- Seasonal-naive term, only when history >= SEASON + 1 months:
  scale        = level_last / issues(same month last year)          -- scales last year's season to now
  seasonal(h)  = max(0, issues(same month last year, offset h) * scale)

forecast_monthly[h] = round( 0.5 * holt(h) + 0.5 * seasonal(h) )    -- when seasonal available
                    = round( holt(h) )                              -- otherwise
                      for h in 1..horizon   (horizon default 3, the build map's window)

forecast_horizon_mt   = Σ forecast_monthly
forecast_daily_demand = forecast_horizon_mt / (horizon * 30.44)     -- the rate the MVP1 engines speak
forecast_cv           = population CV of the last SEASON months (0 when mean is 0)  -- for safety stock
```

`forecast_daily_demand` is expressed in the same unit as `avg_daily_usage_30d` on purpose, so a caller
can substitute or blend the two without a conversion. `forecast_cv` exists because the Reorder Loop
step 5 wants the forecast's OWN variability for safety stock, not the historical `demand_cv`.

`forecastSku` returns `null` when history is shorter than `MIN_MONTHS`. Presence of
`forecast_daily_demand` is the signal a usable forecast exists; a caller must guard on presence, not on
truthiness, because `Number(null)` is `0` and `0` is finite (rules.md).

## Backtest (the trust gate)

Rolling-origin holdout. For each of the last `folds` months (default 6, capped so training keeps at
least `MIN_MONTHS`), fit on everything before it, forecast one month ahead, compare to the actual.

```
MAE   = mean |predicted - actual|                                  -- MT
MAPE  = mean( |predicted - actual| / actual ) * 100, over months where actual > 0
```

A month with zero actual outflow has no defined percentage error, so it is excluded from MAPE and
counted as `zero_months` instead of dividing by zero. If every holdout month is zero (an idle SKU),
MAPE is `null` and only MAE is reported: the caller reads a `null` MAPE as "do not trust a forecast
here" and falls back to the 30 day average.

## What the engine produces, per SKU

```
{ forecast_monthly, forecast_horizon_mt, forecast_daily_demand, forecast_cv,
  method, months_of_history, backtest: { mape, mae, folds, zero_months } }
```

## Measured on the 15 Sep seed (24 months history)

Sanity, not a stored figure (re-run rather than trust this): active SKUs backtest at roughly 9 to 21%
MAPE; the idle SKU (JP-5KG) reports a `null`/100% MAPE and is correctly untrustworthy; forecasts track
the 30 day rate but diverge where a trend or season exists (for example BM-5KG 0.56 to 0.72 up, VF-25KG
6.01 to 5.09 down). Run `node backend/scripts/check-forecast.js` for the current numbers.

## Open decisions (Stan)

1. **Replace or blend.** MVP1's "one demand rate" decision (15 Sep) makes `avg_daily_usage_30d` the
   single rate every engine reads. Feeding the forecast in means either replacing that rate with
   `forecast_daily_demand` or blending them. Either changes figures across the app, so it is Stan's
   call, not an implementation detail.
2. **Trust threshold.** The MAPE above which a forecast is used, and what happens below it (fall back to
   the 30 day average). A starting proposal: use the forecast when MAPE is present and below ~25%, else
   fall back.
3. **Method upgrade.** Whether the first-cut Holt+seasonal blend is enough for the demo, or a heavier
   model (Prophet/ARIMA/gradient boosting, the build map's candidates) is worth the dependency and, for
   the Python options, a separate service.

## Verification

- `backend/scripts/check-forecast.js` re-derives the forecast and backtest from raw history
  independently of the engine and confirms they agree, and proves the backtest can fail (an erratic
  series must score badly, a clean one well). It does not call `buildAnalytics`, so it is a test oracle,
  not a second implementation the app uses.
