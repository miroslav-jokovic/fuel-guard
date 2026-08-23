# McLeod accounting database inventory

**Database:** `lme_analytics`  
**Inspected:** 2026-08-21  
**Access mode:** read-only SQL Server login  
**Scope:** schema metadata, table row counts, financial column names, views, and procedures. No business records, secrets, or financial amounts were exported.

## Executive summary

The database contains a broad McLeod LoadMaster accounting surface rather than a small isolated ledger. The accounting model is split across:

1. General ledger accounts, journals, ledger transactions, and summaries.
2. Accounts payable, accounts receivable, billing, open items, cash receipts, bank reconciliation, vouchers, and checks.
3. Driver/carrier/office payroll, deductions, payee settlement, and payment history.
4. Revenue, cost, charge, freight, rate, margin, commission, and prorating support.
5. Fuel-card, fuel-purchase, fuel-wire, fuel-tax, and fuel-cost data.
6. Tax, withholding, 1099, W-2, excise-tax, and statutory reporting data.
7. EDI and third-party payment/export integration tables.
8. Operational tables that carry accounting fields and connect loads to billing, revenue, pay, and cost records.

The strongest accounting data volumes are:

| Area | Representative tables | Observed rows |
|---|---|---:|
| General ledger | `gl_ledger`, `gl_ledger_hist`, `gl_summary` | 732,530; 1,767,734; 95,905 |
| Source journals | `journal_driver`, `journal_sales`, `journal_cash`, `journal_ap` | 1,005,594; 152,339; 118,122; 71,743 |
| Billing and open items | `billing_history`, `open_item`, `billing_freight_group` | 154,693; 332,083; 107,579 |
| Driver settlement | `drs_settle_hist`, `drs_deduct_hist`, `drs_payroll_hist` | 260,077; 192,281; 63,270 |
| Fuel financials | `fuel_tax_history`, `fuel_wire_open`, `fuel_ticket_hist` | 416,121; 59,779; 78,213 |
| Tax/statutory | `tax_data`, `drsw2_data`, `magmedia_field` | 3,207; 1,884; 4,682 |

Row counts are catalog/partition counts observed during this inspection. They should be rechecked before production extraction.

## Data safety and interpretation rules

- This document intentionally records table names, row counts, and schema-level field names only. It does not contain account numbers, invoice numbers, names, addresses, tax IDs, bank details, check amounts, or other record values.
- A table is classified as accounting-related when its name identifies an accounting domain, or when its columns contain clear financial concepts such as ledger IDs, GL IDs, invoices, vouchers, checks, payments, amounts, costs, rates, revenue, deductions, taxes, or settlement status.
- Some tables are included because they participate in an accounting workflow even when their names are operational. They should not be treated as the system of record for accounting without confirming the McLeod data dictionary.
- Many monetary fields use McLeod's repeated currency companion convention, commonly `<field>`, `<field>_c`, `<field>_d`, `<field>_n`, and `<field>_r`. The exact meaning of those suffixes must be confirmed against the installed LoadMaster version before calculations are implemented.
- Empty tables are retained in the inventory. An empty table means the schema is present in this database, not that the feature is unavailable in the McLeod installation.

## 1. General ledger and journals

These are the primary accounting tables for chart of accounts, GL configuration, journal batches, ledger postings, summaries, recurring journals, and accounting audit support.

### 1.1 Core ledger tables

| Table | Rows | Role indicated by schema |
|---|---:|---|
| `gl_account` | 551 | Chart-of-accounts records and account behavior/configuration. |
| `gl_assignment` | 237 | GL assignment and expense/sales account mappings. |
| `gl_category` | 48 | GL categories and balances. |
| `gl_control` | 4 | Company-level GL control and formatting. |
| `gl_control_mapping` | 4 | GL control mappings. |
| `gl_cycle` | 6 | GL cycle/calendar configuration. |
| `gl_ledger` | 732,530 | Current/general ledger postings with amount, GL ID, payee, check, and comments fields. |
| `gl_ledger_hist` | 1,767,734 | Historical general ledger postings. |
| `gl_summary` | 95,905 | Summarized GL amounts by account/dimension. |
| `gl_sub_audit` | 30 | Subledger audit entries with GL, invoice, journal, voucher, and payee references. |
| `gl_segment_code` | 4 | GL segment-code reference data. |
| `gl_type` | 43 | GL type and starting-account configuration. |
| `gl_account_glmap` | 0 | GL account mapping schema. |
| `gl_account_vmmap` | 0 | GL account-to-voucher/mapping schema. |
| `gl_batch_type` | 0 | GL batch-type reference schema. |
| `gl_begin_bal` | 0 | Beginning-balance schema. |
| `gl_budget` | 0 | Budget schema. |
| `gl_description` | 0 | GL description schema. |
| `gl_journal_type` | 0 | Journal-type reference schema. |
| `gl_mapping` | 0 | General GL mapping schema. |
| `gl_source_type` | 0 | GL source-type reference schema. |
| `gl_transaction` | 0 | Transaction-level GL schema. |

### 1.2 Source and recurring journals

| Table | Rows | Role indicated by schema |
|---|---:|---|
| `journal_ap` | 71,743 | Accounts-payable journal entries with amounts, GL IDs, invoice numbers, checks, payees, and vouchers. |
| `journal_cash` | 118,122 | Cash journal entries with amounts, GL IDs, checks, and invoices. |
| `journal_driver` | 1,005,594 | Driver/payee journal entries with amounts, GL IDs, checks, and payees. |
| `journal_office` | 17,911 | Office journal entries with amounts, GL IDs, checks, and payees. |
| `journal_sales` | 152,339 | Sales/revenue journal entries with amounts, GL IDs, invoices, and invoice strings. |
| `rec_journal_hdr` | 32 | Recurring journal headers. |
| `rec_journal_dtl` | 73 | Recurring journal lines with amounts, GL IDs, and payees. |
| `journal_search` | 0 | Journal search/workflow schema. |
| `journal_vm` | 0 | Voucher-management journal schema. |
| `peachtree_journal` | 0 | Peachtree journal/export integration schema. |
| `peachtree_cash_journal` | 0 | Peachtree cash-journal/export integration schema. |

## 2. AP, AR, billing, cash, bank, and vouchers

This area contains supplier-side AP, customer-side AR, billing and invoice history, open receivables, cash application, bank reconciliation, voucher processing, and payment controls.

### 2.1 Accounts payable and voucher processing

| Table | Rows | Role indicated by schema |
|---|---:|---|
| `ap_check` | 25,649 | AP checks with amount, date, number, bank account, payee, and positive-pay fields. |
| `ap_open_item` | 56 | AP open items with invoices, balances, discounts, payments, GL IDs, and payment status. |
| `ap_cod` | 4 | Cash-on-delivery AP items with invoice, discount, cash GL, and net payment fields. |
| `ap_cod_dist` | 4 | COD distribution across GL/deduction/payee references. |
| `ap_control` | 4 | AP processing and check-print controls. |
| `ap_division` | 10 | AP, cash, discount, expense, and voucher-hold GL mappings. |
| `ap_cycle_code` | 38 | AP cycle-code reference data. |
| `ap_term_code` | 5 | AP payment-term configuration. |
| `ap_begin_bal` | 0 | AP beginning-balance schema. |
| `ap_voucher_master` | 0 | AP voucher header schema. |
| `ap_voucher_detail` | 0 | AP voucher detail schema. |
| `voucher` | 11 | Voucher records with AP/cash GLs, amounts, invoice, check, discount, and hold fields. |
| `voucher_dist` | 397 | Voucher distribution lines with amounts, GLs, deductions, payees, and voucher IDs. |
| `voucher_hist` | 88,736 | Historical vouchers and payment records. |
| `voucher_interface` | 0 | Voucher import/interface schema. |
| `recur_voucher` | 312 | Recurring voucher headers or schedules. |
| `recur_voucher_dist` | 721 | Recurring voucher distribution lines. |
| `amortized_payments` | 7,708 | Amortized payment schedule/transaction schema. |

### 2.2 Accounts receivable, billing, and open items

| Table | Rows | Role indicated by schema |
|---|---:|---|
| `ar_call_record` | 68,795 | AR/customer call or collection activity. |
| `ar_cycle_code` | 0 | AR cycle-code reference schema. |
| `ar_reason_code` | 6 | AR reason-code reference data. |
| `arcontrol` | 4 | AR control/configuration. |
| `billing` | 0 | Current billing records with invoices, rates, charges, taxes, payment method, and totals. |
| `billing_history` | 154,693 | Historical billing records with invoice, charge, tax, payment, rate, and total fields. |
| `billing_freight_group` | 107,579 | Freight-group billing records; includes payment-term linkage. |
| `edi_billing` | 2,182 | EDI billing/invoice records with invoice numbers, charges, taxes, rates, currency, and billing status. |
| `open_item` | 332,083 | Open AR/billing items with invoices, GL dates, amounts, and remaining credit balances. |
| `open_item_history` | 0 | Historical open-item schema. |
| `open_item_manual` | 0 | Manually created open-item schema. |
| `misc_bill` | 0 | Miscellaneous billing/invoice schema. |
| `misc_bill_detail` | 0 | Miscellaneous billing detail schema. |
| `misc_bill_hist` | 82 | Historical miscellaneous billing records. |
| `other_charge_bill` | 1 | Billed other-charge record. |
| `rebill_audit` | 4,298 | Rebill and credit-memo audit references. |
| `invoice_workflow` | 0 | Invoice workflow schema. |
| `invoice_workflow_history` | 0 | Invoice workflow history schema. |
| `customer_billing` | 0 | Customer billing configuration/schema. |
| `customer_order` | 0 | Customer-order accounting configuration/schema. |
| `customer_fuel` | 0 | Customer fuel-billing configuration/schema. |

### 2.3 Cash receipts and bank reconciliation

| Table | Rows | Role indicated by schema |
|---|---:|---|
| `bank` | 240 | Bank/reference records. |
| `bank_account` | 18 | Bank accounts, balances, cash GL IDs, check sequencing, and positive-pay configuration. |
| `bank_account_perm` | 0 | Bank-account permissions/schema. |
| `bank_rec` | 2 | Bank reconciliation headers and statement balances. |
| `bank_rec_hist` | 665 | Bank reconciliation history with GL and statement balances. |
| `bank_rec_trx` | 54,899 | Bank reconciliation transactions with amounts and GL indicators. |
| `bank_statement_trx` | 0 | Imported bank statement transactions. |
| `bank_statemt_match` | 0 | Bank statement matching schema. |
| `bank_trx_code` | 36 | Bank transaction-code reference data. |
| `cash_batch` | 19 | Cash batches with GL, functional currency, and deposit balances. |
| `cash_receipt` | 0 | Cash receipt header/current schema. |
| `cash_receipt_hdr` | 1 | Cash receipt header record. |
| `cash_receipt_dtl` | 1 | Cash receipt application/detail record. |
| `cash_receipt_detail` | 0 | Alternate cash receipt detail schema. |
| `positivepay_master` | 15 | Positive-pay export headers. |
| `positivepay_detail` | 57 | Positive-pay check/export detail. |
| `positivepay_record` | 27 | Positive-pay formatted records. |
| `positivepay_field` | 187 | Positive-pay field definitions. |
| `positivepay_tabxref` | 24 | Positive-pay table/field cross-reference. |

## 3. Payroll, deductions, payees, and settlements

The `drs_` and `off_` families appear to represent separate driver/carrier and office/employee payroll or settlement paths. They contain checks, payees, timecards, deductions, payroll history, and settlement history.

### 3.1 Driver/carrier settlement and payroll

| Table | Rows | Role indicated by schema |
|---|---:|---|
| `drs_payee` | 1,696 | Driver/carrier settlement payee records. |
| `drs_payee_equip` | 1 | Payee/equipment association. |
| `drs_check` | 63,216 | Driver/carrier checks with amount, date, bank, payee, and positive-pay fields. |
| `drs_settle_hist` | 260,077 | Historical driver/carrier settlement records with pay, revenue, fuel pay, deductions, checks, and payment-provider fields. |
| `drs_payroll_hist` | 63,270 | Driver/carrier payroll history with gross/net pay, deductions, tax withholding, and check fields. |
| `drs_deduct_hist` | 192,281 | Historical deductions with amounts, deduction codes, GL accruals, checks, and payment status. |
| `drs_pending_deduct` | 1,639 | Pending deductions. |
| `drs_recur_deduct` | 1,566 | Recurring deductions and loan balances. |
| `drs_deduct_entry` | 0 | Current deduction-entry schema. |
| `drs_man_deduct` | 1 | Manually entered driver deduction. |
| `drs_man_settlement` | 0 | Manual driver settlement schema. |
| `drs_timecard` | 538 | Driver/carrier timecard records. |
| `drs_timecard_hist` | 5 | Historical driver/carrier timecards. |
| `drs_man_timecard` | 111 | Manual driver/carrier timecards. |
| `drs_payrate` | 0 | Driver/carrier pay-rate schema. |
| `drs_payrate_group` | 0 | Driver/carrier pay-rate group schema. |
| `drs_payrate_header` | 0 | Driver/carrier pay-rate header schema. |
| `drs_401k_hist` | 0 | Driver/carrier 401(k) history schema. |

### 3.2 Office/employee payroll

| Table | Rows | Role indicated by schema |
|---|---:|---|
| `off_payee` | 1,695 | Office/employee payee records, pay rates, tax state, and payroll status. |
| `off_check` | 6,468 | Office/employee checks. |
| `off_payroll_hist` | 6,337 | Office/employee payroll history with gross/net pay, tax withholding, and deductions. |
| `off_deduct_hist` | 11,821 | Office/employee deduction history. |
| `off_pending_deduct` | 71 | Pending office/employee deductions. |
| `off_recur_deduct` | 113 | Recurring office/employee deductions. |
| `off_man_deduct` | 0 | Manual office/employee deductions schema. |
| `off_man_settlement` | 0 | Manual office/employee settlement schema. |
| `off_man_timecard` | 0 | Manual office/employee timecard schema. |
| `off_401k_hist` | 0 | Office/employee 401(k) history schema. |

### 3.3 Shared payee, deduction, and payroll configuration

| Table | Rows | Role indicated by schema |
|---|---:|---|
| `payee` | 1,695 | Shared payee master with settlement status, payment method, check, tax, and deduction fields. |
| `payee_dim` | 0 | Payee reporting dimension schema. |
| `payee_location` | 0 | Payee/location association schema. |
| `payee_401k_fund` | 0 | Payee 401(k) fund schema. |
| `payee_401k_rate` | 0 | Payee 401(k) rate schema. |
| `payee_401krate_hdr` | 0 | Payee 401(k) rate header schema. |
| `payroll_control` | 4 | Payroll control with multiple GL IDs, pay frequencies, tax rates, settlement sorting, and pay limits. |
| `deduct_code` | 233 | Deduction-code master. |
| `deduct_code_edi` | 0 | EDI deduction-code mapping schema. |
| `ded_transfer_log` | 0 | Deduction transfer log schema. |
| `direct_deposit` | 886 | Direct-deposit/bank-account configuration. Sensitive values were not read. |
| `leave_transaction` | 0 | Paid leave transaction schema. |
| `bonus_code_hdr` | 0 | Bonus-code header schema. |
| `bonus_code_dtl` | 0 | Bonus-code detail schema. |
| `driver_extra_pay` | 168 | Driver extra-pay records. |
| `carrier_other_pay` | 0 | Carrier other-pay schema. |
| `broke_drs_ex_pay` | 0 | Broker/driver settlement extra-pay schema. |
| `tia_3pl_extrapay` | 0 | Third-party extra-pay schema. |
| `tia_3pl_movepay` | 0 | Third-party movement-pay schema. |

## 4. Revenue, cost, charges, freight, rates, and prorating

These tables calculate or carry the billable/revenue side of a movement and the payable/cost side. They are important accounting inputs but are not all ledgers or journals.

| Table | Rows | Role indicated by schema |
|---|---:|---|
| `revenue_code` | 15 | Revenue and expense GL mappings. |
| `revenue_calculation` | 84 | Revenue calculation/configuration records. |
| `revenue_allocation` | 0 | Revenue allocation schema. |
| `revenue_allocation_control` | 0 | Revenue allocation control schema. |
| `revenue_detail` | 0 | Revenue detail schema. |
| `revenue_detail_audit` | 0 | Revenue detail audit schema. |
| `revenue_fact` | 0 | Revenue fact/reporting schema. |
| `revenue_share` | 0 | Revenue-share schema. |
| `revenue_split` | 0 | Revenue split schema. |
| `revenue_split_history` | 0 | Revenue split history schema. |
| `cust_rev_history` | 27,898 | Customer revenue history with freight, fuel surcharge, amount, and remaining-charge fields. |
| `prorated_move` | 303,654 | Movement-level prorated fuel, nonfuel, other-charge, and revenue amounts. |
| `prorated_moveorder` | 294,097 | Movement/order-level prorated amounts. |
| `prorated_orderdist` | 146,208 | Order distribution support for prorated accounting values. |
| `freight_group` | 107,577 | Freight-group operational records carrying chargeable-weight and billing context. |
| `freight_group_audit` | 0 | Freight-group accounting/audit schema. |
| `billing_freight_group` | 107,579 | Freight-group billing records. |
| `freight_bill` | 0 | Freight bill schema. |
| `freight_bill_detail` | 0 | Freight bill detail schema. |
| `other_charge` | 13,906 | Current other charges, rates, taxability, and fuel-surcharge allocation. |
| `other_charge_bill` | 1 | Billed other-charge record. |
| `other_charge_edi` | 4,869 | EDI other-charge records. |
| `other_charge_hist` | 15,147 | Historical other charges. |
| `other_charge_bids` | 0 | Other-charge bid schema. |
| `other_charge_quote` | 0 | Quoted other-charge schema. |
| `other_charge_rate` | 0 | Other-charge rate schema. |
| `other_charge_rec` | 1 | Other-charge receivable/record schema. |
| `charge_code` | 21 | Charge-code master. |
| `charge_code_edi` | 4 | EDI charge-code mapping. |
| `map_charge_to_deduct_code` | 0 | Charge-to-deduction mapping schema. |
| `dedicated_fixed_charge` | 0 | Dedicated fixed-charge schema. |
| `tiered_charge` | 0 | Tiered charge schema. |
| `tiered_charge_hdr` | 0 | Tiered charge header schema. |
| `tiered_stop_rate` | 0 | Tiered stop-rate schema. |
| `detention_def` | 0 | Detention billing/pay rules and maximum pay amounts. |
| `detention_def_chg` | 0 | Detention charge rules. |
| `detention_control` | 0 | Detention billing and payment controls. |
| `detention_hist_pay` | 0 | Detention payment history schema. |
| `trailer_detention_rate` | 0 | Trailer detention billing/rate schema. |
| `rate` | 0 | General rate schema. |
| `rate_header` | 0 | Rate header schema. |
| `rate_dimension` | 0 | Rate dimension schema. |
| `rate_quote` | 0 | Rate quote schema. |
| `rate_confirmation_status` | 24 | Rate-confirmation status reference. |
| `rate_index_control` | 3 | Rate-index control. |
| `rate_index_result` | 167,130 | Rate-index result/history data. |
| `orig_dest_rate` | 0 | Origin/destination rate schema. |
| `carrier_rate` | 0 | Carrier rate schema. |
| `carrier_lane_rate` | 0 | Carrier lane-rate schema. |
| `dray_rate` | 0 | Drayage rate schema. |
| `dray_lane_rate` | 0 | Drayage lane-rate schema. |
| `dray_distance_rate` | 0 | Drayage distance-rate schema. |
| `chassis_rate` | 0 | Chassis rate schema. |
| `container_rate` | 0 | Container rate schema. |
| `mileage_rate` | 0 | Mileage rate schema. |
| `fsc_rates_canada` | 0 | Canadian fuel-surcharge rate schema. |
| `loh_max_pay_rate` | 0 | Maximum pay-rate schema. |
| `loh_target_margin` | 0 | Target-margin schema. |
| `factoring_company` | 0 | Factoring-company configuration schema. |
| `factoring_service` | 0 | Factoring-service configuration schema. |
| `finance_charge` | 0 | Finance-charge schema. |
| `credit_control` | 0 | Credit-control schema. |
| `credit_exclude` | 0 | Credit-exclusion schema. |
| `credit_override` | 14,603 | Credit overrides. |
| `allocated_charge` | 0 | Allocated-charge schema. |
| `accident_cost` | 562 | Accident cost records. |
| `cost_fact` | 0 | Cost fact schema with driver pay, fuel, freight, and other costs. |
| `cost_summary` | 0 | Cost summary schema. |
| `bi_cost_fact` | 0 | Business-intelligence cost fact schema. |
| `bi_cost_summary` | 0 | Business-intelligence cost summary schema. |
| `bi_profit_control` | 0 | Profitability control schema. |
| `bi_profit_range` | 0 | Profitability range schema. |
| `pft_cost` | 0 | Profitability cost schema. |
| `pft_cost_gl` | 0 | Profitability-to-GL schema. |
| `pft_cost_hdr` | 0 | Profitability cost header schema. |
| `sales_commissionable` | 0 | Commissionable sales schema. |
| `salesman_commission` | 0 | Sales commission schema. |
| `service_commission_rule` | 0 | Service commission rules. |
| `interline_partner_split_rule` | 0 | Interline revenue/pay split rules. |

## 5. Fuel and card financials

Fuel is both an operational data source and an accounting/cost domain. The current tables are sparse, while historical and aggregate tables contain substantial data.

### 5.1 Fuel transaction, cost, and history tables

| Table | Rows | Role indicated by schema |
|---|---:|---|
| `fuel_detail` | 3 | Current fuel transaction detail with price, cost, discount, taxes, billing, and equipment fields. |
| `fuel_detail_hist` | 65,847 | Historical fuel detail with extensive cost, discount, tax, billing, card, and payment fields. |
| `fuel_ticket` | 6 | Current fuel tickets with volume, price, total cost, invoice, tractor, trailer, and reefer references. |
| `fuel_ticket_hist` | 78,213 | Historical fuel tickets. |
| `fuel_total` | 6,731 | Aggregated fuel, tractor, reefer, oil, cash-advance, tax, and cost totals. |
| `fuel_prod_total` | 3,890 | Product-level fuel totals and product cost/billing codes. |
| `fuel_products` | 10 | Fuel product reference data. |
| `fuel_products_hist` | 11,483 | Historical fuel product records. |
| `fuel_stop` | 5,005 | Fuel-stop/vendor reference and transaction support. |
| `fuel_expense` | 2 | Fuel-expense records. |
| `fuel_download` | 3,215 | Fuel transaction/import download data. |
| `fuel_file_list` | 88 | Fuel interface file tracking. |
| `fuel_error` | 0 | Fuel import/error schema. |
| `fuel_post` | 0 | Fuel posting schema. |
| `fuel_reimbursement` | 0 | Fuel reimbursement schema. |
| `fuel_wire_detail` | 14 | Fuel wire/detail records. |
| `fuel_wire_history` | 5,746 | Historical fuel wire invoices and amounts. |
| `fuel_wire_open` | 59,779 | Open fuel-wire/check amounts, charges, payees, and statuses. |
| `fuel_wire_post` | 0 | Posted fuel-wire schema. |
| `fuel_wire_total` | 7,201 | Aggregated fuel-wire invoice, net, and service-charge amounts. |

### 5.2 Fuel cards, interfaces, and policies

| Table | Rows | Role indicated by schema |
|---|---:|---|
| `fuel_card` | 1,820 | Fuel-card master records. |
| `fuel_chain_code` | 11 | Fuel-chain reference data. |
| `fuel_direct_vendor` | 4 | Direct fuel vendor configuration. |
| `fuel_funded_vendor` | 5 | Funded fuel vendor configuration. |
| `fuel_interface` | 48 | Fuel interface/provider configuration. |
| `fuel_payrate` | 0 | Fuel-related pay-rate schema. |
| `fuel_dirdep` | 0 | Fuel direct-deposit schema. |
| `fuel_price` | 2,331 | Fuel price records. |
| `fuel_price_monthly` | 481 | Monthly fuel prices. |
| `fuel_prod_code` | 303 | Fuel product-code reference. |
| `fuel_prod_gl_acct` | 0 | Fuel-product-to-GL mapping schema. |
| `fuel_tax_control` | 3 | Fuel-tax control. |
| `fuel_tax_export` | 0 | Fuel-tax export schema. |
| `fuel_tax_file_type` | 0 | Fuel-tax file-type reference schema. |
| `fuel_tax_interface` | 0 | Fuel-tax interface schema. |
| `fuel_tax_rate` | 108 | Fuel-tax rates. |
| `fuel_tax_vendor` | 0 | Fuel-tax vendor schema. |
| `ifuel_card_comdata` | 0 | Comdata card financial schema. |
| `ifuel_card_efs` | 0 | EFS card financial schema. |
| `ifuel_card_fle` | 0 | Fleet card financial schema. |
| `ifuel_card_limit` | 0 | Card limits schema. |
| `ifuel_card_msts` | 0 | MSTS card financial schema. |
| `ifuel_card_quikq` | 0 | QuikQ card financial schema. |
| `ifuel_card_tch` | 1,601 | TCH card financial records. |
| `ifuel_card_tchek` | 0 | T-Chek card financial schema. |
| `ifuel_cash_on_card` | 1 | Cash-on-card balances and limits. |
| `ifuel_contract_tch` | 3 | TCH fuel contract configuration. |
| `ifuel_control` | 2 | Fuel-interface control. |
| `ifuel_limits_msts` | 0 | MSTS fuel limits schema. |
| `ifuel_metrics` | 0 | Fuel metrics schema. |
| `ifuel_money_msts` | 0 | MSTS money schema. |
| `ifuel_msts_policy_mstr` | 22 | MSTS policy master. |
| `ifuel_policies_msts` | 0 | MSTS policies schema. |
| `ifuel_pool_efs_dtl` | 0 | EFS pooled-card detail schema. |
| `ifuel_pool_efs_hdr` | 0 | EFS pooled-card header schema. |
| `ifuel_product_limit` | 0 | Fuel product-limit schema. |
| `ifuel_quikq_asset` | 0 | QuikQ asset schema. |
| `ifuel_quikq_override` | 0 | QuikQ override schema. |
| `ifuel_user` | 7 | Fuel-interface user records. |
| `ifuel_user_limit` | 0 | Fuel-interface user limits schema. |
| `tch_category` | 141 | TCH category reference data. |
| `tch_checks` | 6,605 | TCH checks with amounts, balances, service charges, and payees. |
| `tchek_checks` | 0 | T-Chek checks schema. |
| `tch_oon_default` | 1 | TCH out-of-network default. |
| `tch_oon_override` | 1 | TCH out-of-network override. |
| `tch_ovrrides_hdr` | 34 | TCH override headers. |
| `tch_ovrrides_dtl` | 28 | TCH override details with amounts. |
| `tch_prompt` | 92 | TCH prompt/reference configuration. |
| `efs_checks` | 198 | EFS check records. |
| `comdata_checks` | 0 | Comdata check schema. |
| `unassigned_cards` | 7 | Fuel-card/interface assignment exceptions. |

## 6. Tax and statutory reporting

These tables cover payroll withholding, fuel tax, excise tax, 1099/W-2 data, tax setup, and magnetic-media/statutory export structures.

| Table | Rows | Role indicated by schema |
|---|---:|---|
| `tax_data` | 3,207 | Payee/payer tax reporting data. Sensitive tax identifiers were not read. |
| `tax_data_hist` | 0 | Historical tax-data schema. |
| `tax_deduct_setup` | 0 | Tax deduction setup schema. |
| `taxyear_setup` | 19 | Tax year and quarter setup. |
| `drs1099_data` | 1,068 | Driver/carrier 1099 reporting data. |
| `drs1099_data_hist` | 0 | Historical driver/carrier 1099 schema. |
| `drsw2_data` | 1,884 | Driver/carrier W-2 reporting data. |
| `drsw2_data_hist` | 0 | Historical driver/carrier W-2 schema. |
| `off1099_data` | 0 | Office/employee 1099 schema. |
| `off1099_data_hist` | 0 | Historical office/employee 1099 schema. |
| `offw2_data` | 129 | Office/employee W-2 reporting data. |
| `offw2_data_hist` | 0 | Historical office/employee W-2 schema. |
| `ap_1099_code` | 44 | AP 1099 code reference. |
| `ap1099_data` | 127 | AP 1099 reporting data. |
| `ap1099_data_hist` | 0 | Historical AP 1099 schema. |
| `w2_box_12_codes` | 30 | W-2 Box 12 code reference. |
| `w2_paid_insurance` | 0 | W-2 paid-insurance schema. |
| `excisetax_charge` | 0 | Excise-tax charge schema. |
| `excisetax_charge_bill` | 0 | Excise-tax billing schema. |
| `excisetax_charge_edi` | 0 | Excise-tax EDI schema. |
| `excisetax_code` | 0 | Excise-tax code reference. |
| `excisetax_control` | 3 | Excise-tax control. |
| `excisetax_history` | 0 | Excise-tax history schema. |
| `excisetax_misc_bill` | 0 | Excise-tax miscellaneous billing schema. |
| `excisetax_rate` | 0 | Excise-tax rates schema. |
| `fedtaxdetail` | 0 | Federal tax detail schema. |
| `fedtaxtable` | 2 | Federal tax table. |
| `statetaxdetail` | 0 | State tax detail schema. |
| `statetaxtable` | 0 | State tax table. |
| `fuel_tax_control` | 3 | Fuel-tax control. |
| `fuel_tax_history` | 416,121 | Historical fuel-tax records. |
| `fuel_tax_rate` | 108 | Fuel-tax rates. |
| `fuel_tax_export` | 0 | Fuel-tax export schema. |
| `fuel_tax_file_type` | 0 | Fuel-tax file-type schema. |
| `fuel_tax_interface` | 0 | Fuel-tax interface schema. |
| `fuel_tax_vendor` | 0 | Fuel-tax vendor schema. |
| `mc_fueltax_control` | 0 | McLeod fuel-tax control schema. |
| `magmedia_emplr` | 0 | Magnetic-media employer schema. |
| `magmedia_field` | 4,682 | Magnetic-media field definitions/data. |
| `magmedia_form` | 21 | Magnetic-media form definitions. |
| `magmedia_recform` | 258 | Magnetic-media record-form definitions. |
| `magmedia_record` | 162 | Magnetic-media output records. |
| `magmedia_tabxref` | 1,076 | Magnetic-media table cross-reference. |
| `magmedia_st_comments` | 0 | State magnetic-media comments schema. |
| `magmedia_st_field` | 0 | State magnetic-media fields schema. |
| `magmedia_state_rec` | 0 | State magnetic-media records schema. |
| `magmedia_trans` | 0 | Magnetic-media transaction schema. |

## 7. EDI and payment-provider integrations

These tables are accounting-adjacent integration surfaces. They should be treated as interface or export state, not as authoritative ledger tables unless the McLeod data dictionary says otherwise.

| Table/family | Observed rows | Purpose indicated by schema |
|---|---:|---|
| `edi_billing` | 2,182 | Billing/invoice EDI transactions. |
| `edi_cash_batch` | 0 | Cash-batch EDI schema. |
| `edi_cash_recpt_hdr` | 0 | Cash-receipt EDI header schema. |
| `edi_cash_recpt_dtl` | 0 | Cash-receipt EDI detail schema. |
| `edi_revenue_detail` | 0 | Revenue EDI detail schema. |
| `edibilling_profile` | 1 | EDI billing profile. |
| `edi_driverextrapay` | 0 | EDI driver extra-pay schema. |
| `edi_movement_order` | 0 | EDI movement/order records with settlement fields. |
| `edi_remit_adv_prof` | 0 | Electronic remittance advice profile schema. |
| `loadpay_control` | 0 | LoadPay control/configuration. |
| `triumphpay_control` | 0 | TriumphPay control/configuration. |
| `triumphpay_field_list` | 92 | TriumphPay field definitions. |
| `triumphpay_trx` | 0 | TriumphPay transaction schema. |
| `hubtran_invoice_exceptions` | 0 | Invoice exception schema. |
| `ifuel_*` | Mixed; see fuel section | Fuel-card/provider interfaces and balances. |
| `peachtree_*` | 0 | Peachtree accounting export schemas. |
| `positivepay_*` | 310 total across listed tables | Bank-check positive-pay export structures. |

## 8. Operational tables carrying accounting fields

These are not accounting ledgers, but they are important joins when reconciling revenue, pay, cost, and billing back to transportation activity.

| Table | Rows | Accounting relevance |
|---|---:|---|
| `orders` | 150,990 | Contains freight charges, pay gross, rates, total charges, revenue codes, billing dates, billing status, taxes, and payment-related fields. |
| `master_orders` | 0 | Master-order billing/rate schema. |
| `movement` | 296,242 | Contains target pay, override pay, pay method, fuel distance, carrier/payment fields, and movement-level accounting status. |
| `movement_order` | 294,871 | Connects movements to orders for billing/pay allocation. |
| `freight_group` | 107,577 | Freight-group weight and billing context. |
| `billing_freight_group` | 107,579 | Freight-group billing state. |
| `prorated_move` | 303,654 | Movement-level allocation of fuel, nonfuel, other charges, and revenue. |
| `prorated_moveorder` | 294,097 | Movement/order allocation of financial values. |
| `prorated_orderdist` | 146,208 | Order distribution support. |
| `customer` | 6,241 | Customer master referenced by billing and revenue records. |
| `customer_billing` | 0 | Customer billing configuration schema. |
| `customer_fuel` | 0 | Customer fuel billing schema. |
| `customer_order` | 0 | Customer-order billing schema. |
| `driver` | 1,491 | Contains payee and revenue-related references; driver identity fields are sensitive and were not read. |
| `driver_extra_pay` | 168 | Extra-pay inputs for settlements. |
| `carrier_other_pay` | 0 | Carrier other-pay schema. |
| `tractor` | 660 | Asset records that can be referenced by fuel and movement cost data. |
| `trailer` | 459 | Asset records that can be referenced by fuel and movement cost data. |
| `stop` | 610,081 | Contains rate-distance and order/movement links used in billing and pay calculations. |
| `company` | 4 | Company/currency context used throughout the accounting tables. |

Important observed relationship pattern:

```text
movement
  -> movement_order
  -> orders
  -> billing / revenue / prorating / settlement records
```

The database exposes few declarative foreign keys for these relationships. Queries must join using the correct `company_id` plus the relevant McLeod IDs.

## 9. Accounting-related views

The following views appear accounting, revenue, freight, or financial-reporting related based on their names:

- `bfg_revenue_summ_view`
- `fgp_base_revenue_summ_view`
- `fgp_financial_amalgum_view`
- `fgp_revenue_summ_view`
- `fgp_x_wrs_view`
- `hdr_x_fgp_uid_view`
- `inbound_txl_plc_loc_fgp_ord_view`
- `linehaul_freight_view`
- `outbound_txl_plc_loc_fgp_ord_view`
- `quote_revenue_detail_per_fgi_view`
- `quote_revenue_detail_view`
- `revenue_detail_per_fgi_view`
- `revenue_detail_view`
- `revenue_split_view`
- `rsp_x_rev_view`
- `trp_txl_stp_fgp_plc_view`
- `txl_fgp_plc_loc_reg_view`
- `txl_fgp_ship_cons_ofrec_view`
- `txl_fgp_view`
- `txl_plc_loc_fgp_ord_view`
- `txl_plc_loc_fgp_reg_view`
- `txl_plc_loc_fgp_view`
- `txl_stp_fgp_plc_loc_view`

View names alone do not prove the accounting grain or whether a view is suitable for extraction. Read-only column and definition review is required before selecting one as an integration contract.

## 10. Stored procedures

The database exposes four stored procedures:

- `insert_omq`
- `process_ejpo_message`
- `process_fgp_ejpo_mod`
- `process_txl_ejpo_mod`

None is clearly named as an accounting procedure. They were not executed. Because the project’s McLeod integration decision is read-only SQL/API extraction, procedure execution should require separate approval and a vendor-confirmed contract.

## 11. Findings and recommended next steps

### Findings

1. **The general ledger is populated.** `gl_ledger`, `gl_ledger_hist`, `gl_summary`, and source journals contain substantial data.
2. **Billing/open-item data is populated.** `billing_history`, `open_item`, `billing_freight_group`, and `edi_billing` contain meaningful row volumes.
3. **Driver settlement is populated.** The `drs_` family has large settlement, deduction, payroll, and check histories.
4. **Fuel accounting is populated mostly in history/aggregate tables.** Current `fuel_detail` and `fuel_ticket` are sparse, while their history and total tables are populated.
5. **Several accounting modules are schema-only in this database.** Current AP vouchers, current billing, cash receipts, revenue facts, cost facts, factoring, and many rate tables contain zero rows.
6. **Accounting joins are multi-tenant.** `company_id` must be included in joins and filters; IDs should not be treated as globally unique.
7. **Sensitive data is present.** Tax, payroll, direct-deposit, payee, bank, and check tables should not be exposed through a broad integration query.

### Recommended read-only extraction order

1. Confirm the intended accounting use case: GL reporting, billing reconciliation, driver settlement, fuel cost, or tax reporting.
2. Obtain the McLeod data dictionary for the installed version and confirm the meaning of currency suffix columns.
3. Build a narrow, company-scoped query against the appropriate source/history tables.
4. Prefer a McLeod-approved view or Direct-Hosted Web API route where available; use direct SQL only for fields unavailable through the supported API.
5. Validate row grain and duplicate behavior using IDs and `company_id` before loading FuelGuard.
6. Exclude tax IDs, bank details, direct-deposit fields, check addresses, payment credentials, and other sensitive fields unless there is a documented requirement and approved handling path.
7. Keep this database access read-only. Do not execute write procedures or issue `INSERT`, `UPDATE`, `DELETE`, DDL, or direct SQL writes.

The project’s McLeod integration guidance treats direct SQL as an exception and prohibits direct SQL writes; the supported primary path remains the private McLeod Web API or an outbound on-premises sync agent.
