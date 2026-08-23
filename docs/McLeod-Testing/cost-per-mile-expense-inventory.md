# McLeod expense and cost-per-mile source inventory

**Database:** `lme_analytics`  
**Inspected:** 2026-08-21  
**Access mode:** read-only SQL Server login  
**Goal:** identify every available or schema-supported expense source needed to calculate cost per mile for each tractor in the fleet.  
**Scope:** expense transactions, cost facts, fuel, driver/carrier pay, taxes, tolls, maintenance, insurance, ownership, allocation, truck assignment, and mileage denominators. Only schema metadata, row counts, and aggregates were inspected; financial amounts and sensitive records were not read.

## Executive summary

McLeod contains both a detailed operational/accounting model and an empty native cost-fact model.

The intended native cost model is visible in these schemas:

- `cost_fact` — tractor ID, trailer IDs, fuel cost, driver pay, tractor/trailer cost, toll cost, other cost/pay, and total-mile fields.
- `cost_summary` — driver pay, fuel cost/volume, loaded distance, other cost/pay, tractor cost, trailer cost, toll cost, and total cost.
- `bi_cost_fact` and `bi_cost_summary` — business-intelligence equivalents.
- `revenue_fact` — revenue and movement-mile facts with tractor/trailer dimensions.
- `fuelopt_header` — actual/effective/savings cost-per-mile fields.

All of those native fact/summary tables are currently **empty**. The only populated cost-per-mile-named field found was on `daily_snap_profile`, which is configuration/reporting data, not a truck expense fact.

A precise truck cost-per-mile calculation must therefore reconstruct the numerator from populated transaction/history tables and the denominator from a canonical truck-mile source.

### Strongest populated sources

| Cost or mileage area | Table | Rows | Truck attribution |
|---|---|---:|---|
| Fuel cost transactions | `fuel_detail_hist` | 65,847 | Direct `tractor_id`; 65,523 also have `movement_id`. |
| Fuel ticket cost | `fuel_ticket_hist` | 78,213 | Direct `tractor_id`; 76,460 have `order_id`. |
| Fuel-tax mileage | `fuel_tax_history` | 416,121 | Direct `tractor_id`; 414,352 have `movement_id`. |
| Driver/carrier settlement | `drs_settle_hist` | 260,077 | 244,379 have `tractor_id`; 260,069 have pay distance. |
| Current settlement | `settlement` | 1,004 | 573 have `tractor_id`; 1,002 have pay distance. |
| Billing/movement distance | `billing_history` | 154,693 | 136,121 have `tractor_id`; 154,678 have distance. This is billing/revenue context, not automatically expense. |
| GL postings | `gl_ledger` / `gl_ledger_hist` | 732,530 / 1,767,734 | Direct tractor fields are sparse; order links are much stronger. |
| Accident costs | `motoraccident` / `accident_cost` | 392 / 562 | `motoraccident` has direct tractor/trailer and total cost; `accident_cost` links through accident ID. |
| Odometer history | `mc_position` | 1,035,043 | Odometer plus movement/driver context; truck assignment requires equipment mapping. |
| Truck MPG history | `tractor_mpg` | 584 | 579 distinct tractors, direct `tractor_id`. |

## 1. Define the cost-per-mile product before extracting data

A single number is ambiguous unless the expense boundary is explicit. The recommended model produces at least two measures.

### 1.1 Operating cost per mile

Includes costs that directly operate or compensate the truck:

```text
fuel
+ driver/carrier settlement pay
+ direct fuel-card and payment fees
+ tolls and road usage charges
+ maintenance/repair/parts/tires, when available
+ direct accident-related costs
+ directly attributable operating taxes
+ directly attributable accessorial/other costs
-----------------------------------------------
canonical truck miles
```

### 1.2 Fully burdened cost per mile

Adds costs that are not consistently attached to individual transactions:

```text
operating costs
+ insurance
+ equipment ownership/lease/rent
+ depreciation or financing interest
+ permits/registration/compliance overhead
+ allocated terminal, shop, office, and administrative overhead
-----------------------------------------------
canonical truck miles
```

The database does not currently provide a populated, truck-linked source for every fully burdened category. The document marks those gaps rather than silently treating missing costs as zero.

### 1.3 Costs that must not be added as expenses

These are useful for revenue or profitability reporting but are not expense inputs by themselves:

- `billing_history.total_charges`, `pay_gross`, and billing totals
- `orders.freight_charge`, `total_charge`, and customer revenue fields
- `journal_sales` and revenue views
- `billing_freight_group` and revenue allocation tables
- `settlement` revenue/linehaul fields when the expense is already represented by `total_pay`

Revenue and expense can be combined for gross margin, but billing totals must not be added to the cost numerator.

## 2. Truck identity and allocation foundation

### 2.1 Fleet assets

| Table | Rows | Relevant fields/role |
|---|---:|---|
| `tractor` | 660 | Fleet asset master; direct tractor ID, driver assignments, status, owner/pay-owner, insurance, purchase date, fuel capacity/type, and current equipment group. |
| `trailer` | 459 | Trailer asset master; trailer ID, tractor association, status, odometer, service dates, and reefer link. |
| `equipment_group` | 301,992 | Equipment-group assignment with current movement ID. |
| `equipment_item` | 748,419 | Equipment-group items with equipment ID and equipment type. |
| `equipment_type` | 292 | Equipment type vocabulary; `applies_to` has four code families that require vendor dictionary confirmation. |
| `equipment_type_match` | 212 | Equipment-type matching rules. |
| `tractor_dim` | 0 | Reporting tractor dimension schema. |
| `trailer_dim` | 0 | Reporting trailer dimension schema. |

Observed equipment-link coverage:

- 295,834 equipment items match a `tractor.id` by company and ID.
- 150,196 equipment items match a `trailer.id` by company and ID.
- 269,254 movements join through `movement -> equipment_group -> equipment_item`.
- 275,138 movement rows have an equipment-group ID.
- Direct `movement.carrier_tractor`/`carrier_trailer` fields are sparse and should not be the only assignment path.

The equipment-group/item history may contain duplicates or changing assignments. A cost model must use the assignment valid for the transaction/movement time, not merely the current equipment-group row.

### 2.2 Truck attribution hierarchy

Use this order of preference for each expense row:

1. Direct `tractor_id` on the transaction/history row.
2. Direct `tractor` or `tractor_no` field, after normalizing the field semantics.
3. `movement_id`/`order_id` to movement, then movement equipment-group/item assignment.
4. `driver_id` to the driver’s time-valid tractor assignment, only where the business rule permits driver allocation.
5. Payee/company/GL allocation as a last resort, explicitly labeled as allocated rather than direct.

Every output row should retain:

- `company_id`
- source table and source row ID
- assignment method (`direct_tractor`, `movement_equipment`, `driver_assignment`, `allocated`, or `unattributed`)
- assignment confidence/status
- source date and accounting/posting date

## 3. Expense taxonomy and source map

### 3.1 Fuel, fuel cards, and fuel taxes

Fuel is the most complete directly truck-linked expense family.

| Table | Rows | Expense/mileage fields | Truck/link fields | Status |
|---|---:|---|---|---|
| `fuel_detail_hist` | 65,847 | Total/direct/funded/draft amounts, tractor cost/price/gallons, discounts, oil/reefer/misc costs, taxes, fees, transaction date. | `tractor_id`, `trailer_id`, `driver_id`, `movement_id`, `order_id`, `fuel_card_id`. | **Primary populated source.** |
| `fuel_ticket_hist` | 78,213 | Fuel volume, price, total cost, invoice, transaction date. | `tractor_id`, `trailer_id`, `driver_id`, `order_id`, `fuel_stop_id`. | **Primary populated source; reconcile against fuel detail before use.** |
| `fuel_tax_history` | 416,121 | Fuel volume, loaded/empty distance, toll miles, source/process dates. | `tractor_id`, `trailer_id`, `movement_id`, `order_id`. | **Primary mileage/tax support; no direct monetary fuel amount.** |
| `fuel_total` | 6,731 | Driver/fleet/tractor/reefer fuel cost, oil, discounts, fees, taxes, gallons. | Aggregate keys must be confirmed. | Populated aggregate; do not add to transaction tables without de-duplication. |
| `fuel_prod_total` | 3,890 | Product costs and product totals. | Company/product context. | Populated aggregate/reference. |
| `fuel_ticket` | 6 | Current fuel tickets and total cost. | Direct tractor/trailer/order keys. | Sparse current table. |
| `fuel_detail` | 3 | Current fuel detail and cost components. | Direct tractor/trailer/movement keys. | Sparse current table. |
| `fuel_wire_history` | 5,746 | Total/net amount, additional/transaction fees, effective/process dates. | `tractor_no`, `trailer_no`, `driver_id`, `order_id`, `fuel_card_id`. | Payment/invoice layer; avoid adding to fuel transaction totals. |
| `fuel_wire_open` | 59,779 | Open check/charge/net/total amounts and transaction date. | Driver/order/payee, but no direct tractor ID in the inspected key fields. | Open payment layer; allocate only with confirmed links. |
| `fuel_wire_total` | 7,201 | Invoice, net, service, and additional fees. | Fuel interface/company context. | Aggregate/payment layer. |
| `fuel_card` | 1,820 | Card/interface/expense references. | Direct `tractor_id`, `trailer_id`, `driver_id`, `payee_id`. | Attribution support, not transaction amount source. |
| `fuel_expense` | 2 | GL mappings for tractor fuel, reefer fuel, oil, repair, tire, advances, discounts, and fees. | Company configuration. | Configuration, not per-truck transactions. |
| `fuel_price` | 2,331 | Price-region history. | Company/price-date context. | Benchmark/enrichment, not actual expense. |
| `fuel_price_monthly` | 481 | Monthly regional prices. | Company/price-date context. | Benchmark/enrichment. |
| `fuel_tax_rate` | 108 | Fuel-tax and loaded/empty-mile tax rates. | Company/rate context. | Configuration; do not recompute tax if transaction already includes it. |
| `fuel_tax_history` | 416,121 | Tax mileage and fuel volume. | Direct tractor/movement. | Primary IFTA-style mileage support. |

Fuel coverage dates:

- `fuel_detail_hist`: 2024-01-01 through 2026-08-20.
- `fuel_ticket_hist`: 2023-01-01 through 2026-08-20.
- `fuel_tax_history`: 2023-01-01 through 2026-08-20.

**Important de-duplication rule:** `fuel_detail_hist`, `fuel_ticket_hist`, `fuel_total`, `fuel_wire_history`, and `fuel_wire_open` may represent different stages of the same fuel spend. Choose one canonical transaction layer, reconcile totals, and use wire/payment tables for settlement validation rather than adding them as another expense.

### 3.2 Driver, carrier, and settlement pay

| Table | Rows | Expense/mileage fields | Truck/link fields | Status |
|---|---:|---|---|---|
| `drs_settle_hist` | 260,077 | Total pay, order pay, linehaul, fuel pay, preload/per-diem, pay rate, trailer rent, payment dates/status. | `tractor_id`, `trailer_id`, `driver_id`, `movement_id`, `order_id`, `payee_id`, `pay_distance`. | **Primary direct pay source.** |
| `settlement` | 1,004 | Current total/order/linehaul/fuel/per-diem/preload pay and pay distance. | Direct tractor/trailer/driver/movement/order. | Current-period settlement source. |
| `drs_deduct_hist` | 192,281 | Deductions, GL accrual amounts, deduction codes, payment status. | `tractor_id`, `driver_id`, `movement_id`, `order_id`, `payee_id`. | Direct/indirect pay adjustment; classify each deduction before inclusion. |
| `drs_pending_deduct` | 1,639 | Pending deduction amounts and payment status. | Direct tractor/driver/movement/order. | Pending liability; include only under an accrual policy. |
| `drs_recur_deduct` | 1,566 | Recurring deductions, loan/garnishment balance, totals-to-date. | `tractor_id`, `payee_id`. | Recurring pay deduction; not automatically operating cost. |
| `drs_payroll_hist` | 63,270 | Gross/earning/net pay, tax withholding, deductions, liability insurance, pay-period and pay-mile fields. | Payee/pay-period; no dependable direct tractor key in the inspected fields. | Payroll/statutory source; allocate carefully and do not add to settlement pay twice. |
| `drs_timecard` | 538 | Regular/overtime/sick/vacation hours and pay. | Payee/company. | Payroll source; generally not truck-specific. |
| `driver_extra_pay` | 168 | Extra pay, rate, fuel-surcharge pay, deductions. | `driver_id`, `movement_id`, `order_id`, `payee_id`. | Allocate through movement/equipment. |
| `posted_wire` | 31,494 | Check, driver fee, service charge, charge amount, transaction date. | `driver_id`, `movement_id`, `order_id`, payee, fuel card. | Payment layer; reconcile, do not automatically add to settlement. |
| `journal_driver` | 1,005,594 | GL journal amounts and checks. | Payee/order; not reliably direct truck. | Posting/reconciliation layer. |
| `drs_check` | 63,216 | Settlement checks and amounts. | Payee/factoring; not direct truck. | Payment validation, not primary expense source. |

Coverage for direct settlement attribution:

- `drs_settle_hist`: 244,379 of 260,077 rows have `tractor_id`; 260,069 have pay distance.
- `settlement`: 573 of 1,004 rows have `tractor_id`; 1,002 have pay distance.
- `drs_deduct_hist`: direct tractor/movement/order fields exist; deduction inclusion requires a business classification.

**Double-counting rule:** do not add `drs_settle_hist.total_pay`, `drs_payroll_hist.tot_settle_pay`, checks, posted wires, and GL driver journals together. They are likely different lifecycle representations of the same pay expense.

### 3.3 Tolls, road usage, and distance charges

| Table/schema | Rows | Available fields | Attribution status |
|---|---:|---|---|
| `route` | 5,377,625 | Leg distance and toll amount with currency companions. | No obvious movement, truck, or route ID key in the inspected schema; not independently truck-allocatable. |
| `in_state_distance` | 597,956 | Non-toll distance, toll distance, toll amount. | No direct truck/movement key in the inspected schema. |
| `fuel_tax_history` | 416,121 | `toll_miles`, loaded/empty distance, fuel volume. | Direct tractor/movement; mileage/tax support, not toll dollars. |
| `movement` | 296,242 | Estimated toll amount and fuel/pay distances. | Movement-level estimate; assign through equipment group. |
| `orders` | 150,990 | Estimated toll amount and billing distances. | Order-level estimate; assign through current movement. |
| `cost_fact` | 0 | `tollcostmove`, `tollcostorder`. | Native cost model schema, empty. |
| `trip_detail` | 0 | Total, loaded, empty, and toll miles. | Native denominator schema, empty. |
| `trip_detail_hist` | 0 | Historical total, loaded, empty, and toll miles. | Native denominator schema, empty. |

**Gap:** toll amounts exist in route/state-distance calculations, but the inspected route/state tables do not provide a direct truck/movement key. McLeod documentation is required to identify the parent relationship or a supported view that connects calculated tolls to movements.

### 3.4 Maintenance, repairs, tires, and shop costs

The maintenance analysis found no populated dedicated repair/work-order/parts/tire/shop/warranty transaction subsystem.

| Table | Rows | Cost fields/role | Status |
|---|---:|---|---|
| `cost_fact` | 0 | Estimated tractor/trailer costs, fuel cost, driver pay, other cost/pay, toll cost, total miles, tractor/trailer IDs. | Native cost fact schema, empty. |
| `cost_summary` | 0 | Tractor/trailer/fuel/driver/other/toll/total cost and loaded distance. | Native summary schema, empty. |
| `bi_cost_fact` | 0 | BI version with tractor ID, fuel, driver pay, tractor/trailer cost, toll cost, and total miles. | Empty. |
| `bi_cost_summary` | 0 | BI cost summary. | Empty. |
| `vcard` | 0 | Repair order, maintenance group, parts/labor/tax/warranty fields. | Empty repair-spend schema. |
| `vcard_trx_history` | 0 | Repair number, labor/parts/misc/tax costs, tractor ID. | Empty repair transaction schema. |
| `vcard_trx_total` | 0 | Total labor, parts, miscellaneous, tax, fees, and invoice totals. | Empty aggregate schema. |
| `trailer_wash_wo` | 0 | Trailer-wash work orders with tractor/trailer/movement/order and internal/external wash amounts. | Empty. |
| `trailer_wash_wo_hist` | 0 | Historical trailer-wash work orders and invoice fields. | Empty. |
| `fuel_expense` | 2 | GL mappings for oil, repair, tire, tractor fuel, reefer fuel, fees, and advances. | Configuration only. |
| `fuel_detail_hist` | 65,847 | Oil, misc, reefer, and fuel cost components. | Cost enrichment; not a general repair ledger. |
| `motoraccident` | 392 | Direct tractor/trailer accident total cost. | Populated direct accident cost. |
| `accident_cost` | 562 | Cost/invoice records linked by `motoraccident_id`. | Populated; join to accident, then truck. |

Maintenance, parts, tires, warranties, depreciation, and work orders must not be treated as zero-cost merely because their transaction tables are empty. They are **unknown/unavailable in this snapshot** until McLeod confirms whether another licensed module, external system, or approved view supplies them.

### 3.5 Insurance, ownership, lease, depreciation, and financing

| Source | Rows | Available information | Cost-per-mile readiness |
|---|---:|---|---|
| `tractor` | 660 | Insurance amounts/dates/name/account, owner/pay-owner, purchase date, in/out-service dates. | Static/asset context; no complete premium/depreciation transaction history. |
| `trailer` | 459 | Asset status, purchase/service dates, dollar-value fields, ownership/loan fields. | Static/asset context; no complete ownership-cost history. |
| `drs_payee` | 1,696 | Lease/owned tractor/trailer counts, liability insurance, pay rates, reimbursements, miles. | Payee-level context; not a truck-specific expense ledger. |
| `carrier_qualification_history` | 5,383 | Insurance amounts and vehicle-maintenance qualification metrics. | Compliance/qualification history, not premium expense. |
| `drs_payroll_hist` | 63,270 | Liability insurance and payroll values. | Pay-period/payee-level; avoid adding to direct settlement without policy. |
| `amortized_payments` | 7,708 | Principal balance, payment, interest, and amortization fields. | No direct tractor/equipment key in the inspected join fields. Allocation gap. |
| `trailer_loan_profile` | 0 | Trailer loan profile schema. | Empty. |
| Dedicated depreciation/fixed-asset tables | Not found by name | No populated dedicated depreciation/fixed-asset transaction family was identified. | **Gap.** |

**Gap:** a fully burdened truck CPM cannot be precise for depreciation, financing interest, insurance premiums, permits, registration, and lease ownership costs without additional joins, an approved allocation policy, or external accounting data.

### 3.6 Accidents and claims

| Table | Rows | Cost/link fields | Use |
|---|---:|---|---|
| `motoraccident` | 392 | `total_cost`, `tractor_id`, `trailer_id`, `driver_id`, `order_id`. | Direct exceptional truck cost. |
| `accident_cost` | 562 | Cost/invoice and `motoraccident_id`. | Join to `motoraccident` for truck attribution. |
| `cargo_claim` | 0 | Claim/preventability/repair-bill schema. | Empty. |
| `claim_detail` | 0 | Claim damage-code schema. | Empty. |
| `property_damage` | 0 | Damage schema. | Empty. |
| `dr_accidents` | 0 | Driver accident cost/preventability schema. | Empty. |

Accident costs should normally be reported separately from recurring operating CPM and optionally included in a fully burdened or exceptional-cost view.

### 3.7 Other charges, accessorials, and order-level expenses

| Table | Rows | Fields and attribution |
|---|---:|---|
| `other_charge` | 13,906 | Amount, rate, taxability, fuel surcharge, order/driver/stop, loaded/empty distance units. Allocate through order -> movement -> equipment. |
| `other_charge_hist` | 15,147 | Historical equivalent with invoice and loaded/empty distance fields. |
| `other_charge_edi` | 4,869 | EDI other charges and invoice/order links. |
| `billing_history` | 154,693 | Billing totals and distances with direct tractor/trailer IDs; revenue/billing context, not automatically expense. |
| `orders` | 150,990 | Freight, pay, toll estimates, accessorials, taxes, and distance fields. |
| `movement` | 296,242 | Target/override pay, extra-stop pay, trailer rent, fuel/pay distance, estimated tolls. |
| `prorated_move` | 303,654 | Prorated fuel/nonfuel/other-charge/revenue allocations by movement. |
| `prorated_moveorder` | 294,097 | Order-level prorated allocations and total distance. |
| `posted_wire` | 31,494 | Driver fees, service charges, charge amounts, and movement/order links. Payment layer. |

These sources must be reconciled with settlement and GL postings. An order-level charge should be allocated once to the truck assignment that performed the movement.

### 3.8 General ledger, AP, and overhead

| Table | Rows | Direct truck coverage | Recommended use |
|---|---:|---|---|
| `gl_ledger` | 732,530 | Only 1 row had a populated direct tractor field; 625,655 had an order link. | Reconciliation and order-linked allocation, not direct truck-only extraction. |
| `gl_ledger_hist` | 1,767,734 | 71 direct tractor fields; 1,096,703 had order links. | Historical reconciliation and allocated cost discovery. |
| `journal_ap` | 71,743 | Only 2 rows had tractor/trailer fields. | Supplier/AP posting reconciliation; order/vendor allocation required. |
| `voucher_dist` | 397 | Tractor/trailer columns exist but no populated direct truck rows were observed. | AP distribution schema; sparse direct attribution. |
| `journal_driver` | 1,005,594 | Payee/order context, not dependable direct truck. | Payroll/settlement reconciliation. |
| `journal_office` | 17,911 | Office/payee context. | Overhead; allocate only by explicit policy. |
| `bank_rec_trx` | 54,899 | No truck key. | Cash/bank reconciliation only. |
| `ap_check` | 25,649 | Payee/vendor context. | Payment reconciliation only. |
| `open_item` | 332,083 | Order/invoice context, no direct truck. | Receivable/AP reconciliation, not direct operating cost. |

Overhead should be kept in a separate allocation layer. Assigning every GL/AP amount to the tractor that happens to be active at the time would create false precision.

## 4. Mileage denominators

A correct numerator with the wrong miles still produces a wrong CPM. The model needs one canonical mileage policy and must retain the source used for each denominator.

### 4.1 Candidate denominators

| Source | Rows | Mileage fields | Truck attribution | Assessment |
|---|---:|---|---|---|
| `mc_position` | 1,035,043 | Odometer, stopped date, movement/driver context. | Requires equipment-group or time-valid assignment. | Best candidate for actual odometer miles if assignment is resolved. |
| `fuel_tax_history` | 416,121 | Loaded distance, empty distance, toll miles. | Direct tractor/movement. | Strong operational/IFTA denominator; validate whether miles are already apportioned/rounded. |
| `drs_settle_hist` | 260,077 | Pay distance. | Direct tractor. | Pay denominator; not necessarily total operating miles. |
| `settlement` | 1,004 | Pay/order movement distance. | Direct tractor. | Current settlement denominator. |
| `billing_history` | 154,693 | Distance, loaded/empty billing distance. | Direct tractor in 136,121 rows. | Billing denominator; may exclude non-billable/deadhead miles. |
| `prorated_moveorder` | 294,097 | Total distance and movement/order distance. | Movement/order; assign through equipment. | Useful movement allocation denominator. |
| `movement` | 296,242 | Move, fuel, pay, manifest loaded/empty distance. | Equipment group; direct carrier tractor sparse. | Operational movement denominator. |
| `trp_pwu_trl_dri_reg_view` | View | Loaded and empty distance, movement, driver/trailer context. | View-level movement assignment; validate tractor exposure. | Strong candidate view for loaded/empty miles. |
| `trip_detail` / `trip_detail_hist` | 0 / 0 | Loaded, empty, total movement/trip miles, toll miles. | Native trip schema. | Empty in snapshot. |
| `tractor_mpg` | 584 | Tractor MPG with start/end dates. | Direct tractor. | Fuel-efficiency enrichment, not total miles. |
| `route` | 5,377,625 | Leg/accumulated distance. | No obvious movement/truck key. | Route calculation support only. |
| `in_state_distance` | 597,956 | Toll/non-toll distance. | No obvious movement/truck key. | State/toll calculation support only. |

### 4.2 Truck MPG quality

`tractor_mpg` contains 584 rows for 579 distinct tractors, from 2018-01-01 through 2026-06-30. The observed MPG range was 2.01 to 618.08, with an average of approximately 7.28. The extreme upper value is likely an outlier, sentinel, unit issue, or data-quality problem and must not be used without validation.

### 4.3 Recommended denominator hierarchy

1. Use odometer deltas from `mc_position` after resolving time-valid tractor assignment.
2. If odometer continuity is unavailable, use `loaded_distance + empty_distance` from `fuel_tax_history`, movement data, or the approved movement view.
3. Use `pay_distance` only for a pay-cost-per-pay-mile metric, not as the universal operating CPM denominator.
4. Use billing distance only for billing CPM or revenue-per-billable-mile metrics.
5. Keep `loaded_miles`, `empty/deadhead_miles`, `toll_miles`, and total miles separately.
6. Do not sum multiple denominator sources for the same movement.

## 5. Native cost-per-mile schemas and what is missing

### 5.1 Native cost fact model

`cost_fact` and `bi_cost_fact` contain the clearest intended model. Their schema includes:

- `tractorid`, `trailer1id`, `trailer2id`, `trailer3id`
- `fuelcostmove`, `fuelcostorder`, `fuelgallons`
- `driverpay`, `prodriverpay`, `totalorderdriverpa`
- `esttractorcostmove`, `esttractorcostorde`
- `esttrailercostmove`, `esttrailercostorde`
- `estothercostmove`, `estothercostorder`
- `otherpay`, `prootherpay`, `totalorderotherpay`
- `tollcostmove`, `tollcostorder`
- `distance`, `ordermovedistance`, `ordertotaldistance`, `totalmilesallorder`
- `orderid`, `revenue_code_id`, `costtype`, and cost-template fields

Both tables contain **zero rows**. The schema should be treated as a design reference and possible future target, not as current expense data.

### 5.2 Native summary/report models

| Table | Rows | Relevant fields |
|---|---:|---|
| `cost_summary` | 0 | Driver pay, fuel cost/volume, loaded distance, other cost/pay, tractor cost, trailer cost, toll cost, total cost/pay. |
| `bi_cost_summary` | 0 | BI equivalent of cost summary. |
| `revenue_fact` | 0 | Billable/loaded/total movement miles plus tractor/trailer dimensions and revenue/charge fields. |
| `fuelopt_header` | 0 | Actual/effective/savings cost-per-mile fields and stop/lost-utilization costs. |
| `daily_snap_profile` | 1 | `cost_per_mile` fields and tractor-fleet/reporting filters; configuration/report output, not expense facts. |
| `bid_scoreboard_profile` | 0 | `cost_mile` fields for bid analysis configuration. |

## 6. Cost-per-mile source status matrix

| Expense family | Best source | Current state | Truck attribution | CPM readiness |
|---|---|---|---|---|
| Fuel purchase cost | `fuel_detail_hist` or `fuel_ticket_hist` | Populated | Direct tractor | High after source reconciliation |
| Fuel-tax mileage | `fuel_tax_history` | Populated | Direct tractor/movement | High for mileage; not cost dollars |
| Driver/carrier pay | `drs_settle_hist` / `settlement` | Populated | Usually direct tractor | High for settlement pay |
| Driver payroll/statutory | `drs_payroll_hist` | Populated | Payee/pay-period, not direct truck | Medium/low without allocation policy |
| Driver deductions | `drs_deduct_hist` | Populated | Often direct tractor/movement | Medium; classify deductions |
| Tolls | `route`, `in_state_distance`, movement estimates | Populated calculations, weak truck links | No direct truck key in route/state tables | Low until linked view/source confirmed |
| Repairs/parts/labor | `vcard_trx_history`, `vcard_trx_total` | Empty | Schema supports tractor | Not currently available |
| PM cost | `cost_fact`, `fuelopt_*`, `tmt_*` | Empty | Schema supports truck/movement | Not currently available |
| Accident cost | `motoraccident`, `accident_cost` | Populated | Direct tractor or accident join | Medium/high for exceptional cost |
| Insurance | `tractor`, `drs_payee`, qualification/payroll | Populated context, not premiums | Mostly asset/payee level | Low without premium transactions |
| Depreciation | No populated dedicated source found | Empty/not identified | No reliable truck cost | Not available |
| Lease/financing | `amortized_payments`, asset/settlement fields | Populated amortization but no truck key | Allocation required | Low/medium after allocation |
| Trailer rent | `settlement`, `drs_settle_hist` | Populated | Direct tractor/trailer | Medium/high |
| Fuel/card/payment fees | Fuel wire/card/posted-wire tables | Populated | Mixed direct/indirect | Medium after lifecycle reconciliation |
| Taxes/permits/registration | Fuel/payroll tax plus asset fields | Partial | Mixed | Low for fully burdened CPM |
| Accessorial/other cost | `other_charge`, `other_charge_hist` | Populated | Order/driver/stop; allocate to movement | Medium |
| Overhead/AP/GL | `gl_ledger`, journals, AP/vouchers | Populated | Direct truck sparse; order links stronger | Low without explicit allocation policy |
| Native total cost | `cost_fact`, `cost_summary` | Empty | Designed for direct truck | Not available in snapshot |

## 7. Recommended calculation architecture

### 7.1 Canonical movement-cost ledger

Build an intermediate, append-only cost ledger with one row per source transaction or allocation:

```text
cost_ledger
  company_id
  source_table
  source_row_id
  source_date
  accounting_date
  tractor_id
  trailer_id
  movement_id
  order_id
  cost_category
  cost_subcategory
  amount
  currency
  miles_basis
  allocation_method
  allocation_confidence
  is_direct
  is_reversal_or_void
  source_status
```

Do not collapse to truck/month until source rows have been reconciled and duplicate lifecycle layers removed.

### 7.2 Recommended category codes

Use stable categories instead of deriving categories from GL descriptions alone:

- `fuel_tractor`
- `fuel_reefer`
- `fuel_oil`
- `fuel_card_fee`
- `driver_settlement`
- `driver_extra_pay`
- `driver_deduction_adjustment`
- `toll`
- `maintenance_repair`
- `maintenance_parts`
- `maintenance_labor`
- `tires`
- `trailer_wash`
- `accident`
- `insurance`
- `lease_rent`
- `depreciation`
- `interest_financing`
- `permits_taxes`
- `accessorial_operating`
- `allocated_overhead`

### 7.3 Numerator rules

For each cost category:

1. Select one canonical transaction source.
2. Include source and lifecycle dates.
3. Exclude voided/reversed rows or represent reversals with signed amounts.
4. Normalize currency using the documented McLeod currency fields.
5. Allocate order/movement costs to the time-valid tractor assignment.
6. Keep direct and allocated costs separate.
7. Reconcile the truck ledger back to GL/AP/settlement totals without adding the reconciliation layer twice.

### 7.4 Denominator rules

For each truck and reporting window:

```text
canonical_miles = odometer_miles
                  or loaded_miles + empty_miles
                  or approved movement-distance fallback
```

Store the denominator method and quality flags. A zero/negative/missing denominator must produce `not_computable`, not zero CPM.

### 7.5 Output measures

At minimum, produce:

- Total operating cost
- Operating cost per total mile
- Fuel cost per mile
- Driver pay per mile
- Toll cost per mile
- Maintenance/repair cost per mile
- Accident cost per mile
- Fully burdened cost per mile
- Loaded miles, empty miles, total miles, and empty-mile percentage
- Direct cost versus allocated cost
- Coverage percentage and unattributed expense amount
- Source freshness and data-quality warnings

## 8. Critical reconciliation and double-counting risks

1. **Fuel transaction versus payment layers:** Do not add `fuel_detail_hist`, `fuel_ticket_hist`, `fuel_wire_history`, `fuel_wire_open`, and `fuel_total` together without proving they represent different spend.
2. **Settlement versus payroll versus checks:** Do not add `drs_settle_hist`, `drs_payroll_hist`, `drs_check`, posted wires, and driver journals together. Pick the expense layer and use the others for reconciliation.
3. **Billing versus expense:** `billing_history` and order totals are revenue/billing values, not costs.
4. **Estimated versus actual:** `movement`/`orders` estimated pay/tolls and `cost_fact` estimated fields must not be mixed with posted settlements as if they were actual expenses.
5. **Current versus history:** Use a period boundary and void/reversal policy across current/history tables.
6. **Direct versus allocated truck assignment:** Preserve assignment method; do not present order-level allocation as a direct truck transaction.
7. **Trailer and tractor double attribution:** A trailer expense should not be added to every tractor that pulled it unless the business rule explicitly allocates it.
8. **Shared/teams:** Driver pay and movement costs may involve multiple drivers or tractors; define split rules.
9. **Pay miles versus operating miles:** Pay distance, billable distance, fuel-tax distance, movement distance, and odometer distance answer different questions.
10. **GL allocation:** Company/office overhead should not be assigned to trucks without an approved allocation basis.

## 9. Data gaps requiring McLeod confirmation

To calculate a fully burdened, precise truck CPM, ask McLeod or the carrier administrator to confirm:

1. Whether `cost_fact`/`cost_summary` can be populated or exposed through a supported report/API.
2. The supported relationship from route/state-distance toll calculations to movement/truck transactions.
3. The canonical fuel source between fuel detail, fuel ticket, fuel total, and wire/payment tables.
4. Whether settlement `total_pay` already includes fuel pay, per diem, preload, trailer rent, extra pay, and deductions.
5. The time-valid tractor assignment source for `equipment_group`/`equipment_item` history.
6. Where maintenance work orders, parts, labor, tires, warranties, and shop invoices live if they are outside this database.
7. Whether insurance premiums, permits, registration, depreciation, leases, and financing are in another accounting system.
8. The correct currency-suffix semantics and posting/transaction date rules.
9. The definition of `pay_distance`, `billing_history.distance`, `fuel_tax_history.loaded_distance`, and movement distance.
10. Which cost categories are considered operating, exceptional, reimbursable, or overhead for the carrier’s official CPM.

## 10. Recommended implementation phases

### Phase 1 — Reconstruct directly attributable operating CPM

Use:

- `fuel_detail_hist` or `fuel_ticket_hist`, after reconciliation
- `fuel_tax_history` for loaded/empty miles
- `drs_settle_hist`/`settlement` for direct pay
- `motoraccident`/`accident_cost` as a separate exceptional category
- movement/equipment-group assignment
- `mc_position` or approved movement mileage denominator

### Phase 2 — Add indirect operating costs

Add:

- `other_charge` and history through order/movement assignment
- fuel-card and payment fees
- direct deductions and extra pay
- tolls after a supported movement/truck link is confirmed
- trailer rent and other equipment-linked settlement amounts

### Phase 3 — Add maintenance and ownership costs

Requires a populated or external source for:

- repair orders
- parts and labor
- tires
- PM work
- shop/wash work orders
- warranties
- insurance premiums
- depreciation/lease/financing
- permits and registration

### Phase 4 — Add controlled overhead allocation

Only after direct and indirect costs reconcile to GL/AP should company, terminal, office, and other overhead be allocated. Report allocated overhead separately from direct truck operating cost.

## 11. Relevant views and report-layer candidates

The following views expose useful assignment, mileage, revenue, or cost fields. Their definitions and row grain must be reviewed before use; view names alone do not establish a cost contract.

| View | Relevant fields | Potential use |
|---|---|---|
| `trp_pwu_trl_dri_reg_view` | Movement ID, loaded/empty distance, carrier payee, tractor type, trailer number/type, driver number. | Candidate movement-distance and pay context view. |
| `trp_pwu_trl_dri_mcu_mcp_view` | Loaded/empty distance, trailer, driver, McLeod movement/driver IDs, fuel-tax exclusion. | Candidate movement/fuel-tax enrichment view. |
| `stp_trp_pwu_trl_dri_reg_view` | Carrier tractor/trailer, trailer numbers, driver number, override payee. | Candidate assignment view where base movement fields are sparse. |
| `recur_move_loc_view` | Tractor/trailer/trailer2/trailer3 and driver IDs. | Recurring-movement equipment context. |
| `rsp_x_rev_view` | Revenue, paid amount, and `total_cost`. | Revenue/cost comparison; validate whether cost is actual, planned, or allocated. |
| `revenue_detail_view` | Revenue amount and `charge_cost_as_amount`. | Revenue/charge analysis, not automatically expense. |
| `revenue_detail_per_fgi_view` | Revenue and charge-cost fields by freight-group item. | Revenue/charge allocation analysis. |
| `fgp_financial_amalgum_view` | Revenue and split-revenue fields. | Financial/revenue reporting, not a direct truck expense source. |
| `revenue_split_view` | Revenue, split, paid amount, and planned-pay timestamp. | Revenue/payment analysis. |

No view name matched `cost_per_mile`; the closest cost-per-mile fields exist in empty/native fact or optimization schemas and in the populated `daily_snap_profile` configuration row.

## Final assessment

McLeod can support a strong **direct operating cost-per-mile** calculation today, especially for fuel, settlement pay, fuel-tax mileage, movement-linked expenses, and accident costs. It cannot support a fully precise **fully burdened** truck CPM from this snapshot alone because native cost facts are empty and dedicated maintenance, depreciation, insurance-premium, toll-transaction, permit, and ownership-cost sources are incomplete or not truck-linked.

The safest implementation is a source-reconciled truck cost ledger with explicit direct/allocated/unattributed states, a canonical mileage denominator, and separate operating versus fully burdened CPM outputs. Missing data must remain visible as a coverage gap rather than being silently converted to zero expense.
