# Finance go-live — from "proven once" to "precise every month"

**Status:** ACTIVE — audit complete, nothing built yet. **Owner:** Miki. **Written:** 2026-09-03,
from a read-only audit of the collectors, the store, the harness, the Finance pages and the
production database. **Parent:** [TRUCK-COST-ATTRIBUTION-PLAN](./TRUCK-COST-ATTRIBUTION-PLAN.md)
(T1–T7, R1–R6) and `docs/plans/mcleod/FINANCIAL-STORE-PLAN.md` (D-FS1..8). This plan does not
replace either; it records what the audit found between them and decides every open item.

The goal this plan serves, in the owner's words: *when we connect to live McLeod we have
everything production ready and 100% precise, accurate and reliable* — revenue per mile per
truck, spend per mile per truck, and what is left per mile per truck.

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

## 4. Execution order — one PR each, gates green, no step skipped

Correctness before operations before presentation; the owner/carrier items run in parallel.

| # | Step | Decision | Blocks |
|---|---|---|---|
| 1 | F1 + F11 — schedule leaves the pool; largest-remainder; invariant test — **BUILT 2026-09-03** (`cpmTieOut.ts`, `apportion.ts`; page reads `glTieOut` in F15) | D-FIN1, D-FIN11 | every all-in figure |
| 2 | F2 — ingest guard, rejects, re-queue the April/May refetch — **BUILT 2026-09-03** (`efsIngestRejects.ts`; rejects on `import_rows`; the re-queue is the owner's one statement, §1.2) | D-FIN2 | April/May fuel |
| 3 | F10 — null per-mile, measured-only fleet figure — **BUILT 2026-09-03** (rates are `number | null`; the page prints a dash; `fleet.unmeasured` is its own line) | D-FIN10 | trust in the table |
| 4 | F6 — zero rows never delete; one RPC | D-FIN6 | fleet truth surviving a bad sweep |
| 5 | F3 — last-synced, "as of", failure findings | D-FIN3 | knowing 2–4 held |
| 6 | F4 — scheduled agent, 75-day window, hardening pass, agent tests | D-FIN4 | everything monthly |
| 7 | F5 — voids swept with their flag | D-FIN5 | precision after edits |
| 8 | F7 — one AP date | D-FIN7 | unprojected vouchers |
| 9 | F8 — `company_id` (column first, readers one merge later) | D-FIN8 | per-entity tie-out |
| 10 | F9 — org time zone (column first, readers one merge later) | D-FIN9 | month edges |
| 11 | F12 — decomposed FUEL tie-out | D-FIN12 | the 5–8% |
| 12 | F14 — monthly close table, Books check page | D-FIN14 | "100% precise" as a fact |
| 13 | F15 — error states, page tests, selector, drill-downs, dispatcher rate | D-FIN15 | the handoff's three items |
| ∥ | R1–R5 signatures; T1 schedule data entry; office-lines backfill; §3 items 1–6 | §2, §3 | T2–T6, live |

T2–T6 from the parent plan follow their rulings and are unchanged by this document except where
§2 rewrites how the ruling is expressed (R2, R4).

## 5. What this plan refuses to do

- No default without a printed label; no label without the ruling behind it or the word
  *proposed* on it (D-MC26, D-FIN13).
- No number where a measurement is absent: "—" and a stated dollar line, never 0 (D-FIN10).
- No repair that drops a fact to save a derivation (D-FIN2), and no delete on an empty read
  (D-FIN6).
- No tie-out that only displays. A residual is a finding or the month does not harden (D-FIN14).
- No question left in this file. If one appears, it gets a decision here before any code moves.
- 2026-09-03 · F3 — the financial routes stamp `org_integrations` provider `mcleod_financial`; the
  CPM header prints "McLeod figures as of …"; `financialFreshness.ts` runs six-hourly and turns a
  sweep older than 26 h or a failed finance job into a `system` finding for every `accounting`
  manager plus one office email per run (dedupe keys: `finance:stale:<org>:<day>`,
  `finance:job-failed:<job>`). A dedicated notification category is owed if the office ever wants
  to mute it apart from other system findings.
