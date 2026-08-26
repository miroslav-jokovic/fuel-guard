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

Two consequences:

1. **`move_distance` is the denominator**, with `fuel_distance` as a cross-check. The 0.38%
   spread is small enough to treat as a data-quality alarm threshold rather than a modelling
   choice.
2. **Loaded-vs-empty CPM cannot be computed from `movement`.** Both manifest columns are empty.
   The loaded/empty split must come from `in_state_distance` (597,956 rows) or be derived from
   stop sequences. This is unresolved and is the largest open question in §7.

`in_state_distance` additionally gives per-state miles, which serves both CPM and an IFTA
cross-check against the existing `fuelTax` logic.

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
| `stop` | 610,081 | Stop sequence, locations, actual times. |
| `in_state_distance` | 597,956 | Per-state miles per movement. |
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
tractor column exists.

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

### 5.4 Other expenses

| Table | Rows | Role |
|---|---:|---|
| `voucher_hist` | 88,736 | AP vouchers — the main non-fuel expense body. |
| `other_charge` | 13,906 | Accessorials, with `order_id`, `driver_id`, and loaded/empty units. |
| `fuel_detail_hist` | 65,847 | Fuel with `reefer_cost` / `def_cost` splits. |
| `fuel_ticket_hist` | 78,213 | Fuel tickets. |

`voucher_hist` carries only `purchase_order_no` — **no tractor, no movement.** AP expense is
therefore unattributed at source and is exactly the category the FuelGuard harness will
allocate.

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

**Blocking correctness (must answer before the harness is trusted):**

1. **Loaded vs empty miles.** Both manifest columns are zero. Can the split be derived from
   `in_state_distance`, or from `stop` sequence + `movement_order`? Without this, CPM cannot
   separate loaded and deadhead cost.
2. **`move_distance` vs `fuel_distance`.** Which does the carrier's finance team consider
   authoritative? They differ by 0.38%.
3. **Which settlement lifecycle stage is "cost"?** Per D-MC13 — accrual, ok2pay, paid, or
   transferred? `drs_settle_hist` carries 21 distinct date columns.

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

- **C1.** Extraction queries for **loads** (`movement`, `orders`, `movement_order`, `stop`,
  `in_state_distance`, `equipment_item` bridge) in `tools/mcleod-agent/queries.mjs`, plus a
  neutral loads contract in `packages/shared`. *Done when:* a dry run reports movement counts
  and total `move_distance` for a bounded window, and the `equipment_group_id` bridge resolves
  a movement to a tractor unit number.
- **C2.** **Fuel and other expenses** — `fuel_detail_hist`, `fuel_ticket_hist`, `other_charge`,
  `voucher_hist`, live `UNION ALL` `_hist` per D-MC11. *Done when:* extracted fuel reconciles to
  the `FUEL` GL module total for the same window.
- **C3.** **Settlement** — `drs_settle_hist` and siblings, each as its own lifecycle-tagged fact
  table per D-MC13. *Done when:* settlement reconciles to the `SET` + `DRS` GL modules.
- **C4.** **GL control totals** — `gl_ledger` + `gl_ledger_hist` by `post_module` and `glid`,
  imported for reconciliation only. *Done when:* a recon report shows subledger-vs-GL drift
  per module.
- **C5.** **CPM harness** in `packages/shared` — pure functions over the imported facts, with
  allocation rules as explicit configuration. Depends on §7 questions 1–3 being answered.

Explicitly **not** in scope: maintenance (FleetPal), any write to McLeod, and any allocation
rule baked into the extraction layer.
