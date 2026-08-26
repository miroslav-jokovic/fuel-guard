# McLeod CPM data-source spec — loads, accounting, profiles, other expenses

**Status:** verified extraction contract, ready for implementation
**Sandbox verification:** 2026-08-26 against `lme_analytics` (restore of 2026-08-21)
**Write policy:** `SELECT` only. No DDL, no DML, no stored procedures, no McLeod mutations.
**Supersedes on two points:** `docs/plans/MCLEOD-SQL-SOURCE-OF-TRUTH.md` §5 (see §2 below).

## Purpose

`MCLEOD-ROSTER-SYNC-PLAN.md` and `MCLEOD-READ-ONLY-INTEGRATION-HANDOFF.md` cover the roster
(drivers, tractors, trailers). This document covers the four remaining domains needed for
cents-per-mile: **loads, accounting, profiles/settlement, and other expenses.**

The governing product decision is that FuelGuard **replicates McLeod facts faithfully and
allocates costs downstream in its own harness**. This document therefore specifies extraction
of line-level facts with their native keys preserved. It deliberately does **not** specify
aggregation, allocation, or any CPM arithmetic — those belong to the FuelGuard harness, where
the rules are ours to change without re-reading McLeod.

---

## 1. Verified environment

| Fact | Value |
|---|---|
| Server | `10.0.1.171:1433`, SQL Server 2019 Enterprise 15.0.2120.1, host `APPNEW` |
| Database | `lme_analytics` (sandbox restore; production is `lme`, unreachable from this login) |
| Login | `NikiAnalytics`, `db_datareader` |
| Operating company | `dbo.company.id = 'TMS'` — Silvicom, Inc. |
| Company scope | GL is 99.8% `TMS`; `TMS2`/`TMS3`/`TMS4` are small and must be excluded by predicate |

### 1.1 The sandbox is frozen, not replicated

Maximum dates by domain, measured 2026-08-26:

| Source | Max date |
|---|---|
| `gl_ledger.transaction_date` | 2026-08-17 |
| `voucher_hist.invoice_date` | 2026-08-19 |
| `audit_log.change_date_time` | 2026-08-19 |
| `fuel_detail_hist.trans_date_time` | 2026-08-20 |
| `drs_settle_hist.pay_date` | 2026-08-21 |

Every domain stops at the 2026-08-21 restore. **The sandbox is a point-in-time snapshot and
receives no updates.** It is the correct fixture for building and testing extraction, and it
cannot demonstrate the real-time requirement. Real-time is a property of production `lme` only,
and is gated on carrier/DBA access — an approval, not an engineering task.

> **D-MC10:** Build and test the entire extraction against the frozen sandbox. Treat freshness
> as a production acceptance test, not a development blocker. The schema is what production has;
> the recency is not.

---

## 2. Two corrections to `MCLEOD-SQL-SOURCE-OF-TRUTH.md` §5

### 2.1 McLeod *does* hold fuel data — the audit read the wrong table

§5 concluded: *"`fuel_detail` = 3 rows → No. EFS remains authoritative. Any plan that assumes
otherwise is planning against an empty table."*

That reading missed McLeod's live/history split. Completed records move to `_hist`:

| Live table | Rows | History table | Rows |
|---|---:|---|---:|
| `fuel_detail` | 3 | `fuel_detail_hist` | **65,847** |
| `fuel_ticket` | 6 | `fuel_ticket_hist` | **78,213** |
| `voucher` | 11 | `voucher_hist` | **88,736** |
| `gl_ledger` | 732,530 | `gl_ledger_hist` | **1,767,734** |

> **D-MC11:** Every extraction query reads `UNION ALL` over the live table *and* its `_hist`
> counterpart. A query against the live table alone sees under 0.01% of the data and will look
> like a working integration returning almost nothing.

This does **not** demote EFS. EFS remains the authoritative fuel-purchase source; McLeod's fuel
tables become a **reconciliation input** and the source of `reefer_cost` and `def_cost`
splits that EFS does not break out.

### 2.2 The cost-per-mile verdict was right for the wrong reason

§5 called CPM *"a finance project, not an import"* because the native cost-fact model looked
empty. The conclusion holds, but the mechanism is different and more actionable — see §3.

### 2.3 Confirmed correct: maintenance is genuinely absent

Every table matching `%maint%`, `%work_order%`, `%repair%`, `%tire%`, `%part%` is empty or
unrelated (EDI partner tables only). **FleetPal is correctly scoped as the maintenance source.**

---

## 3. The central finding: the GL cannot attribute, the subledgers can

`gl_ledger` carries `tractor`, `trailer`, and `order_id` columns. They are **not populated**.

2026 year-to-date, all GL lines:

| Attribution | Lines | % of lines | Absolute dollars | % of dollars |
|---|---:|---:|---:|---:|
| has tractor | 0 | 0.00% | $0 | 0.00% |
| no tractor | 188,179 | 100.00% | $298,191,036 | 100.00% |

Zero of 188,179 lines. The carrier does not use equipment-level GL coding. **Any CPM design that
plans to read cost per truck out of the general ledger will produce nothing.**

The subledgers are the opposite. 2026 year-to-date:

| Subledger | Rows | tractor | driver | movement |
|---|---:|---:|---:|---:|
| `drs_settle_hist` | 20,833 | **20,833 (100%)** | 20,828 (99.98%) | **20,833 (100%)** |

`fuel_detail_hist` likewise carries `tractor_id`, `tractor_code`, `tractor_gals`, `tractor_cost`,
`driver_id`, `movement_id`, `order_id`, `truck_stop_state`, and `licensed_state`.

> **D-MC12 — the architecture that follows from this:**
>
> - **Subledgers are the attribution source.** Settlement, fuel, and accessorial rows carry
>   `tractor_id` / `movement_id` natively. They answer "what did truck 1234 cost".
> - **The GL is the control total, not an input to CPM.** We extract it to *prove* the subledger
>   extraction is complete — GL by `post_module` should reconcile to the sum of the subledger
>   rows we captured. A drift means we are missing rows.
> - **Unattributed cost stays unattributed at the boundary.** We import it with its
>   `glid` (account) and `post_module` intact and let the FuelGuard harness apply allocation.
>   The integration never invents an attribution McLeod does not assert.

2026 GL by posting module, showing where the money actually is:

| `post_module` | Source | Lines | Absolute dollars |
|---|---|---:|---:|
| `BILL` | SALES | 21,874 | $62,013,898 |
| `GJ` | GJ | 1,158 | $58,645,249 |
| `CASH` | CASH | 17,724 | $54,743,118 |
| `AP` | AP | 7,853 | $53,042,658 |
| `DRS` | DRS | 34,432 | $19,749,150 |
| `SET` | DRS | 36,854 | $16,753,358 |
| `FUEL` | DRS | 57,486 | $15,878,667 |
| `RJ` | RJ | 782 | $12,266,856 |
| `OFF` | OFF | 2,357 | $3,199,797 |
| `WIRE` | DRS | 5,275 | $1,310,131 |
| `SETV` | DRS | 910 | $442,283 |
| `DED` | DRS | 1,344 | $101,200 |

`OFF` is the office-settlement module — the "office settlements" in scope. Note that fuel posts
through `DRS` (driver settlement), not through AP: at this carrier fuel reaches the ledger via
the settlement path, which is consistent with fuel cards being settled against drivers.

---

## 4. The mileage denominator — a real gap

CPM needs miles. `movement` offers five distance columns. Measured over 21,547 movements
settled in 2026:

| Column | 2026 total | Usable? |
|---|---:|---|
| `move_distance` | 10,801,438 | **Yes** |
| `fuel_distance` | 10,842,984 | **Yes** (0.38% above `move_distance`) |
| `pay_distance` | 0 | No — never populated |
| `manifest_loaded_distance` | 0 | No — never populated |
| `manifest_empty_distance` | 0 | No — never populated |

**Resolved 2026-08-26 — see §4.1 and §4.2.** `move_distance` is the denominator; `movement`
records loaded miles only; empty miles are not stored anywhere and must be inferred.

### 4.1 What `move_distance` actually measures

Stop-level distances reconstruct it almost exactly. Over 20,239 movements settled in 2026:

| Measure | Value |
|---|---:|
| `SUM(movement.move_distance)` | 10,801,438 |
| `SUM(stop.move_dist_from_previous)` | 10,609,285 (98.2%) |
| Movements matching within 1 mile | **19,303 of 20,239 (95.4%)** |
| Average stops per movement | 2.08 |

Distance accumulates almost entirely on `SO` (delivery) stops — 10,713,860 miles across 23,373
`SO` stops, versus 14,112 across 22,404 `PU` stops. The carrier runs overwhelmingly simple trips:
20,735 movements have exactly two stops.

That pattern means every recorded mile is a **pickup-to-delivery mile**. `move_distance` is
**loaded miles**. The truck's trip from a delivery to its next pickup is not recorded on any row.

> **D-MC15:** `movement.move_distance` (unit `MI`, confirmed on 21,542 of 21,547 rows) is the
> loaded-mile denominator. `fuel_distance` runs 0.36% higher and is retained as a data-quality
> cross-check, not as an alternative basis. A per-movement divergence beyond 2% is an alarm.

### 4.2 Empty miles are absent but inferable — and worth about 4%

Deadhead can be reconstructed because stop endpoints are complete: **46,384 of 46,384** stops in
2026 carry both latitude/longitude and `city_id`, and 3,308 of 3,334 movements in a June sample
have both a first-`PU` and a last-`SO` endpoint across 159 tractors.

Chaining consecutive movements per tractor and measuring previous-delivery → next-pickup:

| June 2026 | Value |
|---|---:|
| Chained legs | 3,149 |
| Loaded miles | 1,656,596 |
| Deadhead (great-circle floor) | 65,463 |
| **Deadhead as % of loaded** | **3.95%** |

Great-circle understates road distance by roughly 20%, so true deadhead is near **4.7%**.

> **D-MC16:** Total miles = loaded (`move_distance`) + inferred deadhead. The inference belongs
> in the FuelGuard harness, not the extraction layer — the extraction ships stop coordinates and
> timestamps, and the harness chains them. Ignoring deadhead would overstate CPM by ~4–5%, which
> is too large to discard and too uncertain to treat as exact. Report it as a separate,
> clearly-labelled estimated component, never merged silently into the loaded figure.

### 4.3 `billed_distance` is not a denominator

`drs_settle_hist.billed_distance` sums to 18,569,803 against 10,508,703 loaded miles for the same
movements — 77% higher, at 1.02 settlement lines per movement, so this is not line duplication.
The ratio is bimodal rather than constant, which rules out a unit conversion:

| `billed_distance` ÷ `move_distance` | Movements |
|---|---:|
| below 0.95× | 219 |
| **0.95–1.05× (equal)** | **10,103** |
| 1.05–1.75× | 486 |
| 1.75–1.85× (km would sit here) | 58 |
| **above 1.85×** | **8,389** |

Two clean clusters at ~1× and ~2× indicate `billed_distance` is the **order-level** distance
repeated on each movement of a multi-movement order. `pay_distance` (10,884,021, +3.6% over
loaded) is the driver-pay basis and tracks movement distance closely.

> **D-MC17:** Never use `billed_distance` as a mileage denominator — on roughly 40% of movements
> it counts the whole order. Note that `pay_distance_um` and `billed_distance_um` are **NULL on
> all 20,833 rows**, so settlement distances carry no unit declaration and must be assumed `MI`
> by convention rather than by evidence.

---

## 5. Extraction contract by domain

All queries are company-scoped (`company_id = @companyId`), parameterised, column-explicit
(never `SELECT *`), and read live `UNION ALL` `_hist` per D-MC11.

### 5.1 Loads

| Table | Rows | Role |
|---|---:|---|
| `movement` | 296,242 | The trip. Distances, status, dates, `equipment_group_id`. |
| `orders` | 150,990 | The customer order. Revenue, customer, commodity. |
| `movement_order` | 294,871 | Movement ↔ order join (many-to-many). |
| `stop` | 610,081 | Stop sequence, locations, actual times, **lat/lon (100% populated)**, `move_dist_from_previous`. |
| `in_state_distance` | 597,956 | **Not per-movement** — see note below. |
| `billing_history` | 154,693 | Invoiced revenue as billed. |
| `freight_group` / `billing_freight_group` | 107,577 | Freight grouping for revenue splits. |

**Movement ↔ truck bridge.** `movement` has no direct tractor column — `carrier_tractor` is for
purchased transportation, not company equipment. The link is:

```text
movement.equipment_group_id
  -> equipment_item.equipment_group_id
     -> equipment_item.equipment_id   (the unit)
        + equipment_item.equipment_type_id  (tractor | trailer | driver)
```

`equipment_item` has 748,419 rows. Extraction must resolve this join rather than assuming a
tractor column exists. `equipment_type_id = 'T'` selects the tractor row.

**Correction on `in_state_distance`.** An earlier draft of this document described it as per-state
miles per movement. It is not: it has **no `movement_id`**. Its key is
`(origin_city_id, dest_city_id, state, distance_profile)` with `distance_profile = 'FUEL'` — it is
McLeod's cached city-pair mileage lookup used to apportion a trip across states for fuel tax. It
is still valuable, both as the IFTA state-apportionment source and as the road-mileage lookup for
the deadhead inference in §4.2, but it is joined on city pairs, never on a movement key.

### 5.2 Accounting

| Table | Rows | Role |
|---|---:|---|
| `gl_ledger` + `gl_ledger_hist` | 732,530 + 1,767,734 | Control totals only (D-MC12). |
| `journal_sales` | 152,339 | Revenue journal. |
| `journal_ap` | 71,743 | Payables journal — carries unused `tractor`/`trailer`. |
| `journal_cash` | 118,122 | Cash journal. |
| `journal_driver` | 1,005,594 | Driver journal. |
| `open_item` | 332,083 | Open AR/AP items. |
| `gl_summary` | 95,905 | Period summaries — useful as a second control total. |

### 5.3 Profiles and settlement

Roster (drivers, tractors, trailers) is already contracted in
`MCLEOD-READ-ONLY-INTEGRATION-HANDOFF.md` §3 and is unchanged by this document.

Settlement is new scope:

| Table | Rows | Role |
|---|---:|---|
| `drs_settle_hist` | 260,077 | **Per-movement, per-truck driver pay. 100% attributed.** |
| `drs_deduct_hist` | 192,281 | Deductions. |
| `drs_payroll_hist` | 63,270 | Payroll detail. |
| `drs_check` | 63,216 | Check register. |
| `drs_payee` | 537 cols | Payee master — office settlements included. |

> **D-MC13:** The extraction-guide warning in `MCLEOD-SQL-SOURCE-OF-TRUTH.md` §5 stands and is
> load-bearing: settlement, payroll, checks, and GL are **four lifecycle views of one payment**.
> They must never be summed together. FuelGuard imports each as its own fact table with its
> lifecycle stage recorded, and the harness picks exactly one stage per cost question.

#### Settlement lifecycle — resolved 2026-08-26

`drs_settle_hist` carries 21 date columns. Because it is the *history* table, every row has
already completed the full lifecycle, so stage population does not discriminate. Over 20,833
rows paid in 2026:

| Stage column | Populated |
|---|---:|
| `accrual_date` | 20,826 |
| `ok2pay_date` | 20,833 |
| `pay_date` | 20,833 |
| `transfer_date` | 20,833 |
| `check_number` | 20,833 |
| `void_date` | **925** |

The discriminator is not the date — it is `is_void`:

| `is_void` | `payee_type` | `pay_method` | Rows | `total_pay` |
|---|---|---|---:|---:|
| N | C | M | 19,192 | $7,251,264 |
| **Y** | C | M | **925** | **$339,985** |
| N | O | P | 541 | $1,586,057 |
| N | C | F | 99 | $39,343 |
| N | C | S | 71 | $0 |
| N | O | F | 5 | $1,033 |

> **D-MC18:** Settlement extraction filters `is_void = 'N'`. The 925 voided rows carry $339,985
> of `total_pay` that was never actually paid — 4.4% of rows and 3.7% of company-driver cost.
> Including them silently inflates driver cost per mile.
>
> **D-MC19:** `accrual_date` is the economic date and the one CPM uses — it places cost in the
> period the work happened. `pay_date` is cash timing and belongs to cash-flow questions only.
> Import both; never let the harness choose implicitly.
>
> **D-MC20:** `payee_type` separates company drivers (`C`) from owner-operators (`O`), and the
> economics differ by an order of magnitude per row — $378 average for `C` against $2,932 for
> `O`. Owner-operator settlements bundle costs that are the carrier's own expense on a company
> truck, so the two must never be pooled into one cost-per-mile figure.

### 5.4 Other expenses

| Table | Rows | Role |
|---|---:|---|
| `voucher_hist` | 88,736 | AP vouchers — the main non-fuel expense body. |
| ~~`other_charge`~~ | 13,906 | **Moved to §5.1 — it is REVENUE.** See §5.5 finding 1. |
| `fuel_detail_hist` | 65,847 | Fuel with `reefer_cost` / `def_cost` splits. |
| `fuel_ticket_hist` | 78,213 | Fuel tickets. |

`voucher_hist` carries only `purchase_order_no` — **no tractor, no movement.** `voucher_dist` has
`tractor` and `trailer` columns and populates them on **0 of 397 rows**, so that is not a way round
it either. AP expense is unattributed at source and is exactly the category the harness allocates.

### 5.5 Four C2 findings

**1. `other_charge` is revenue, not expense — correcting §5.4 above.** Its rows are `FSC` fuel
surcharge (3,359), `DET` detention (3,329), `LUM` lumper (3,075), `TON` (2,109), `STO` stop-off and
similar, each carrying a `customer_id`, a `bill_type` and `is_taxable`. It is accessorial revenue
billed on an order. Importing it as cost would subtract the carrier's own earnings from its margin
twice. It belongs in §5.1 with loads, and is **not** part of C2.

**2. `voucher_hist` stores offsetting pairs, so a naive sum is exactly $0.00.** Each voucher has a
`D` or `R` row carrying the expense and a `P` row carrying the payment that cancels it. The first
C2 dry run reported `total: 0` across 366 June rows — a number that reads as an empty result rather
than a bug. `voucher_type <> 'P'` leaves the expense, and keeps negative `R` rows so a credit memo
still reduces cost.

**3. Accounts payable CONTAINS the fuel, at the same value.** The fuel-card vendor invoices the
carrier for the purchases `fuel_detail` already records. Three independent paths agree to the cent
on June 2026:

| Path | Amount |
|---|---:|
| `fuel_detail` `direct_amount` + `funded_amount` | $1,017,601.81 |
| GL account `20550000` (`post_module='FUEL'`) | $1,017,601.81 |
| AP vouchers described "Fuel Transactions" | $1,017,601.81 |

That is 70% of June's $1,453,255.46 of positive payables. Summing fuel and AP would count it twice.
`expenses.mjs` splits on vendor id (configurable via `MCLEOD_FUEL_VENDOR_IDS`) and the CPM figure
excludes it. **The split is approximate at the window edge** — vendor-matching gives $1,010,966.35
against fuel's $1,017,601.81, because `voucher_hist` is windowed on `invoice_date` while
`fuel_detail` is windowed on `trans_date_time`. Fine for an inventory; do not present the difference
as a reconciliation.

**4. `total_amount` is not what reconciles.** McLeod records fuel gross, then the negotiated card
discount (14.6% of gross in June — $173,972.28), then the net under `direct_amount` (1,904 of 2,259
rows) or `funded_amount` (the other 355), exactly one of which is non-zero per row.

> **D-MC21:** `settled_amount = direct_amount || funded_amount` is the only fuel figure that ties to
> the ledger. `total_amount` overstates by the discount — $173,528 in June 2026 alone.
>
> **D-MC22:** Reconcile against the **payable leg only** (`glid` `20550000`), never the whole `FUEL`
> module. The module is double-entry and nets to zero by construction, so a reconciliation against
> it would always pass and prove nothing. The payable leg has exactly one line per fuel transaction.

### 5.6 What made settlement reconcile (C3)

**One payment, two GL modules.** Every settlement row carries `accrual_module = 'SET'` and
`post_module = 'DRS'`. The work accrues under one and the cash leaves under the other — D-MC13's
"four lifecycle views" made concrete in two columns.

> **D-MC23:** Reconcile settlement on the **accrual** side: window on `accrual_date` and join
> `accrual_key` into `post_module = 'SET'`. The accrual posts exactly one payable line per settlement
> — 2,751 keys to 2,751 lines in June 2026. The payment side fans out across cash and clearing
> accounts and cannot be matched one to one. Windowing on `pay_date` while reconciling against the
> accrual ledger compares two different months.
>
> **D-MC24:** `orig_posted_pay` is the figure that ties to the ledger; `total_pay` is the figure cost
> per mile uses. They are not the same and both must be imported. June 2026: $1,262,893.74 posted
> against $1,268,565.31 paid. The $5,671.57 gap is real money reaching owner-operators after the
> accrual posted — report it, never reconcile it away.

Two smaller traps, both of which fail a reconciliation that is actually exact:

- **14 of June's 2,765 rows are zero-value** and post no ledger line at all. Counting them as
  unmatched breaks an otherwise perfect tie.
- **The ledger query needs its own date bound, wider than the settlement window.** A settlement
  accrued on the last day of the window can post a day or two later, so an equal bound drops real
  lines; with no bound at all the optimiser abandons the `transaction_date` index and scans 733k
  rows — the first version of that query timed out after four minutes. Fourteen days either side.

**No live/`_hist` union here.** `drs_settle` does not exist; this domain has a history table only.
D-MC11 does not apply and its absence is not a defect to be fixed.

### 5.7 The coverage report, and the number in it that must not be misread (C4)

June 2026, every posting module in the window:

| Module | Lines | One-sided value | Sweep | Drift |
|---|---:|---:|---|---:|
| `GJ` | 202 | $5,432,913 | — | — |
| `BILL` | 3,420 | $5,216,146 | — | — |
| `CASH` | 2,100 | $4,096,957 | — | — |
| `AP` | 893 | $2,770,827 | — | — |
| `DRS` | 7,187 | $2,067,340 | — | — |
| `SET` | 5,788 | $1,390,599 | `settlements.mjs` | −$127,706 |
| `FUEL` | 8,196 | $1,191,574 | `expenses.mjs` | −$173,972 |
| `RJ` | 77 | $766,435 | — | — |
| `OFF` | 318 | $222,050 | — | — |
| `SETV` | 270 | $118,642 | — | — |
| `WIRE` | 718 | $89,056 | — | — |
| `DED` | 240 | $9,100 | — | — |
| `MISC` | 12 | $4,200 | — | — |
| `DEDV` | 6 | $115 | — | — |

**One-sided value is half the absolute sum.** Double-entry books every posting twice, so the signed
sum of a complete module is exactly zero — reporting that would show $0.00 for a month in which the
carrier spent millions.

> **D-MC25 — `throughputCoveragePct` is a breadth signal, never a cost ratio.** June's figure is
> 11.05%, and reading it as "FuelGuard sees 11% of the carrier's costs" would be badly wrong. The
> denominator counts the same dollars several times over, because **the modules are lifecycle views
> of one payment — D-MC13 at module scale**. Demonstrated within this dataset: `SET` is the accrual
> of the settlements that `DRS` then pays; `AP` contains the fuel-card invoices `FUEL` already booked,
> agreeing to the cent at $1,017,601.81; `CASH` is the bank side of most of the rest. A genuine cost
> total counts each dollar once, which means choosing one lifecycle stage per dollar — a finance
> exercise for the harness with sign-off, not an extraction output.

**Drift is reported, not asserted away.** A module's one-sided value is not the same quantity as a
subledger's reconciling figure and is not expected to match. `FUEL` moved $1,191,574 while the fuel
payable — the leg with one line per purchase — was $1,017,602; the $173,972 gap is the card discount
posting through its own accounts, which C2 already measured. `SET`'s −$127,706 is accrual timing:
the module contains postings for settlements accrued outside the extraction window.
`reconcileFuelToLedger` and `reconcileSettlementToLedger` remain the authorities on whether a domain
actually ties, because they compare per key. This report is about breadth.

**`OFF` — office settlements — has no subledger at all.** $222,050 in June, 318 lines, posted
straight to the ledger. It is office payroll, bonuses and staff reimbursements, and the only
description is a 40-character free-text `descr`: "ARKADZIO, Office Payroll", "AVACELIL, Zelle Koni's
salary (2wk) re", "BIGRIG, Towing (truck # 506) reimbur". The ledger line IS the record, so
`OFFICE_SETTLEMENT_LINES` imports it as one and carries `descr` verbatim.

Note the truck numbers inside that free text — the same pattern that puts repair vouchers into
accounts payable (§5.5). They are **not parsed**. A unit number scraped from an abbreviated,
40-character-truncated note is a guess, and D-MC12 forbids the extraction layer from asserting an
attribution McLeod does not make itself.

**`gl_ledger` and `gl_ledger_hist` differ by a rename, and their ranges are disjoint.** The free-text
note is `gl_comments` live and `comments` in history; neither is selected. Live covers 2024-01-01 to
2026-08-14 and history 2016-01-01 to 2023-12-31 — a year-end archive rather than the
working/completed split that moves a fuel row the moment it posts. A 2026 window touches only the
live table; the union exists so a historical window still works.

### 5.8 What the CPM harness is, and what it refuses to do (C5)

C1–C4 extract: McLeod decides the answer and the ledger proves whether we read it correctly, which
is why each of those can say "$0.00 difference" and mean it. **C5 allocates, and allocation has no
ground truth in the source.** No query reveals what share of an insurance premium belongs to truck
1234.

So the harness optimises for auditability rather than accuracy. Direct cost is measured; allocated
cost is a policy; the two are never merged into one number, and every run emits a caveat list
generated from what actually happened in it.

> **D-MC26 — the default rules are deliberately understated and known to be.** `overheadBasis`
> defaults to `none`: until finance signs an allocation rule, no overhead is assigned to any truck
> and the whole pool is reported as excluded. A figure that is too low, with the shortfall stated, is
> safe to price against in a way that an invented allocation is not.
>
> **D-MC27 — which figure each cost uses is a decision, not a detail.** Fuel uses `settled_amount`
> (D-MC21), not `total_amount`, which would overstate it by the card discount. Settlement uses
> `total_pay`, not `posted_pay`, which is the accrual the ledger recorded and a reconciliation
> figure rather than a cost (D-MC24). Both are pinned by tests that fail if the other column is read.
>
> **D-MC28 — cost McLeod could not place on a truck is excluded and counted, never spread.**
> Silently distributing it across trucks that happen to carry an id would inflate every one of them
> with money the source never attributed.

The rules are `deadhead` (`estimate` | `exclude`), `overheadBasis` (`total_miles` | `loaded_miles` |
`equal_per_truck` | `none`), `includeOwnerOperators`, and `overheadAccounts`. Changing the basis
moves the fleet figure from 116.4¢ to 198.7¢ without touching a single extracted fact — which is
precisely why the rule belongs in configuration and in the report's own output.

### 5.9 The deadhead bug that only live data could catch (C5)

The first end-to-end run produced **2,257,083 deadhead miles against 1,694,429 loaded — 133%**,
where §4.2's independent SQL measurement said 3.95%. Every unit test passed.

`inferDeadheadLegs` sorted a tractor's movements by `settled_at`. But `xfer2settle_date` is a
**batch** timestamp: measured 2026-08-26, **2,226 of 3,165 consecutive movement pairs on the same
tractor — 70.3% — share it to the second.** Within a batch the order is arbitrary, so the chain
paired a delivery in Georgia with a pickup a week earlier in Tennessee and called the gap deadhead.

Fixtures could not catch it. A test fixture with distinct timestamps sorts correctly under the bug
and under the fix; only real data has the ties.

> **D-MC29:** Chain movements by when the truck actually finished them — the last delivery's
> `departed_at`, falling back to its `arrived_at` — never by settle date. A movement with no
> delivery time (12 of June's 3,337) is skipped rather than placed arbitrarily; skipping shortens
> the chain and understates deadhead, which is the safe direction for a floor.

After the fix: **59,731 miles, 3.52% of loaded**, against the 3.95% the C1 SQL probe measured by a
different method. Two independent routes to the same answer is the check that matters here; a
regression test now pins the batch-timestamp case with identical settle dates and reversed trip
order.

---

## 6. Change detection

The roster handoff (§5.3) chose full-table hash diff over the ~589 active roster rows. That does
not scale to 296k movements and 2.5M GL lines.

**Constraints measured:**

- No `rowversion` columns on these tables.
- Change Tracking is enabled on 91 tables with 10-day retention, but the current login is denied
  `VIEW CHANGE TRACKING`.
- `audit_log` has 45,546,200 rows and is dominated by a driver heartbeat field.

**Landmine:** `MAX(stop.actual_departure)` is **2215-03-12**. McLeod uses far-future sentinel
dates for unset values. A naive `WHERE date > @watermark` will either sweep sentinel rows in
forever or, if the watermark is set from `MAX()`, advance to the year 2215 and never return a
row again.

> **D-MC14:** Transactional domains use a **bounded-window re-read**, not a high-watermark:
> re-read a trailing N-day window on a settlement/post date column each cycle and diff by hash,
> plus a periodic full-period reconciliation against the GL control total. Never derive a
> watermark from `MAX()` of a column that can hold sentinel dates. Request `VIEW CHANGE TRACKING`
> in production as an optimisation, never as the only recovery path.

---

## 7. Open questions

**Resolved 2026-08-26 by measurement — no longer blocking:**

1. ~~Loaded vs empty miles.~~ **Answered (§4.1, §4.2).** `move_distance` is loaded miles; empty
   miles are recorded nowhere but are inferable from stop coordinates, which are 100% populated.
   Deadhead is ~4–5% of loaded miles. D-MC15, D-MC16.
2. ~~`move_distance` vs `fuel_distance`.~~ **Answered (D-MC15).** `move_distance`, declared `MI`,
   is the basis; `fuel_distance` is a 0.36% cross-check. Separately, `billed_distance` is
   disqualified as a denominator — D-MC17.
3. ~~Which settlement lifecycle stage is "cost".~~ **Answered (D-MC18, D-MC19, D-MC20).**
   Filter `is_void='N'`, use `accrual_date` as the economic date, and keep `payee_type` `C` and
   `O` in separate pools.

**Remaining, and worth confirming with the carrier's finance team — but these refine the harness
rather than block extraction:**

1. Should deadhead use the great-circle estimate, or the `in_state_distance` city-pair road
   mileage where the pair is cached? The latter is more accurate and less complete.
2. Do owner-operator settlements (`payee_type='O'`) belong in fleet CPM at all, or only in a
   separate contractor-cost view?

**Blocking production (carrier/DBA, not engineering):**

4. Production `lme` access for a dedicated read-only login with a column allowlist — not
   `db_datareader`, which exposes SSNs and credentials.
5. Trusted TLS certificate and hostname; the sandbox currently connects unencrypted because the
   server presents a self-signed fallback.
6. `VIEW CHANGE TRACKING` grants on the transactional tables.
7. Confirmation that production schema matches this sandbox.

---

## 8. Execution order

Each step is one PR, gated on `pnpm test` green.

- **C1. — SHIPPED 2026-08-26.** `MOVEMENT_FACTS` / `MOVEMENT_STOPS` / `MOVEMENT_FACT_COUNTS` in
  `tools/mcleod-agent/queries.mjs`, the sweep and dry run in `tools/mcleod-agent/movements.mjs`
  (`npm run movements -- <start> <end>`), and the neutral contract plus the deadhead estimator in
  `packages/shared/src/tmsCost/movementFact.ts`.

  Dry run over June 2026, client-side summary matching the server-side aggregate exactly:

  | Measure | Value |
  |---|---:|
  | Movements | 3,337 |
  | Duplicated movement rows | **0** |
  | Tractors resolved via `equipment_group_id` | 159 |
  | Movements with no tractor | 13 |
  | Team-driven movements | 58 |
  | Loaded miles | 1,694,429 |
  | Fuel miles | 1,700,597 (+0.36%, matching the fleet-wide figure) |
  | Stops | 6,966, **0** missing coordinates |

  Two traps surfaced during implementation and are pinned by the query comments: drivers are not
  1:1 with a movement (58 team trips in June alone, which a naive join would emit twice and
  double-count), and `movement.status = 'V'` marks 41 voided trips in 2026 whose miles were never
  run.
- **C2. — SHIPPED 2026-08-26.** `FUEL_PURCHASES` / `FUEL_LEDGER_LINES` / `AP_VOUCHERS` in
  `queries.mjs`, the sweep and reconciling dry run in `tools/mcleod-agent/expenses.mjs`
  (`npm run expenses -- <start> <end>`), contracts and the reconciler in
  `packages/shared/src/tmsCost/fuelFact.ts` and `expenseFact.ts`.

  **Fuel reconciles exactly.** June 2026: 2,259 purchases, 153 tractors, 44 states, 226,351 tractor
  gallons plus 1,419 reefer and 9,774 DEF. Gross $1,191,130.34, discount $173,972.28,
  **settled $1,017,601.81 against a ledger payable of $1,017,601.81 — difference $0.00**, nothing
  unmatched in either direction. Payables: 183 vouchers, $432,241.17 of genuine other expense.

  Four findings, each of which would have produced a wrong number rather than an error — see
  §5.5 below.
- **C3. — SHIPPED 2026-08-26.** `SETTLEMENTS` / `SETTLEMENT_LEDGER_LINES` / `SETTLEMENT_DEDUCTIONS`
  in `queries.mjs`, the sweep and reconciling dry run in `tools/mcleod-agent/settlements.mjs`
  (`npm run settlements -- <start> <end>`), contract and reconciler in
  `packages/shared/src/tmsCost/settlementFact.ts`.

  June 2026 accrual window: 2,765 settlements across 149 tractors — 2,690 company-driver rows at
  $1,024,286.08 and 75 owner-operator rows at $244,279.23. **Posted pay $1,262,893.74 against a
  ledger payable of $1,262,893.74 — difference $0.00**, nothing unmatched. Deductions: 1,342 rows,
  $378,247.90, of which 548 carry a tractor.

  See §5.6 for the four decisions that made it reconcile.
- **C4. — SHIPPED 2026-08-26.** `GL_CONTROL_TOTALS` and `OFFICE_SETTLEMENT_LINES` in `queries.mjs`,
  the coverage report in `tools/mcleod-agent/ledger.mjs` (`npm run ledger -- <start> <end>`), and
  `buildLedgerCoverageReport` in `packages/shared/src/tmsCost/ledgerControl.ts`.

  June 2026: 14 posting modules, $23,375,954.60 of ledger throughput, of which two modules
  ($2,582,173.47) have a sweep behind them. Drift is reported per module rather than asserted to
  balance — `FUEL` shows −$173,972.30 and `SET` −$127,705.62, both explained below.

  The report runs the fuel and settlement sweeps live rather than trusting a stored expectation, so
  a coverage claim cannot outlive the sweep that produced it.

  See §5.7.
- **C5. — SHIPPED 2026-08-26.** `computeCpm` in `packages/shared/src/tmsCost/cpmHarness.ts`: pure,
  no clock, no I/O, allocation rules passed in rather than baked in.

  June 2026 under the default rules: 159 trucks, 1,694,429 loaded miles plus 59,731 estimated
  deadhead, $1,017,601.81 fuel and $1,024,286.08 company-driver settlement — **116.4¢/mi direct**.
  A further $1,443,207.52 of overhead is deliberately left unallocated (about 82.3¢/mi if spread by
  miles), and the report says so in its own caveat list.

  See §5.8 for what the harness is and is not, and §5.9 for the bug the live run caught.

Explicitly **not** in scope: maintenance (FleetPal), any write to McLeod, and any allocation
rule baked into the extraction layer.
