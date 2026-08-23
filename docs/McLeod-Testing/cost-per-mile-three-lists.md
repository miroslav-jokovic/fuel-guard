# Cost per Mile — Three Lists

**Purpose:** define exactly what the outside calculation harness needs, what McLeod can supply, and what is missing.  
**Database inspected:** `lme_analytics` on 2026-08-21.  
**Calculation location:** outside McLeod.  
**Data handling:** no financial amounts, credentials, or business records were read into this document.

## Definitions

- **Direct operating CPM:** expenses directly connected to operating the truck divided by total operating miles.
- **Fully burdened CPM:** direct operating CPM plus approved allocations for ownership, insurance, permits, office, terminal, shop, and other overhead.
- **Supported:** the database schema contains the data structure, whether or not rows currently exist.
- **Available now:** populated records were observed.
- **Indirect:** the data exists but must be connected to a truck through an order, movement, driver, payee, GL account, or allocation rule.
- **Missing:** the inspected database does not provide a populated, reliable, truck-attributable source.

# List 1 — Expenses that should be included in Cost per Mile

The harness should calculate each category separately before producing totals. Each category must be marked as **direct**, **allocated**, **unattributed**, or **not available**.

| # | Expense category | Include in direct operating CPM | Include in fully burdened CPM | Required treatment |
|---:|---|---|---|---|
| 1 | Tractor fuel | Yes | Yes | Use actual fuel purchase cost, taxes, discounts, and fees. Do not count the same fuel again from a payment or GL layer. |
| 2 | Reefer fuel | Optional separate line; include only when the reefer was operating for the truck/load | Yes when included by policy | Keep separate from tractor fuel where possible. |
| 3 | Oil, DEF, fluids, and fuel-related consumables | Yes when directly attributable | Yes | Include actual purchase cost; do not confuse fuel-stop availability with a purchase. |
| 4 | Fuel-card and transaction fees | Yes | Yes | Include card, transaction, funding, wire, and payment fees once. |
| 5 | Fuel taxes and IFTA-related operating taxes | Yes when treated as operating cost | Yes | Use actual tax expense where available; use tax rates only to calculate missing tax, not to duplicate posted tax. |
| 6 | Driver/carrier settlement pay | Yes | Yes | Include the selected settlement expense measure once. Do not add payroll, checks, wires, and GL postings again. |
| 7 | Driver extra pay | Yes | Yes | Include approved extra pay, stop pay, detention pay, preload pay, and similar compensation. |
| 8 | Per diem and driver allowances | Yes if company policy treats them as truck operating cost | Yes | Keep separately visible because they may be driver- or trip-based rather than truck-based. |
| 9 | Driver payroll burden | Usually yes for a fully loaded operating view | Yes | Include employer payroll taxes, workers compensation, benefits, and employer-paid insurance only when attributable. |
| 10 | Tolls and road charges | Yes | Yes | Use actual paid tolls; calculated/estimated tolls must be labeled as estimates. |
| 11 | Scale, parking, ferry, border, and other road-use fees | Yes when truck-attributable | Yes | Require a transaction source and truck/movement link. |
| 12 | Preventive maintenance | Yes | Yes | Include scheduled service, inspections, fluids, and PM labor once a maintenance source is connected. |
| 13 | Repairs and breakdown service | Yes | Yes | Include parts, labor, roadside service, towing, and repair invoices. |
| 14 | Tires | Yes | Yes | Include tire purchases, mounting, retreading, balancing, and tire service; apply credits/warranty offsets. |
| 15 | Trailer maintenance and washing | Yes when allocated to the truck/trailer combination | Yes | Keep trailer costs separate before applying a tractor allocation rule. |
| 16 | Accident and damage costs | Separate exceptional-cost measure; optionally include in operating CPM | Yes if approved | Show recurring CPM and CPM including exceptional accidents separately. |
| 17 | Truck lease expense | Yes for an accrual/operating view | Yes | Use lease expense, not loan principal. Keep cash payments separate. |
| 18 | Trailer lease or rent | Yes when allocated to the operating truck | Yes | Include trailer rent once; do not also add the same rent from payroll or GL. |
| 19 | Truck depreciation | No for cash-only CPM; yes for economic/fully burdened CPM | Yes | Use the approved fixed-asset depreciation schedule. Do not use purchase price directly as a single-period expense. |
| 20 | Trailer depreciation | No for cash-only CPM; yes for economic/fully burdened CPM | Yes | Allocate over useful life and assign to trucks/trailer usage by policy. |
| 21 | Loan interest and financing fees | Yes for an accrual/fully burdened view | Yes | Interest and financing fees are expenses; principal repayment is a cash-flow measure, not an accounting expense. |
| 22 | Insurance | Yes only if directly assigned and policy requires it | Yes | Include liability, cargo, physical damage, workers compensation, occupational accident, and other approved premiums. |
| 23 | Permits, registration, plates, and operating authority | Yes when truck-specific | Yes | Allocate annual fees over the valid period and identify the truck/fleet basis. |
| 24 | Compliance and regulatory costs | Yes when operating-related | Yes | Include drug testing, inspections, filings, and compliance services when approved as fleet cost. |
| 25 | ELD, GPS, telematics, communications, and toll-transponder subscriptions | Yes when truck-specific | Yes | Allocate monthly service fees by truck, active days, or approved fleet basis. |
| 26 | Other truck-specific operating expenses | Yes | Yes | Include only expenses with a documented category and truck/movement allocation. |
| 27 | Truck equipment and securement gear | Yes when consumed or directly assigned | Yes when capitalized/allocated | Include straps, chains, load bars, tarps, dunnage, tie-downs, safety gear, and truck tools. Expense or depreciate according to accounting policy. |
| 28 | Office rent and office facilities | No for direct operating CPM | Yes, as allocated overhead | Include rent, utilities, cleaning, security, and facility services through an approved allocation rule. |
| 29 | Office salaries and payroll burden | No for direct operating CPM | Yes, as allocated overhead | Include office wages, employer taxes, benefits, and workers compensation only through an approved fleet allocation. |
| 30 | Office supplies and office equipment | No for direct operating CPM | Yes, as allocated overhead | Include stationery, technology, furniture, computers, and other office purchases; separate capital assets from supplies. |
| 31 | Terminal, dispatch, shop, and facility overhead | No for direct operating CPM | Yes, as allocated overhead | Keep the allocation visible and separate from direct truck cost. |
| 32 | Accounting, payment, factoring, and administrative fees | Depends on policy | Yes when approved | Include only the portion classified as fleet operating cost. |
| 33 | Reimbursements, discounts, credits, refunds, and warranty recoveries | Not an expense category | Reduce the related expense | Apply against the original category; never count a reimbursement as positive cost. |
| 34 | Cash advances and driver deductions | Not automatically an expense | Only according to accounting policy | Separate cash movement, deduction, and actual expense. |

**Required totals:**

```text
Direct operating CPM = direct operating expenses / total operating miles
Fully burdened CPM = (direct operating expenses + approved allocations) / total operating miles
```

The harness must not add revenue, billing totals, customer charges, or linehaul revenue to the expense numerator.

# List 2 — Data McLeod can provide based on the database

The following data structures are supported by the McLeod database. “Available now” means populated records were observed. “Supported but empty” means the schema exists and could provide the data if the relevant module is enabled or populated.

| # | McLeod data McLeod can provide | Main database sources | Current status and use |
|---:|---|---|---|
| 1 | Tractor and trailer identity | `tractor`, `trailer`, `equipment_group`, `equipment_item`, `equipment_type` | **Available now.** 660 tractors and 459 trailers. Used to assign every cost to equipment. |
| 2 | Time-varying truck/movement assignment | `movement`, `equipment_group`, `equipment_item`, movement assignment views | **Available, indirect.** 269,254 movements joined through equipment items. Assignment history must be made time-aware. |
| 3 | Fuel purchase amount | `fuel_detail`, `fuel_detail_hist`, `fuel_ticket`, `fuel_ticket_hist`, `fuel_total` | **Available now.** Historical fuel-detail, ticket, and aggregate records are populated. |
| 4 | Fuel volume and price | `fuel_detail_hist`, `fuel_ticket_hist`, `fuel_total`, `fuel_products_hist`, `fuel_price` | **Available now.** Includes gallons, price, product, discounts, taxes, and fuel type. |
| 5 | Fuel-card and payment fees | `fuel_card`, `fuel_wire_history`, `fuel_wire_open`, `fuel_wire_total`, `posted_wire` | **Available now, indirect.** Must reconcile payment layers to fuel transactions. |
| 6 | Tractor fuel, reefer fuel, oil, and miscellaneous fuel cost components | `fuel_detail_hist`, `fuel_total`, `fuel_expense` | **Available now/partially configured.** Actual fuel rows exist; category GL mappings exist. |
| 7 | Fuel-tax mileage and fuel volume | `fuel_tax_history`, `fuel_tax_rate` | **Available now.** 416,121 rows; direct tractor and movement relationships are present. |
| 8 | Loaded, empty, toll, pay, billing, and movement miles | `fuel_tax_history`, `movement`, `billing_history`, `settlement`, `drs_settle_hist`, `prorated_moveorder`, movement views | **Available now, with multiple definitions.** The harness must select one official operating-mile denominator. |
| 9 | Odometer and usage history | `mc_position`, `mc_performx`, `tractor_mpg` | **Available now.** Odometer/performance data exists; assignment and quality must be validated. |
| 10 | Driver/carrier settlement pay | `drs_settle_hist`, `settlement` | **Available now.** Includes total pay, order pay, per diem, preload, pay distance, pay status, and equipment IDs. |
| 11 | Trailer rent and equipment-related pay | `settlement`, `drs_settle_hist`, `drs_payroll_hist`, `payroll_control` | **Available now/partially configured.** Trailer-rent fields and account mappings exist. |
| 12 | Driver payroll and pay-period information | `drs_payroll_hist`, `drs_timecard`, `drs_timecard_hist`, `off_payroll_hist`, `off_check` | **Available now, mostly payee-based.** Includes gross/net pay, taxes, deductions, benefits, and pay miles. |
| 13 | Driver deductions and advances | `drs_deduct_hist`, `drs_pending_deduct`, `drs_recur_deduct`, `posted_wire`, deduction codes | **Available now.** Must classify actual expense versus deduction/cash movement. |
| 14 | Driver extra pay and movement-related pay | `driver_extra_pay`, `edi_driverextrapay`, `movement`, `settlement` | **Available now/partially populated.** Can be assigned through driver, order, or movement. |
| 15 | Other movement/order charges | `other_charge`, `other_charge_hist`, `other_charge_edi`, `prorated_move`, `prorated_moveorder` | **Available now.** Requires allocation from order/movement to truck. |
| 16 | Tolls and road-cost calculations | `route`, `in_state_distance`, `movement`, `orders`, `cost_fact` | **Supported.** Route/state toll calculations and estimated toll fields exist; native cost fact is empty and paid toll attribution is incomplete. |
| 17 | Office and company accounting expenses | `journal_office`, `gl_ledger`, `gl_ledger_hist`, `gl_account`, `gl_assignment` | **Available now.** Office journal has 17,911 rows; not directly truck-attributable. |
| 18 | Accounts payable, vouchers, and supplier expenses | `ap_check`, `ap_open_item`, `voucher`, `voucher_dist`, `voucher_hist`, `journal_ap`, `open_item` | **Available now.** Useful for reconciliation and some direct supplier costs; truck links are sparse. |
| 19 | Expense account and category mappings | `gl_account`, `gl_assignment`, `payroll_control`, `arcontrol`, `fuel_expense`, `revenue_code` | **Supported and partly configured.** Provides the accounting vocabulary for classifying expenses. |
| 20 | Accident and damage costs | `motoraccident`, `accident_cost`, claims/damage schemas | **Available now for accidents.** 392 motor-accident rows and 562 accident-cost rows; claim families are empty. |
| 21 | Maintenance/repair/parts/labor/warranty | `vcard`, `vcard_trx_history`, `vcard_trx_total`, `trailer_wash_wo`, `fuelopt_*`, `tmt_*` | **Supported but empty.** The schema can represent repair orders, parts, labor, warranties, and maintenance costs. |
| 22 | Trailer wash and service work | `trailer_wash_wo`, `trailer_wash_wo_hist`, trailer-wash controls | **Supported but empty.** No populated wash work-order expenses. |
| 23 | Insurance and liability context | `tractor`, `trailer`, `drs_payee`, `drs_payroll_hist`, `carrier_qualification_history` | **Partially available.** Coverage/limit/context fields exist; complete premium transactions do not. |
| 24 | Purchase, ownership, loan, and amortization context | `tractor`, `trailer`, `amortized_payments`, `recur_voucher`, `trailer_loan_profile` | **Partially available.** Asset and amortization fields exist, but truck-level payment attribution is incomplete. |
| 25 | Native truck cost facts | `cost_fact`, `cost_summary`, `bi_cost_fact`, `bi_cost_summary` | **Supported but empty.** Schema includes tractor/trailer cost, fuel, pay, toll, other cost, and total miles. |
| 26 | Native cost-per-mile/report fields | `fuelopt_header`, `daily_snap_profile`, `bid_scoreboard_profile` | **Mostly empty/configuration.** Cost-per-mile fields exist, but no populated truck cost fact was found. |
| 27 | Revenue and billing context | `billing_history`, `orders`, `revenue_fact`, revenue views | **Available now/partially empty.** Useful for gross margin and revenue-per-mile, not an expense numerator by itself. |
| 28 | Movement and cost reporting views | `trp_pwu_trl_dri_reg_view`, `trp_pwu_trl_dri_mcu_mcp_view`, `stp_trp_pwu_trl_dri_reg_view`, `rsp_x_rev_view` | **Supported views.** Provide movement assignment, loaded/empty miles, pay, or cost/revenue context; definitions need confirmation. |
| 29 | Office salaries and payroll burden | `off_payroll_hist`, `off_payee`, `journal_office` | **Available now.** 6,337 office payroll rows and 1,695 office payee rows; not directly truck-attributable. |
| 30 | Office rent, supplies, facilities, and office equipment purchases | `journal_office`, `ap_check`, `vendor`, `gl_ledger`, `gl_ledger_hist` | **Accounting entries available now, category identification indirect.** No dedicated office-rent or office-supplies source was identified. |
| 31 | Truck equipment and securement gear | `equipment_issued`, `equipment_type`, `equipment_item`, `vendor`, AP/GL sources | **Partially available.** 21 issued-equipment rows include quantity and issue dates; equipment values are empty. The equipment vocabulary contains 2 strap-related and 6 securement-related descriptions. |

# List 3 — Data McLeod does not provide reliably at the moment

These are not necessarily impossible in McLeod as a product. They are missing, empty, not linked to a truck, or not sufficiently reliable in the inspected database.

| # | Missing or unreliable data | Why it prevents a precise CPM | What we need next |
|---:|---|---|---|
| 1 | Actual paid toll transactions linked to a truck/movement | Route and state tables contain toll calculations, but not a clear paid-toll transaction-to-truck relationship. | Toll provider export, AP invoices, or a McLeod report/view with movement and truck links. |
| 2 | Repair orders and maintenance completion | No populated work-order or repair history exists. | Shop/maintenance system or additional McLeod maintenance module/report. |
| 3 | Parts purchases by truck | Parts/labor schemas are empty. | Parts inventory, shop invoices, or AP detail with equipment links. |
| 4 | Repair labor hours and cost | No populated labor/work-order source. | Internal shop system, vendor invoices, or labor time records. |
| 5 | Tire purchases and tire service | No populated tire transaction source. | Tire vendor, tire-management system, or AP detail. |
| 6 | Warranty credits and recoveries | Repair cost cannot be netted accurately without warranty recoveries. | Shop/vendor warranty records. |
| 7 | Preventive-maintenance schedule completion and downtime | McLeod has PM-related schemas/configuration, but no populated PM work history. | Maintenance system and dispatch downtime records. |
| 8 | Complete insurance premium history by truck | McLeod has coverage/limit fields, not complete premium expense transactions. | Insurance broker, policy schedule, invoices, and allocation basis. |
| 9 | Depreciation by truck | No populated fixed-asset/depreciation schedule was found. | Fixed-asset accounting system. |
| 10 | Truck loan principal and interest by truck | Amortized payments exist without a reliable truck/equipment key. | Lender statements and asset-to-loan mapping. |
| 11 | Trailer loan or lease payments by trailer | Trailer loan profile is empty and payment records are not reliably equipment-linked. | Lease/finance system and trailer mapping. |
| 12 | Truck lease payments by truck | Lease/owner fields exist, but no complete truck-linked lease transaction history exists. | Lease contracts, invoices, and equipment mapping. |
| 13 | Permits, registration, plates, and operating-authority expense history | Asset expiration fields exist, but not a complete expense ledger. | Permit provider, compliance system, registration records, or AP. |
| 14 | Office and terminal cost allocation to trucks | Office journals and GL are populated but have no automatic truck allocation. | Finance-approved allocation method and cost-center data. |
| 15 | Shop and facility overhead allocation | Facility costs are not reliably linked to trucks. | Facilities/accounting data and approved allocation basis. |
| 16 | Payroll-to-truck assignment for every pay period | Payroll is mainly organized by driver/payee, while drivers can change trucks. | Payroll plus time-valid ELD/dispatch assignments. |
| 17 | Complete time-valid truck assignment history | Equipment and movement relationships exist, but historical assignment rules need confirmation. | McLeod data dictionary, movement history, ELD, or asset assignment history. |
| 18 | Fully populated native cost facts | McLeod cost fact and cost summary tables are empty. | McLeod report/module configuration or external harness reconstruction. |
| 19 | Fully configured expense accrual mappings | Expense accrual fields exist but were not populated for the inspected company controls. | McLeod accounting configuration review. |
| 20 | Reliable distinction between transaction, payment, payroll, check, and GL layers | Multiple tables may represent the same expense at different lifecycle stages. | McLeod data dictionary and finance reconciliation rules. |
| 21 | Complete parking, scale, ferry, border, roadside, and replacement-rental transactions | No complete truck-linked source was identified for all of these categories. | Vendor/AP/dispatch/rental data. |
| 22 | Approved treatment for reimbursements, credits, advances, and deductions | The data exists in several places, but business treatment is not defined by the database. | Finance policy and reconciliation rules. |
| 23 | Office rent and office-supplies category identification | Office journal, AP, vendor, and GL entries exist, but the inspected database has no dedicated office-rent or office-supplies transaction category. | GL account mapping, vendor classification, or accounting export with expense categories. |
| 24 | Office salary allocation to the fleet | Office payroll is populated by payee/pay period, not by truck or fleet activity. | Department/cost-center mapping and an approved allocation rule. |
| 25 | Purchase cost of straps, chains, tarps, load bars, dunnage, and truck tools | Issued-equipment records contain quantities and issue dates, but equipment values are empty; AP/GL purchases are not linked to issued equipment. | Equipment purchasing/inventory system or AP invoices linked to equipment type and truck. |
| 26 | Equipment consumption, replacement, loss, and repair history | The database identifies equipment types and some issued items but does not provide a complete lifecycle cost history for securement gear. | Equipment inventory/asset system and replacement records. |

## Required final result

The outside harness should produce, for every truck and reporting period:

- Direct operating expenses by category
- Fully burdened expenses by category
- Total operating miles
- Loaded and empty miles
- Direct operating CPM
- Fully burdened CPM
- Direct versus allocated expenses
- Unattributed expenses
- Missing-category warnings
- Data coverage percentage
- Mileage confidence
- Source freshness

The harness must never report a truck as having zero maintenance, zero tolls, zero insurance, or zero depreciation merely because McLeod does not currently contain those records. It must report the category as **missing**, **unallocated**, or **not applicable**.
