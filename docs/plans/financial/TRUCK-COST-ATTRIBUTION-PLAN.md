# Truck Cost Attribution — from direct CPM to full CPM

**Status:** ACTIVE — T1 in build. **Owner:** Miki. **Written:** 2026-08-28, from the June 2026
income statement reviewed line-by-line against what the pipeline measures today.

**SUPERSEDED IN FULL, 2026-09-03, by
[FINANCE-FLEET-REPORT-PLAN](./FINANCE-FLEET-REPORT-PLAN.md) §0.** The owner ruled that we do not
have a precise enough source for per-truck cost and that Finance will be a fleet report instead —
so T1 through T6 are not deferred, they are out of scope, and rulings R1, R3, R4 and R5 are not
pending, they are moot. R2 survives, but as a JOIN rather than a table: the class of a deduction
is the type of the GL account it posts to, and that derivation is now used only to count
owner-operator income correctly (fleet plan §1.3, measured working on July 2026 data).

This document stays in the tree because it is the honest record of what per-truck attribution
would have required — a per-unit contract register for ≈$1.06M/month of lease and insurance, a
FleetPal key, a toll provider export, and four owner rulings — and that record is what makes the
decision to stop defensible. Nothing below is a queue any more.

The owner's requirement, verbatim in spirit: *precise numbers — no assuming, no improvising.* This
plan is bound by that. Every step below either (a) attributes dollars to a truck from a MEASURED
source, (b) attributes them by a RULE the owner signed, with the rule printed on the report, or
(c) leaves them in a named unallocated pool. There is no fourth bucket, and the acceptance
instrument (T7) exists to prove the three buckets sum to the general ledger to the cent.

## 1. Where this starts from — facts, each measured, none assumed

- **June 2026 P&L** (printed 2026-08-20): $5,107,789.04 revenue, $3,633,776.21 expenses
  ($3,245,282.08 operating + $388,494.13 G&A), net $1,473,728.93. The current sandbox copy shows
  June billing at $5,638,045.93 fully GL-posted — the P&L predates McLeod's ~1-month entry lag
  finishing the month; monthly figures harden roughly one month in arrears, and every acceptance
  check below must compare against the GL as of a stated sweep date, not against a printed PDF.
- **McLeod's GL cannot attribute to trucks.** 0 of 188,179 `gl_ledger` lines carry a tractor
  (measured 2026-08-26, D-MC12). Whatever McLeod knows per-truck lives in subledgers
  (settlements, billing, movements) — everything else arrives as vendor invoices and bank-statement
  entries with an account code only. No extraction change can fix this; only new sources can.
- **What is per-truck measured today** (the CPM page's direct figures, June basis): company-driver
  pay $1,092,756.86 (settlements, per tractor), owner-operator pay $228,099.51 (pooled separately,
  D-MC20), fuel $899,741.93 + DEF $46,204.77 + reefer fuel $5,793.51 (EFS canonical, per truck,
  D-FS2). ≈62% of June expense dollars.
- **Samsara measured miles are live in production**: `samsara_ifta_jurisdiction_miles`, 21,143 rows
  covering 2026-01 through 2026-07, per vehicle per jurisdiction per month (verified 2026-08-28).
  The denominator AND a per-state allocation basis both exist already.
- **EFS raw history starts 2026-02-04** (11,519 rows in `fuel_transactions`). Months before
  February 2026 can never have measured per-truck fuel; a report over such a month must say so.
- **The deduct-code vocabulary is measured** (recon F6, 2026-08-28): ~115 codes over
  `deduction_type` D/R/E; 2026 headline dollars include FEE $412,932.38, SL $205,092.94,
  RRO $157,125.57, O10 $156,609.54, TRR $120,014.92. Nothing about their cost semantics is ruled
  yet — see R2 below.
- **June under today's default rules** (spec §C5): 159 trucks, 116.4¢/mi direct;
  $1,443,207.52 deliberately unallocated (~82.3¢/mi if spread by miles), stated in the report's own
  caveats (D-MC26).

## 2. The gap, line by line (June dollars)

| P&L family | June $ | Truck attribution source | Step |
|---|---|---|---|
| Driver + owner-op pay | 1,320,856 | McLeod settlements — measured | shipped |
| Fuel / DEF / reefer fuel | 951,740 | EFS — measured | shipped |
| VIP Lease (truck payments) | 400,000 | fixed-cost schedule (contract per unit) | **T1** |
| Insurance (net of adj.) | 161,358 | fixed-cost schedule (policy per unit) | **T1** |
| GPS fees | 11,663 | fixed-cost schedule (flat per unit) | **T1** |
| Maintenance family (repairs, tires, oil, towing, shop, trailer) | ~264,000 | FleetPal work orders per unit | **T5** |
| Tolls | 72,613 | transponder feed — source unruled | **T4** |
| Permits / IRP / IFTA / state taxes | ~16,000 | Samsara per-state miles allocation | **T2** |
| Deduction recoveries (netting, sign TBD) | see F6 | deduct-code classification | **T3** |
| G&A + remaining operating overhead | ~388,000 + misc | owner's allocation ruling (or stays pooled) | **T6** |

## 3. Steps — one PR each, in dollar order, every Done-when measurable

### T1 — Per-truck fixed-cost schedule (≈$573k/mo: lease, insurance, GPS, permits-by-unit)

A new table, `truck_cost_schedules`, holding what the office knows from actual contracts: unit,
category (`lease` | `insurance` | `gps` | `permit` | `other`), label (vendor/contract wording),
monthly amount, and an effective half-open date range `[effective_from, effective_to)`. Data entry
is FROM the signed contracts and policy schedules — the system will not guess a truck's lease from
an AP voucher, because the voucher is one blended payment to the lessor. Harness: `computeCpm`
gains a per-unit fixed-cost input; the report gains a fixed column and a full CPM alongside direct
CPM, with a caveat naming every truck the schedule does not cover and the fleet schedule total per
category (so finance can eyeball it against the P&L line: VIP Lease schedule total should read
≈$400k or the schedule is incomplete — a stated drift, never a silent one). A month partially
covered by a range charges the whole month if the range covers the window's month start; the rule
is printed in the caveat, not hidden in code.

**Done when:** the June window shows lease + insurance + GPS per truck for every scheduled unit,
the caveat lists uncovered trucks and per-category schedule totals, and an office user can
maintain the schedule from a page without SQL.

### T2 — Jurisdiction taxes allocated by measured state miles

IFTA, IRP, state monthlies/quarterlies (KY/NM/NY/OR/CT/ID, highway use tax) allocate per truck by
that truck's share of measured miles in the relevant jurisdiction month —
`samsara_ifta_jurisdiction_miles` is already per (vehicle, jurisdiction, month). Requires R4 (the
GL account list that constitutes "jurisdictional") — enumerated from `mcleod_gl_totals` account
codes once the sweep lands, presented to the owner as a checklist, never inferred from account
names alone.

**Done when:** a June per-truck tax figure exists whose fleet sum equals the swept GL total of the
ruled accounts to the cent, and a truck with no measured miles in a state gets $0 from that state
(D-FS5 — no invented attribution).

### T3 — Deduction semantics: recoveries net against truck cost

The F6 vocabulary (~115 codes) gets a classification table — `deduct_code` →
(`driver_cost_recovery` | `pass_through` | `earnings_adjustment`) — seeded as a PROPOSAL from the
code names and dollar patterns, then ruled line-by-line by the owner (R2) before anything nets.
Once ruled: `driver_cost_recovery` amounts (driver-charged tolls, damage, fuel advances recovered)
subtract from the charged truck's cost; `pass_through` never touches CPM; `earnings_adjustment`
stays on the pay side. Until ruled, deductions stay staged and OUT of CPM, and the report caveat
says so.

**Done when:** the ruled table exists in a migration, the harness nets `driver_cost_recovery`
per truck, and the caveat states the total netted and the total still unruled (which must be $0
for the owner's sign-off month).

### T4 — Tolls per truck (BLOCKED on R3: which transponder service, and does it export per-unit?)

$72,613/June sits in AP as vendor payments. The precise source is the toll provider's own
per-transponder statement (transponder → unit). Until the owner names the provider and we see an
export, tolls stay in the unallocated pool — allocating tolls by miles would charge the Ohio
turnpike to a truck that ran Texas, exactly the improvisation this plan forbids.

**Done when:** provider export lands in a raw table keyed by transponder-native id, transponders
map to units, and June's per-truck toll sum reconciles against the AP toll vendor total with the
difference stated.

### T5 — FleetPal maintenance per truck (BLOCKED on R5: API access)

The owner ruled FleetPal the maintenance source (2026-08-27). Collector + raw table keyed by
FleetPal's work-order id carrying its unit; canonical-maintenance predicate mirrors D-FS2 exactly:
FleetPal is canonical for maintenance dollars, the McLeod AP copies of the same spend become
non-canonical references, so the same repair can never count twice. Needs FleetPal API credentials
and a look at their export shape before the schema is designed — the raw table stores what
FleetPal asserts, verbatim, same as every other collector.

**Done when:** a June-equivalent month shows per-truck maintenance from FleetPal, and
ledger-coverage shows the maintenance GL accounts claimed by the FleetPal sweep with drift stated
per account.

### T6 — Overhead basis ruling (R1 — no code, one decision)

G&A (~$388k/mo) plus whatever T1–T5 never attribute (office subcontract labor, recruiting, rent,
professional fees). The harness already supports `total_miles` | `loaded_miles` |
`equal_per_truck` | `none` and defaults to `none` (D-MC26). The owner picks; the report prints the
chosen basis on every page. Recommendation: `total_miles` over Samsara measured miles — overhead
follows activity — but the recommendation is not a default; until ruled, the pool stays visible
and unallocated.

**Done when:** the ruling is recorded here with a date, the default flips to it, and the CPM page
shows overhead per truck under the printed basis.

### T7 — The acceptance instrument: three buckets sum to the ledger

Extends ledger-coverage into a monthly per-truck full-cost statement: for a closed month,
`Σ(per-truck attributed) + unallocated pool == mcleod_gl_totals expense total` for that month, per
account family, difference shown to the cent. This is what "100% precise" MEANS here: not that
every dollar is measured per truck (insurance per truck is a schedule, an allocation is a rule),
but that every dollar is in exactly one named bucket under a printed basis and nothing leaks.
Runs against the sweep's month stamp, so the ~1-month McLeod entry lag is visible as "month not
yet hardened" instead of as phantom drift.

**Done when:** June 2026 (or the first hardened month after staging fills) reports a to-the-cent
tie between the three buckets and the GL, and any nonzero residual names its account.

## 4. Open rulings — each blocks the step named, nothing else

*Every ruling below now has a complete recommended answer in
[FINANCE-GO-LIVE-PLAN](./FINANCE-GO-LIVE-PLAN.md) §2 (2026-09-03), written so that ruling is a yes/no.
R2 and R4 are re-expressed there as derivations rather than lists.*

*R1, R2 and R4 have prepared worksheets — measured candidates with proposals to strike or confirm,
from recon F6/F10 (2026-08-28): see [COST-RULING-WORKSHEETS](./COST-RULING-WORKSHEETS.md). R2's
worksheet also surfaced that T3's taxonomy needs a FOURTH class: McLeod's type-R deduction rows are
reimbursements — truck cost arriving via the settlement — not recoveries, so `truck_cost` joins the
three classes named under T3.*

- **R1 (blocks T6):** overhead allocation basis. Recommended `total_miles`; owner decides.
- **R2 (blocks T3):** the deduct-code classification, ruled per code over the F6 measured list.
- **R3 (blocks T4):** which toll transponder service the fleet uses, and access to its per-unit
  statement export.
- **R4 (blocks T2):** the GL account list constituting jurisdictional taxes — checklist produced
  from swept `mcleod_gl_totals`, owner confirms.
- **R5 (blocks T5):** FleetPal API credentials and a sample export.
- **R6 (blocks first full run):** production ingest-token registration + projection backfill —
  one command, owner's machine (`register-ingest-token.mjs`, prepared 2026-08-28), then the
  250-day `--financial` sweep fills staging.

## 5. What this plan refuses to do

- No allocation without a printed basis; no basis without the owner's ruling (D-MC26).
- No attribution invented from vendor names, account labels, or "obviously it's per truck"
  (D-FS5). A truck with no measured or scheduled cost in a category shows the gap, not a guess.
- No double counting across sources: one canonical predicate per spend family (D-FS1/D-FS2
  pattern — EFS for fuel, FleetPal for maintenance, schedule for fixed), the McLeod copy retained
  as reference.
- No acceptance against stale snapshots: monthly tie-outs run against the sweep's own stamp, and
  a month McLeod hasn't finished entering is reported as unhardened, not as reconciled.
