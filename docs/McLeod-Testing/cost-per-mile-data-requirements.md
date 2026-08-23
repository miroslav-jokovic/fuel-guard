# Cost per Mile Data Requirements

## Business purpose

This document defines all data that can be obtained from the McLeod database for calculating the cost of operating each truck, what is currently available, what McLeod supports but does not currently contain, and what must come from other systems.

The calculation harness will run **outside McLeod**. McLeod should be treated as a source of operational and accounting information, not as the place where the final cost-per-mile calculation is performed.

The goal is a number precise enough for:

- Fleet profitability decisions
- Truck replacement and utilization decisions
- Driver and owner-operator cost comparisons
- Fuel and maintenance analysis
- Route and customer profitability
- Budgeting and pricing
- Identifying trucks whose costs are outside expected ranges

This is a business document. Technical table names are included only in the appendix so the finance, operations, IT, and integration teams can use the same data vocabulary.

## Important conclusion

McLeod can provide a strong foundation for **direct operating cost per mile**, especially:

- Fuel
- Driver/carrier settlement pay
- Truck and trailer assignment
- Loaded and empty miles
- Fuel-tax mileage
- Movement-linked charges
- Accident costs
- Some payment and accounting information

McLeod does **not** currently provide everything needed for a complete fully burdened truck cost. The database has empty or incomplete areas for:

- Repair orders
- Parts
- Labor
- Tires
- Preventive maintenance work
- Paid toll transactions linked to trucks
- Insurance premiums
- Depreciation
- Truck financing and lease payments linked to individual trucks
- Permits and registration
- A reliable allocation of office and terminal overhead

Missing data must be shown as **missing** or **unallocated**. It must never be silently treated as zero cost.

## 1. The two numbers we should produce

A single cost-per-mile number can be misleading. The harness should produce two primary measures.

### 1.1 Direct operating cost per mile

This measures the cost directly associated with operating a truck:

- Fuel and fuel-related fees
- Driver/carrier settlement pay
- Tolls and road charges, when attributable
- Direct movement and accessorial costs
- Accident costs
- Maintenance and repairs, once a source is connected
- Direct operating taxes

**Formula:**

```text
Direct operating cost per mile
= direct operating expenses / total operating miles
```

### 1.2 Fully burdened cost per mile

This adds costs that support the truck but are not always recorded against a specific movement:

- Insurance
- Depreciation
- Financing interest
- Lease or ownership payments
- Permits and registration
- Terminal/shop expenses
- Office and administrative overhead
- Other approved company allocations

**Formula:**

```text
Fully burdened cost per mile
= direct operating expenses
  + approved allocated expenses
  --------------------------------
  total operating miles
```

The report must show both numbers separately. A company should not compare a fully burdened number from one truck with a direct-only number from another.

## 2. What McLeod can provide now

### 2.1 Truck and trailer identity

McLeod contains:

- 660 tractor records
- 459 trailer records
- Tractor and trailer IDs
- Driver assignments
- Equipment groups and equipment items
- Current and historical movement relationships
- Tractor and trailer status
- In-service and out-of-service dates
- Inspection dates
- Trailer odometer fields
- Some tractor ownership and insurance fields

This is the foundation for answering **which truck incurred the expense**.

The safest assignment order is:

1. Use the truck ID on the expense record when available.
2. Otherwise use the movement or order connected to the expense.
3. Resolve the movement to the equipment group and equipment item.
4. Resolve the equipment item to the tractor.
5. Use driver-to-truck assignment only when the business rule confirms that the driver was operating one truck during that period.
6. Mark the expense as allocated or unattributed when the relationship is uncertain.

Truck assignments must be time-aware. A current driver or equipment assignment must not automatically be used for an expense from a previous month.

### 2.2 Fuel

Fuel is the strongest currently available direct expense category.

McLeod can provide:

- Fuel transaction amount
- Fuel volume
- Price per gallon
- Tractor fuel cost
- Fuel discounts
- Taxes
- Card and transaction fees
- Funded/direct/draft amounts
- Fuel type
- Oil cost and quantity
- Reefer cost
- Miscellaneous fuel-related cost
- Fuel card ID
- Truck stop
- Tractor and trailer IDs
- Driver ID
- Movement and order IDs
- Transaction and posting dates

Current database coverage includes:

- 65,847 historical fuel-detail rows
- 78,213 historical fuel-ticket rows
- 416,121 fuel-tax history rows
- Historical fuel data through August 2026

**Business status: Available now, subject to reconciliation.**

McLeod has several fuel layers: transaction detail, fuel tickets, totals, card payments, and wire/payment records. These may represent the same purchase at different stages. The harness must choose one primary fuel transaction source and use the others for reconciliation, not add them together.

### 2.3 Driver and carrier pay

McLeod can provide driver/carrier compensation information including:

- Total settlement pay
- Order pay
- Linehaul pay
- Per-diem pay
- Preload charges
- Pay rate
- Pay distance
- Trailer rent component
- Payment status and payment dates
- Driver and payee
- Tractor and trailer
- Movement and order

Current database coverage includes:

- 260,077 historical settlement rows
- 244,379 historical settlement rows with a truck ID
- 242,756 historical settlement rows with a trailer ID
- 260,069 historical settlement rows with pay distance
- 1,004 current settlement rows
- 573 current settlement rows with a truck ID
- 565 current settlement rows with a trailer ID

**Business status: Available now and highly useful for direct truck cost.**

Driver payroll history is also available, but it is primarily organized by driver/payee and pay period. It should not be added on top of settlement pay unless finance confirms that the two represent separate expenses.

### 2.4 Trailer rent and equipment-related pay

McLeod supports trailer-related payment information through settlement records:

- Trailer ID
- Trailer rent percentage
- Trailer rent amount in payroll/settlement structures
- Pay distance
- Total settlement pay

The accounting configuration also contains trailer-rent account mapping for most company control rows.

**Business status: Trailer rent is supported and partially populated.**

This is different from a truck loan, trailer loan, depreciation, or lease payment. Those ownership costs are not fully available at truck level in the current database.

### 2.5 Miles and utilization

McLeod can provide several types of miles:

- Odometer movement history
- Loaded miles
- Empty/deadhead miles
- Total movement miles
- Fuel-tax miles
- Toll miles
- Pay miles
- Billing miles
- Movement distance
- Order distance
- Tractor MPG history

The strongest mileage sources are:

- Odometer history through McLeod position data
- Loaded and empty distance in fuel-tax history
- Movement loaded/empty distance
- Settlement pay distance
- Billing loaded/empty distance
- Movement reporting views

**Business status: Available, but the company must choose one official denominator.**

Recommended policy:

- Use actual odometer miles where reliable.
- Otherwise use loaded plus empty operating miles.
- Use pay miles only for a pay-per-mile measure.
- Use billing miles only for a billable-mile measure.
- Always report loaded, empty, and total miles separately.

### 2.6 Other movement and accessorial expenses

McLeod can provide movement/order-level charges such as:

- Other charges
- Accessorial charges
- Extra-stop amounts
- Fuel surcharge-related amounts
- Detention-related amounts
- Estimated tolls
- Trailer rent
- Drayage pay or charges
- Loaded and empty distance units
- Taxability and charge codes

These expenses generally do not contain a truck ID directly. They can often be assigned through the order and movement to the truck that performed the work.

**Business status: Available now, but requires movement allocation and careful de-duplication.**

### 2.7 Accidents and exceptional costs

McLeod contains:

- Motor accident records
- Total accident cost
- Tractor and trailer involved
- Driver and order references
- Accident-related cost records

**Business status: Available for exceptional-cost reporting.**

Accident cost should normally be displayed separately from recurring operating cost. Management can decide whether to include it in fully burdened CPM.

### 2.8 General accounting and office expenses

McLeod can provide office and company accounting information through:

- Office journal entries
- General ledger entries
- Accounts payable and vouchers
- Expense account mappings
- Company-level accrual settings
- Payee/vendor accounting

The current database contains:

- 17,911 office-journal rows
- 732,530 current/general ledger rows
- 1,767,734 historical ledger rows
- 237 populated GL assignment rows

**Business status: Available as accounting data, but not automatically truck-attributable.**

Office costs can be included in fully burdened CPM only after the company decides how to allocate them. Possible allocation bases include:

- Miles
- Number of trucks
- Truck-days active
- Revenue
- Direct operating cost
- Terminal or fleet ownership

The chosen allocation rule must be visible in the report.

### 2.9 Expense categories configured in McLeod

McLeod has accounting configuration for several expense categories, including:

- Office cash/accounting activity
- Driver expenses
- Lease-operator expenses
- Trailer rent
- Wire/payment expenses
- Fuel cash
- Repair GL mapping
- Tire GL mapping
- Oil GL mapping
- Tractor fuel GL mapping
- Reefer fuel GL mapping

The configuration exists, but not every company control row is fully configured. Expense accrual mappings for company, owner, carrier, and agent expenses were present in the schema but not populated in the inspected rows.

**Business status: Supported by McLeod, partially configured in this snapshot.**

## 3. What McLeod supports but is currently empty

These are important because the database structure shows that McLeod was designed to handle them, even though this snapshot has no records.

### 3.1 Native cost calculation data

McLeod has native cost structures that can hold:

- Tractor ID
- Trailer IDs
- Fuel cost
- Driver pay
- Tractor cost
- Trailer cost
- Other cost
- Other pay
- Toll cost
- Total miles
- Loaded and order miles

The native cost fact and cost summary records are currently empty.

**Meaning:** McLeod has a place for these values, but we cannot treat the missing rows as zero cost.

### 3.2 Repairs and maintenance

The database has schemas for:

- Repair orders
- Parts
- Labor
- Maintenance groups
- Warranties
- Virtual-card maintenance purchases
- Trailer-wash work orders
- Fuel optimization maintenance costs
- Preventive-maintenance controls

These areas currently contain no populated repair/work-order transactions.

**Outside source likely required:** shop system, maintenance provider, tire provider, repair invoices, or a separate McLeod module/report.

### 3.3 Tolls

McLeod supports toll calculations and has fields for toll cost, but there is no clearly populated paid-toll transaction source connected directly to trucks.

**Outside source or McLeod confirmation required:**

- Toll transponder provider
- E-ZPass/PrePass/Bestpass records
- AP invoices from toll vendors
- McLeod report that connects calculated tolls to movements

### 3.4 Ownership, financing, and depreciation

McLeod has some asset information:

- Purchase date
- Owner/pay-owner
- Insurance fields
- Trailer value and loan-related fields
- Amortized payment records

However, the amortized payments are not reliably tied to individual tractors, and no populated depreciation schedule was found.

**Outside source likely required:**

- Fixed-asset register
- Truck loan statements
- Lease schedules
- Depreciation schedule
- Equipment finance system

### 3.5 Insurance premiums

McLeod has insurance-related asset, payee, and qualification fields. Those fields describe coverage and limits, not a complete premium expense history by truck.

**Outside source likely required:**

- Insurance invoices
- Policy schedule
- Premium allocation by tractor/trailer
- Claims and deductible records

### 3.6 Permits and registration

Truck and trailer records contain some licensing, tag, DOT, and expiration information, but no complete populated expense history for:

- Registration
- Permits
- IFTA filing cost
- Plates
- Federal/state fees
- Operating authority

**Outside source likely required:** permit provider, registration records, accounting/AP, or fleet compliance system.

## 4. Data we do not currently have and must source elsewhere

The following items are required for the most precise possible fully burdened CPM but are missing, incomplete, or not truck-attributable in the current database.

| Missing or incomplete data | Why it matters | Likely outside source |
|---|---|---|
| Repair orders | Direct maintenance expense and downtime | Shop/maintenance system |
| Parts purchases | Parts cost by truck | Parts inventory, shop, or AP |
| Labor hours and labor cost | Internal or external repair labor | Shop/work-order system |
| Tire purchases and tire service | Major fleet cost category | Tire vendor or maintenance system |
| Preventive-maintenance completion | Distinguishes scheduled work from breakdowns | Maintenance/PM system |
| Warranty credits | Prevents overstating repair cost | Shop/vendor warranty records |
| Paid toll transactions | Actual toll expense, not estimates | Toll provider/AP |
| Insurance premiums | Fully burdened operating cost | Insurance broker/accounting |
| Truck depreciation | Ownership cost per truck | Fixed-asset accounting |
| Truck loan principal/interest | Financing cost | Lender/finance system |
| Trailer loan or lease payments | Trailer ownership cost | Lender/lease system |
| Truck lease payments | Cost of leased equipment | Lease contracts/accounting |
| Registration and permits | Required operating cost | Compliance/permit provider |
| Office expenses allocation | Fully burdened fleet cost | Accounting plus approved allocation rule |
| Terminal/shop overhead | Location-level overhead allocation | Accounting/facilities |
| Driver payroll-to-truck assignment | Payroll history is mostly payee-based | Payroll plus ELD/dispatch assignment |
| Company/owner/carrier accruals | Accrual mappings are not populated | McLeod configuration/accounting |
| Complete odometer history | Most reliable denominator | ELD/telematics backup |
| Truck assignment history | Needed when trucks change drivers/equipment groups | Dispatch/ELD/asset history |
| Reimbursements and credits | Prevents overstating expenses | AP, payroll, fuel-card, vendor records |
| Cash advances and settlements | Must be separated from actual operating cost | Payroll/settlement policy |
| Shop downtime cost | Cost of unavailable truck | Dispatch/utilization system |
| Replacement rental truck cost | Cost during maintenance downtime | Rental vendor/accounting |

## 5. Precision rules for the outside calculation harness

### 5.1 Every expense needs an owner

Every expense must be assigned to one of these states:

- Directly assigned to a tractor
- Assigned through a movement/order
- Assigned through a time-valid driver assignment
- Allocated by company policy
- Unattributed
- Excluded as revenue, reimbursement, duplicate, or reconciliation-only data

The report must show the amount in each state.

### 5.2 Every expense needs two dates

Store both:

- The date the cost happened
- The date it was posted, paid, or recognized in accounting

This prevents a January repair paid in February from appearing inconsistently between operational and financial reports.

### 5.3 Every expense needs a source and lifecycle status

The harness should retain:

- Source system
- Source record identifier
- Expense category
- Original amount and currency
- Posting/accounting amount and currency
- Transaction date
- Posting date
- Void/reversal status
- Truck assignment method
- Allocation rule
- Confidence level

### 5.4 Do not count lifecycle layers twice

The following are potential duplicate representations and must be reconciled:

- Fuel detail and fuel tickets
- Fuel transactions and fuel-card/wire payments
- Settlement records and payroll records
- Settlement records and checks
- Settlement records and GL journals
- Other charges and billing totals
- Estimated costs and posted costs
- Current and historical copies of the same transaction

### 5.5 Use one official mile definition

For the official operating CPM, the recommended order is:

1. Actual odometer miles
2. Loaded plus empty operating miles
3. Approved movement-distance fallback

Pay miles and billing miles should be separate measures, not silently substituted for operating miles.

### 5.6 Never convert missing data to zero

Each truck/month should show:

- Computable CPM
- Coverage percentage
- Direct expense amount
- Allocated expense amount
- Unattributed expense amount
- Missing-category indicator
- Mileage confidence

If repair data is absent, the report should say **maintenance cost not available**, not show maintenance cost as `$0`.

## 6. Recommended report outputs

For every tractor and reporting period, produce:

### Operating cost report

- Fuel cost
- Driver/carrier settlement cost
- Toll cost
- Other operating charges
- Accident cost
- Maintenance cost, when available
- Total direct operating cost
- Total operating miles
- Direct operating CPM

### Fully burdened report

- Direct operating cost
- Insurance allocation
- Depreciation
- Financing/lease cost
- Permits and registration
- Office allocation
- Terminal/shop allocation
- Other approved overhead
- Total fully burdened cost
- Fully burdened CPM

### Supporting measures

- Loaded miles
- Empty/deadhead miles
- Total miles
- Empty-mile percentage
- Fuel gallons
- Fuel cost per gallon
- Fuel cost per mile
- Driver pay per mile
- Toll cost per mile
- Maintenance cost per mile
- Cost by customer/movement, where appropriate
- Direct versus allocated cost
- Unattributed cost
- Data freshness
- Data completeness

## 7. Decisions required before calculation begins

The company should decide:

1. Is the official CPM based on odometer miles or operating movement miles?
2. Are driver settlements included in operating CPM?
3. Are trailer rents included in truck CPM or reported separately?
4. Are accidents included in recurring CPM or shown separately?
5. Is office overhead allocated to trucks?
6. If yes, what allocation basis is approved?
7. Are depreciation and financing included?
8. Are insurance premiums included?
9. Are tolls based on actual paid tolls or McLeod estimates until an outside source is connected?
10. How are team drivers and shared trucks handled?
11. How are leased trucks and owner-operators handled?
12. How are reimbursements, fuel discounts, credits, and advances treated?
13. What level of missing-data coverage is required before a CPM is considered reliable?

## 8. Recommended order for obtaining additional sources

### First priority: complete direct operating CPM

Use McLeod plus:

- Fuel transaction reconciliation
- Settlement pay
- Canonical miles
- Movement-to-truck assignment
- Actual toll provider data if available

### Second priority: maintenance and repair

Obtain:

- Work orders
- Parts
- Labor
- Tires
- Warranty credits
- Shop invoices
- Downtime

### Third priority: fully burdened ownership cost

Obtain:

- Insurance premiums
- Fixed assets and depreciation
- Truck loans
- Trailer loans
- Lease payments
- Registration and permits

### Fourth priority: overhead allocation

Obtain:

- Office expenses
- Terminal expenses
- Shop expenses
- Dispatch/operations overhead
- Approved allocation policy

## 9. Technical source appendix

This appendix connects the business data categories to the McLeod database structures identified during inspection. It is included for IT and integration teams; the main calculation decisions should remain business-owned.

| Business data | McLeod source structures |
|---|---|
| Tractor/trailer identity | `tractor`, `trailer`, `equipment_group`, `equipment_item`, `equipment_type` |
| Fuel transactions | `fuel_detail_hist`, `fuel_ticket_hist`, `fuel_total`, `fuel_card` |
| Fuel tax and miles | `fuel_tax_history`, `fuel_tax_rate` |
| Fuel payments and fees | `fuel_wire_history`, `fuel_wire_open`, `fuel_wire_total`, `posted_wire` |
| Driver/carrier pay | `drs_settle_hist`, `settlement`, `driver_extra_pay`, `journal_driver`, `drs_check` |
| Payroll and deductions | `drs_payroll_hist`, `drs_timecard`, `drs_deduct_hist`, `drs_pending_deduct`, `drs_recur_deduct` |
| Trailer rent and ownership pay | `settlement`, `drs_settle_hist`, `amortized_payments`, `trailer_loan_profile` |
| Other charges | `other_charge`, `other_charge_hist`, `other_charge_edi`, `prorated_move`, `prorated_moveorder` |
| Accidents | `motoraccident`, `accident_cost` |
| Office/accounting | `journal_office`, `gl_ledger`, `gl_ledger_hist`, `gl_account`, `gl_assignment`, `ap_check`, `voucher_dist` |
| Expense/account mapping | `payroll_control`, `arcontrol`, `fuel_expense`, `fuel_tax_rate`, `revenue_code` |
| Insurance and compliance context | `tractor`, `trailer`, `drs_payee`, `carrier_qualification_history` |
| Toll calculations | `route`, `in_state_distance`, `movement`, `orders` |
| Native cost model | `cost_fact`, `cost_summary`, `bi_cost_fact`, `bi_cost_summary`, `revenue_fact`, `fuelopt_header` |
| Mileage | `mc_position`, `fuel_tax_history`, `movement`, `billing_history`, `settlement`, `tractor_mpg` |
| Movement assignment | `movement`, `equipment_group`, `equipment_item`, `equipment_type` |
| Movement assignment views | `trp_pwu_trl_dri_reg_view`, `trp_pwu_trl_dri_mcu_mcp_view`, `stp_trp_pwu_trl_dri_reg_view` |
| Maintenance schemas | `vcard_trx_history`, `vcard_trx_total`, `trailer_wash_wo`, `fuelopt_*`, `tmt_*` |

## Final position

McLeod can provide enough information to begin a reliable direct operating CPM harness, especially for fuel, settlement pay, miles, truck assignment, movement-linked charges, and accident costs.

It cannot provide a fully complete and precise fully burdened CPM from this database alone. The missing categories must be obtained from maintenance, toll, insurance, fixed-asset, finance, compliance, payroll, and accounting sources outside McLeod or from additional McLeod modules/reports that the carrier confirms are licensed and available.

The final system should make data completeness visible. A truck with missing maintenance, insurance, depreciation, or toll data must receive a qualified result—not an artificially low cost-per-mile number.
