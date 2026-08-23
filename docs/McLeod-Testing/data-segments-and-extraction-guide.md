# McLeod data segments and extraction guide

**Database:** `lme_analytics`  
**Inspected:** 2026-08-21  
**Purpose:** explain the database segments that are useful for reading and pulling data safely, including both accounting/GL segments and business data domains.  
**Access posture:** metadata and read-only analysis only; no business values or database writes were performed.

## What “segments” means here

There are two useful meanings of segments in this database:

1. **Accounting segments:** the parts of a GL account and allocation rule that identify company, account, department, tractor, payee, movement, terminal, or other accounting dimensions.
2. **Business data segments:** logical groups of tables that should be extracted together, such as fleet, movements, fuel, settlements, accounting, maintenance, and EDI.

Both are important. Business segments tell us **what data to pull**. GL segments tell us **how accounting data is classified and allocated**.

# 1. Accounting and GL segments

## 1.1 Company segment — tenant boundary

| Item | Source | Observed state | Use |
|---|---|---:|---|
| Company/tenant ID | `company.company_id` and `company.id` | 4 company records | Required on every extraction and every join. |
| Company currency | `company.currency` | Supported | Determines the accounting currency context. |
| Company distance unit | `company.distance_um` | Supported | Helps normalize miles/kilometers. |
| Company weight/temperature units | `company.weight_um`, `company.temperature_um` | Supported | Useful for operational normalization. |
| Company fiscal/accounting context | `gl_control`, `arcontrol`, `payroll_control` | Company-scoped controls populated | Determines posting, accrual, payroll, and GL behavior. |

**Rule:** treat IDs as `company_id + record_id`, not as globally unique IDs. A query without `company_id` can mix tenants or company partitions.

## 1.2 GL account segment

| Item | Source | Rows | Use |
|---|---|---:|---|
| GL account master | `gl_account` | 551 | Account description, active status, posting type, transfer behavior, escrow/interest flags, tire-cost and driver-debt flags. |
| GL assignment master | `gl_assignment` | 237 | Expense/income account assignments, power expense account, sales expense account, allocation code, pay code, revenue-calculation priority. |
| GL category | `gl_category` | 48 | Higher-level account categories and balance behavior. |
| GL type | `gl_type` | 43 | Account/type grouping and starting-account information. |
| GL account mappings | `gl_account_glmap`, `gl_account_vmmap`, `gl_mapping` | Empty schemas | Supported mapping structures, not populated in this snapshot. |

Use this segment to translate an accounting posting into a business category such as fuel, driver pay, office, rent, repairs, toll, or overhead. Do not infer category only from a free-text description when a configured GL mapping exists.

## 1.3 GL structure segment — how account codes are composed

| Item | Source | Rows | Use |
|---|---|---:|---|
| Segment layout | `gl_control` | 4 | Number of segments, main segment, currency segment, segment descriptions, segment lengths, delimiter, fiscal period/year. |
| Segment layout mapping | `gl_control_mapping` | 4 | Alternate/shared GL segment layout and descriptions. |
| Segment vocabulary | `gl_segment_code` | 4 | Segment number, code, description, and short name. |
| Segment allocation codes | `seg_alloc_code` | 6 | Active allocation codes and up to five GL segment-code components. |
| Segment allocation rules | `seg_alloc_control` | 4 | Driver, movement, office, payee, tractor, dedicated, trailer-wash, management, terminal, and via-terminal segment positions. |

The important `seg_alloc_control` dimensions are:

- Driver segment
- Movement segment
- Office segment
- Payee segment
- Tractor segment
- Dedicated segment
- Trailer-wash segment
- Management/brokerage segment
- LTL terminal segment
- Via-terminal rate/basis
- Revenue method
- Settlement method
- Allocation basis and active status

These controls are the best starting point for determining whether office, tractor, payee, movement, or terminal costs can be separated without inventing an allocation rule.

## 1.4 Ledger posting segment

| Item | Source | Rows | Use |
|---|---|---:|---|
| Current GL postings | `gl_ledger` | 732,530 | Amount, GL ID, source, posting/transaction dates, batch, payee, tractor, trailer, order, terminal, correction, and summarized status. |
| Historical GL postings | `gl_ledger_hist` | 1,767,734 | Historical version of the ledger posting segment. |
| GL summaries | `gl_summary` | 95,905 | Account/date-level summaries. |
| GL subledger audit | `gl_sub_audit` | 30 | Invoice, journal, voucher, check, payee, and GL audit references. |

Important posting fields:

- `company_id`
- `glid`
- `amount` and currency companion fields
- `transaction_date`
- `post_date`
- `post_module`
- `source`
- `post_key`
- `batch_code`, `batch_number`, and `batch_seq`
- `tractor`
- `trailer`
- `order_id`
- `via_terminal_id`
- `payee_id`
- correction/void/summarization indicators

Direct tractor fields in the GL are sparse, but order links are much stronger. For truck reporting, use the order/movement-to-equipment path whenever the direct GL tractor field is empty.

## 1.5 Source journal segments

| Journal segment | Source | Rows | Primary meaning |
|---|---|---:|---|
| Driver/payee | `journal_driver` | 1,005,594 | Driver and payee postings. |
| Sales/revenue | `journal_sales` | 152,339 | Revenue and invoice postings. |
| Cash | `journal_cash` | 118,122 | Cash/check/invoice postings. |
| AP | `journal_ap` | 71,743 | Supplier/AP postings. |
| Office | `journal_office` | 17,911 | Office/accounting postings. |
| Recurring | `rec_journal_hdr`, `rec_journal_dtl` | 32 / 73 | Recurring journal setup and lines. |

These journals are accounting lifecycle segments. They should reconcile to the GL, not be added to the GL as additional expenses.

# 2. Business data segments for extraction

## 2.1 Company and identity segment

**Purpose:** establish tenant, units, currency, and source ownership.

**Primary sources:** `company`, company-scoped control tables, `company_id` fields throughout the database.

**Pull first:**

- Company ID
- Currency
- Distance unit
- Weight/temperature units
- Fiscal period/year
- Active/company status where available

**Extraction rule:** every downstream record must retain `company_id`.

## 2.2 Fleet and equipment segment

**Purpose:** identify tractors, trailers, equipment types, owners, statuses, and assignment history.

**Primary sources:**

- `tractor`
- `trailer`
- `equipment_group`
- `equipment_item`
- `equipment_type`
- `equipment_type_match`
- `equipment_issued`
- `equipment_pool_positioning`
- `equipment_pool_rule`

**Useful information:**

- Tractor/trailer IDs
- Equipment type
- Owner/pay-owner
- In/out-of-service dates
- Inspection/service status
- Current equipment group
- Driver assignments
- Odometer where available
- Issued equipment, quantities, issue/return dates, and parent asset/location
- Securement/equipment vocabulary

**Join path:**

```text
company
  -> tractor / trailer
  -> equipment_group
  -> equipment_item
  -> movement
```

`equipment_issued` has 21 rows with quantity and issue dates, but equipment values are empty. It can identify issued equipment, not complete equipment purchase cost.

## 2.3 Driver and payee segment

**Purpose:** connect driver work, settlement, payroll, deductions, and payee costs.

**Primary sources:**

- `driver`
- `payee`
- `drs_payee`
- `off_payee`
- `users`
- `drs_settle_hist`
- `settlement`
- `drs_payroll_hist`
- `drs_deduct_hist`
- `drs_pending_deduct`
- `drs_recur_deduct`
- `driver_extra_pay`
- `drs_check`
- `off_payroll_hist`

**Useful information:**

- Driver/payee identity key
- Driver type and payee type
- Tractor/trailer assignment
- Settlement pay and pay distance
- Per diem, preload, fuel pay, trailer rent, and extra pay
- Payroll gross/net pay, employer taxes, benefits, and workers compensation
- Deductions, advances, reimbursements, and payment status

**Caution:** payroll/payee data is generally pay-period based, while settlement data may be movement/truck based. Reconcile them before using both in the same expense total.

## 2.4 Movement, order, and stop segment

**Purpose:** provide the operational event that connects expenses to work performed.

**Primary sources:**

- `movement`
- `movement_order`
- `orders`
- `stop`
- `billing_history`
- `prorated_move`
- `prorated_moveorder`
- `prorated_orderdist`
- `other_charge`
- `other_charge_hist`
- `servicefail`

**Useful information:**

- Movement/order/stop IDs
- Tractor/trailer/driver/equipment group
- Origin/destination and stop sequence
- Loaded/empty/pay/billing distance
- Estimated tolls and other charges
- Pay, accessorial, revenue, and billing context
- Service failures and operational exceptions

**Join path:**

```text
expense
  -> order_id or movement_id
  -> movement_order
  -> movement
  -> equipment_group / equipment_item
  -> tractor / trailer
```

## 2.5 Mileage and telematics segment

**Purpose:** create the denominator for cost per mile and measure utilization.

**Primary sources:**

- `mc_position`
- `mc_performx`
- `fuel_tax_history`
- `movement`
- `billing_history`
- `settlement`
- `drs_settle_hist`
- `prorated_moveorder`
- `tractor_mpg`
- `trip_detail`
- `trip_detail_hist`
- `trp_pwu_trl_dri_reg_view`
- `trp_pwu_trl_dri_mcu_mcp_view`

**Useful information:**

- Odometer readings and timestamps
- Loaded miles
- Empty/deadhead miles
- Total movement/trip miles
- Fuel-tax miles
- Toll miles
- Pay miles
- Billing miles
- MPG history
- Driver/truck/movement context

**Recommended priority:** odometer miles, then loaded plus empty operating miles, then an approved movement-distance fallback.

## 2.6 Fuel and energy segment

**Purpose:** pull fuel expense, volume, taxes, discounts, fees, and fuel-related cost components.

**Primary sources:**

- `fuel_detail`
- `fuel_detail_hist`
- `fuel_ticket`
- `fuel_ticket_hist`
- `fuel_total`
- `fuel_prod_total`
- `fuel_products`
- `fuel_products_hist`
- `fuel_card`
- `fuel_wire_history`
- `fuel_wire_open`
- `fuel_wire_total`
- `fuel_tax_history`
- `fuel_tax_rate`
- `fuel_expense`
- `fuel_price`
- `fuel_price_monthly`

**Useful information:**

- Tractor fuel cost
- Reefer fuel cost
- Oil/DEF/fluids
- Gallons and price
- Fuel taxes
- Discounts
- Card and transaction fees
- Fuel type/product
- Truck stop/vendor
- Tractor/trailer/driver/movement/order

**Caution:** detail, ticket, total, wire, and payment tables may be lifecycle versions of the same purchase.

## 2.7 Settlement and payment segment

**Purpose:** capture actual pay, payment status, checks, wires, vouchers, and reconciliation records.

**Primary sources:**

- `drs_settle_hist`
- `settlement`
- `posted_wire`
- `fuel_wire_history`
- `fuel_wire_open`
- `drs_check`
- `ap_check`
- `voucher`
- `voucher_dist`
- `voucher_hist`
- `recur_voucher`
- `recur_voucher_dist`
- `amortized_payments`

**Useful information:**

- Total pay and payment dates
- Payee/driver/tractor/trailer
- Trailer rent
- Payment status
- Check/wire/voucher IDs
- Principal/interest/amortization where available
- GL/AP reconciliation references

**Caution:** payment records are not automatically additional expenses. Use one expense recognition layer and use payment layers to prove settlement.

## 2.8 General accounting and office segment

**Purpose:** read office, company, AP, GL, overhead, accrual, and vendor costs.

**Primary sources:**

- `journal_office`
- `gl_ledger`
- `gl_ledger_hist`
- `gl_summary`
- `gl_account`
- `gl_assignment`
- `journal_ap`
- `ap_check`
- `ap_open_item`
- `vendor`
- `open_item`
- `payroll_control`
- `arcontrol`
- `seg_alloc_control`

**Useful information:**

- GL account and category
- Office salaries and payroll burden
- Office rent, supplies, facilities, and equipment purchases when classified by GL/vendor
- Vendor/AP invoices and payments
- Expense accruals
- Company/office/tractor/payee/movement allocation segments
- Posting date versus transaction date

**Important limitation:** office journal and AP records do not automatically identify the trucks that benefited from the expense. A finance-approved allocation rule is required.

## 2.9 Revenue and billing segment

**Purpose:** provide revenue, billing, customer, and gross-margin context. This is not automatically expense data.

**Primary sources:**

- `orders`
- `billing_history`
- `billing_freight_group`
- `revenue_code`
- `revenue_calculation`
- `revenue_fact`
- `revenue_detail` and revenue views
- `revenue_split`
- `fgp_financial_amalgum_view`
- `rsp_x_rev_view`

**Useful information:**

- Revenue and charges
- Billable distance
- Customer/order/movement
- Revenue code
- Total cost fields where a view provides them
- Paid/planned revenue

**Rule:** use this segment for revenue per mile and gross margin; do not add revenue to the expense numerator.

## 2.10 Maintenance, safety, and accident segment

**Purpose:** identify maintenance-related costs, inspections, accidents, damage, downtime, and compliance impacts.

**Primary sources:**

- `inspection`
- `inspect_vehicle`
- `inspect_violation`
- `servicefail`
- `motoraccident`
- `accident_cost`
- `carrier_qualification_history`
- `vcard`
- `vcard_trx_history`
- `vcard_trx_total`
- `trailer_wash_wo`
- `fuelopt_*`
- `tmt_*`

**Useful information:**

- Inspection/out-of-service status
- Vehicle violations
- Service failures
- Accident total cost
- Vehicle-maintenance qualification measures
- Repair order, parts, labor, warranty, wash, and PM structures

**Current state:** inspection and accident data are populated; dedicated repair/maintenance cost structures are mostly empty.

## 2.11 Tax and compliance segment

**Purpose:** separate operating taxes, payroll burden, fuel tax, statutory filings, permits, and compliance data.

**Primary sources:**

- `fuel_tax_history`
- `fuel_tax_rate`
- `fuel_tax_control`
- `tax_data`
- `drs_payroll_hist`
- `off_payroll_hist`
- `fedtaxtable`
- `statetaxtable`
- `excisetax_*`
- `drsw2_data`
- `drs1099_data`
- `inspection`
- `carrier_qualification_history`
- `tractor`/`trailer` license and expiration fields

**Caution:** tax tables can describe withholding or tax calculation rules rather than a direct truck expense.

## 2.12 EDI and external integration segment

**Purpose:** read transactions or acknowledgements received from customers, vendors, fuel providers, payment providers, or external systems.

**Primary sources:**

- `edi_billing`
- `edi_order`
- `edi_revenue_detail`
- `edi_driverextrapay`
- `edi_cash_*`
- `edi_partner`
- `edi_partner_code`
- `edi_standard_code`
- `edi_trans_detail`
- `edi_trans_set`
- `edi_log`
- `edi_map_error`
- `ifuel_*`
- `triumphpay_*`
- `loadpay_*`
- `hubtran_*`

**Useful information:**

- External transaction identifiers
- Partner/source system
- Billing/pay/fuel/payment records
- Error/recovery status
- Imported versus posted state

**Caution:** EDI tables can contain duplicate representations of an accounting or operational transaction. Preserve external IDs and processing status.

## 2.13 Location, route, and terminal segment

**Purpose:** normalize geography, terminals, route costs, toll calculations, and facility allocations.

**Primary sources:**

- `location`
- `route`
- `in_state_distance`
- `terminal`
- `geographic_region`
- `city`
- `state`
- `timezone`
- `distance_profile`
- `distance_control`
- `fuel_stop`

**Useful information:**

- Origin/destination and stop location
- Terminal and office
- Route distance
- Toll calculations
- Fuel price region
- Fuel-stop services
- Distance method/profile
- Facility or terminal allocation context

## 2.14 Configuration and reference segment

**Purpose:** interpret codes, defaults, policies, mappings, and account classifications used by other segments.

**Primary sources:**

- `system_parameter`
- `dispatch_control`
- `distance_control`
- `payroll_control`
- `fuel_expense`
- `gl_control`
- `gl_control_mapping`
- `gl_segment_code`
- `seg_alloc_code`
- `seg_alloc_control`
- `code`
- `reason_code`
- `charge_code`
- `deduct_code`
- `revenue_code`
- `equipment_type`
- `order_type`
- `fuel_prod_code`
- `hazmat_code`

**Extraction rule:** pull reference/configuration data with the transaction data. Codes without their descriptions and configuration rules are difficult to interpret safely.

# 3. Practical extraction rules

## 3.1 Always scope by company

Every query should begin with a company boundary and carry `company_id` through the output. This applies to:

- GL and journals
- Fuel
- Settlements
- Orders/movements/stops
- Equipment
- Payroll
- EDI
- Configuration

## 3.2 Use a consistent join hierarchy

```text
company
  -> movement / order
  -> equipment_group / equipment_item
  -> tractor / trailer
```

For accounting:

```text
company
  -> GL account / GL segment / allocation code
  -> ledger or journal posting
  -> order, movement, payee, tractor, trailer, or terminal
```

For fuel/payments:

```text
fuel or payment transaction
  -> fuel card / driver / payee / order / movement
  -> equipment assignment
  -> tractor or trailer
```

## 3.3 Keep all important dates

Retain separate fields for:

- Event/transaction date
- Service date
- Source date
- Posting/accounting date
- Payment date
- Process date
- Void/reversal date
- Effective/expiration date

Do not use the first date available as the accounting date without confirming its meaning.

## 3.4 Preserve direct versus allocated status

Every pulled record should indicate whether it is:

- Directly linked to a tractor
- Linked through a movement/order
- Linked through a driver/payee
- Classified through a GL segment
- Allocated by a business rule
- Unattributed

## 3.5 Reconcile current/history and transaction/payment layers

Do not add:

- Current and historical copies of the same record
- Fuel detail plus fuel ticket plus fuel wire as separate expenses
- Settlement plus payroll plus checks plus GL journal as separate expenses
- Revenue or billing totals to expense totals

## 3.6 Pull metadata before values

Before reading a business table, confirm:

- Table status and row count
- Columns and data types
- Company key
- Primary/business ID
- Date fields
- Truck/movement/order/payee fields
- Reversal/void fields
- Currency fields
- Relevant configuration and code tables

Empty tables should remain in the source map because they identify supported but unused features.

## 3.7 Protect sensitive fields

The database schema contains personal, banking, payroll, tax, and credential-bearing columns. Extraction should use an explicit field allowlist and should not use `SELECT *`.

# 4. Recommended extraction order

1. Pull company and unit definitions.
2. Pull reference/configuration/GL segment definitions.
3. Pull tractor, trailer, equipment-group, and equipment-item assignments.
4. Pull movements, orders, and stops.
5. Pull mileage and odometer data.
6. Pull fuel transactions and fuel-tax mileage.
7. Pull settlement/payroll/payment data.
8. Pull GL/AP/office/accounting data.
9. Pull maintenance, inspection, accident, and compliance data.
10. Pull EDI/integration records only when they add source or lifecycle detail.
11. Reconcile duplicates and reversals.
12. Produce the business output with direct, allocated, unattributed, and empty-source flags.

# 5. What this guide enables

This segmentation supports safe extraction for:

- Cost per mile
- Fuel cost per mile
- Driver pay per mile
- Revenue and gross margin per mile
- Office/terminal overhead allocation
- Maintenance and accident cost analysis
- Fleet utilization
- Fuel-tax/IFTA analysis
- Settlement reconciliation
- GL-to-truck cost attribution
- EDI and payment lifecycle reconciliation

The segments are a navigation and extraction framework. Their purpose descriptions are based on schema names and columns; McLeod’s version-specific data dictionary is still required before treating any field or segment as an official business definition.
