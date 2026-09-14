# (Stan) ELI18 explanations: draft for review

> **For Stan to read.** A rewrite of the rule-based explanation behind the **Why?** button, shorter and in
> plain English. **Applied on 15 Sep** after Stan's review: it now lives in `frontend/src/lib/explain.js`
> and the old wording is in git history. Every figure below was generated from the real code and real
> data at review time, not typed by hand.

## What changed and why

- **One or two short sentences per step**, in everyday words. Trade jargon removed: "blended rate",
  "throughput", "disposition", "binding constraint", "service level".
- **Plainer step headings**: *What we see, How we worked it out, If we do nothing, What to do, and why*. Same
  four-step order, because it is the reasoning chain judges follow.
- **Every figure is still the engine's own.** An automatic check confirmed each number in the draft traces
  back to the SKU record or the alert (result at the bottom).
- **One factual fix.** The current stockout text says *"55 days of cover is the minimum... Cover is short of
  that by 17 days"*. But 17 is cover against the **45-day lead time**; against 55 days the gap is 27. The draft
  states each figure against what it is actually measured from.

## Length

| Alert | SKU | Current words | Draft words | Change |
| --- | --- | ---: | ---: | --- |
| STOCKOUT_RISK | TJ-25KG | 221 | 119 | 46% shorter |
| REORDER | TW-25KG | 185 | 110 | 41% shorter |
| OVERSTOCK | VF-10KG | 179 | 132 | 26% shorter |
| IDLE | JP-5KG | 217 | 122 | 44% shorter |
| SLOW_MOVING | BM-5KG | 140 | 100 | 29% shorter |
| AGEING | JP-5KG | 116 | 94 | 19% shorter |

## Side by side

## STOCKOUT_RISK: Thai Jasmine 25KG

**Alert card:** Thai Jasmine 25KG has 28 days of cover against a 45-day supplier lead time. A stockout is projected 17 days before replenishment can arrive.

**Recommended action:** Place a replenishment order now (min 20 MT). Suggested quantity 597 MT. Consider expedited freight.

| Step | Current (221 words) | Draft (119 words) |
| --- | --- | --- |
| 1 | **What was measured**<br>160 MT available right now, against demand running at 5.71 MT a day. That blended rate comes from three windows which currently agree closely: 5.58 over 30 days, 5.78 over 60, 5.84 over 90. The trend is stable, so the rate is unlikely to rescue this on its own. | **What we see**<br>160 MT is available and 5.71 MT sells each day. That lasts 28 days. |
| 2 | **How it was derived**<br>160 MT divided by 5.71 MT a day is 28 days of cover. Replacing it takes 45 days from Supplier ABC Thailand, and policy holds 10 days of safety stock on top, so 55 days of cover is the minimum this SKU should ever sit at. Cover is short of that by 17 days, which is the projected length of the stockout. | **How we worked it out**<br>A new order takes 45 days to arrive from Supplier ABC Thailand, so the shelf runs empty 17 days before it lands. Adding the 10-day safety buffer, this product should never drop below 55 days of stock. |
| 3 | **If nothing changes**<br>About 97 MT of demand goes unfilled, worth SGD $157K in revenue and SGD $26.2K in margin. This is not hypothetical: 8 MT of demand was already lost in the last 30 days. This is an A-class SKU, so it is among the ones the portfolio can least afford to miss. | **If we do nothing**<br>About 97 MT of orders go unfilled, losing SGD $26.2K of gross profit. This is already happening: 8 MT of orders were missed in the last 30 days. It is one of your most valuable products. |
| 4 | **Why this action**<br>Ordering 597 MT restores the 500 MT target measured at the moment the shipment lands, not today. Ordering only enough to top up today's shelf would arrive already short, because roughly 257 MT gets consumed while the order is in transit. Expediting is worth pricing against the SGD $26.2K of margin at risk. The supplier minimum is 20 MT. | **What to do, and why**<br>Order 597 MT now. That puts stock back on target when the delivery lands, after counting what sells while you wait. Faster shipping is worth pricing against the SGD $26.2K at risk. |

## REORDER: Thai White Rice 25KG

**Alert card:** Thai White Rice 25KG inventory position (230 MT: available stock plus expected incoming) is at or below the approved reorder point (250 MT).

**Recommended action:** Initiate a standard replenishment order of ~449 MT within the lead-time window.

| Step | Current (185 words) | Draft (110 words) |
| --- | --- | --- |
| 1 | **What was measured**<br>Inventory position is 230 MT: 230 MT available plus 0 MT already on order. The approved reorder point is 250 MT, and the position has reached it. | **What we see**<br>230 MT is available, with nothing already on order. That is at or below the approved reorder point of 250 MT. |
| 2 | **How it was derived**<br>The system's own calculation is lead-time demand plus safety stock: 199 MT consumed over the 45 days wait, plus 43 MT of buffer, which comes to 242 MT. That buffer is sized for a 97% service level against demand variability of 0.19 and lead-time variability of 5 days. That calculation differs from the approved 250 MT. This alert follows the approved value, which a manager sets on the Inventory page; the gap between the two is worth a policy review. | **How we worked it out**<br>The reorder point is the stock needed to cover sales during the 45-day delivery wait, plus a safety buffer. The system's own estimate is 242 MT. Alerts follow the approved 250 MT you set on the Inventory page, so the gap is worth a look. |
| 3 | **If nothing changes**<br>Position keeps falling at 4.42 MT a day. Once cover drops below the 45 days lead time this becomes a stockout risk rather than a reorder, and at that point expediting is the only remaining lever. | **If we do nothing**<br>Stock keeps falling by 4.42 MT a day. Once it cannot last the 45-day wait, this becomes a stockout alert, and only paying for faster shipping helps. |
| 4 | **Why this action**<br>449 MT restores the 480 MT target measured at the point the shipment lands. There is still time to order at normal freight rates, which is the entire advantage of acting on a reorder alert rather than waiting for the stockout one. | **What to do, and why**<br>Order 449 MT. There is still time to use normal shipping, which is the whole point of ordering now. |

## OVERSTOCK: Vietnam Fragrant 10KG

**Alert card:** Vietnam Fragrant 10KG on-hand stock (620 MT) exceeds the maximum level (400 MT) by 220 MT. A further 200 MT is inbound.

**Recommended action:** Suspend purchasing. Defer or cancel the inbound PO if contractually possible. Overstock carrying cost ≈ SGD $51.7K/year.

| Step | Current (179 words) | Draft (132 words) |
| --- | --- | --- |
| 1 | **What was measured**<br>620 MT on hand against a maximum of 400 MT, so 220 MT above the ceiling. A further 200 MT is already inbound. | **What we see**<br>620 MT is on hand, but the maximum is 400 MT, so it is 220 MT over. Another 200 MT is already on the way. |
| 2 | **How it was derived**<br>The maximum is a policy value on the SKU, not a warehouse capacity limit. Carrying cost is SGD $51.7K a year, which is the overage valued at cost and charged at the 24% annual carrying rate. | **How we worked it out**<br>The maximum is a limit you set, not the size of the warehouse. Holding the extra stock costs SGD $51.7K a year (24% of its value each year). |
| 3 | **If nothing changes**<br>The carrying cost accrues whether or not the stock moves. At the current rate this is 6 months and 5 days of cover. Movement class is Normal, so demand will drain this on its own, just slower than the stock policy assumes. The question is the ceiling, not the sell-through. | **If we do nothing**<br>That cost keeps adding up while the stock sits there. At today's sales pace it lasts 6 months and 5 days. It does sell, so it will clear on its own, just slowly. The real question is whether the maximum is set right. |
| 4 | **Why this action**<br>Overstock is not automatically a mistake. A bulk discount or a hedge against a supply disruption can justify it. The point of the alert is that it should be a decision someone made, not a position the system drifted into. Suspending purchasing stops it growing while that is established. The inbound PO is the first thing to look at, since deferring it is cheaper than disposing of what it delivers. | **What to do, and why**<br>Stop buying until someone confirms the extra stock was on purpose, for example to get a bulk discount. Look at the incoming order first: delaying it is cheaper than dealing with the stock after it arrives. |

## IDLE: Japonica Short Grain 5KG

**Alert card:** Japonica Short Grain 5KG has had no sales for 3 months and 7 days. 78 MT on hand, SGD $250K tied up.

**Recommended action:** Stop replenishment. Initiate disposition review - discount, alternative channel, or CSR donation. Write-down risk ≈ SGD $87.4K.

| Step | Current (217 words) | Draft (122 words) |
| --- | --- | --- |
| 1 | **What was measured**<br>No sales at all for 97 days, against a 90-day threshold. 78 MT is sitting in the warehouse, SGD $250K of capital. The last recorded sale was 2026-06-09. | **What we see**<br>No sales for 97 days. 78 MT is sitting in the warehouse, worth SGD $250K. |
| 2 | **How it was derived**<br>Movement class is assigned on throughput, not on coverage. Zero sales in 90 days is Idle regardless of how much or how little is held. Days of cover is reported as Not Applicable here rather than as a number, because dividing by zero demand has no meaningful answer. Separately, this is a C-class SKU by annual consumption value, which is what decides how much the idleness costs. | **How we worked it out**<br>Idle is decided by sales alone: zero sales in 90 days is idle, however much or little is in stock. |
| 3 | **If nothing changes**<br>Write-down risk is SGD $87.4K, which is 35% of the value tied up. The position is also 18 MT above the maximum stock level, so it carries storage cost on top. Stock has been held 190 days of a 270-day limit, leaving 80 days before quality becomes the binding constraint rather than demand. | **If we do nothing**<br>It could lose SGD $87.4K of value, 35% of what is tied up. It is also 18 MT over its maximum, so storage costs keep adding up. It has been stored 190 days of its 270-day limit. |
| 4 | **Why this action**<br>No replenishment can help a SKU with no demand, so the only useful decisions are about disposition: discount, move it to a different channel, or donate it. Every one of those recovers less than cost. They are being compared against the write-down, not against a profit. The choice gets worse the longer it waits, which is why this is flagged as critical despite having no deadline of its own. | **What to do, and why**<br>Buying more cannot help when nobody is buying. The choice is how to clear it: discount it, sell it somewhere else, or donate it. Each gets back less than it cost, so compare them with the write-down, not with a profit, and decide soon, because waiting makes every option worse. |

## SLOW_MOVING: Basmati Premium 5KG

**Alert card:** Basmati Premium 5KG has 9 months and 22 days of cover on hand. Demand is decelerating.

**Recommended action:** Reduce or pause the next order. Review the customer base; consider a targeted promotion.

| Step | Current (140 words) | Draft (100 words) |
| --- | --- | --- |
| 1 | **What was measured**<br>9 months and 22 days of cover on hand, against a 120 day threshold. Demand is decelerating. | **What we see**<br>At today's sales pace, current stock would take 9 months and 22 days to sell. More than 120 days counts as slow. Sales are slowing down. |
| 2 | **How it was derived**<br>Cover is 175 MT divided by 0.6 MT a day. The 30, 60 and 90-day rates are 0.56, 0.72 and 0.64, and the trend flag comes from comparing the 30-day rate against the 90-day one. | **How we worked it out**<br>That is 175 MT of stock divided by the 0.6 MT that sells each day. |
| 3 | **If nothing changes**<br>SGD $389K stays committed to this SKU for months. Demand is decelerating, so the real figure is likely worse than the one shown. Slow moving is the stage before idle. It is cheaper to act on now, while there is still demand to sell into. | **If we do nothing**<br>SGD $389K stays tied up in this product for months. Because sales are slowing, it may take even longer. Slow comes before idle, and it is easier to fix while people are still buying. |
| 4 | **Why this action**<br>Reducing the next order is the lever with no downside: it slows accumulation without touching stock already paid for. A promotion is the more aggressive option and is worth it only if the margin given away is less than the carrying cost avoided. | **What to do, and why**<br>Buy less next time: it costs nothing and stops the pile growing. Run a promotion only if the discount costs less than keeping the stock. |

## AGEING: Japonica Short Grain 5KG

**Alert card:** Japonica Short Grain 5KG has been held 6 months and 10 days, against a limit of 9 months (status: Ageing).

**Recommended action:** Escalate to QA and commercial. Move stock before it reaches the holding limit, 2 months and 20 days remain.

| Step | Current (116 words) | Draft (94 words) |
| --- | --- | --- |
| 1 | **What was measured**<br>Held 190 days against a 270-day limit, which is 70% of the way through. Status is Ageing. | **What we see**<br>Stored for 190 days of its 270-day limit, 70% of the way there. |
| 2 | **How it was derived**<br>Age is measured from the last receipt date (2026-03-08), at SKU level. This is a documented simplification: without batch-level tracking, a recent delivery resets the clock on the whole position, so genuinely old stock underneath can be masked. | **How we worked it out**<br>Age counts from the last delivery. A new delivery resets the clock for the whole product, so older stock underneath can look younger than it is. |
| 3 | **If nothing changes**<br>80 days remain before the holding limit. Rice does not spoil abruptly, but quality and sellability decline, and past the limit the decision moves from commercial to quality control. | **If we do nothing**<br>80 days left before the limit. Rice does not go bad overnight, but it gets harder to sell, and past the limit it becomes a quality problem instead of a sales one. |
| 4 | **Why this action**<br>QA and commercial need to agree a route before the deadline rather than after it. Moving stock while it is still sellable at a discount recovers more than a quality-driven write-off does. | **What to do, and why**<br>Quality and sales should agree a plan before the deadline. Selling at a discount now gets back more than writing it off later. |

## Worth knowing: the live stockout explanation has a wrong figure today

The fix is in this draft, but the app is untouched until you approve. On the Alerts page, Thai Jasmine 25KG's
**Why?** currently says *"55 days of cover is the minimum this SKU should ever sit at. Cover is short of that by 17
days."* Against 55 days the gap is 27. The 17 is the gap to the 45-day lead time alone. Approving the draft fixes
it; if you would rather keep the current wording, I can fix just that sentence instead.

## Questions for you

1. **Tone:** is this the right level of plain, or too casual for judges?
2. **Headings:** keep the new plain ones, or go back to *What was measured / How it was derived / If nothing changes / Why this action*?
3. **Anything cut that you want back?** For example the 30, 60 and 90-day sales rates, or the note that ageing is measured at product level, not batch level.

Say "apply it" and I will swap the import in `pages/Alerts.jsx`, check it in the browser, and commit.

## Automatic checks on the draft

- No undefined, null or NaN values in any explanation.
- No en or em dashes.
- Every figure in every draft explanation traces back to the engine's data for that alert.
- Missing data: 24 stress cases (every alert type with an empty or partial product record) print no "null", "undefined" or "NaN". A sentence whose figure is missing is dropped instead. The current live explanation does not have this safeguard.
