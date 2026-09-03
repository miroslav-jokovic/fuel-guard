# Finance go-live — from "proven once" to "precise every month"

**Status:** SUPERSEDED IN SCOPE 2026-09-03 by
[FINANCE-FLEET-REPORT-PLAN](./FINANCE-FLEET-REPORT-PLAN.md). This document remains the record of
the correctness programme — D-FIN1 through D-FIN15, all built and merged, and every one of them
still holds. What no longer holds is its §4 queue and its §6 collector inventory: the owner ruled
that Finance is a FLEET report, so per-truck attribution, the fixed-cost schedule, FleetPal, the
toll collector, jurisdictional allocation and the overhead basis are out of scope rather than
pending, and the 2026-07-01 reporting era moves back to 2026-01-01 because Finance no longer reads
EFS. Read the fleet plan for what is being built; read this one for why the numbers can be trusted.

**Original status:** ACTIVE — audit complete, nothing built yet. **Owner:** Miki. **Written:** 2026-09-03,
from a read-only audit of the collectors, the store, the harness, the Finance pages and the
production database. **Parent:** [TRUCK-COST-ATTRIBUTION-PLAN](./TRUCK-COST-ATTRIBUTION-PLAN.md)
(T1–T7, R1–R6) and `docs/plans/mcleod/FINANCIAL-STORE-PLAN.md` (D-FS1..8). This plan does not
replace either; it records what the audit found between them and decides every open item.

The goal this plan serves, in the owner's words: *when we connect to live McLeod we have
everything production ready and 100% precise, accurate and reliable* — revenue per mile per
truck, spend per mile per truck, and what is left per mile per truck.

**Revised 2026-09-03 (second pass), on two owner rulings that change the shape of this plan:**

- **D-FIN16 — the reporting era starts 2026-07-01.** July 2026 is month one. Nothing before it is
  reported to the bosses, nothing before it has to tie, and no step is blocked on repairing a month
  that will never be shown. June stays as the *proof* month (it is the month whose figures were
  reconciled by hand on 2026-08-28 and is therefore the regression fixture), but it is a test
  fixture from here on, not a deliverable.
- **D-FIN17 — org-level precision first, per-truck precision second.** The bosses' question is
  "did the company make money this month, and where did it go". That question is answerable *today*
  to the cent (§0.1 proves it), and it is answerable without FleetPal, without a toll feed and
  without the deduct-code taxonomy. Per-truck precision is the second deliverable, not the first,
  and the steps are ordered by the dollars they move rather than by the elegance of the attribution.
  A step that argues over 0.7% of the money does not precede a step that fixes 26% of it.

Consequence for §4: the execution order below is re-sorted, and the work is re-expressed as a
**collector and classification programme (the C-series)** rather than as harness work. The harness
is largely built and is not the constraint. What is missing is *data that is collected but not
posted*, *data that is posted but not classified*, and *data that nobody collects at all* — §6
enumerates all three, exhaustively, against the July 2026 income statement.

**Rule of this document: no open questions.** Every item below ends in a decision (`D-FIN*`) or
a proposed ruling with a recommended answer. Where a decision is the owner's to sign (the R-series),
the recommendation is written in full so signing is a yes/no, not a research task. A question left
open is a defect of this plan and gets fixed here, not in a chat.

---

## 0. Position, measured 2026-09-03

Measured against production (`supabase db query --linked`), the sandbox notes in
`HANDOFF-2026-08-28.md`, and the code at `origin/main` 7f154c6.

| Fact | Measurement |
|---|---|
| Last McLeod sweep into production | **2026-08-28 21:02 UTC**, one manual run; every `mcleod_*` staging table has that stamp |
| Finance commits since | none after 2026-08-29 (page tabs only) |
| `mcleod_movements` / `_settlements` / `_deductions` / `_ap_vouchers` / `_billing` | 23,072 / 20,693 / 10,158 / 1,464 / 11,722 rows |
| `mcleod_gl_totals` | 1,421 rows, months 2025-12 → 2026-08 |
| `mcleod_office_lines` | **0 rows** (deployed 0276, never backfilled) |
| `truck_cost_schedules` | **0 rows** (fixed costs ≈ $573k/month absent from every report) |
| `financial_entries` | 49,530 (nightly projection running; 14,774 canonical EFS fuel rows from 2026-01-01) |
| `samsara_ifta_jurisdiction_miles` | 24,586 rows through 2026-08 — the denominator is live and current |
| `efs_window_refetch` job | **FAILED** 2026-08-28 17:25, `numeric field overflow`, 1 of 3 windows; never retried |
| Rulings R1–R5 | all still `(pending)` in `COST-RULING-WORKSHEETS.md` |

What that means in one sentence: the pipeline is built and was proven to the cent for June 2026,
but it is fed by hand, two of its inputs are empty, one repair job failed silently, and the
proof has never been re-run.

**EFS canonical fuel against McLeod's fuel expense account (40050000), by month:**

| Month | GL 40050000 | EFS canonical | EFS − GL |
|---|---:|---:|---:|
| 2026-01 | 592,760 | 635,980 | +43,220 |
| 2026-02 | 609,483 | 639,474 | +29,991 |
| 2026-03 | 910,964 | 990,050 | +79,086 |
| 2026-04 | 989,259 | **621,104** | **−368,155** |
| 2026-05 | 1,051,183 | **925,026** | **−126,157** |
| 2026-06 | 899,742 | 963,725 | +63,983 |
| 2026-07 | 972,821 | 1,024,356 | +51,535 |

Two facts in that table: April and May are missing the fuel the failed refetch was queued to
bring (D-FIN2), and every complete month runs 5–8% ABOVE the GL account, which nothing in code or
plans explains yet (D-FIN12). January, which the vendor guide left unmeasured, IS reachable —
1,971 fills landed — so the "McLeod-copy fuel staging for January" fallback is not needed.

---

## 0.1 July 2026, measured 2026-09-03 — the month the reporting era starts

Every figure in this section came from `supabase db query --linked` against production staging on
2026-09-03, and was checked line by line against the owner's printed `PROFIT LOSS JULY 2026.pdf`
(McLeod Income Statement + Balance Sheet, printed 2026-08-20 09:59, Silvicom, Inc.).

**The staged general ledger reproduces the printed income statement to the cent.**

| | Printed P&L | `mcleod_gl_totals` |
|---|---:|---:|
| Total Revenue | 4,828,189.24 | **4,828,189.24** |
| Total Operating Expenses | 3,549,112.89 | **3,549,112.89** |
| Total General & Admin | 509,030.49 | **509,030.49** |
| Total Expenses | 4,058,143.38 | **4,058,143.38** |
| Net Income | 770,045.86 | **770,045.86** |

94 expense account/module rows, 13 revenue account/module rows. This is the single most important
measurement in this plan: **the company-level money is already complete and already ours.** Every
claim below about what is "missing" is a claim about *grain*, never about dollars.

**Where July's expense dollars sit, by the posting module McLeod used** — `mcleod_gl_totals` is
grained `(org, company, month, glid, post_module)`, and the module is what says how finely McLeod
itself can split an account (`glMonthlyCosts.ts` `GRAIN_BY_MODULE`, measured against June 2026):

| Grain | Modules | July $ | % | What it is |
|---|---|---:|---:|---|
| **per truck** | SET, SETV, FUEL, DRS, DED | 2,465,737 | **60.8%** | driver pay, owner-op pay, every EFS product, deductions |
| **company** | GJ, RJ | 1,057,724 | **26.1%** | VIP Lease 700,000 · insurance 177,208 · officer+office salaries 88,250 · payroll tax 54,415 · GPS 13,466 · IFTA/permits 22,580 |
| **per person** | OFF | 289,921 | **7.1%** | office payroll, 31 named people |
| **per vendor** | AP | 244,761 | **6.0%** | maintenance 141,000 · rent 32,050 · CPA/legal/utilities · IRP |

**Where July's revenue dollars sit:**

| Grain | Module | July $ | Route to a truck |
|---|---|---:|---|
| per truck | BILL | 4,807,522.63 (99.57%) | `mcleod_billing.tractor_unit` — populated on 1,412 of 1,415 July bills |
| per truck | DRS | 20,666.61 (0.43%) | settlement payee (equipment rental, installment sale, O/O insurance collection, detention, out-of-service) |

There is no revenue in this carrier's July that lacks a route to a truck. The earlier reading of
the printed PDF — that Equipment Rental and Installment Sale are "non-trucking revenue that can
never attribute" — was wrong: both post through DRS and carry a payee. Corrected here rather than
left standing.

**Denominators, July 2026:**

| Measure | Value | Source |
|---|---:|---|
| Samsara measured miles | 1,552,337 over **172 vehicles** | `samsara_ifta_jurisdiction_miles` |
| McLeod loaded miles | 1,336,507 over 2,634 movements | `mcleod_movements` (tractor on 2,614 of 2,634) |
| Billed distance | present on 1,415 of 1,415 bills (`distance`) | `mcleod_billing` |
| Trucks with billing | 160 | `mcleod_billing` |

Samsara runs 16% above McLeod loaded miles, which is deadhead, and is the reason `total_miles`
is the recommended overhead basis (R1).

**Therefore the org-level answer already exists, today, with no new integration:**

> **July 2026 — earned $3.11/mile · spent $2.61/mile · kept $0.50/mile.**
> $770,045.86 net on 15.9% margin, $4,477 net per truck per month over 172 measured trucks.

**Two data-quality facts found in the ledger itself while measuring the above:**

- `40790002 Tolls OO` is typed **`Income Tax Expense`** in McLeod's own `gl_account` master, as is
  `40220002 "2290 OO"` (heavy-highway-use tax, IRS form 2290). Both are operating costs. McLeod's
  own P&L sectioning therefore misfiles real expenses, and the account→family catalogue (C6) must
  be keyed on the account CODE and signed, never derived from McLeod's section or from `descr`.
  `descr` cannot be a key either: it is truncated to 28 characters, so three distinct revenue
  accounts all print as `Gross Trucking Income` and two expense accounts print as
  `Subcontracted Labor: Bonus`.
- `glIncome.ts` classifies on `type_id` against `PNL_REVENUE_TYPES` / `PNL_EXPENSE_TYPES`
  (`ledgerControl.ts:65-66`). Four staged accounts carry `type_id = 'Other Expenses and Losses'`
  (Driver Road Expenses, Theft, State Tax, Payroll Tax Adj) and one carries
  `'Other Revenue and Gains'` (Investment Gain/Loss). A known-but-unlisted type matches neither set
  and falls through all three branches — **silently dropped, not even counted in
  `unclassifiedNet`**, which only catches `type == null`. Zero dollars have posted to those five
  accounts in any staged month, so this is latent, not live. C7 fixes it.

**One finding for the accountants, not for the code:** the printed July balance sheet does not
foot. Total Assets $19,387,472.49 against Total Liabilities & Equity $19,021,729.85 — **out by
$365,742.64**. Every subtotal on the page adds correctly and net income agrees with retained
earnings, so the gap is inside McLeod's balance sheet, not in the printing. Raised because a
balance sheet that is out by a third of a million says some account is misposted, and that account
may be one the income statement uses.

---

## 1. Findings and decisions

Each finding is measured (file:line or a query). Each decision names the step that implements it
and what "done" means. Severity order: a wrong number in front of the owner first, then a number
that goes missing, then operations, then presentation.

### 1.1 Fixed costs will be charged twice the day the schedule is filled — **D-FIN1**

`cpmHarness.ts:268` computes the overhead pool as `GL expenses − direct fuel − direct pay −
owner-operator pay`. Lease, insurance and GPS (T1's schedule categories) are INSIDE the GL
expense total, so once `truck_cost_schedules` carries them they are charged per truck by
`fixedCost` (`:313`) AND left in the pool that is spread by miles. Latent today only because the
table has 0 rows. No test combines a GL anchor with a schedule (`cpmHarness.test.ts:592-645`).

> **D-FIN1:** The pool is `GL expenses − attributed direct − owner-operator pay − Σ scheduled
> fixed cost charged in the window`. The schedule is attributed cost, and attributed cost leaves
> the pool — the same rule fuel and pay already follow. The caveat prints, per schedule category,
> the schedule total beside the GL line it stands for (VIP Lease ≈ $400k, Insurance ≈ $165k, GPS
> ≈ $12k): a schedule below its line leaves the difference in the pool (stated), a schedule ABOVE
> its line is a data-entry error and is refused into the pool as a negative, exactly as the
> negative-remainder guard already refuses over-attribution.

**Step F1.** Harness change + a test whose fixture carries a GL total AND a schedule and asserts
the pool shrank by the schedule. Mutation-test it: remove the subtraction, the test must fail.
**Done when:** with June's schedule entered, all-in cost per mile moves by the schedule's ¢/mi
exactly once, and `Σ truck (direct + fixed + allocated) + pool + O/O pool == GL expenses` to the
cent (this is D-FIN11's invariant, which F1 introduces).

### 1.2 April–May fuel is missing and the repair failed silently — **D-FIN2**

The job `efs_window_refetch` (payload: 2026-04-18→05-05, 05-06→05-19, 01-01→02-04) failed with
`numeric field overflow` on one window and stayed `failed` for six days. `fuel_transactions`
carries `gallons numeric(8,3)`, `total_cost numeric(10,2)`, `computed_mpg numeric(6,2)`,
`odometer numeric(10,1)` (`0003_core_tables.sql:108-120`). The fill values cannot overflow those;
a DERIVED value can — `computed_mpg` above 9,999.99 from a near-zero gallons line, or
`miles_since_last` from an odometer reset. A derived advisory field must never cost the fill it
was derived from.

> **D-FIN2:** (a) Derived-at-ingest fields (`computed_mpg`, `miles_since_last`) are range-checked
> before write and stored as `null` with the fill's existing scoring path noting "implausible";
> the fill itself always lands. (b) A page whose insert throws is retried row-by-row and the
> offending row is written verbatim to the import's `rejects` (JSONB on `imports`, no new table)
> with the Postgres error text — so a bad row costs one row, never a window. (c) The failed job is
> re-queued with the same three windows after (a) ships; the window that returned rows is
> idempotent by file hash and no-ops.

**Step F2.** Ingest guard + rejects + re-queue (owner runs the one-line dispatch, as for R6).
The re-queue is one statement in the Supabase SQL editor, after the guard has deployed (the claim
rule of 0095 takes `queued` rows whose `run_after` has passed):

```sql
update jobs set status = 'queued', attempts = 0, error = null, locked_by = null,
  lease_expires_at = null, started_at = null, finished_at = null, run_after = now()
where kind = 'efs_window_refetch' and status = 'failed';
```

**Done when:** April and May canonical fuel sit inside the band the complete months show
(D-FIN12 names the band), the job reads `done`, and `rejects` lists the row that overflowed with
its reason.

### 1.3 Nobody is told when the money stops arriving — **D-FIN3**

Financial ingest routes never call `touchLastSynced` (`routes/tmsIngest.ts:148,174,191` do it for
roster only), so the Integrations page cannot say when staging last landed; a failed
`financial_projection` or `efs_window_refetch` job is visible only in the `jobs` table. The
reports therefore cannot tell "this month is complete" from "the sweep stopped three weeks ago".

> **D-FIN3:** Every financial ingest endpoint stamps `last_synced_at` under a `mcleod_financial`
> provider key. The Finance pages print "figures as of <last sweep>" in `PageHeader`. A freshness
> rule in the existing notifications module raises a finding when no financial sweep has landed in
> 26 hours or when any job of kind `financial_projection` / `efs_window_refetch` /
> `efs_soap_posted` ends `failed` — routed to the owner and to whoever holds `accounting` manage.
> Silence is a state the system reports, never a state it assumes.

**Step F3.** **Done when:** stopping the agent for a day produces a finding, and the CPM header
shows the stale date.

### 1.4 The sweep is manual, and its window is thinner than McLeod's entry lag — **D-FIN4**

`--financial` has no script, no scheduler and no README section (`agent.mjs:530-602`,
`tools/mcleod-agent/package.json`). It re-reads a trailing 45-day window; McLeod's manual GL
entries (bank statements) land ~1 month late. A late entry older than 45 days is never seen again,
and the "hardened month" concept in T7 has nothing to harden against.

> **D-FIN4:** The agent runs as a scheduled service on the carrier network (Windows Task
> Scheduler or `INTERVAL_MINUTES`), `--financial` daily, window **75 days** (lag + margin), plus
> a **hardening pass** on the 1st–3rd of every month that re-reads the two previous full calendar
> months whole. This is D-MC14's "periodic full-period reconciliation", now with a date. The agent
> gains a `financial` npm script and a README section, and its mappers, `monthsTouching` and the
> batch envelope get fixture-based unit tests (no SQL Server needed) run by `pnpm test` — the
> agent has zero tests today, and #365's backtick incident shows what CI-blind code costs.

**Step F4.** **Done when:** two consecutive days of production sweeps show without a human
running anything, and a hardening pass on the first of a month re-stamps both prior months.

### 1.5 A row voided in McLeod after its first sweep stays live forever — **D-FIN5**

The SQL filters voids out (`is_void='N'`, `void_date IS NULL`, `status<>'V'`) and the ingest
hard-codes `is_void: false` (`financialIngest.ts:62,133`), so a settlement voided on day 3 keeps
its day-1 copy in the store and in every report. Named as a follow-up in code
(`financialIngest.ts:21-25`); nothing implements it.

> **D-FIN5:** Voids are facts, so they are swept, not filtered. The queries return voided rows
> WITH their flag (`is_void`, `void_date`, `status='V'`, billing's `canceled`/`rebilled` from
> 0270), the ingest writes the flag, and the projection already treats `is_void` as non-canonical
> (D-FS1). Filtering at the source was a workaround for not carrying the flag; carrying the flag
> is the fix. No absence-diffing is needed: McLeod never deletes these rows, it marks them.

**Step F5.** **Done when:** voiding a June settlement in the sandbox and re-sweeping flips the
staged row to `is_void=true` and removes it from the CPM total on the next projection.

### 1.6 An empty GL read erases a month — **D-FIN6**

`ingestLedgerTotals` upserts what arrived, then deletes every row of the month with an older
`swept_at` (`ledgerControlIngest.ts:45-59`). Zero rows arriving (wrong company id, a transient
error, a month past the data edge) deletes the month's control totals and takes the CPM page's
"fleet truth" with them.

> **D-FIN6:** Zero rows for a month is a measurement, logged and surfaced under D-FIN3; it never
> deletes. Stale rows are removed only when at least one row for that month arrived under the new
> stamp. The two steps become one set-based RPC (the 0174/0175 pattern) so a crash between upsert
> and delete cannot leave a half-replaced month.

**Step F6.** **Done when:** posting `totals: []` for June leaves June intact and writes the
zero-row log line; a real re-post still replaces.

### 1.7 Vouchers are windowed on one date and projected on another — **D-FIN7**

The agent windows AP on `invoice_date` (`queries.mjs:450-501`); the projection reads
`distribution_date` (`financialReads.ts:113-114`, `projection.ts:99`). A voucher whose
distribution falls outside the 50-day projection window but inside the 45-day sweep is staged and
never projected until a manual `full` run.

> **D-FIN7:** One economic date per fact family, used by both sides. For AP it is the GL posting
> date, `coalesce(distribution_date, invoice_date)`: the sweep predicate and the projection window
> read the same expression, and the projection's trailing window is never shorter than the
> sweep's (both follow D-FIN4's 75 days).

**Step F7.** **Done when:** a fixture voucher with an invoice date in-window and a distribution
date out-of-window is projected on the next nightly run without `full`.

### 1.8 `company_id` is dropped at the door — **D-FIN8**

Every payload row carries McLeod's `company_id`; no staging table stores it, and identity comes
only from the ingest token (`routes/tmsIngest.ts:76-84`). `dbo.company` holds four entities
(TMS, TMS2, TMS3 plus one more); whether McLeod ids are unique per instance or per company is
unmeasured, and T7's tie-out has to be per legal entity because the GL is.

> **D-FIN8:** Staging tables gain `company_id` (new column, shipped one merge ahead of its
> readers per the deploy window), the unique key becomes `(org_id, company_id, external_id)`, the
> agent already sends it, and every tie-out (ledger coverage, T7) runs per company. A token maps
> to one org; the row says which books it belongs to.

**Step F8.** **Done when:** a TMS2 row and a TMS row sharing an `external_id` both exist, and the
June tie-out reports TMS alone at the figures HANDOFF-2026-08-28 recorded.

### 1.9 Three clocks, no carrier time zone — **D-FIN9**

McLeod `datetime` values are exported as local wall time and stamped `Z`
(`settlements.mjs:41-43`, `billing.mjs:39-42`, `ledger.mjs:61`); EFS `fueled_at` is a true
instant; Samsara reports by its own calendar month; API windows are `YYYY-MM-DD` compared to
`timestamptz` at UTC midnight. A Chicago fill at 23:30 on the 31st is next month's fuel; a
McLeod settlement at 23:30 is this month's. Month edges bucket differently per source, and the
error is invisible because it is small and self-cancelling — until a tie-out is asked to hold to
the cent.

> **D-FIN9:** The organisation carries one IANA time zone (`orgs.timezone`, default
> `America/Chicago` for this carrier), and every Finance window is a local calendar window.
> The agent stops appending `Z` and emits McLeod datetimes as local time with the org offset
> (SQL Server 2019 `AT TIME ZONE` on the query side, so the conversion is the database's, not
> ours). The API resolves `from`/`to` to instants in the org zone before querying, and the
> projection stamps `occurred_at` as the true instant. Samsara's monthly rows are kept as Samsara
> states them, and the caveat says so — that is the one clock we do not own.

**Step F9.** **Done when:** a fixture fill at 23:30 local on the last day lands in that month
on the ledger, the CPM page and the coverage claim alike.

### 1.10 A truck with cost and no measured miles prints $0.00 per mile — **D-FIN10**

Under the Samsara basis a truck with fuel or pay but no Samsara miles gets `totalMiles=0` and
`cents()` returns 0 (`cpmHarness.ts:39-40, 303-336`); the table prints 0 miles and **$0.00 /
mile** and only the collapsed explainer says "not computed". Its cost stays in the fleet
numerator while its miles are absent from the denominator (`:283-292`), skewing the fleet figure
up. A plausible wrong number is the failure mode this whole program exists to prevent.

> **D-FIN10:** Per-mile fields become `number | null`; `null` means "no measured miles", never
> 0. The page prints "—" with the hover "no Samsara miles this month" and the row sorts last.
> The fleet ¢/mi is computed over MEASURED trucks only; the cost sitting on unmeasured trucks is
> its own printed line ("$X on N trucks without measured miles") so it is neither hidden nor
> smeared. Owner-operator units without devices are the known case (June: Samsara 7.8% below
> loaded) and this is where that caveat lives.

**Step F10.** Contract change + harness + page. **Done when:** a fixture truck with $1,000 of fuel
and no miles shows "—", the fleet figure excludes it, and the separate line shows $1,000 on 1
truck.

### 1.11 Allocations do not sum to the pool — **D-FIN11**

Each truck gets `round(pool × share)` (`cpmHarness.ts:312`) and the fleet reports the whole pool
(`:349`); the residual cents vanish. Under `equal_per_truck` a zero-mile truck receives a share
that then divides by zero into nothing. The per-truck table and the company-total tab therefore
cannot be added up, and T7 cannot hold to the cent by construction.

> **D-FIN11:** Apportionment uses the largest-remainder method so `Σ allocated == pool` to the
> cent, every time. `totalCpm` derives from the summed dollars, not from summed rounded ¢/mi. The
> harness gains one invariant test, run on every report with a GL anchor: `Σ truck (direct +
> fixed + allocated) + unallocated + owner-operator pool == GL expenses` to the cent, and the
> report carries the residual (0.00 or the number). This is T7 at report grain; §1.14 makes it
> the monthly close.

**Step F11** (ships with F1). **Done when:** the invariant test passes on the June fixture and
fails when any one term is dropped.

### 1.12 EFS runs 5–8% above the GL fuel account every complete month — **D-FIN12**

§0's table. Candidates, each measurable from staged data: EFS `total_cost` includes DEF, reefer
and fees that McLeod books to other accounts (`fuel_detail` carries `def_cost`, `reefer_cost`);
McLeod posts fuel ~1 day late so month edges shift; the card discount ($173,972 in June's
`fuel_detail`) may sit in a contra account. Today the FUEL coverage claim compares a single
number to a single account and reports drift with no decomposition (`ledgerCoverage.ts:22-26`).

> **D-FIN12:** The FUEL claim becomes a decomposed tie-out: EFS canonical by product (diesel /
> DEF / reefer / fees) against the GL accounts each product posts to, by McLeod's posting month,
> with a timing term (fills in the last local day of the month vs. first posting day) and a
> discount term. Every component is a number; the residual after all named components is the
> only "drift", and the target for it is **< $1.00 per month**. Until measured, the report band
> printed for D-FIN2's done-when is the observed +5–8%.

**Step F12.** **Done when:** June's FUEL residual is decomposed into named components summing
to the observed +63,983 and the unexplained remainder is under a dollar or listed row by row.

### 1.13 Rulings that were already made by code, and comments that lie — **D-FIN13**

`cpmContract.ts:86` defaults the overhead basis to `total_miles` while
`accounting/index.ts:5-9` and `routes/index.ts:80,100` still say "unallocated until §6 Q5", and
`mcleod/index.ts:10-12` says financial ingestion "is owed to this module". D-MC26 says no default
flips without a dated ruling. The code flipped; the ruling is unrecorded.

> **D-FIN13:** §2's R1 recommendation is presented for signature; the day it is signed the
> comments are rewritten to cite it. Until then the page prints "basis: total miles (proposed,
> unsigned)" — an unsigned basis is a labelled state, not a hidden one. Stale comments elsewhere
> are corrected in the same PR; `lint:comment-claims` only checks test claims, so this is by
> hand.

### 1.14 "100% precise" has no instrument yet — **D-FIN14**

T7 (`TRUCK-COST-ATTRIBUTION-PLAN.md` §3) is the acceptance instrument and is unbuilt. Ledger
coverage displays drift but asserts nothing; the June proof of 2026-08-28 lives in a handoff
file, not in the database, and cannot be re-run without a person.

> **D-FIN14:** A monthly close. A `finance_month_closes` table (org, company, month, sweep
> stamp, GL revenue, GL expenses, attributed direct, scheduled fixed, allocated pool,
> owner-operator pool, EFS-vs-GL fuel residual, billing-vs-GL residual, residual, `status`
> `open | hardened`) written by a job after every hardening pass (D-FIN4) for months at least
> two months old. `hardened` requires every residual at 0.00; anything else stays `open` with
> the residual named and raises a finding (D-FIN3). Finance pages carry the month's status in
> `PageHeader`: "June 2026 — hardened 2026-09-02" or "August 2026 — open, McLeod still posting".
> The June figures in HANDOFF-2026-08-28 become that table's first row, and any later sweep that
> changes a hardened month's figure is a finding, not a silent update.

**Step F14.** **Done when:** June 2026 hardens to the cent from a live sweep, and July shows
`open` with its residual until McLeod finishes posting it.

### 1.15 Presentation defects that make wrong numbers likely — **D-FIN15**

Billing margin, dispatcher and GL-account tables pass `:error="null"` and show nothing on a
failed fetch (`BillingPage.vue:235,265`, `GlAccountsTable.vue:66`, `CpmOwnerOperatorTable.vue:45`);
no Finance page has a component test; "Empty miles" omits "estimated"; the CPM search box
persists onto the Contractors tab without filtering it; `/api/accounting/ledger-coverage` has no
page.

> **D-FIN15:** Every Finance table shows its error state (the shared `DataTable` already has
> one). Each Finance page gets the three component tests the web traps memo names (empty,
> error, pagination reset). Ledger coverage becomes a page, "Books check", under Finance —
> one table (the D-FIN14 close by month), the claims behind `ExplainerPanel`. The three items
> from HANDOFF-2026-08-28 ship as written there: month/week selector prorating the month's
> overhead by the week's share of McLeod billed distance and labelled *prorated*; fixed-cost
> drill-down to the 31 office people and 30 AP vendors; dispatcher rate per mile as revenue ÷
> McLeod billed distance — the rate the load was priced on, which is the right basis for a
> dispatcher even though it is the wrong basis for a truck.

---

## 2. Proposed rulings — R1 to R5, written so signing is yes/no

D-MC26 stands: no basis ships without the owner's ruling. What changes is that each ruling now
has a complete recommended answer and the reasoning. To rule, the owner appends a dated line to
`COST-RULING-WORKSHEETS.md` §Rulings; the plan step then moves.

**R1 — overhead basis (blocks T6).** *Recommend `total_miles` over Samsara measured miles.*
G&A follows activity, the denominator is already measured per truck, and the harness has run this
basis since #363 (§1.13). `equal_per_truck` punishes a truck that sat idle, which is the opposite
of what a pricing decision needs. Printed on every page as "shared costs spread by measured miles".

**R2 — deduct-code classes (blocks T3).** *Recommend no per-code table at all.* Migration 0274
already showed that the GL account a deduction posts to classifies it, and the audit's
worksheet only stalled because it tried to read meaning from code names. The four classes derive:

| McLeod account type of the deduction's `glid` | Sign | Class | CPM effect |
|---|---|---|---|
| Revenue | any | `carrier_income` | income to the owner-operator pool (already built, #363) |
| Asset / Liability | any | `pass_through` | none — a receivable being settled |
| Expense | credit (type D charged back) | `truck_cost_recovery` | subtract from the charged truck; already net in the GL |
| Expense | debit (type R reimbursement) | `truck_cost` | add to the charged truck; already gross in the GL |

A deduction with no `glid` (posts nowhere) is `unruled`, excluded, and printed with its dollars.
The truck is the deduction's own `tractor` (548 of June's 1,342 carry one), else the settlement's
tractor via `settlement_external_id`, else listed as unattributed. The owner rules the DERIVATION,
once, instead of 115 codes forever — and the next code the bookkeeper invents classifies itself.

**R3 — tolls (blocks T4).** *The provider is not a question; it is a query.* Tolls sit on a GL
account whose AP vendor is staged in `mcleod_ap_vouchers.vendor_id`; the vendor on that account IS
the transponder service. Step: read it, then ask that provider for the per-transponder statement
export (Bestpass, PrePass and the E-ZPass commercial programs all provide one keyed by
transponder or plate). Until it lands, tolls stay in the pool under R1's printed basis with the
line "tolls $X spread by miles — provider export pending". No allocation of a toll to a truck by
miles is ever labelled as measured.

**R4 — jurisdictional accounts (blocks T2).** *Rule IN all eleven listed accounts* (IRP, IFTA,
OR, NM ×2, KY, CT, ID, NY ×2, HUT). *Rule `40200000 Business Licenses and Permit` OUT of T2*: it
is per-unit plating and permits, which belong to T1's schedule under category `permit` when the
office enters them from the registrations, and stay in the pool until then. Its 2026 negative net
is refunds and stays in the pool as the credit it is. T2's allocation key is each truck's share of
`samsara_ifta_jurisdiction_miles` in that jurisdiction-month; a truck with no miles in a state
gets $0 from that state (D-FS5).

**R5 — FleetPal (blocks T5).** *Owner action: an API key and one sample export.* The collector
is designed now so the key is the only wait: a `fleetpal` collector module, raw work orders stored
verbatim keyed by FleetPal's work-order id, unit matched by unit number through roster's
interface, canonical for maintenance dollars (D-FS2 pattern). Dedup against McLeod AP: the
FleetPal work order's vendor invoice number, where present, is the `dedup_key` shared with the AP
voucher; where absent, the AP maintenance voucher stays canonical and the caveat lists the
overlap in dollars — never both counted, never one guessed away.

**R6 — production registration.** Done 2026-08-28; recorded here so the list is complete.

---

## 3. Live McLeod — prerequisites, each with its answer

These are the carrier/DBA items from `MCLEOD-CPM-DATA-SOURCE-SPEC.md` §7, decided.

1. **Login.** A dedicated `fuelguard_ro` login on `lme` that can read only a set of views in a
   schema the DBA owns (`silvicom.*`), one view per query the agent runs, with `social_security_no`
   and its siblings absent by construction. `db_datareader` is refused as the production shape.
   The agent's queries are already the view definitions; the DBA creates them from
   `queries.mjs` verbatim.
2. **Transport.** `MCLEOD_SQL_ENCRYPT=true` with a CA-issued certificate on the SQL Server host
   name (carrier IT). If IT cannot issue one, pin the server certificate thumbprint in the agent's
   env rather than trusting any certificate; the agent already refuses a silent downgrade.
3. **Schema parity.** Before the first live sweep, run `agent.mjs --inspect` against `lme` and
   diff its answers against the recorded sandbox set (`lint:mcleod-recon`'s expectations). Any
   difference is a plan entry before it is a query change.
4. **Parity of figures.** The first live sweep re-reads June 2026 whole. June was frozen in the
   2026-08-21 restore, so live June must reproduce HANDOFF-2026-08-28's figures (billing
   5,490,961.97; pay 1,268,565.31; loaded miles 1,694,429) or list every difference as a late
   entry with its posting date. This is D-FIN14's first close.
5. **Credential hygiene.** Rotate the `NikiAnalytics` password (outstanding since 2026-08-28) and
   stop using it for anything but the sandbox; the production login lives sealed in a
   dedicated `mcleod_credentials` table with `secretBox` envelopes — the shape ARCHITECTURE.md §2
   requires of every collector, which the McLeod agent does not have yet (it reads `.env` today).
6. **Change tracking.** Request `VIEW CHANGE TRACKING` as an optimisation only; D-FIN4's window
   re-read remains the recovery path.
7. **Data-edge behaviour.** Live `_hist` archival moves rows between tables between sweeps; the
   `UNION ALL` reads make that invisible, and F8's per-company key plus D-FIN5's void flag mean
   a moved row is the same row. The first two weeks of live sweeps run with the hardening pass
   daily instead of monthly, so any archival surprise shows up as a re-stamp, not a loss.

---

## 4. Execution order — org-level first, then per-truck, sorted by dollars moved

**Re-sorted 2026-09-03 under D-FIN16/D-FIN17.** The original order was "correctness before
operations before presentation", and it was right while the question was whether the pipeline
worked. It is now the wrong order, because the pipeline works: §0.1 shows the ledger tying to the
printed statement to the cent. The question is now *which grain each dollar can be reported at*,
and that is a collector-and-classification question, not a harness question.

So the remaining work is re-expressed as the **C-series**. The F-series below is kept verbatim as
the record of what shipped; nothing in it is re-opened.

### 4a. F-series — the correctness programme. COMPLETE except where marked.

| # | Step | Decision | State |
|---|---|---|---|
| 1 | F1 + F11 — schedule leaves the pool; largest-remainder; invariant test | D-FIN1, D-FIN11 | BUILT |
| 2 | F2 — ingest guard, rejects, re-queue the April/May refetch | D-FIN2 | BUILT; re-queue **no longer blocking** under D-FIN16 — April/May are outside the reporting era |
| 3 | F10 — null per-mile, measured-only fleet figure | D-FIN10 | BUILT |
| 4 | F6 — zero rows never delete; one RPC | D-FIN6 | BUILT (F6a + F6b) |
| 5 | F3 — last-synced, "as of", failure findings | D-FIN3 | BUILT |
| 6 | F4 — scheduled agent, 75-day window, hardening pass, agent tests | D-FIN4 | BUILT; **Task Scheduler entry owed to the owner** |
| 7 | F5 — voids swept with their flag | D-FIN5 | BUILT; **F5b owed** (AP void column, billing cancel vocabulary) |
| 8 | F7 — one AP date | D-FIN7 | BUILT |
| 9 | F8 — `company_id` | D-FIN8 | F8a/F8b BUILT; **F8c owed** (movements-only key change) |
| 10 | F9 — one clock | D-FIN9 | BUILT; **owner runs one `financial_projection{full}`** |
| 11 | F12 — decomposed FUEL tie-out | D-FIN12 | BUILT — residual $444/month; **F12b owed** (posting-lag term, needs C1) |
| 12 | F14 — monthly close table, Books check page | D-FIN14 | BUILT; **hardening rule changes under D-FIN18, see C9** |
| 13 | F15 — error states, page tests, dispatcher rate | D-FIN15 | F15a/F15b BUILT; **owed:** month/week selector with prorating, fixed-cost drill-down |

### 4b. C-series — the collector and classification programme. This is the remaining work.

Ordered by the dollars each step moves from "pooled" to "attributed", or from "unclassified" to
"classified". §6 is the evidence for every row.

| # | Step | Moves | Kind | Blocked on |
|---|---|---:|---|---|
| **C1** | **Stage `fuel_detail`** — the McLeod fuel purchase rows the agent already queries and then throws away (§6.1) | — (closes F12b; second source for 25% of expense) | collector | nothing |
| **C2** | **Backfill office lines** — `mcleod_office_lines` is 0 rows against a live endpoint (§6.2) | $289,921/mo · 7.1% → per person | ops | nothing |
| **C3** | **Truck fixed-cost schedule data entry** — lease, insurance, GPS, plating, per unit, from the contracts (T1) | $1,057,724/mo · 26.1% → per truck | owner data entry | owner |
| **C4** | **Billed distance** — `billing_loaded_distance` / `billing_empty_distance` are 0-populated on all 1,415 July bills (§6.3) | the revenue-per-mile denominator | collector | nothing |
| **C5** | **Revenue tie-out** — the expense invariant (D-FIN11) has no revenue twin (§6.6) | proves 100% of revenue, both grains | harness | C4 |
| **C6** | **The account→family catalogue** — 226 accounts, signed, keyed on code, one family each (§6.7) | every page that groups money | classification | owner signature |
| **C7** | **Classification fall-through** — a known-but-unlisted `type_id` is silently dropped (§0.1) | latent; 5 accounts | correctness | nothing |
| **C8** | **Active-truck definition** — undefined today; 190 / 172 / 160 are all defensible divisors (§6.8) | ±20% on every per-truck figure | classification | nothing |
| **C9** | **D-FIN18 — hardening without the two-month wait** (§6.9) | July closes in weeks, not October | correctness | nothing |
| **C10** | **Trailer cost object** — trailer repair and tires have no truck; movements carry the trailer (§6.4) | $36,782/mo · 0.9% | collector + harness | C6 |
| **C11** | **Toll collector** — ruling changed to weekly manual upload; nothing is built or specced (§6.5) | ~$52,000/mo · 1.3% | collector | owner ruling |
| **C12** | **FleetPal** — maintenance per unit (T5) | $244,761/mo · 6.0% → per truck | collector | owner: API key |
| **C13** | **T2 jurisdictional allocation** by measured state miles | $29,286/mo · 0.7% | harness | R4 signature |
| **C14** | **T3 deduct-code semantics** by the derivation in R2 | netting only; already inside the GL | harness | R2 signature |

**Read the order.** C1–C9 need no owner ruling and no third-party credential; together they take
the report from "org-level correct" to "org-level proven, both sides, at a stated grain". C3 alone
moves four times the dollars that C12 does, and it is an afternoon of data entry. C13 and C14 are
last on purpose: they argue over 0.7% of the money and they are the two steps that stalled this
programme for a week.

**In parallel, owner and carrier:** R1–R5 signatures; §3 items 1–6 (production login, TLS, schema
parity, figure parity, credential rotation, change tracking); the Task Scheduler entry; one
`financial_projection{full}`.

T2–T6 from the parent plan are unchanged except that T2 and T3 are now last rather than middle.

## 5. What this plan refuses to do

- No default without a printed label; no label without the ruling behind it or the word
  *proposed* on it (D-MC26, D-FIN13).
- No number where a measurement is absent: "—" and a stated dollar line, never 0 (D-FIN10).
- No repair that drops a fact to save a derivation (D-FIN2), and no delete on an empty read
  (D-FIN6).
- No tie-out that only displays. A residual is a finding or the month does not harden (D-FIN14).
- No question left in this file. If one appears, it gets a decision here before any code moves.

## 6. The collector and classification inventory

**Written 2026-09-03 (second pass)** against the July 2026 income statement, the agent's queries
(`tools/mcleod-agent/queries.mjs`), the staging schema (production `information_schema`), and the
EFS SOAP store. This section is the evidence behind the C-series and is meant to be exhaustive:
if a dollar on the July P&L is not accounted for here, this section has a defect.

The organising idea, and the reason the C-series replaced harness work: **a collector's job is to
land the finest grain the source asserts, verbatim, and to say which fact family it belongs to.**
Everything the harness does afterwards is arithmetic on facts that already carry their own grain.
Where a report is imprecise today it is almost never because the arithmetic is wrong; it is
because a fact arrived without its grain, or did not arrive at all.

### 6.0 The three failure modes, named

1. **Collected but not posted** — the agent runs the query and discards the rows (C1).
2. **Posted but not classified** — the row is in staging, but nothing says which cost family it
   belongs to, so it can only be summed, never grouped (C6).
3. **Not collected at all** — no source exists (C11 tolls, C12 FleetPal).

### 6.1 Collected but not posted: `fuel_detail` — **C1**

`FUEL_PURCHASES` (`queries.mjs:348-402`) reads `dbo.fuel_detail` + `fuel_detail_hist` and returns
27 columns per purchase: `tractor_id`, `driver_id`, `movement_id`, `order_id`, `trans_date_time`,
truck-stop name/city/state, `fuel_card_id`, and the product split McLeod keeps —
`tractor_gals`/`reefer_gals`/`def_gals`/`other_gals` and
`tractor_cost`/`reefer_cost`/`def_cost`/`oil_cost`/`misc_cost`/`sales_tax`/`transaction_fee`,
plus `total_amount`, `fuel_discount`, `direct_amount`, `funded_amount`, `post_key`, `post_module`.

`expenses.mjs:108-122` runs it, and `agent.mjs`'s `--financial` sweep posts settlements,
deductions, vouchers, movement-facts, billing, gl-accounts, office-lines and ledger-totals —
**but never `ex.purchases`.** The rows are used for the in-agent reconciliation claim and then
discarded. There is no `mcleod_fuel_purchases` table.

Why it matters, three ways:

- It is the **posting date** of each fill. F12's decomposed FUEL tie-out closed the old 5–8% drift
  to $444/month and named the remaining term "posting lag, unproven until `fuel_detail` is staged".
  This is that step.
- It is an **independent second source** for 25% of the carrier's expense. EFS says what the card
  bought; `fuel_detail` says what McLeod booked, keyed to the same purchase. Two sources that
  agree are a proof; one source is an assertion.
- It carries **`movement_id` and `order_id` on the fill**, which EFS does not. That is the only
  path from a gallon of diesel to the load that burned it.

**C1:** a `mcleod_fuel_purchases` staging table (new table — exempt from the deploy-window rule),
`POST /api/tms/fuel-purchases`, the agent posting `ex.purchases`, and the projection treating it as
**non-canonical reference** beside EFS (D-FS2 stands: EFS is canonical for fuel dollars). Done
when: July's per-account fuel residual is decomposed into a named posting-lag term, and the
FUEL claim's unexplained remainder is under $1.00.

### 6.2 Posted but empty: `mcleod_office_lines` — **C2**

The endpoint exists, the agent posts it (`agent.mjs:581`), the table is deployed (0276) — and
production holds **0 rows**. July's OFF module is $289,921 over 290 ledger lines and 31 named
people: the largest single overhead component in the carrier, and the report cannot name one
person of it. Either the carrier box is running an agent build older than the office-lines step, or
`OFFICE_SETTLEMENT_LINES` returned nothing on the 2026-08-28 sweep. **C2** is: find out which,
from the sweep's own log, and re-run. Ops, not code — unless the query is wrong, in which case it
becomes code and gets a fixture test like every other mapper.

### 6.3 Posted but null: billed distance — **C4**

`mcleod_billing` carries `billing_loaded_distance` and `billing_empty_distance`. On all **1,415**
July bills both are **NULL**. `distance` is populated on all 1,415. The dispatcher rate-per-mile
shipped in #522 reads billed distance and therefore prints a dash for every dispatcher.

Three columns for distance is itself the defect: `distance`, `billing_loaded_distance`,
`billing_empty_distance`, and nothing states which is authoritative. **C4:** measure what
`billing_history` populates in the sandbox, keep the one McLeod actually fills, and drop or
document the others. A column that is never non-null is a claim the store cannot support.

### 6.4 Collected, attributable, unattributed: trailers — **C10**

`mcleod_movements.trailer_unit` is populated on 2,588 of 2,634 July movements (98.3%) and
`mcleod_billing.trailer_unit` on 1,411 of 1,415 bills. So the trailer↔truck↔month association
**exists in staging today**. What does not exist is anything that uses it: Trailer Repair
($33,844) and OTR Trailer Tires ($2,937) — $36,782 in July — fall into the company pool and are
spread by tractor miles, which charges a dry-van tractor for a reefer trailer's repair.

**C10:** the trailer becomes a cost object of its own. Trailer-family accounts (from C6's
catalogue) attribute to a trailer, and the trailer's cost reaches a truck only through the
movements that pulled it, pro-rata by that movement's miles. A trailer that no movement pulled in
the month keeps its cost on the trailer, reported as such. This is small money and it is on the
list because it is the difference between a report that is right and a report that is nearly right.

### 6.5 Not collected: tolls — **C11**

The plan's R3 says "read the AP vendor on the toll account, then obtain that provider's
per-transponder export". The owner's ruling has since changed to **weekly manual upload**. Nothing
is built and nothing is specced for either path.

Two measurements make this urgent rather than tidy:

- July's GL tolls (`40790000`) are **$184.40**, against $364,179.98 year-to-date — roughly
  $52,000/month over the other six months. Something changed in July: reclassified, netted through
  driver deductions, or simply not yet entered. **July is month one of the reporting era, and its
  single most anomalous line is a cost family with no collector.** This must be answered by the
  accountants before the July report is shown.
- `40790002 Tolls OO` is typed `Income Tax Expense` (§0.1), so a family built from McLeod's own
  sectioning will not even find all the toll money.

**C11:** a spec before code — file shape, transponder→unit map, the economic date, and the dedup
rule against the AP voucher for the same toll (the AP copy becomes non-canonical, D-FS2 pattern),
plus what the report prints for a week nobody uploaded. Until it lands, tolls stay in the pool
under R1's printed basis with their dollars named, never allocated as though measured.

### 6.6 Missing invariant: revenue — **C5**

The expense side has a to-the-cent invariant (D-FIN11, `cpmTieOut.ts`): every dollar of the income
statement lands in exactly one named bucket, and the harness test fails the moment a term is
dropped. **Revenue has no equivalent.** `mcleod_billing` is read, summed and shown; nothing proves
the sum against `mcleod_gl_totals`' revenue accounts.

Measured, July 2026: staged billing $4,877,410.27 against GL BILL-module revenue $4,807,522.63 —
a difference of **$69,887.64 (1.45%)**, unexplained, and made of some mixture of bill-date versus
posting-date timing, `canceled`/`rebilled` rows, and DRS-module revenue that billing never sees.
That is exactly the shape of drift F12 decomposed on the fuel side and closed to $444.

**C5:** `buildRevenueTieOut`, mirroring `buildFuelTieOut` — billing by posting month against the
BILL revenue accounts, settlement-sourced revenue against the DRS revenue accounts, a named timing
term, a named cancelled/rebilled term, and a residual with a target under $1.00. And the
per-truck revenue column gets the same invariant the cost column has:
`Σ truck revenue + unattributed == GL revenue`.

### 6.7 The catalogue that does not exist: account → cost family — **C6**

This is the classification gap, and it is the one the owner named. Today the store knows two
things about a GL account:

- **class** — `mcleod_gl_accounts.type_id`, McLeod's own (`Revenue`, `Operating Expenses`,
  `General & Admin Expenses`, `Income Tax Expense`, …). 226 accounts staged.
- **grain** — derived from `post_module` (`glMonthlyCosts.ts` `GRAIN_BY_MODULE`): per truck, per
  person, per vendor, company.

It does not know **family** — is this account fuel, maintenance, driver pay, truck fixed cost,
jurisdictional tax, tolls, or company overhead. Every page that groups money therefore either
sums everything into one number or hard-codes a list. §0.1's two findings prove why family cannot
be inferred: McLeod's own sectioning misfiles at least two operating accounts into
`Income Tax Expense`, and `descr` is truncated to 28 characters so it is not unique.

**C6:** a `gl_account_families` table — `(org_id, company_id, glid, family, cost_behaviour,
attribution_target, ruled_by, ruled_at)` — seeded as a PROPOSAL from July's 226 accounts and their
modules, then signed by the owner once, account by account, in one sitting. Three fields carry
the meaning:

- **`family`** — the reporting group a boss reads: `fuel_and_fluids`, `driver_and_contractor_pay`,
  `truck_fixed`, `maintenance`, `trailer`, `jurisdictional`, `tolls`, `company_overhead`,
  `revenue_linehaul`, `revenue_accessorial`, `revenue_other`, `non_operating`.
- **`cost_behaviour`** — `variable_with_miles` | `fixed_per_truck_per_month` |
  `fixed_per_company_per_month`. This is what decides the allocation basis, and it is why a single
  global basis (R1) is only ever right for the residual pool: a lease does not follow miles.
- **`attribution_target`** — `truck` | `trailer` | `driver` | `person` | `vendor` | `company`,
  which the collector must be able to satisfy or the family stays pooled and says so.

An account with no signed row is `unruled`: its dollars are reported under their own line, never
folded into a family, and the count of unruled dollars is printed on the Books check page. Ruling
the derivation once beats ruling 226 rows forever — but unlike R2's deduct codes, there is no
derivation available here, because the source's own classification is measurably wrong. This one
is a signature.

### 6.8 The undefined divisor: what is an active truck — **C8**

Three defensible answers exist for July and they differ by 19%: **190** tractors active in McLeod
roster, **172** vehicles Samsara measured miles for, **160** trucks that carried a bill. Nothing
in the codebase states which is the divisor for "cost per truck", and the figure the bosses read
moves with the choice.

**C8:** a truck is **active in a month** if it has ANY of measured Samsara miles, a settled
movement, a settlement, or a fill in that month — the union, computed per month, printed as a
count on every page that divides by trucks. A truck that is only on the fixed-cost schedule and
did nothing else is active too (its lease was still paid) and shows with zero miles and a dash
per mile, which D-FIN10 already renders correctly.

### 6.9 The hardening rule blocks month one — **D-FIN18 / C9**

`planMonthClose` hardens a month only when it is **at least two months old**. Under D-FIN16, July
2026 is month one — and would not harden until 2026-10-01. The two-month rule was a proxy for
"McLeod has finished posting", and there is now a direct measurement of that: the hardening pass
re-reads whole months (F4), so the ledger's own stability is observable.

> **D-FIN18:** a month hardens when every residual reads 0.00 **and** the month's GL totals are
> unchanged across two consecutive hardening passes. The two-month age becomes a fallback for
> months with fewer than two passes on record, not the rule. A hardened month that later moves is
> still a finding (unchanged from D-FIN14).

### 6.10 What we already have — the complete positive inventory

Stated as the counterpart to everything above, because a list of gaps read alone understates the
position badly. Every row measured 2026-09-03.

**McLeod, via the on-prem agent (outbound HTTPS only, read-only SQL):**

| Fact family | Staging table | Grain it carries | July population |
|---|---|---|---|
| Movements | `mcleod_movements` | tractor, trailer, drivers, order ids, loaded + fuel miles, stops, status | 2,634 rows; tractor 2,614, trailer 2,588, miles 2,634 |
| Settlements | `mcleod_settlements` | tractor, trailer, driver, movement, order, payee + payee type, pay method, accrued/paid/transferred, total + posted pay, pay distance, void, accrual + post key | 20,693 rows all-time |
| Deductions | `mcleod_deductions` | payee, payee type, tractor, deduct code, D/R/E type, **glid**, amount, void | 10,158 rows all-time |
| AP vouchers | `mcleod_ap_vouchers` | vendor, invoice no, PO, description, invoice/due/distribution dates, amount, discount, **ap_glid**, paid, check no, post key/module | 1,464 rows all-time |
| Billing | `mcleod_billing` | invoice, customer, order, master order, tractor, trailer, driver, bill/ship/delivery/transfer dates, total + other charges, excise tax, **dispatcher**, distance, canceled, rebilled | 1,415 July rows |
| GL month totals | `mcleod_gl_totals` | company, month, **glid × post_module**, line count, net + abs amount, sweep stamp | 1,421 rows, 2025-12 → 2026-08 |
| GL account master | `mcleod_gl_accounts` | glid, descr, **type_id** | 226 accounts |
| Office payroll lines | `mcleod_office_lines` | payee, glid, descr, amount, date | **0 rows — C2** |
| Roster | `drivers`, `vehicles`, `trailers` | identity, active/service status, out-of-service dates | 164 / 190 / 235 |

**EFS, via SOAP (canonical for fuel dollars, D-FS2):**

| Fact | Table | Grain |
|---|---|---|
| Card line items | `efs_transactions` | **`item` product code**, `unit_price`, `qty`, `amt`, `fees`, card, unit, driver, trailer, odometer, hubometer, location, invoice, control id — one row per product line |
| Fuel events | `fuel_transactions` (71 cols) | vehicle, driver, instant, odometer, gallons, price, settled cost, station, canonical flag, dedup, plus the whole anomaly/recon apparatus |
| Cards, controls, mutations | `efs_cards`, `efs_card_mutations`, `efs_card_control_settings` | per card |

July line items, every one carrying a unit: ULSD $1,018,807.92 (1,857) · DEFD $47,620.00 (1,337) ·
ULSR $5,547.70 (58) · SCLE $5,404.78 (379) · WWFL, ADD, OIL, DEF, ANFR, STAX (~$420 across 60).
Ten product codes, all attributed to a truck. **This is the best-classified feed we have and it is
the model the others should be judged against.**

**Samsara:**

| Fact | Table | Grain |
|---|---|---|
| Jurisdiction miles | `samsara_ifta_jurisdiction_miles` | vehicle × jurisdiction × month, taxable + total meters — the CPM denominator AND T2's allocation key |
| Engine days | `vehicle_engine_days` | vehicle × day |
| Assignments | `driver_vehicle_assignments` | driver ↔ vehicle over time |

**Derived / owned by us:**

| Fact | Table | State |
|---|---|---|
| Money projection | `financial_entries` | 49,530 rows — direction, **category**, amount, occurred/settled, vehicle, driver, load, source + source row, dedup key, canonical + void flags, **ledger post key / module / account** |
| Truck fixed costs | `truck_cost_schedules` | unit, category, label, monthly amount, effective range — **0 rows — C3** |
| Monthly close | `finance_month_closes` | org, company, month, every bucket, every residual, verdict — awaiting the first hardening sweep |

**What has no collector at all:** tolls (C11), FleetPal maintenance work orders (C12), and a
per-unit lease/insurance/plating contract register (C3 — the schedule table exists; the data is
the owner's to enter and no system holds it today).

## 7. Progress log — append here, never edit the §4 table

Three PRs in one afternoon each marked their own row of the §4 table "BUILT", and every pair
conflicted on merge because the rows are adjacent lines. The table is the plan; this list is the
record. One dated line per step, appended at the end, so parallel PRs never touch the same line.

- 2026-09-03 · #504 — the plan itself. Merged.
- 2026-09-03 · #506 — F1 + F11: schedule leaves the pool; largest-remainder; `glTieOut`. Merged.
- 2026-09-03 · #507 — F2: `efsIngestRejects.ts`, rejects on `import_rows`; the owner's re-queue
  statement is in §1.2 and runs AFTER this has deployed.
- 2026-09-03 · #509 — F10: rates are `number | null`, the page prints a dash, `fleet.unmeasured`,
  `sortRows` keeps blanks last.
- 2026-09-03 · F6a — reader refuses an empty payload; `replace_mcleod_gl_month` lands in 0302 as
  the function only. **F6b owed:** the reader calls the RPC one merge after 0302 has applied.
- 2026-09-03 · F3 — the financial routes stamp `org_integrations` provider `mcleod_financial`; the
  CPM header prints "McLeod figures as of …"; `financialFreshness.ts` runs six-hourly and turns a
  sweep older than 26 h or a failed finance job into a `system` finding for every `accounting`
  manager plus one office email per run (dedupe keys: `finance:stale:<org>:<day>`,
  `finance:job-failed:<job>`). A dedicated notification category is owed if the office ever wants
  to mute it apart from other system findings.
- 2026-09-03 · F4 — the agent gains `npm run financial` / `financial:harden`; the trailing window
  is 75 days; the 1st–3rd of each month re-read the two previous months whole (`windows.mjs`,
  pure, with the agent's first `node:test` suite, run by CI through `lint:agent-syntax`). The
  README says to schedule it daily. **Owed to the owner:** the Task Scheduler entry on the carrier
  box — the code cannot create that.
- 2026-09-03 · #514 — F5 (settlements, deductions, movements): the agent SQL carries `is_void` /
  `status` instead of filtering; the movement reader excludes V. Sandbox June: 3,894 settlements
  (1,129 voided → 2,765 live = C3), 1,686 deductions (344 → 1,342 = C3), 3,347 movements (10 →
  3,337 = C1). **F5b owed:** `mcleod_ap_vouchers` needs a void column before its filter can go;
  billing's `canceled`/`rebilled` vocabulary is still recon F3.
- 2026-09-03 · #515 — F7: AP windows on `coalesce(distribution_date, invoice_date)` on both sides;
  projection window 75. Sandbox June by invoice date 183 vouchers / $1,443,207.52 → by posting date
  202 / $1,492,888.52 (12 leave, 31 arrive) — the month as the GL closes it.
- 2026-09-03 · #516 — F8a: `company_id` on the seven staging tables (0303), backfilled with the
  measured value. Measured first: every financial id is instance-unique EXCEPT `movement.id`
  (296,242 rows, 277,481 distinct, 18,761 repeat across TMS/TMS2/TMS3); production's staged rows
  are all company TMS (400/400 sampled per table). So §1.8's key change is **movements-only**
  (F8c), after every row carries a company; F8b (writers + a guard that refuses a cross-company
  movement overwrite) follows one merge after 0303 applies.
- 2026-09-03 · F12 — the FUEL tie-out decomposed (`buildFuelTieOut`; ledger coverage carries a
  `fuel` block and a FUEL claim). **§1.12's 5–8% is explained:** production June — ULSD 913,477.77
  vs 40050000 898,128.58; DEFD 46,480.43 vs 30220000 46,204.77; ULSR 5,810.12 vs 30340000 5,793.51;
  SCLE 4,755.23 vs 40760000 5,287.91; owner-operator-unit fuel 46,243.48 vs 17000000 62,131.62;
  ~$337 unmapped; whole month EFS ≈ 1,017,158 vs the FUEL module's payable 1,017,601.81 → residual
  ≈ $444 (0.04%). The per-account residual is the posting-lag term until McLeod `fuel_detail` is
  staged with its posting dates (**F12b owed**).
- 2026-09-03 · #519 — F8b: every financial staging writer carries `company_id` (the agent sends it
  from its own company filter; `tmsLedgerTotalsPayloadSchema` and `tmsOfficeSettlementLineSchema`
  take it nullish); `refuseCrossCompanyOverwrite` makes a movement chunk that would replace a row
  carrying a different company throw, naming up to five ids, and write nothing. **F8c still owed:**
  the movements-only key change once every stored row carries a company.
- 2026-09-03 · #520 — 0304: `replace_mcleod_gl_month` takes `p_company_id`; the stale delete is
  scoped to that company and to rows carrying no company (deploy-window rows). Function only; the
  reader switch waited one merge (#525). Matrix `mcleod-gl-month-replace` at 16 checks.
- 2026-09-03 · #521 — F9, **D-FIN9 revised by measurement:** McLeod stamps are date-valued wall
  times; shifting them into America/Chicago would move 890 canonical entries ($1.29M) off the 1st of
  a month, so they stay. The store's one clock is the org's local wall time labelled UTC (0305 is
  comments only); `localWallClock` converts EFS `fueled_at` on the way in and the projection reads
  fills a day wide on each side. The org tz is `organizations.operating_hours->>'tz'` — no column.
  **Owner:** one `financial_projection{full}` job moves the older EFS entries into place.
- 2026-09-03 · #522 — F15a: Revenue & margin → Per dispatcher gains `#` rank, `Billed miles`
  and `Rate / mile` (null → dash when no booked load carried a distance); the billing, dispatcher,
  fixed-cost and contractor tables show a failed fetch instead of `:error="null"`. First Finance
  page test.
- 2026-09-03 · #523 — F14: `finance_month_closes` (0306, new table) holds each (org, company,
  month)'s GL revenue/expenses, the D-FIN11 buckets and every residual; `planMonthClose` (shared,
  pure) hardens only when the month is ≥ 2 months old, the anchor held and every residual is 0.00,
  otherwise names each open reason (a missing sweep is a reason, not a zero). `runMonthClosesOnce`
  runs on the freshness timer, re-plans a month whose GL sweep is newer than its close, and reports
  a hardened month that moved to `accounting` managers. `GET /api/accounting/month-closes`. The
  first real row appears after the next hardening sweep from the carrier box.
- 2026-09-03 · #524 — F15b: Finance → Books check (`/books-check`, `section("accounting")`): one
  table of closes — month, books, verdict, earned, spent, left over, open reasons, sweep date —
  with three cards and a plain-words explainer of "hardened". **F15 still owed:** month/week
  selector with prorating; fixed-cost drill-down to office people and AP vendors.
- 2026-09-03 · #525 — F6b: `ingestLedgerTotals` calls `replace_mcleod_gl_month` — one
  transaction, one stamp, company-scoped stale delete. D-FIN6 complete.


---
- 2026-09-03 · second-pass audit against the July income statement. D-FIN16 (reporting era starts
  2026-07-01), D-FIN17 (org-level precision before per-truck), D-FIN18 (hardening on ledger
  stability, not on a two-month age). §0.1 records July tying to the printed P&L to the cent and
  the grain each dollar sits at; §4 is re-sorted into the C-series; §6 is the collector and
  classification inventory the C-series is drawn from. Plan only — no code in this change.
