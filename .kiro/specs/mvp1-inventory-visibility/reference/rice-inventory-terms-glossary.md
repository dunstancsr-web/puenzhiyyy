# Rice Inventory — Terms and Formula Reference

> Source: supplied by a domain expert as a .docx, converted to markdown and lightly condensed. Original
> title: *"Plain language definitions for warehouse operations, dashboards, planning models and
> supervised AI agents."*
>
> **How StockSense currently relates to this document:** see
> [`terminology-map.md`](./terminology-map.md) for exactly which of StockSense's field names map to
> which term number below, and what changed.

## Core principle

Current stock comes only from completed operational events. Purchase orders and forecasts describe the
future — they must **never** be added to current on-hand stock. The AI agent may explain and recommend,
but authoritative quantities come from controlled calculation services.

| Layer | What it answers | Typical output |
|---|---|---|
| Current stock | What is physically recorded now? | On Hand and Available |
| Committed activity | What has already been promised? | Reserved and Outstanding Demand |
| Future supply | What is expected but not received? | Expected Incoming and In Transit |
| Planning | What may happen next? | Projected Stock and Suggested Order |
| Agent | Why did the system reach this result? | Explanation and approval request |

### The naming rule that prevents most mistakes

| Situation | Correct term | Current On Hand changes? |
|---|---|---|
| Purchase order approved | Ordered Quantity | No |
| Supplier confirms unreceived quantity | Expected Incoming | No |
| Shipment is travelling | Supplier In Transit | No |
| Warehouse records arrival | Received Pending Acceptance | No (or "Receiving" status) |
| Receipt is accepted and posted | **Actual Stock In** | **Yes** |
| Sales order is confirmed | Outstanding Demand | No |
| Order is reserved | Reserved Stock | No — Available decreases |
| Dispatch is confirmed | **Actual Stock Out** | **Yes** |

---

## Part One — Current Warehouse Stock

These describe current operational truth — every number must be rebuildable from posted movements and
visible as of a stated time.

**1. Actual Stock In** = Accepted Quantity Posted at Receipt. Updated when a validated receipt is
accepted and posted (a scan may start the transaction, but validation+posting make it authoritative). A
PO, shipment notice or truck arrival is **not** Actual Stock In. *Example: a receiver scans 500 bags;
490 accepted, 10 rejected → Actual Stock In is 490.*

**2. Actual Stock Out** = Confirmed Quantity Posted at Dispatch. Updated when the dispatch checkpoint
confirms and posts the shipment. A sales order, reservation, or pick does **not** reduce On Hand.
*Example: order for 300 bags, only 280 dispatched → Actual Stock Out is 280.*

**3. Opening Stock** = Approved Closing Stock from the Previous Cutoff. Not manually re-entered every
day.

**4. On Hand** = `Opening Stock + Actual Stock In − Actual Stock Out`. Updated by any posted receipt,
dispatch, write-off, approved adjustment, or quantity-changing conversion. Expected Incoming is **not**
included. *Example: 1,000 + 500 − 300 = 1,200 bags.*

**5. Reserved Stock** = Sum of Active Unfulfilled Reservations. On-hand stock committed to confirmed
orders or authorised internal demand. Remains physically On Hand until dispatch.

**6. Unavailable Stock** = Quality Hold + Blocked + Damaged + Rejected. Physically present but
currently unsellable/unconsumable. Moving stock between statuses does not change total On Hand.

**7. Available Stock** = `On Hand − Reserved Stock − Unavailable Stock`. What can be promised, picked,
or consumed now. Never add future purchase orders to this. *Example: 1,200 − 200 − 50 = 950 bags.*

**8. Physical Count** = Quantity Independently Observed by the Count Team. An observation, not a stock
movement — does not automatically become the ledger balance.

**9. Count Variance** = `Physical Count − System On Hand`. The system must not silently overwrite On
Hand. *Example: 1,180 − 1,200 = −20 bags.*

**10. Approved Stock Adjustment** = `Accepted Physical Count − System On Hand`, posted only after an
authorised supervisor approves the investigation. Only the posted adjustment changes On Hand — never the
raw count.

**11. Adjusted On Hand** = `Previous On Hand + Approved Adjustment`. Preserve both the original balance
and the adjustment trail.

**12. Inventory Accuracy %** = `100 × [1 − (Absolute Variance / Counted Quantity)]`. Define treatment
for zero counted quantity; exclude invalid counts.

## Part Two — Purchasing, Sales and Transfers

Commitments and future movements — support planning but never automatically change current On Hand.

**13. Ordered Purchase Quantity** = Quantity on Approved Purchase Order. Not stock, and not necessarily
supplier-confirmed.

**14. Open Purchase Order Quantity** = `Ordered − Accepted Receipts − Cancelled Quantity`. Excludes
closed/cancelled/already-received quantity.

**15. Expected Incoming Stock** = Eligible Confirmed Open PO Quantity — future supply the supplier has
confirmed and the business reasonably expects. **Not** Actual Stock In; must never increase On Hand.

**16. Supplier In Transit** = `Confirmed Shipped Quantity − Accepted Receipt Quantity`. Gate arrival
alone does not make it Available.

**17. Outstanding Customer Demand** = `Confirmed Order − Dispatched − Cancelled`. If this demand is
already reserved, don't deduct it from Available a second time.

**18. Inventory Position** = `Available + Eligible Incoming − Unreserved Outstanding Demand`. A
planning view, not labelled On Hand. The reservation method must prevent double-counting customer
demand.

**19. Internal Transfer In Transit** = `Transfer Dispatched − Transfer Received − Approved Transit
Loss`. Company total stays unchanged unless an approved loss is posted.

## Part Three — Demand and Replenishment Planning

Planning terms estimate future need — must display as-of time, assumptions, confidence, and must never
be presented as current physical stock.

**20. Qualified Demand** = `Fulfilled Sales − Accepted Customer Returns`. Promotions, samples,
exceptional orders and stockout periods should be flagged.

**21. Average Daily Demand** = `Qualified Demand / Eligible Days`. The business must define eligible
calendar days and the lookback window.

**22. Days of Cover** = `Available Stock / Average Daily Demand`. **When demand is zero, show "Not
Applicable," not infinity.** *Example: 900 / 30 = 30 days of cover.*

**23. Actual Supplier Lead Time** = `Inventory Available Time − PO Confirmation Time`. Arrival time
alone isn't the end of lead time if stock is still blocked.

**24. Expected Lead Time** = Approved Estimate from Qualified Historical Lead Times. Show supplier,
route, model version, as-of time, confidence.

**25. Forecast Demand** = Approved Model Estimate for the Selected Future Period. Not a customer order —
must be labelled as an estimate.

**26. Lead Time Demand** = Sum of Forecast Demand During Expected Lead Time. Use dated forecast values
when demand varies by week/season.

**27. Safety Stock** = `Approved Buffer Days × Average Daily Demand`. Separate from Forecast Demand and
from compliance stock.

**28. Reorder Point** = `Lead Time Demand + Safety Stock`. Falling below it creates a **recommendation**,
not an automatic purchase.

**29. Projected Stock (by date)** = `Current Available + Eligible Incoming − Confirmed Unreserved Demand
− Forecast Demand`. A future estimate — must not be labelled On Hand.

**30. Suggested Order Quantity** = `Maximum of Zero and (Target Stock − Projected Stock at Receipt)`.
After calculation, apply pack size, container size, minimum order, capacity, shelf-life and budget
constraints. Manager approval required before PO creation.

## Part Four — Performance, Value and Compliance

**31. Target Stock** = `Demand During Review + Lead Time + Safety Stock`. A policy level, not actual
inventory.

**32. Safety Breach Date** = First Future Date Projected Stock is Below Safety Stock. A predicted risk
date, not a confirmed stockout.

**33. Stockout Date** = First Future Date Projected Stock is Zero or Negative. Show confidence and the
assumptions causing the date.

**34. Customer Fill Rate %** = `100 × Quantity Fulfilled / Quantity Ordered`. Define treatment of
cancellations/substitutions.

**35. Supplier Fill Rate %** = `100 × Accepted Receipt / Supplier Confirmed Quantity`. Use accepted
quantity, not merely quantity unloaded.

**36. Gross Inventory Value** = `On Hand Quantity × Approved Unit Cost`. Keep the quantity ledger and
cost ledger distinguishable.

**37. Net Inventory Value** = `Gross Inventory Value − Impairment Allowance`. Impairment normally
reduces value, not physical quantity — disposal requires a separate write-off movement.

**38. Compliance Position** = `Eligible Compliance Stock − Required Compliance Stock`. Surplus/shortfall
against the formally approved rice-stockpile requirement. Never hard-code a simplified rule — store the
approved formula, scope, source, and effective date.

## Part Five — Agent and System Control

Keeps the agent useful without letting it create false stock numbers or bypass business authority.

**39. Data Age** = `Current Time − Latest Successful Source Update`. Stale data must not appear as
current.

**40. Calculation Readiness** = `Data Current AND Ledger Reconciled AND Required Inputs Available`. Do
not publish a normal-looking number when readiness fails.

**41. Agent Recommendation Permission** = `Calculation Ready AND Evidence Available AND Agent Permission
Valid`. The agent must use calculation-service results and never invent quantities.

**42. Execution Permission** = `Valid Recommendation AND Authorised Human Approval AND Approval Not
Expired`. Chat text alone is **not** approval — it must be structured and auditable.

---

## Appendix A — Recommended Dashboard Labels

| Dashboard label | User meaning | Display guidance |
|---|---|---|
| On Hand | Recorded physical stock now | Large current-stock card |
| Available | Stock that can still be sold | Large current-stock card |
| Reserved | Stock promised to open orders | Supporting card |
| Unavailable | Held, blocked, damaged or rejected | Exception card with drill-down |
| Stock In Today | Accepted receipts posted today | Daily activity card |
| Stock Out Today | Dispatches posted today | Daily activity card |
| Expected Incoming | Confirmed supply not yet received | Future-supply card with ETA |
| Supplier In Transit | Confirmed shipment travelling | Future-supply drill-down |
| Outstanding Demand | Confirmed quantity still to deliver | Order-risk card |
| Days of Cover | How long available stock may last | Planning card |
| Projected Stock | Future quantity by date | Line chart, clearly labelled estimate |
| Suggested Order | Proposed replenishment quantity | Recommendation requiring approval |
| Count Variance | Difference between count and system | Exception card |
| Data Status | Whether the numbers are current and reconciled | Always visible |

**Numbers that should never be combined:**

| Keep separate | Reason |
|---|---|
| On Hand and Expected Incoming | One is current physical stock; the other is future supply |
| Available and Projected Stock | One is current usable stock; the other is a future-date estimate |
| Reserved and Actual Stock Out | Reservation changes availability; dispatch changes physical stock |
| Financial Impairment and Physical Write Off | Impairment changes value; write-off changes quantity |
| Safety Stock and Compliance Stock | One is an operating buffer; the other follows an approved regulatory rule |
| Agent Recommendation and Approved Action | The agent proposes; an authorised person approves execution |

## Appendix B — Event to Calculation Map (selected)

| Operational event | Quantity effect | Main terms updated |
|---|---|---|
| Purchase order approved | No current-stock change | Ordered Quantity, Open PO |
| Supplier confirms | No current-stock change | Expected Incoming |
| Warehouse arrival scan | Creates receiving evidence | Received Pending Acceptance |
| Receipt accepted and posted | On Hand increases | Actual Stock In, On Hand, Available |
| Quality hold / release | On Hand unchanged | Unavailable ⇄ Available |
| Stock reserved | On Hand unchanged | Reserved increases, Available decreases |
| Dispatch posted | On Hand decreases | Actual Stock Out, Outstanding Demand |
| Physical count submitted | No immediate stock change | Physical Count, Count Variance |
| Count adjustment approved | On Hand changes | Approved Adjustment, Adjusted On Hand |
| Forecast published | No current-stock change | Forecast Demand, Projected Stock |
| Recommendation approved | No stock change until executed | Approval and execution status |

## Appendix C — Implementation Rules for Developers

- Every current quantity must trace to posted movements and an as-of time.
- A scan is evidence; a validated and successfully posted transaction changes the authoritative balance.
- Use separate fields for On Hand, Available, Reserved, Unavailable, Expected Incoming, Projected Stock.
- Use one base UOM for calculations; retain the original transaction unit and conversion factor.
- Reservations reduce Available but not On Hand. Dispatch reduces On Hand.
- Purchase orders/shipments never increase On Hand before an accepted receipt.
- Stock-status movements must not create or destroy total quantity.
- Physical counts create variances; only approved adjustments change the ledger.
- Prevent duplicate scans/message replays with stable transaction identifiers.
- Forecasts, projected quantities, and agent statements must show they are estimates.
- Never subtract the same customer demand once as a reservation and again as outstanding demand.
- Never treat financial impairment as a physical stock reduction unless a separate write-off is posted.
- Make policy thresholds, compliance rules, and calculation versions configurable and auditable.
- When data is stale or unreconciled, show the status and block authoritative recommendations.
- The agent may explain, investigate, draft actions — execution requires structured human approval.

**Minimum acceptance tests:** partial accepted receipt increases On Hand only by the accepted quantity
· reservation decreases Available, leaves On Hand unchanged · dispatch decreases On Hand exactly once ·
replaying the same scan doesn't post twice · moving stock to hold changes availability, not total On
Hand · transfer reconciles source + in-transit + destination throughout · a count variance doesn't
change stock until an adjustment is approved · Expected Incoming affects projection but never current On
Hand · reserved demand is never deducted twice · stale data can't appear as current · the agent can't
invent a quantity or bypass approval.

**Final calculation chain:**

```
Operational Events → Movement Ledger → On Hand → Available → Projected Stock → Suggested Order
→ Human Approval → Execution
```

If a lower step is missing or unreliable, the system must expose the issue instead of presenting a
confident result at a higher step.
