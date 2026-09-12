# Rice Inventory Intelligence — Technical Implementation Specification

> Source: supplied by a domain expert (end-to-end rice inventory operations) as a .docx, converted to
> markdown and lightly condensed (tables reformatted, wording tightened) but faithful in content.
> Original title: *"Detailed step by step build guide from operational stock control to predictive
> planning and supervised agents."*
>
> **How StockSense currently relates to this document:** see
> [`terminology-map.md`](./terminology-map.md) for the field-by-field rename mapping, and
> `../requirements.md` / `../design.md` for what MVP1 actually implements vs. defers. This document is
> the full enterprise target state — most of it is **intentionally not built yet** (see the "Explicitly
> Deferred" section of `requirements.md`).

## Purpose

This specification tells technical and operational teams what to build, in what order, how each stock
event must behave, and what evidence must exist before forecasting or an AI agent is introduced.

**Primary conclusion:** the inventory ledger is the source of quantity truth. Calculation services
produce balances and policies. Predictive models may estimate demand and lead time only after data
controls pass. The AI agent may explain, investigate and coordinate — but must not invent inventory
numbers or bypass approvals.

## Build order

| # | Section | Outcome |
|---|---|---|
| 1 | Operational definition | Everyone agrees when stock enters, changes status and leaves |
| 2 | Data foundation | Products, lots, units, locations, owners, documents use stable identifiers |
| 3 | Movement ledger | Every balance can be rebuilt from immutable transactions |
| 4 | Operational workflows | Receipts, dispatches, transfers, returns, counts, repacking work end to end |
| 5 | Controls and reconciliation | Book balances compared with source totals and physical counts |
| 6 | Planning and prediction | Forecasts, lead times, safety stock, projected inventory are measurable |
| 7 | Recommendations and agents | Rules propose actions; agents explain; humans authorise material actions |

## The four system layers

| Layer | Responsibility | Must not do |
|---|---|---|
| Operational transaction | Capture real stock events and approvals | Forecast demand or rewrite posted history |
| Deterministic calculation | Calculate balances, availability, coverage, safety stock, policies, triggers | Ask an LLM to calculate authoritative quantities |
| Predictive model | Estimate future demand, lead time, uncertainty | Post transactions or approve commercial action |
| Agent | Explain, investigate, compare options, coordinate approval | Invent facts, silently change rules, directly alter stock |

**Definition of done:** a feature is complete only when the operating owner confirms the workflow,
automated tests pass, balances reconcile, failures are observable, permissions are enforced, and an
audit trail explains what happened. A dashboard alone is not proof of a working inventory system.

---

## Step 0 — Operational Process Definition

Document the real warehouse/commercial events before creating tables or models: a process map for
purchasing → receipt → quality inspection → storage → reservation → picking → dispatch → returns →
transfers → counts → damage → disposal → repacking; an event catalogue naming everything that changes
quantity, location, ownership or status; a responsibility matrix (who initiates/verifies/approves/
audits each event); cutoff rules; a glossary agreed across warehouse, procurement, sales ops and
finance.

Key decisions and recommended starting rules:

| Question | Recommended rule |
|---|---|
| When does a receipt become on hand | When the goods receipt is posted for quantity physically received |
| When does it become available | Only after required quality acceptance and location assignment |
| When does a sale reduce on hand | At confirmed physical dispatch / gate exit — not order creation |
| What does reservation do | Reduces available quantity but not on hand |
| How are errors corrected | Reverse the incorrect posting, then post the correct one — never delete history |
| Can stock be negative | Block by default; permit only controlled exceptions with reason + approval |
| Backdated events | Allow by role, recalculate balances, record posting time separately |

**Acceptance:** one agreed trigger/owner/source/posting-rule per event; one shared definition per term
across departments; the team can walk a real order end to end without an undefined transition.

## Step 1 — Master Data Foundation

Stable reference data before posting movements: SKU master (SKU ID, description, rice variety, grade,
brand, pack size, base unit, status, shelf life); batch/lot master (supplier lot, internal lot, origin,
crop year, packing/expiry date, quality attributes); warehouse/location hierarchy with capacity and
allowed stock statuses; unit-conversion rules (kg/tonne/bags/pallets/containers, versioned, controlled
rounding); party/ownership data (suppliers, customers, carriers, owned/consignment/third-party); rule
tables for tolerances, approval thresholds, movement categories, allocation, planning policy.

Rice-specific master data:

| Domain | Minimum fields | Why it matters |
|---|---|---|
| Product | Variety, grade, brand, pack size, base UOM | Prevents unlike rice/packaging from being combined |
| Lot | Origin, crop year, mill, supplier lot, internal lot | Traceability and quality investigation |
| Quality | Moisture, inspection result, fumigation, release status | Controls whether physical stock is sellable |
| Shelf life | Pack date, best-before/expiry, FEFO rank | Reduces ageing/expiry risk |
| Conversion | Bag nominal weight, tolerance, kg factor | Common mass basis for reconciliation |
| Ownership | Owned, consignment, customer-owned | Separates physical custody from financial ownership |

**Validation rules:** SKU ID/warehouse ID/base UOM mandatory; a lot-controlled SKU can't be received
without a lot ID; conversion factors positive/versioned/approved; inactive products/locations can't take
new transactions without an authorised exception; a location declares which status/product types it may
hold.

**Acceptance:** every active SKU maps to one base UOM with valid conversion; no duplicate/missing/orphan
identifiers before migration; a sample receipt and dispatch can be represented at SKU/lot/warehouse/
location/owner/base-quantity level.

## Step 2 — Inventory Movement Ledger

Build an **append-only** inventory movement ledger. Balance tables may exist for speed, but must be
derived projections rebuildable from the ledger.

```
Balance as of time t = Sum of all posted movements with an effective time up to t
```

Required fields per movement: unique movement ID + idempotency key; signed quantity in base UOM plus
original transaction quantity/UOM; movement type, reason code, source document/line, linked reversal;
SKU/lot/warehouse/location/stock-status/ownership dimensions; effective time, posting time, business
date, actor, approval, rule version; before/after balances or an equivalent sequence for investigation.

Movement design rules:
1. Validate source document, master data, status transition, unit conversion, permission, available quantity.
2. Acquire an atomic lock (or equivalent) for the affected balance key.
3. Check the idempotency key — a replayed source event returns the original result, doesn't re-post.
4. Insert the movement and update the balance projection in one atomic transaction.
5. Publish an inventory event for planning/alerts/integrations **only after** the DB transaction commits.
6. Store failed integration messages for retry and follow-up.

**Corrections and reversals:** posted movements are never edited or deleted. A correction creates a
reversing movement linked to the original, then (if needed) posts the replacement. The audit view shows
original + reversal + replacement + actors + reasons together.

**Acceptance:** rebuilding balances from the ledger matches the operational balance table; replaying
the same message twice creates one movement only; simultaneous reservations/dispatches can't
double-consume the same stock; every manual adjustment/reversal has an authorised actor and reason.

## Step 3 — Inventory Balances and Stock States

Separate quantities for physical custody, saleability, commitments and planning — never one generic
"inventory" field.

| Measure | Definition | Important rule |
|---|---|---|
| Book on hand | Recorded physically present quantity | Derived from posted movements |
| Physical count | Independently observed at stocktake | Does not overwrite book on hand |
| Available | On-hand eligible to promise/consume | Excludes reserved, hold, blocked, damaged |
| Reserved | Committed to demand but still physically present | Reduces availability, not on hand |
| In transit | Dispatched from one point, not yet received at another | Must not be counted in both warehouses |
| Inventory position | On hand + eligible supply − open demand | Demand already reserved must not be deducted twice |
| Inventory value | Financial value after valuation/provisions | Impairment ≠ physical write-off |

```
Available   = Sum of quantities in eligible "available" statuses
Count variance = Physical count − Book on hand
```

Every unit of on-site stock belongs to one mutually exclusive status: available, reserved, allocated,
picked, quarantine, quality hold, blocked, damaged, rejected. In-transit/dispatched are tracked
separately from on-site stock.

**Preventing double counting:** if a confirmed sales order reserves 20 units, Available already fell by
20. Planning must subtract only confirmed demand *not already* reflected in Available, or start from
total on hand and subtract all open demand once — pick one method and enforce it everywhere.

**Acceptance:** the system can explain the difference between on hand / available / reserved / physical
count / inventory position for any SKU; status quantities sum exactly to the on-hand total; holds and
reservations never remove physical stock; financial impairment posts without incorrectly changing
quantity.

## Step 4 — Purchase to Stock Workflow

A PO, supplier dispatch, or truck arrival is **not** automatically available inventory.

1. Approve the PO and its lines/quantities/UOMs/dates.
2. Record supplier dispatch and transport references (classify as in-transit if ownership transferred).
3. Record physical arrival without yet assuming the full ordered quantity was received.
4. Create the goods receipt with actual SKU/lot/quantity/measured weight/location/time.
5. Record shortage, overage, visible damage, document discrepancies vs. the PO/shipment.
6. Send controlled goods to quarantine/quality hold.
7. Accept, partially accept, hold, or reject the received quantity.
8. Move only accepted quantity to available status.
9. Return/dispose/resolve rejected quantity via separate approved movements.
10. Update the remaining open PO quantity and the actual available date (for lead-time measurement).

Receipt data: references (PO/line, shipment, container, delivery note, carrier); stock identity (SKU,
supplier lot, internal lot, origin, crop year, ownership); quantity (ordered/shipped/received/accepted/
held/rejected + base UOM); quality (inspection requirement/result/reason/release actor/time); time
(expected/actual arrival, receipt posting, inventory-available time); variance (shortage/overage/damage/
tolerance/resolution/approval).

**Acceptance:** partial receipts update only received+accepted quantity; rejected/held stock is visible
but unavailable; the unreceived PO balance stays open without duplicating the receipt; supplier lead
time uses the inventory-available date, not just arrival.

## Step 4A — Import Clearance and Inbound Logistics

Extends inbound from supplier dispatch through regulatory clearance and warehouse arrival: arrival
notices linked to PO/shipment/vessel/container; a configurable import-document checklist (commercial
invoice, packing list, bill of lading, delivery order, etc.); permit/declaration references (product,
grade, quantity, status, validity); haulage booking/slots/carrier; container/seal number and condition;
milestones (departure → transhipment → port arrival → clearance → container release → warehouse arrival
→ empty-container return); exception alerts (missing docs, quantity mismatch, clearance delay, missed
slot, demurrage risk).

Workflow: receive arrival notice and link to PO/shipment → validate required documents → record
permit/declaration and compare authorised quantity/scope with shipment → track port arrival/clearance
without treating goods as available → book haulage and warehouse slot → verify container/DO/vehicle/seal
at gate → record discrepancies with photos and an exception owner → release to goods-receipt after gate
checks pass → record container return / detention / demurrage exceptions.

**System boundary:** trade declarations/regulatory approvals may live in external systems — this
platform stores references/statuses/handoffs, and must never infer a permit exists just because a
shipment arrived.

**Acceptance:** every expected shipment has a PO, document status, arrival milestone, responsible owner;
permit/quantity mismatches create an exception before receipt posting; container/seal discrepancies stay
linked to the final receipt and supplier claim; clearance/haulage delay updates the predicted
inventory-available date.

## Step 4B — Mobile Receiving and Barcode Control

Point-of-activity capture to reduce delay and re-keying: authenticate + select warehouse/door → scan
PO/shipment/container → scan/search SKU → scan or create the lot → enter bag count/UOM/measured
weight/damage → capture origin/crop year/dates/quality attributes → photograph damage/seal/discrepancy
→ assign receiving/quarantine/put-away location → submit for validation/disposition → print/associate a
lot+handling-unit barcode → sync and display the resulting stock status.

Barcode/label requirements: product code maps to one approved SKU+pack config; lot code identifies
supplier+internal lot unambiguously; handling unit optionally identifies pallet/container/group; location
code supports scan-based put-away/move/pick/count; label carries SKU/description/lot/quantity/UOM/dates/
scannable ID; duplicate scans/serialised IDs are warned before reuse.

Offline/device controls: store only minimum encrypted data for an authorised offline task; stable local
transaction IDs before sync; show pending/synced/failed states; resolve conflicts through a controlled
exception queue — never silently overwrite a newer balance; support remote sign-out, device
registration, full audit of user/device/scan/time.

**Acceptance:** a receiver completes a partial receipt without a desktop; repeated sync doesn't
duplicate the receipt; label/scan resolve to the correct SKU/lot/location/base quantity; offline work
stays visibly pending until server confirmation.

## Step 5 — Order to Dispatch Workflow

Separate demand, reservation, allocation, picking and dispatch events. The customer order creates
demand; physical dispatch creates the stock-out movement.

1. Validate and confirm the order and delivery date.
2. Reserve eligible stock per policy — reduces available, leaves on hand unchanged.
3. Allocate warehouse/location/lot via FIFO/FEFO/quality/ownership/customer requirements.
4. Create the pick task, move picked quantity to "picked".
5. Record short picks, substitutions, damaged picks explicitly.
6. Verify loaded quantity and shipping documents.
7. Confirm physical dispatch/gate exit — reduces on-hand exactly once.
8. Release unused reservations; close or backorder the remaining SO quantity.
9. Link invoice/delivery status without letting financial events duplicate the quantity movement.

**Cancellation/returns:** cancellation before dispatch releases the reservation/allocation. A customer
return creates an inbound receipt into inspection status — available only after quality acceptance. A
credit note does not by itself add physical quantity.

**Acceptance:** order confirmation/reservation don't reduce on hand; dispatch reduces on hand exactly
once even if the shipping message replays; cancelled quantity returns to availability when eligible;
customer returns stay unavailable until inspected.

## Step 5A — Customer Order and Proof of Delivery

Replaces verbal/paper handoffs: order capture (phone/messaging/email/walk-in/connected channel);
customer/address/date/SKU/grade/brand/pack/quantity/UOM; price-list version/currency/discount/approval
as commercial context (no price optimisation in Phase 1); electronic pick/delivery orders linked to SO
lines; load verification (picked vs. invoiced vs. loaded); driver/carrier/vehicle/route/dispatch
confirmation; proof of delivery (recipient, time, delivered quantity, signature/equivalent); partial
delivery/rejection/failed-delivery/return-at-door workflows.

Workflow: create a written order record (read back / confirm verbal orders) → validate product/pack/
quantity/price authority/credit/date → reserve inventory, confirm shorts/substitutions → generate pick +
delivery docs from the same order version → compare picked/loaded/invoiced before dispatch → post
stock-out at dispatch → capture proof of delivery + discrepancies → create a return/redelivery case
without silently reversing the original dispatch → close the order only when delivered/cancelled/written
off.

**Acceptance:** one SO line links reservation → allocation → pick → dispatch → invoice → delivery
evidence; a price/invoice change can't create another stock movement; partial/failed deliveries preserve
the in-transit/due-for-return quantity; customer returns enter inspection before becoming available.

## Step 6 — Transfers, Returns and Repacking

**Warehouse transfer:** approved transfer order (source/dest/SKU/lot/qty) → allocate+pick at source →
post transfer dispatch (reduces source on hand, creates in-transit) → receive+verify at destination →
post destination receipt for actual quantity → investigate/approve transit loss/damage/overage.

**Supplier/customer return:** a supplier return removes quantity only when physically dispatched. A
customer return adds quantity to inspection/quarantine only when physically received. Commercial
debit/credit documents stay linked but never replace the physical events.

**Rice repacking/conversion:** conversion order (input bulk SKU/lot, planned output SKUs/formats) →
issue input quantity → record packaging-material consumption → receive each output SKU/derived lot with
actual bag count/weight → record normal loss separately from abnormal loss → calculate yield/mass
variance, require approval when tolerance is exceeded.

```
Input weight = Output weight + Recorded normal loss + Recorded abnormal loss
```

Example: 1,000 kg input bulk rice → 38 bags of 25 kg (950 kg) output + 5 kg normal process loss + **45
kg unexplained variance requiring investigation**.

**Acceptance:** stock is never in both transfer warehouses simultaneously; unreceived transfer quantity
stays visible in transit; repacking preserves lot genealogy input→output; mass variance outside
tolerance can't close without an approved reason.

## Step 7 — Physical Count and Reconciliation

Independent physical-count workflows plus daily system reconciliation. Count observations never
directly overwrite the ledger.

1. Select warehouse/zones/locations/SKUs/lots in scope.
2. Freeze movements or apply controlled cutoffs for the count scope.
3. Generate blind count tasks (hide expected quantities where appropriate).
4. Record first count, counter, device, time.
5. Require a recount when variance exceeds tolerance.
6. Investigate receiving/picking/transfer/UOM/timing causes.
7. Approve the variance per quantity/value thresholds.
8. Post a separate positive/negative adjustment movement.
9. Retain count → recount → evidence → decision → movement → reason as one audit chain.

Daily reconciliation controls: opening + movements = closing for every balance key; source-system
receipt/dispatch totals equal ledger totals; every transfer-out matches an in-transit or destination
receipt; no duplicate idempotency keys/source lines; negative balances, stale integrations, backdated
postings are reported; quality holds/rejected/unapproved adjustments are aged and assigned.

```
Calculated closing = Opening + Stock in - Stock out
Physical variance   = Observed physical count - Calculated book closing
```

**Acceptance:** count record, book balance, and posted adjustment remain three separately visible
facts; an approved adjustment brings book balance to the accepted count without erasing history; daily
reconciliation catches unmatched/stale transactions before planning runs.

## Step 8 — Historical Utilisation and Movement

Calculate demand history from fulfilled operational demand while flagging stockouts, returns,
promotions, one-off events that distort normal usage: rolling gross/net sales for 30/60/90/180 days;
average daily/monthly usage over an agreed calendar; recent-vs-long-term ratios and trend direction;
days since last meaningful outbound movement; flags for stockout-censored demand, returns, promotions,
samples, exceptional orders; classification thresholds stored as versioned business rules.

| Class | Interpretation | Action |
|---|---|---|
| Fast moving | High velocity or coverage below the normal range | Monitor replenishment frequency and shortage risk |
| Normal moving | Velocity and coverage within policy | Continue standard planning |
| Slow moving | Coverage materially exceeds policy or velocity is weak | Review purchasing, allocation, sales plan |
| Idle | No meaningful movement for the configured period | Stop replenishment, review disposition |

Thresholds are never permanently hard-coded — store scope, effective dates, version, approver, reason.

**Acceptance:** usage metrics reconcile to qualified outbound transactions; returns/internal movements
follow an approved definition; a user can see which rule version produced each classification.

## Step 8A — ABC Inventory Classification

An **economic-importance** classification alongside movement speed — ABC answers which products
consume the most inventory *value*; fast/slow describes *velocity*. The two must stay separate axes.

```
Annual consumption value = Qualified annual quantity used × Approved unit cost
```

1. Select the approved analysis period and valuation basis.
2. Calculate annual consumption value per eligible SKU.
3. Sort SKUs highest → lowest.
4. Calculate each SKU's % and cumulative % of portfolio total.
5. Assign A/B/C using configurable cumulative thresholds.
6. Store calculation date, currency, cost source, thresholds, rule version.
7. Combine ABC class with Fast/Normal/Slow/Idle for management action.

| Combined class | Interpretation | Typical attention |
|---|---|---|
| A + fast | High value, high velocity | Frequent review, strong availability control, accurate forecasting |
| A + idle | High value trapped in weak demand | Immediate purchasing stop, disposition review |
| C + fast | Lower value, frequent movement | Simple, efficient replenishment with suitable order multiples |
| C + idle | Low value, no meaningful movement | Low-priority discontinuation / clearance review |

Management approves the cost basis and thresholds — never hard-code category percentages. New products
without reliable cost need an explicit "unclassified" state.

**Acceptance:** ABC reconciles to approved quantity/cost sources; the system shows value class and
movement class as two different attributes; historical classifications retain their threshold/valuation
versions.

## Step 9 — Supplier Lead Time

Calculate actual replenishment lead time from operational milestones, not just supplier promises.

```
Actual lead time = Inventory available time - Purchase order confirmation time
```

Milestones retained: PO confirmation (starts the clock) → supplier ready date (separates production
from transport) → dispatch date (supplier fulfilment) → port/border events (route/customs delay) →
warehouse arrival (transport completion) → inventory available date (includes receiving/quality delay).

Required outputs: average/median/recent/percentile lead time by supplier/origin/route/SKU (where sample
size allows); on-time performance and quantity-fill rate; separate planned/confirmed/expected/actual
dates; a fallback hierarchy for thin-history combinations; confidence based on sample size, recency,
variability, completeness.

**Acceptance:** completed PO lines link to receipts without duplicating split receipts; the model
separates transport delay from warehouse/quality-release delay; planning falls back to an approved
conservative lead time when evidence is weak.

## Step 9A — Procurement Execution and Shipment Tracking

Connects an approved replenishment recommendation to sourcing/PO execution/shipment milestones. Phase 1
may record price/payment context without price/FX/financing optimisation.

1. Convert an approved recommendation into a requisition/draft RFQ.
2. Invite approved suppliers; capture comparable quote lines (currency, validity, incoterm, lead time, MOQ, payment terms).
3. Record the commercial selection and approval reason.
4. Create the PO from the approved supplier/quantity, retaining recommendation+approval references.
5. Receive supplier acknowledgement; compare confirmed quantity/dates with the PO.
6. Record amendments/cancellations and remaining open quantity by line.
7. Track payment/LC status as a readiness milestone where applicable.
8. Track shipment booking/departure/transhipment/arrival/clearance/delivery milestones.
9. Update expected inventory availability; raise exceptions when milestones slip.
10. Close the PO line only when receipts+cancellations+approved variances fully account for the ordered quantity.

| Field group | Examples | Phase 1 treatment |
|---|---|---|
| Quote | Supplier, quantity, price, currency, validity, incoterm | Record and compare; no autonomous price optimisation |
| Payment | Deposit, payment due, LC/bank status | Track milestone and exception only |
| Foreign exchange | Transaction currency, approved reference rate | Retain for audit; optimisation is a later phase |
| Shipment | Booking, vessel, container, milestone dates | Visibility and predicted availability |
| PO control | Original/amended/cancelled/received/remaining quantity | Use remaining eligible quantity in planning |

**Acceptance:** a recommendation traces through approval → supplier selection → PO → receipt; planning
uses only approved/unreceived/operationally-eligible PO quantity; supplier delays update projected
stock risk and the responsible owner; payment/price/FX changes never directly alter physical stock.

## Step 10 — Demand Forecasting

Start transparent, add complexity only when backtesting proves it beats the baseline.

| Level | Method | Promotion rule |
|---|---|---|
| Baseline | Seasonal naive, moving average, weighted moving average | Required for every SKU as benchmark and fallback |
| Demand model | Trend, seasonality, calendar effects, qualified causal inputs | Only when it beats the baseline consistently |
| Intermittent demand | Method for sparse/zero-heavy demand | Appropriate slow/irregular items |
| Probabilistic forecast | Demand distribution + prediction intervals | Once calibration and interpretation are validated |

Workflow: build an as-of dataset (only info available at each historical forecast date) → clean/qualify
demand, retain stockout/promotion/exceptional-event flags → generate 30/60/90-day forecasts at the
agreed grain → backtest with rolling historical origins → compare every candidate to baseline (bias,
WAPE, or agreed metric + service-level outcome) → select the best eligible method by SKU segment, not
narrative preference → publish forecast + uncertainty + freshness + model version + fallback status →
monitor error/drift, auto-fallback when quality deteriorates.

Confirmed customer orders must be handled explicitly: either forecast total demand and net orders
carefully, or forecast uncommitted demand and add confirmed orders — **never count the same demand
twice.**

**Acceptance:** the numeric forecast comes from a versioned forecasting service, never the LLM;
backtesting prevents future information leaking into historical training; output includes point
forecast + uncertainty + freshness + model version + baseline comparison; a reliable fallback exists for
new products and model failure.

## Step 11 — Safety Stock, Reorder Point and Target Levels

One planning engine for lead-time demand, safety stock, reorder point, and the operating range. Store
assumptions and rule versions with every result.

```
Lead time demand         = Forecast daily demand × Expected replenishment lead time
Reorder point            = Lead time demand + Safety stock
Recommended order qty    = Maximum of zero and (Target stock − Projected position at receipt)
```

**Safety stock:** the initial release may use a management-approved percentage or days-of-demand
buffer. A later statistical method should use demand variability, lead-time variability, forecast error
and the required service level. Safety stock is always a separate field, never hidden inside the
forecast.

**Minimum/target/maximum:** Minimum = lowest acceptable operating level. Base target = normal quantity
requirement from demand+lead time+safety stock. Maximum = limits excess/capacity/ageing exposure.
Strategic adjustment stays zero in Phase 1, stored separately for future price/market intelligence.
`Final target stock = Base target stock + Strategic adjustment`.

| Order constraint | Required treatment |
|---|---|
| Minimum order quantity | Raise to minimum only when policy permits |
| Pack/container multiple | Round with an explicit direction, show the difference |
| Warehouse capacity | Cap or flag the recommendation |
| Shelf life | Prevent an order likely to create expiry/ageing risk |
| Open purchase orders | Net only the eligible unreceived quantity |
| Budget/supplier capacity | Flag constraint, preserve the unconstrained recommendation for audit |

**Acceptance:** the system shows raw and constrained order quantities with reasons; changing a policy
creates a new version without rewriting historical recommendations; target fields stay compatible with
future strategic adjustment.

## Step 11A — Rice Stockpile Compliance

A **dedicated** compliance calculation and evidence trail for regulated rice inventory — ordinary
safety stock does not automatically satisfy it.

**Governance before implementation:** the compliance owner must approve applicable products, formula,
measurement period, eligible locations, quantity basis, reporting calendar, and exemption treatment. A
pitch deck may describe it loosely as "two months" or "two times monthly import" — developers encode
**only** the current, formally approved rule, with its effective date and source.

What the team must create: compliance applicability by SKU/grade/importer licence/warehouse/ownership;
versioned formula inputs (approved import-history period, quantity basis); required stockpile quantity,
eligible physical quantity, restricted/committed quantity, compliance surplus/shortfall; separate
treatment of operational safety stock vs. reserved compliance quantity vs. commercially available
quantity; daily current and projected compliance positions; alerts for current/projected shortfall,
missing evidence, upcoming deadlines; audit evidence linking imports/receipts/lots/locations/
adjustments/disposals/releases; controlled overrides/exemptions with approver/reason/validity/document.

Calculation flow: identify applicable products/entities → retrieve+verify qualified import history →
calculate required quantity from the active rule version → calculate eligible stock from approved
locations/ownership/status → exclude quantities the rule doesn't permit → compare eligible vs. required
→ project the comparison with dated demand and eligible incoming supply → raise an alert/action proposal
on current or projected shortfall → retain the calculation snapshot and evidence.

```
Compliance position = Eligible compliance stock - Required compliance stock
```

**Important separation:** expose at least three distinct values — regulatory requirement, operational
safety stock, and total physical on hand. A policy may reserve part of on-hand stock for compliance, but
must not silently double-count or double-subtract the same quantity.

**Acceptance:** the compliance owner approves every active formula/applicability rule; a user can drill
from the compliance balance to qualifying lots/import records; rule changes create a new version and
preserve historical calculations; the system identifies current/projected shortfalls without overstating
commercially available stock.

## Step 12 — Projected Inventory

A **dated** projection, not one net number — showing the first future risk, its size, and its expected
recovery.

Time-phased inputs: opening balance (SKU/warehouse/status); confirmed customer orders by dispatch date;
forecast uncommitted demand by day/week; open POs by realistic inventory-available date; transfers,
quality releases, expiry, disposal, planned conversions; safety stock/reorder point/min/target/max
reference levels.

**Supply eligibility:** incoming supply counts only when it passes a configurable rule (approved PO with
remaining quantity, a credible date, no blocking status). Overdue or repeatedly delayed orders are
downgraded or excluded, not left indefinitely "reliable."

| Output | Meaning |
|---|---|
| Projected on hand | Expected physical quantity by date |
| Projected available | Expected usable quantity after commitments/holds |
| First safety breach | Earliest date projected stock crosses the safety level |
| First stockout | Earliest date the relevant projected balance reaches zero |
| Lowest position | Minimum projected quantity within the horizon |
| Recovery date | Date eligible supply restores the position |
| Confidence | Combined indicator for forecast, supply, data quality |

**Acceptance:** the projection reconciles each change to a dated supply/demand event; users can drill
from a risk date to the events causing it; delayed/ineligible supply never conceals the shortage.

## Step 13 — Triggers and Recommendations

Convert projected conditions into deterministic alerts and action proposals — explainable without an
LLM.

| Trigger | Condition | Initial action |
|---|---|---|
| Shortage | Projected quantity falls below safety stock | Propose purchase, expedite, reallocate, or demand action |
| Reorder | Projected quantity falls below reorder point | Calculate constrained replenishment quantity and deadline |
| Overstock | Projected quantity exceeds maximum | Pause purchasing, transfer, or review sales action |
| Demand surge | Recent qualified demand exceeds the configured reference | Review forecast and near-term supply |
| Supplier delay | Expected availability moves beyond tolerance | Expedite, adjust promise, or source alternative supply |
| Idle / ageing | No meaningful movement, or expiry risk exceeds policy | Stop replenishment, begin disposition review |
| Data quality | Required feed is stale, incomplete, or unreconciled | Suppress unsafe automation, assign investigation |

Recommendation contract: problem + affected SKU/lot/location; evidence values, timestamps, data-quality
status; rule/model versions used; recommended action + quantity + required-by date; unconstrained and
constrained quantities with constraint reasons; urgency, confidence, expected consequence of no action;
required approver and permitted modifications.

**Acceptance:** every recommendation can be recreated from stored inputs/versions; the rule engine
produces the same result without the agent; data-quality failure suppresses or clearly limits
recommendations depending on missing facts.

## Step 14 — Agent Explanation and Investigation

Introduce the agent only after ledger, calculations, prediction, and recommendation services are stable
— use it to make trusted outputs easier to understand and act on.

**Permitted:** explain an alert from structured evidence; summarise top risks; compare approved
scenarios without altering authoritative data; investigate movements/orders/supplier history/prior
decisions through read tools; draft an operational action or approval request; ask for missing context
when a decision can't be made safely.

**Prohibited:** inventing stock/demand/forecast/safety-stock/reorder quantities; writing directly to
inventory tables; changing rules/models/master data without an authorised workflow; creating or
approving POs without required approval; hiding uncertainty, stale data, or conflicting evidence;
treating unrestricted natural language as permission for a material transaction.

| Tool class | Default access | Controls |
|---|---|---|
| Balance and traceability | Read | As-of timestamp, warehouse scope, evidence links |
| Planning and scenario | Read or compute | Versioned inputs; no posting side effects |
| Draft recommendation | Create draft | Schema validation and audit record |
| Submit for approval | Workflow write | Named approval policy, immutable request |
| Execute approved action | Restricted write | Approval token, role check, idempotency, final validation |
| Inventory adjustment | No direct agent access | Human-controlled operational service only |

Agent response structure: state the issue/urgency → state the relevant stock/demand/supply/lead-time/
policy values → explain the rule that generated the recommendation → describe the proposed action and
constraints → state uncertainty/stale inputs/missing data → request the required human decision.

**Acceptance:** the agent can't produce an authoritative quantity without a calculation-service result;
every factual claim traces to a structured input and as-of time; prompt injection / untrusted document
text can't grant execution authority; a failed agent doesn't interrupt underlying calculations/alerts.

## Step 15 — Human Approval and Execution

Commercial and inventory control stays with authorised users; approval is captured as structured data,
not chat text.

1. Create the trigger and deterministic calculation snapshot.
2. Generate the proposed action and quantity.
3. Let the agent explain the recommendation from the snapshot.
4. Present approve/modify/reject to an authorised manager.
5. If modified, require the final quantity/action and an override reason.
6. Validate approval role, amount, expiry, segregation-of-duties policy.
7. Execute through the controlled operational API with an idempotency key.
8. Link the execution result back to the decision record.
9. Measure the later operational/financial outcome.

| Decision | System behaviour |
|---|---|
| Approve | Execute the proposed action if final validation still passes |
| Modify | Store original + final action, actor, reason; validate the modified action |
| Reject | Do not execute; store actor and reason |
| Expired | Require a fresh calculation and approval |
| Failed execution | Keep approval + failure record; retry safely or return for intervention |

**Acceptance:** no material action executes without a valid, unexpired approval (or explicit policy);
the approver can't unknowingly approve based on changed inputs; execution retries can't create
duplicate POs/movements/transfers.

## Step 16 — Audit Outcomes and Learning

Store the full decision history to evaluate forecasts, recommendations, overrides, outcomes.

What to create: calculation snapshot (stock/demand/supply/lead-time/policy/rule/model versions);
trigger + recommendation + agent explanation + source evidence; manager decision/override/reason/final
quantity/approval time/role; execution reference and status; outcome measures at defined evaluation
dates; links to later stockout/excess/expiry/service-level/working-capital results.

| Area | Measures |
|---|---|
| Inventory accuracy | Book-to-physical accuracy, count variance, adjustment rate |
| Forecast | Bias, WAPE/agreed metric, interval coverage, drift |
| Supply | Actual vs. predicted lead time, on-time performance, fill rate |
| Availability | Stockout rate, service level, days below safety stock |
| Excess | Days above maximum, idle value, ageing, expiry |
| Decision quality | Recommendation acceptance, override reason, realised outcome |
| Operations | Posting latency, integration failures, reconciliation exceptions |

Manager overrides are learning data, not automatic training labels — review whether the override
improved the outcome before using it to change policy or models.

**Acceptance:** every historical recommendation is reconstructable; forecast/lead-time predictions are
evaluated against actuals using their original as-of snapshots; policy/model changes require evidence,
approval, and versioning.

## Step 17 — Dashboard and Management Experience

A concise management view with drill-down to operational evidence — **the dashboard is a window into
the system, not a separate source of truth.**

Portfolio view: total on-hand and available quantity + inventory value (where authorised); counts of
fast/normal/slow/idle SKUs; shortage-risk/overstock/ageing/data-quality exception counts;
working-capital and service-level trends; freshness and last-reconciliation status.

| SKU action view field group | Contents |
|---|---|
| Current position | On hand, available, reserved, hold, in transit |
| Demand | Recent usage, forecast, confirmed demand, uncertainty |
| Supply | Open PO quantity, expected availability, supplier confidence |
| Policy | Safety stock, reorder point, minimum, target, maximum |
| Projection | First breach, stockout, lowest point, recovery date |
| Decision | Status, trigger, action, quantity, urgency, approval state |
| Evidence | As-of time, source freshness, rule version, drill-down links |

A manager should understand the portfolio within one minute, open an affected SKU, see why the issue
exists, compare permitted options, and record a decision. The interface must distinguish fact,
prediction, recommendation, and agent-generated explanation.

**Acceptance:** all dashboard quantities match calculation-service outputs for the same as-of time;
users can trace a number to movements or dated planning events; stale/unreconciled data is visibly
identified and never appears as normal confidence.

## Step 18 — Services, Integrations and Security

Clear service boundaries so operational transactions, planning, prediction, and agents can evolve
without compromising the ledger.

| Service | Core responsibilities |
|---|---|
| Master data | Validate SKU, lot, UOM, location, ownership, rule references |
| Inventory transaction | Post, reverse, query movements and balance projections |
| Order allocation | Reserve, allocate, release stock against demand |
| Warehouse workflow | Receipt, quality, pick, dispatch, transfer, count, repack transitions |
| Planning | Utilisation, coverage, safety stock, policy, projected inventory |
| Forecasting | Demand/lead-time predictions, uncertainty, backtests, drift |
| Trigger and recommendation | Deterministic conditions, action proposal, constraints |
| Approval and execution | Authorisation, expiry, execution, retry, audit |
| Agent orchestration | Read evidence, explain, investigate, submit controlled drafts |

Non-functional requirements: atomic posting + concurrency control; idempotent APIs and event consumers;
role-based access, segregation of duties, least privilege; encryption in transit/at rest, secrets
management; observable event lag/failures/retries/dead letters/stale data; as-of querying, business-date
cutoffs, warehouse time-zone handling; versioned schemas/rules/models; recovery tests, backups,
retention, audit export; performance targets for posting/balance query/projection/dashboard refresh.

Illustrative API operations: transactions (`post_inventory_movement`, `reverse_inventory_movement`,
`receive_purchase_order`, `confirm_dispatch`); control (`change_stock_status`,
`record_physical_count`, `approve_count_adjustment`, `convert_or_repack_stock`); queries
(`get_balance_as_of`, `trace_lot`, `get_available_to_promise`, `get_open_supply_demand`); planning
(`forecast_demand`, `predict_lead_time`, `project_inventory`, `calculate_reorder`,
`evaluate_triggers`); agent (`explain_recommendation`, `compare_scenarios`, `draft_action`,
`submit_for_approval`).

**Acceptance:** every state-changing API enforces permission/validation/idempotency/audit; planning/
agent failures can't corrupt the transaction ledger; monitoring detects delayed feeds before they
mislead recommendations.

## Step 18A — Data Freshness and Operating Service Levels

Turns "live stock" from a pitch-deck promise into measurable engineering targets — each deployment sets
its own numbers, but the system must expose whether those targets are currently being met.

| Area | Measure | Required decision |
|---|---|---|
| Inventory posting | Accepted event → committed ledger movement | Target and max delay by event type |
| Balance visibility | Ledger commit → balance/dashboard visibility | Target for warehouse and management views |
| Reservation protection | Max delay before reserved stock is unavailable elsewhere | Require atomic/strongly-consistent control |
| Mobile synchronisation | Time for an online device to confirm posting | Retry/timeout/pending behaviour |
| Offline mobile work | Max offline period and data scope | Expiry and supervisor intervention |
| Supplier updates | Permitted age of shipment/ETA data | Polling/event frequency, stale threshold |
| Planning refresh | Material input change → new projection/triggers | Event-driven or scheduled refresh |
| Dashboard freshness | Age shown to users, warning threshold | Always show the as-of time and current status |

**Freshness states:** *Current* — all critical inputs within approved service levels. *Delayed* — one
input exceeds its normal target but within tolerance. *Stale* — a critical source exceeds its safe-use
threshold. *Unreconciled* — transaction totals or balance controls haven't passed. *Unavailable* — the
system can't produce the required evidence/calculation.

Behaviour when not current: display last successful event/calculation times → identify the affected
source/warehouse/SKU set and owner → suppress autonomous execution, limit recommendations per policy →
continue safe transaction capture without pretending downstream views are current → reprocess missed
events idempotently after recovery → reconcile the repaired period before restoring normal confidence.

**Acceptance:** every dashboard/recommendation shows an as-of time and freshness status; monitoring
alerts before a stale feed looks normal; recovery/replay restores events without duplicates or
unexplained balance changes; service-level targets are measurable and owned.

## Step 19 — Testing, Release and Rollout

| Layer | Examples |
|---|---|
| Unit | UOM conversion, status transition, balance equation, rounding, rule/compliance thresholds |
| Contract | API schemas, event versions, idempotency, error responses |
| Integration | ERP, WMS, sales, purchasing, mobile, logistics, permit refs, delivery evidence |
| Scenario | Permit mismatch, offline receipt replay, partial receipt, short pick, failed delivery, transfer loss, recount, repack variance |
| Reconciliation | Ledger rebuild, source totals, compliance position, as-of balances, physical counts |
| Model | Leakage, backtest, bias, baseline comparison, uncertainty, drift |
| Agent | Evidence grounding, permission boundaries, prompt injection, failure fallback |
| User acceptance | Warehouse, import, procurement, sales, compliance, finance, management sign-off |

Rollout: clean/migrate opening balances with documented cutoffs → run ledger calculations in parallel
with the current operational record → investigate every material difference → enable operational
posting in a controlled pilot warehouse/SKU group → enable planning outputs in advisory mode → measure
forecast/recommendation/operational accuracy → enable approval workflow for selected actions → expand
scope only after agreed exit criteria pass.

Release gates (all must pass): every balance drills to movements; duplicate/offline replay posts once;
import/seal exceptions stay linked to receipts; transfers neither lose nor duplicate quantity; proof of
delivery reconciles to dispatch without reposting stock; count adjustments require approval; demand/
reservations aren't double-counted; open POs include only eligible remaining quantity; compliance
calculations use an approved rule version; stale data can't appear as current; forecasting beats or
safely falls back to a baseline; the agent can't bypass approval or create authoritative numbers.

**Acceptance:** a full pilot cycle passes, exceptions are recoverable, management accepts accuracy and
residual risk.

---

## Appendix A — Minimum Data Dictionary

Selected fields (see the original for the full ~40-field dictionary; the following are the ones most
relevant to StockSense's current MVP1 scope):

| Field | Domain | Definition |
|---|---|---|
| `sku_id` | Master | Stable product identifier |
| `base_uom` | Master | Authoritative quantity unit (kg or tonne) |
| `lot_id` | Master/transaction | Internal traceability identifier — **not in MVP1** |
| `warehouse_id` | Master/transaction | Warehouse holding/changing stock |
| `stock_status` | Balance/movement | Mutually exclusive stock condition |
| `movement_id` | Ledger | Unique posting identifier — **not in MVP1** |
| `quantity_base` | Ledger | Signed quantity in base UOM |
| `idempotency_key` | Ledger | Stable replay-protection key — **not in MVP1** |
| `available_qty` | Projection | Derived eligible quantity |
| `forecast_qty` | Planning | Model estimate for horizon |
| `expected_available_date` | Supply | Date inbound stock is expected to become usable |
| `safety_stock` | Policy | Explicit buffer quantity |
| `reorder_point` | Policy | Lead-time demand + safety stock |
| `base_target_stock` | Policy | Quantity-only target |
| `strategic_adjustment` | Policy | Future market adjustment, zero in Phase 1 |
| `final_target_stock` | Policy | Base target + strategic adjustment |
| `calculation_version` | Audit | Version of calculation/rules |
| `as_of_at` | Audit | Latest included data time |
| `compliance_rule_version` | Compliance | Approved rule + effective date |
| `required_compliance_qty` | Compliance | Calculated regulatory requirement |
| `eligible_compliance_qty` | Compliance | Quantity eligible under the approved rule |
| `freshness_status` | Operations | Current / delayed / stale / unreconciled / unavailable |

## Appendix B — Inventory Event Catalogue (selected)

| Event | Quantity/status effect | Owner |
|---|---|---|
| `purchase_order_approved` | No immediate on-hand change | Procurement |
| `goods_received` | Adds quantity to receiving/quarantine | Warehouse |
| `quality_accepted` | Moves held quantity to available | Quality |
| `quality_rejected` | Moves held quantity to rejected | Quality |
| `inventory_reserved` | Available → reserved; on hand unchanged | Order allocation |
| `reservation_released` | Reserved → available | Order allocation |
| `goods_dispatched` | Reduces on hand, closes shipment quantity | Warehouse |
| `customer_return_received` | Adds quantity to inspection status | Warehouse |
| `transfer_dispatched` / `transfer_received` | Reduces source / adds destination, via in-transit | Warehouse |
| `physical_count_recorded` | Observation only, no ledger effect | Count team |
| `count_adjustment_approved` | Authorises a separate adjustment | Supervisor |
| `inventory_adjusted` | Adds/removes quantity with reason | Authorised operations |
| `inventory_written_off` | Removes quantity after approval | Operations and finance |
| `compliance_position_calculated` | Records requirement/eligible stock/evidence | Compliance |

## Appendix C — Delivery Roadmap (original, full enterprise scope)

| Sprint | Primary deliverable | Exit gate |
|---|---|---|
| 0 | Process maps, event catalogue, definitions, RACI | Operational sign-off |
| 1 | SKU, lot, UOM, warehouse, status, ownership masters | Master-data validation |
| 2 | Movement ledger, balance projection, idempotency, reversals | Ledger rebuild test |
| 3 | Import, mobile receipt, outbound, delivery, transfer, return, repacking | End-to-end scenarios |
| 4 | Counts, approvals, reconciliation, freshness monitoring | Daily controls pass |
| 5 | Utilisation, movement, ABC classification | Approved sample reproduction |
| 6 | Lead time, procurement tracking, demand forecasting | Backtests and fallback |
| 7 | Safety stock, reorder policy, stockpile compliance | Policy and compliance validation |
| 8 | Projected inventory, triggers, recommendations | Risk-date validation |
| 9 | Dashboard, agent explanation, approval workflow | Agent and approval controls |
| 10 | Pilot, parallel run, outcome measurement, rollout | Business acceptance |

> **StockSense's actual roadmap position** (as of this pass) is documented in `../design.md`'s roadmap
> appendix — practically, MVP1 sits closest to a simplified Sprint 5-8 slice (utilisation, ABC,
> safety-stock/reorder policy, a taste of projected inventory via alerts) built on a **snapshot** balance
> model rather than the Sprint 2 ledger this roadmap assumes. That gap (Sprints 0-4) is the largest
> single piece of intentionally deferred work — see `../requirements.md`'s "Explicitly Deferred" section.

**Final implementation principle:** build trust in this order — operational events, immutable ledger,
reconciled balances, deterministic planning, measurable prediction, supervised recommendations, and only
then an agent. If a lower layer is uncertain, the higher layer must expose that uncertainty rather than
hide it.
