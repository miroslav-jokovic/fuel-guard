# Finance — the fleet report

**Status:** ACTIVE. **Owner:** Miki. **Written:** 2026-09-03, after two scope rulings that made
the previous programme wrong rather than incomplete.

**Session handoff:** [HANDOFF-2026-09-03-FLEET-REPORT](./HANDOFF-2026-09-03-FLEET-REPORT.md) —
where the build stopped, what is proven, and the three traps that cost time. Read it first.

**Supersedes** [FINANCE-GO-LIVE-PLAN](./FINANCE-GO-LIVE-PLAN.md) §4 and §6 and
[TRUCK-COST-ATTRIBUTION-PLAN](./TRUCK-COST-ATTRIBUTION-PLAN.md) in full. Both stay in the tree:
the go-live plan is the record of the correctness programme that shipped (D-FIN1–D-FIN15, all
built), and the attribution plan is the record of why per-truck cost was attempted and what it
would have cost. Neither is a queue any more. This document is the queue.

---

## 0. The rulings this plan is built on

The owner's reasoning, in one sentence: *we do not have a precise enough source for per-truck cost,
so we will be precise about the fleet instead, and detailed within it.* Everything below follows
from that, and each ruling below is what makes the report simpler AND more reliable at the same
time — which is the test a simplification has to pass.

- **D-FLEET1 — the report is fleet-grained.** Cost per mile, revenue per mile and net per mile are
  computed for the whole fleet from whole-fleet totals. No cost is attributed to a truck, so no
  cost is attributed wrongly.
- **D-FLEET2 — every dollar comes from McLeod's general ledger.** One source for money, and it is
  the source the accountants already reconcile every month from the bank statements and the EFS
  reports. `mcleod_gl_totals` × `mcleod_gl_accounts` is the whole financial input.
- **D-FLEET3 — every mile comes from Samsara.** One source for distance:
  `samsara_ifta_jurisdiction_miles`, per vehicle per month. Not a preference — §1.5 measures why
  McLeod cannot supply the denominator at all: it holds no empty-mile figure anywhere, and the
  mileage it does hold is on a settlement clock rather than a calendar one.
- **D-FLEET4 — EFS keeps collecting, and is not a Finance source.** The SOAP feed continues in
  full for the Fuel section, anomalies, card control and driver work. Finance reads fuel as GL
  lines (`40050000 Fuel for Hired Vehicles`, `30220000 DEF`, `30340000 Reefer Fuel`) like every
  other expense. **This is what removes the reporting-era start date:** the old 2026-07-01 boundary
  existed only because EFS raw history begins 2026-02-04. McLeod's ledger goes back further, so
  the report goes back further.
- **D-FLEET5 — two eras, because the two inputs have different histories.** **Money from
  2025-12**: the ledger is complete from there and the fiscal year-to-date ties to the printed
  income statement to the cent (§1.1). **Per-mile figures from 2026-03**: Samsara telematics was
  still being rolled out before that, and a denominator missing trucks inflates cost per mile
  (§1.5.3 measures the gap — 16 trucks, 11% of the fleet, in February alone). January and February
  therefore show revenue, expenses and net like every other month, and show **"—"** for every
  per-mile figure with the reason on hover. A per-mile number computed over an incomplete fleet is
  exactly the plausible-but-wrong figure D-FIN10 exists to refuse.
- **D-FLEET6 — the period is a parameter of the harness, not a constant of the report.** The
  harness takes a start and an end and computes from whatever rows fall inside them. What the
  report can actually OFFER is decided by the collectors' grain, not by the harness — today that is
  the calendar month, and §1.8 measures exactly what each source would need to offer a week.
- **D-FLEET9 — collectors stage the finest grain the source asserts; the harness aggregates.**
  A collector that pre-aggregates to a period has made a reporting decision inside an extraction
  layer, and every later question about a different period becomes a schema change. Where we
  currently aggregate in SQL and it costs us nothing to stop, we stop (§1.8.1).
- **D-FLEET7 — owner-operators are their own column, derived and never configured.** Their trucks
  come from `payee_type`, their pay from the settlements, their revenue from the loads they ran,
  and the class of every deduction is read from the GL account it posts to (§1.3).
- **D-FLEET8 — nothing is allocated.** There is no overhead pool, no basis, no apportionment and
  no ruling to sign. A fleet number divided by fleet miles needs none of it.

### What these rulings delete

| Was blocking, cost, or risk | State now |
|---|---|
| `truck_cost_schedules` — ≈$1.06M/month of lease and insurance entered by hand from contracts | **deleted.** The ledger already holds the totals |
| FleetPal API key and collector (T5, R5) | **deleted from Finance.** Maintenance is a ledger line |
| Toll collector, weekly upload or vendor export (T4, R3) | **deleted from Finance.** Tolls are a ledger line |
| Jurisdictional allocation by state miles (T2, R4) | **deleted.** IFTA, IRP and permits are ledger lines |
| Overhead allocation basis (T6, R1) | **deleted.** Nothing is allocated |
| Deduct-code taxonomy as a 115-row table (T3, R2) | **deleted as a table.** The derivation survives, and only for owner-operator income (§1.3) |
| Trailer cost object; per-truck fixed cost; the three-bucket attribution model | **deleted** |
| The EFS-versus-ledger fuel tie-out as a Finance blocker (F12b) | **moved to the Fuel section**, where it is a reconciliation and not a report input |
| Reporting-era start of 2026-07-01 | **moved to 2026-01-01** (D-FLEET5) |

Five of the six owner rulings and every third-party credential leave the critical path.

---

## 1. Position — measured against production 2026-09-03

All figures from `supabase db query --linked`, checked against the owner's printed
`PROFIT LOSS JULY 2026.pdf` (McLeod Income Statement, Silvicom, Inc., printed 2026-08-20).

> **What these numbers are for, and what they are not.** Nothing in this section is a figure the
> product prints, and nothing here is ever typed into code. Every number below was computed by hand
> from staged data for exactly one purpose: to prove that the collectors already hold what the
> harness needs, and to serve afterwards as the **acceptance fixture** that harness must reproduce.
> The report is computed, always, from the collected rows — §2.5 states that contract. A plan that
> carried the answers instead of the method would be a spreadsheet, and it would be stale the
> morning after the next sweep. Where a step below says *"the harness reproduces §1.2"*, that is a
> test, not an instruction to hard-code a table.

### 1.1 The ledger reproduces the printed statement to the cent — month AND year to date

| | Printed P&L, July | Staged | | Printed, YTD | Staged |
|---|---:|---:|---|---:|---:|
| Revenue | 4,828,189.24 | **4,828,189.24** | | 28,687,090.14 | **28,687,090.14** |
| Expenses | 4,058,143.38 | **4,058,143.38** | | 25,126,042.28 | **25,126,042.28** |
| Net | 770,045.86 | **770,045.86** | | 3,561,047.86 | **3,561,047.86** |

Seven months summed independently, to the cent, on both sides. This is the proof that D-FLEET2 is
safe: the accountants' monthly entry into McLeod is complete, and it is already ours.

### 1.2 The report exists in the data today — seven months of it

Ledger revenue and expenses over Samsara measured miles, per calendar month:

| Month | Revenue | Expenses | Net | Miles | Trucks | Rev/mi | Cost/mi | **Net/mi** |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| 2026-01 | 2,572,980.94 | 2,925,198.58 | −352,217.64 | 1,224,329 | 130 | 2.10 | 2.39 | **−0.29** |
| 2026-02 | 3,464,243.01 | 3,377,113.44 | 87,129.57 | 1,179,719 | 135 | 2.94 | 2.86 | **0.07** |
| 2026-03 | 4,086,460.84 | 3,629,958.88 | 456,501.96 | 1,370,444 | 149 | 2.98 | 2.65 | **0.33** |
| 2026-04 | 4,237,047.52 | 3,522,432.91 | 714,614.61 | 1,492,407 | 157 | 2.84 | 2.36 | **0.48** |
| 2026-05 | 4,390,379.55 | 3,979,134.98 | 411,244.57 | 1,563,003 | 158 | 2.81 | 2.55 | **0.26** |
| 2026-06 | 5,107,789.04 | 3,634,060.11 | 1,473,728.93 | 1,574,109 | 170 | 3.24 | 2.31 | **0.94** |
| 2026-07 | 4,828,189.24 | 4,058,143.38 | 770,045.86 | 1,552,337 | 172 | 3.11 | 2.61 | **0.50** |
| **YTD** | **28,687,090.14** | **25,126,042.28** | **3,561,047.86** | **9,956,348** | | **2.88** | **2.52** | **0.36** |

The bosses get a seven-month trend on the first day the page ships, not a single month with a
promise of history later. January's loss is the figure that will be asked about first: revenue
$2.57M against $3.46M in February on comparable miles. It is a real month, not a staging artefact
— the ledger ties — and the page prints it as it is.

⚠ **The per-mile columns for 2026-01 and 2026-02 are shown here for completeness and will NOT be
printed on the page.** Samsara had not finished rolling out (§1.5.3), so those two denominators
are missing 7% and 11% of the running fleet and their cost per mile is inflated by about as much.
Under D-FLEET5 those two months print money and a dash. Per-mile reporting begins 2026-03.

### 1.3 Owner-operators separate cleanly, and their deductions classify themselves

July 2026: **9 owner-operator trucks**, all nine carrying Samsara miles.

The class of a deduction is not a judgement about its code — it is the type of the GL account the
deduction posts to, which `mcleod_deductions.glid` already carries and `mcleod_gl_accounts.type_id`
already classifies. July's owner-operator deductions, sorted by that join alone:

| Account class | July $ | What it is | Effect |
|---|---:|---|---|
| **Revenue** — equipment rental, insurance collection O/O, installment sale, detention | 34,384.28 | carrier income from the contractor | counts as revenue |
| **Current Assets** — fuel advance, driver advances | 53,917.64 | a receivable being repaid | **not income** |
| **Current Liabilities** — company driver payable | 31,356.61 | pass-through | none |
| **Expenses** — repairs, permits, occupational insurance, GPS, scales, tolls, postage | 11,064.71 | cost charged back | reduces carrier expense |
| | **130,723.24** | | ties to the deduction total to the cent |

This is R2's derivation, measured working on staged data. It survives the simplification because
owner-operator income depends on it — and it survives as **a join, not a table**. No code list is
maintained, and the next code the bookkeeper invents classifies itself.

**July under the split** — both columns add back to the printed net income exactly:

| | Company fleet | Owner-operator | Total |
|---|---:|---:|---:|
| Trucks | 163 | 9 | **172** |
| Miles | 1,480,417 | 71,920 | **1,552,337** |
| Revenue | 4,590,612.95 | 237,576.29 | **4,828,189.24** |
| Expenses | 3,832,460.63 | 225,682.75 | **4,058,143.38** |
| **Net** | **758,152.32** | **11,893.54** | **770,045.86** |
| Revenue / mile | 3.10 | 3.30 | 3.11 |
| Cost / mile | 2.59 | 3.14 | 2.61 |
| **Net / mile** | **0.51** | **0.17** | **0.50** |

### 1.4 The income statement layout is a read, not a build

Two properties of the staged master, both checked rather than assumed:

- **`type_id` gives the section breaks** — Revenue, Operating Expenses, General & Admin Expenses,
  Income Tax Expense. The same sections, in the same order, as the printed statement.
- **Sorting by `glid` inside a section reproduces the printed line order exactly.** Verified
  against the July PDF: 30210000 Additives → 30220000 DEF → 30230000 Shop Parts → 30240000 OTR
  Repairs over $1000 → 30250000 OTR Repairs under $1000 → … line for line.

So the income statement page renders rows we already hold. What it must NOT do is key on the name:
McLeod truncates `gl_account.descr` at **28 characters at source**, so three distinct revenue
accounts all read `Gross Trucking Income` and two expense accounts read
`Subcontracted Labor: Bonus`. The account code prints beside the name (G3).

### 1.5 Distance: why Samsara is the denominator and McLeod cannot be

Measured 2026-09-03 in answer to two questions — do we collect McLeod's empty miles, and are
Samsara's miles actually better.

#### 1.5.1 McLeod holds no empty miles. Not uncollected — absent.

D-MC15 said this and it was re-verified against staged July data, including the one column whose
name suggests otherwise:

| Candidate | July 2026 | Verdict |
|---|---:|---|
| `movement.move_distance` → `loaded_miles` | 1,336,507 | loaded legs only, by definition |
| `movement.fuel_distance` → `fuel_miles` | 1,341,896 | **0.4% above loaded — not empty miles.** The name misleads |
| `stop.move_dist_from_previous` | **null on every stop** | never populated |
| `billing_empty_distance` | **null on all 1,415 bills** | never populated |
| `settlement.pay_distance`, both manifest distance columns | 0 across the year (D-MC15) | never populated |

So the answer to "do we also pull empty miles" is: **there is nothing to pull.** This is a
property of the carrier's McLeod configuration, not a gap in the collector, and no extraction
change reaches it. The only McLeod-side route to deadhead is to INFER it — `inferDeadheadLegs`
computes leg distance between one movement's last stop and the next movement's first stop from the
lat/lon that ARE present. That is an estimate, it was built for the per-truck harness, and under
this plan nothing needs it.

#### 1.5.2 Samsara is better on three counts, each measured

1. **Actual, not routed.** `move_distance` is a routing estimate for the loaded leg. Samsara is
   GPS and odometer.
2. **It contains the empty miles McLeod cannot see.** July, over the 159 trucks both sources
   cover: median truck **+17.1%**, fleet **+15.5%** (1,543,494 against 1,335,995).
3. **It is calendar-month by construction, and McLeod's mileage is not.** This is the one that
   decides the matter. McLeod movements are windowed on `xfer2settle_date` — a settlement transfer
   date, median **4.3 days** after delivery, and **208 of July's 2,634 settled movements (7.9%)
   were delivered in June**. Billing is windowed on `bill_date`, later still. The general ledger is
   calendar-month. **Using McLeod mileage would divide calendar-month dollars by settlement-month
   miles**, and the error would be invisible because it is small, one-sided and self-cancelling
   across the year — which is precisely the class of error this programme exists to refuse.

That timing mismatch also explains the 26 of 159 July trucks whose Samsara miles read BELOW their
McLeod loaded miles, which is physically impossible: their loaded miles were driven in June and
settled in July.

#### 1.5.3 Samsara's own limit: coverage, and it bites the first two months

Samsara is the better source and it is not a perfect one. Trucks that delivered a load in the
month, against trucks Samsara measured in the same month:

| Month | Trucks that delivered | Trucks Samsara measured | Gap |
|---|---:|---:|---:|
| 2026-01 | 139 | 130 | **−9** |
| 2026-02 | 151 | 135 | **−16** |
| 2026-03 | 149 | 149 | 0 |
| 2026-04 | 155 | 157 | +2 |
| 2026-05 | 154 | 158 | +4 |
| 2026-06 | 155 | 170 | +15 |
| 2026-07 | 160 | 172 | +12 |

January and February are missing 7% and **11%** of the running fleet from the denominator, which
inflates cost per mile by roughly the same proportion — February's $2.86 would fall near $2.59 on
a complete denominator. From March the gap closes and then reverses, which is correct: Samsara
measures trucks that ran without delivering (repositioning, shop, out-of-service moves) and
billing does not see them.

Hence D-FLEET5's two eras. Today the coverage question is closed: in July exactly **2** trucks
that carried a load had no Samsara miles, between them **512 miles — 0.04% of the month**.

#### 1.5.4 Two denominators, two questions, both printed — G9

A single per-mile figure hides the most actionable number in the report. Miles driven (Samsara)
against miles billed (`mcleod_billing.distance`, re-dated to `delivery_date` so both sides are on
the driving clock, not the invoicing clock):

| Month | Driven | Billed | Empty | Empty % |
|---|---:|---:|---:|---:|
| 2026-03 | 1,370,444 | 1,391,350 | −20,906 | −1.5% |
| 2026-04 | 1,492,407 | 1,348,180 | 144,227 | 9.7% |
| 2026-05 | 1,563,003 | 1,322,679 | 240,324 | 15.4% |
| 2026-06 | 1,574,109 | 1,438,262 | 135,847 | 8.6% |
| 2026-07 | 1,552,337 | 1,389,814 | 162,523 | **10.5%** |

**Cost per mile driven** is what the fleet burned. **Revenue per mile billed** is what the loads
were priced at. The gap between them is the cost of running empty, and it is the figure a boss can
act on — July: $3.11 earned per mile driven against $3.64 per mile billed. Both print, each
labelled with its own denominator, and neither is ever called "cost per mile" unqualified.

March's −1.5% is the residual of the same clock problem: `delivery_date` re-dates the bill to the
day the load was delivered, but a truck's empty run to the next pickup falls in whatever month it
happens. The month-edge noise is small and stated; the figure is reported as a trailing
three-month average alongside the month so an edge effect cannot read as a trend.

### 1.6 Finance and Fuel will print different fuel numbers, and that is correct

A consequence of D-FLEET4 that has to be stated on the page rather than discovered by a reader.
Finance shows what McLeod booked; the Fuel section shows what the card was charged. July 2026:

| | July $ | What it is |
|---|---:|---|
| EFS card lines, ULSD | 1,018,807.92 | retail, before the card discount |
| GL `40050000 Fuel for Hired Vehicles` | 972,820.53 | what the carrier owed and the ledger recorded |

The difference is the fuel-card discount, and both numbers are right for their own question. So
the income statement's fuel row carries the hover *"as booked in McLeod, after card discounts —
the Fuel section shows card charges before discount"*, and the Fuel section carries the mirror of
it. Two numbers with two labels is honest; two numbers with one label is how a boss stops trusting
a report.

### 1.7 Dispatchers compute today

`mcleod_billing` carries `dispatcher_name`, `total_charges` and `distance` on **all 1,415** July
bills. July, top six of ~14:

| Dispatcher | Loads | Revenue | Miles | $/mile |
|---|---:|---:|---:|---:|
| Chris | 120 | 376,717.10 | 96,344 | **3.91** |
| pete | 159 | 490,637.33 | 128,036 | **3.83** |
| robert | 141 | 446,776.61 | 118,531 | **3.77** |
| Arture Krianha | 117 | 347,040.57 | 92,974 | **3.73** |
| ROMAN | 129 | 457,669.69 | 124,489 | **3.68** |
| kane | 128 | 500,815.54 | 136,431 | **3.67** |

**Correction, 2026-09-03, made while building G2:** an earlier draft of this plan said the
rate-per-mile column reads `billing_loaded_distance` and therefore printed a dash for every
dispatcher. It does not. Migration 0275 added plain `distance` for exactly this reason, the reader
selects it (`financialReads.ts:132`), `dispatcherEarnings.ts` sums it, and `BillingPage.vue` shows
both columns. Verified end to end against production July: all 1,415 bills booked, 1,383 carrying a
distance, 1,326,922 billed miles over $4,994,450.85 — a rate of $3.76 per mile fleet-wide.

**So G2 was already built and needed no change.** The two empty columns beside it are also already
decided: 0275 keeps `billing_loaded_distance` and `billing_empty_distance` deliberately, as the
record that McLeod asserts nothing in them, and deleting them would erase the measurement that says
so. The plan claimed a defect that the code had already fixed; the claim is corrected here rather
than left standing, and nothing was "repaired".

### 1.8 Weekly reporting — what each source would need

Asked 2026-09-03. Answered per collector, because the answer is different for each and the
difference is the whole point of D-FLEET9.

#### 1.8.1 Money: the source is already daily. Our collector throws that away.

`gl_ledger.transaction_date` is on **every line**. `GL_CONTROL_TOTALS`
(`tools/mcleod-agent/queries.mjs:643`) groups by `(post_module, glid)` over a window the caller
supplies, and `ledger.mjs` calls it once per calendar month. **The monthly grain is our
aggregation, not the source's** — a textbook case of a collector making a reporting decision.

The fix is small and it is D-FLEET9 applied: add the transaction date to the `GROUP BY`, stage at
**daily** grain — `(org, company, date, glid, post_module, line_count, net, abs)` — and let the
harness sum to a week, a month, a quarter or a custom range. Volume is not a concern: July's whole
expense side is **10,254 ledger lines**, so daily grain is bounded by that and realistically lands
near 2,000 rows a month against the 140 we store now.

Doing this also retires the month-shaped plumbing around it — `monthsTouching`,
`replace_mcleod_gl_month`'s month argument, and the month-aligned-window guard the old harness
needed before it could anchor on a GL total.

#### 1.8.2 Miles: monthly by the vendor's API, and we keep no history to derive from

Two separate walls, both measured in the code:

- **The IFTA endpoint is monthly by design.** `samsaraIftaSync.ts` fetches a named month, and
  asking for the month in progress returns **HTTP 400** — a fact recorded in that file after a
  backfill in which seven months landed and August failed. There is no week parameter to pass.
- **The stats feed reads odometer and stores only the latest value.** `samsaraStatsFeed.ts`
  patches `vehicles.current_odometer` and keeps no time series, so no daily or weekly distance can
  be differenced out of what we hold. `vehicle_engine_days` carries drive, idle and off **seconds**
  and no distance at all.

So weekly miles is a **new collector**: daily odometer snapshots per vehicle, from which a week's
distance is a subtraction, or Samsara's distance-over-range report if its API offers one — which
must be verified against the vendor documentation before the table is designed, not assumed from
the endpoint name. Either way it is one collector, and it is the only new one this plan would
need for weekly.

Deriving weekly miles by splitting a monthly figure is refused (D-FLEET8): that is an allocation
wearing a measurement's clothes.

#### 1.8.3 The finding that decides the shape: a quarter of cost is not event-dated

This is the one that matters, and it is why "can we do weekly" is not the same question as "can we
window smaller". July's expense side, by whether the posting module dates a real event or a
bookkeeping entry:

| | Amount | Lines | $/line |
|---|---:|---:|---:|
| **Event-dated** — SET, FUEL, DRS, DED, OFF, AP, and the small tail | 2,992,899.82 | 10,210 | 293 |
| **Journal** — GJ, RJ | **1,065,243.56** | **44** | **24,210** |
| | | | **26.2% of cost, on 44 lines** |

VIP Lease posts as six journal lines totalling $700,000. Insurance, officer salaries and payroll
tax are most of the rest. These are month-end batch entries, so a weekly cost per mile computed
from them would show three cheap weeks and one enormous one — **arithmetically correct and
operationally meaningless**, which is the most dangerous kind of wrong number a report can carry.

> **D-FLEET10 — a weekly view reports what happens weekly, and names what does not.** Revenue,
> miles, loads, empty percentage and the event-dated cost families are weekly figures. Costs that
> post as monthly journals are shown as their own labelled block, at their monthly value, excluded
> from the weekly cost-per-mile — never spread across weeks, because spreading is allocation and
> D-FLEET8 refuses it. The weekly tab says in plain words which costs it contains and which it does
> not. Monthly stays the P&L; weekly is the activity and revenue view.

#### 1.8.4 What weekly costs, in order

| | Step | Enables |
|---|---|---|
| 1 | Daily GL grain (§1.8.1) — agent query, staging column, RPC, reader | any money period; retires the month-aligned guard |
| 2 | Weekly revenue, miles-free — billing by `delivery_date`, loads, revenue per billed mile | most of the value, before the mileage collector exists |
| 3 | Daily vehicle-distance collector (§1.8.2) — **verify the Samsara API surface first** | weekly miles, and therefore weekly per-mile figures |
| 4 | The weekly tab under D-FLEET10 | the view itself |

Steps 1 and 2 are ours and unblocked. Step 3 is a vendor-capability question that gets answered
before it gets designed. **None of it changes the harness's shape** — the period is already a
parameter under D-FLEET6; these steps only widen what the collectors can offer it.

---

## 2. The report

One Finance section, four tabs. Plain word leads, industry term in the hover, method behind
`ExplainerPanel`. One table per tab, everything paginates.

### 2.5 The harness contract — the thing that is actually built

Stated before the tabs, because the tabs are a rendering of it and this is what the work is.

Collectors and harness stay separated as they are. A collector lands what a source asserts,
verbatim, at the source's own finest grain, and asserts nothing about periods or reports. The
harness is pure — no clock, no randomness, no I/O — and takes a period and a set of collected rows
and returns the whole report. Every figure on every tab comes out of one call.

```
computeFleetReport(
  period:        { from: Date; to: Date },        // any range; the caller decides
  ledger:        LedgerRow[],                     // glid, post_module, date, net, abs, line_count
  accounts:      GlAccount[],                     // glid, descr, type_id   (sections + print order)
  miles:         VehicleMiles[],                  // vehicle, period, measured miles
  settlements:   SettlementRow[],                 // payee_type, tractor, pay      (owner-op split)
  deductions:    DeductionRow[],                  // payee_type, glid, amount      (owner-op income)
  bills:         BillRow[],                       // dispatcher, tractor, distance, charges, dates
  rules:         FleetRules,                      // company scope; nothing to tune, by design
) => FleetReport
```

and `FleetReport` carries, computed and never configured:

| Output | Derived from | Refuses to guess |
|---|---|---|
| `revenue`, `expenses`, `net` | ledger × account class, summed over the period | an account whose class is unknown is its own reported line, never folded in |
| `milesDriven`, `truckCount` | mileage rows in the period | `null` when coverage is incomplete (G10), never a smaller number |
| `milesBilled`, `emptyMiles`, `emptyPct` | bills re-dated to delivery, against driven | `null` when either side is `null` |
| `revenuePerMileDriven` / `PerMileBilled`, `costPerMileDriven`, `netPerMile` | the above | `null`, never 0, when a denominator is absent (D-FIN10) |
| `ownerOperator` / `company` split | settlement `payee_type`; deduction class from the account it posts to | a deduction with no `glid` is reported unruled, with its dollars |
| `incomeStatement[]` | ledger grouped by class then `glid`, month and period-to-date | print order is `type_id` then `glid`; never the description |
| `dispatchers[]` | bills by dispatcher: loads, revenue, billed miles, rate per mile | `null` rate when a dispatcher's bills carry no distance |
| `tieOut` | company + owner-operator against the ledger | **residual ≠ 0.00 and the report refuses to render** |

Three properties this contract has to hold, each pinned by a test that must fail when the term is
removed:

1. **Every published figure is a pure function of collected rows.** No constant in this module is a
   dollar amount, a truck count, a month, or a rate. The §1 measurements appear ONLY as fixtures.
2. **The period is a parameter throughout.** Nothing inside computes a month boundary. What periods
   the product offers is a collector question (§1.8), never a harness one.
3. **The tie-out is a precondition, not a display.** §1.1 and §1.3 tie today; the harness asserts
   the same identity on every call and refuses rather than prints when it fails.

The acceptance fixtures are the §1 tables, loaded from a JSON snapshot of real staged rows:
`computeFleetReport` over July's rows must return §1.3's split to the cent, over each of the seven
months must return §1.2's row, and over January must return money with `null` rates (§1.5.3).
Mutation-test each: drop the owner-operator term and the July fixture must fail.

### Tab 1 — Overview

The month, and the year to it. Six figures at the top: **earned**, **spent**, **kept**, and each
of those per mile, with the previous month beside them. Below, the company / owner-operator /
total table of §1.3. Below that, the twelve-month trend of §1.2 as one chart of three lines.

The header states its provenance in one line: *"July 2026 · McLeod ledger swept 3 Sep 2026 · ties
to the ledger, residual $0.00 · 172 trucks, 1,552,337 measured miles."*

### Tab 2 — Income statement

The GL as the bosses already read it: section, account code, account name, this month, % of
revenue, year to date, % of revenue. Sorted the way McLeod prints it (§1.4). Every row expands to
the posting modules behind it, which is how a reader gets from "Fuel for Hired Vehicles
$972,820.53" to "5,777 FUEL-module ledger lines".

Above the table, the **family summary** (G6): ten rows, not ninety-four — fuel and fluids, driver
and contractor pay, truck fixed costs, maintenance, jurisdictional, tolls, company overhead — each
as dollars, per mile, and per cent of revenue. A ninety-four-row statement is a document; a
ten-row summary is an answer, and the answer is what changes strategy.

### Tab 3 — Per dispatcher

Rank, dispatcher, loads, revenue, billed miles, **rate per mile**. Sortable, ranked, with the
fleet average as a reference line.

### Tab 4 — Per truck

Only the columns that are 100% precise per truck: unit, measured miles, revenue, revenue per mile.
No cost column, no fuel column, no allocated anything — because no cost figure per truck is
precise and this plan does not print a figure it cannot defend. A truck without measured miles
prints a dash, never a zero (D-FIN10 stands).

---

## 3. What we build — the G-series

Each is one PR, gates green. Nothing here is blocked on a vendor, a credential, or a signature.

| # | Step | What it is | Blocked on |
|---|---|---|---|
| **G1** | **The fleet harness** | **BUILT 2026-09-03** — pure harness, service, route. | — |
| **G2** | **Dispatcher rate per mile** | **ALREADY BUILT** — verified end to end 2026-09-03 (§1.7). Migration 0275, the reader, the service and the page all use `distance`; the two empty columns are documented rather than deleted, by 0275's own decision. No work. | — |
| **G3** | **Income statement tab** | **BUILT 2026-09-03.** `buildIncomeStatement` (pure, shared), `getIncomeStatement` (service, month-widening, months-missing), `GET /api/accounting/income-statement`, `IncomeStatementTable.vue`, and a fourth tab on the cost-per-mile page. | — |
| **G4** | **Active-truck rule** | **BUILT 2026-09-03** with G10 — they are one measurement. `assessMileageCoverage` / `periodDenominator` (pure), `getMileageCoverage` (service, both collectors), `GET /api/accounting/mileage-coverage`, and a banner above the tabs. | — |
| **G5** | **Overview tab** | **BUILT 2026-09-03** — headline figures, the three-column split, the two denominators, and the twelve-month trend beneath them. | — |
| **G6** | **The family summary** | **BUILT 2026-09-03**, map signed by the owner the same day. Ten families of expense and four of income over the 100 accounts that posted; `GL_FAMILIES` + `buildFamilySummary` (pure), carried on `/fleet-report` because it needs the miles as well as the lines, `FamilySummaryTable.vue` above the income statement. | — |
| **G7** | **The removals and the rename** | §4, as its own PR after G1–G5 are live. **Also the rename:** the page is called "Cost per mile" in the nav and now leads with an overview and carries an income statement. The route name, `route.meta.title` and the nav entry move together, with `routeGates` and the section matrix. | G1–G5 |
| **G8** | **Provenance line and the retained tie-out** | The monthly close keeps running as the internal proof; its verdict prints as one line in `PageHeader` instead of as a page. | G1 |
| **G9** | **Two denominators and the empty-mile figure** | **BUILT 2026-09-03.** Miles driven beside miles billed and the empty percentage between them (in `FleetReport`), plus the twelve-month trend of earned/spent/kept per mile — `computeFleetTrend`, `getFleetTrend`, `GET /api/accounting/fleet-trend`, `FleetTrendChart.vue`. | G1, G2 |
| **W1** | **Daily GL grain** | §1.8.1 — the agent groups by transaction date, staging carries it, the replace RPC and its reader follow the deploy-window rule. Retires `monthsTouching` and the month-aligned-window guard. | nothing |
| **W2** | **Weekly revenue and activity** | Bills by `delivery_date`, loads, revenue per billed mile, empty percentage — weekly, before any mileage collector exists | W1, G2 |
| **W3** | **Daily vehicle-distance collector** | §1.8.2 — **verify the Samsara API surface against vendor documentation first**, then daily odometer snapshots or a distance-over-range read | vendor capability |
| **W4** | **The weekly tab** | D-FLEET10: weekly revenue, miles, activity and event-dated costs; monthly journals as their own named block, never spread | W1–W3 |
| **G10** | **The mileage-coverage guard** | **BUILT 2026-09-03** with G4. Computed from two counts, never a date. | — |
| **G11** | **The ledger-coverage guard** | **BUILT 2026-09-03.** The money-side twin of G10, and found by a live defect rather than designed: a month swept before it ended is not that month. `assessLedgerMonths` (pure), `readLedgerForPeriod` / `getFleetTrend` exclude such months from the period AND the year to date, and the overview withholds its figures instead of printing zeros. | — |

**Ordering:** G2, G3, G4, G10, G1, G5, G9, G11 and G6 — done. **Next G7**, which is now the only
remaining G-step: the removals and the page rename. G7 last, so nothing is deleted before its
replacement is live — and every replacement is now live.

The **W-series runs after G5** — the monthly report has to be right before a second period is
offered — except W1, which can ship any time and is worth shipping early because it removes
month-shaped plumbing from three places rather than adding to it.

---

## 4. What we delete — G7

Deletion is a step with a PR, not a side effect of another step. Nothing here is removed until the
tab that replaces it is live.

| Removed | Why | Anything lost |
|---|---|---|
| `/accounting` — *Money in & out* (`AccountingLedgerPage.vue`, `useLedger`) | Transaction-grain money browsing is not what this section is for | Fuel transactions remain on the Fuel section's own pages |
| `/books-check` — *Books check* (`BooksCheckPage.vue`, `useMonthCloses`) | One line in a header carries the same guarantee | **The `finance_month_closes` table and its job stay.** Only the page goes (G8) |
| `/cost-schedule` — *Truck fixed costs* (`CostSchedulePage.vue`, `glMonthlyCosts.ts`) | Nothing allocates any more, so nothing needs a per-unit schedule | Nothing. The table has 0 rows and always did |
| `truck_cost_schedules` | Same | Nothing |
| Per-truck cost, fuel and allocated columns on the CPM page (`CpmTruckTable`) | No per-truck cost figure is precise; per-truck fuel belongs to the Fuel section | The precise columns survive as Tab 4 |
| The allocation apparatus — `apportion.ts`, the overhead pool, `overheadBasis`, `MilesBasis` mixing, the caveat machinery that explained it | D-FLEET8 | Nothing. Keep `apportion.ts` only if another module uses it; otherwise delete with its tests |
| The parent plan's T1–T6 and rulings R1, R3, R4, R5 | §0 | R2's *derivation* survives as the join in §1.3; R2 as a table does not |

A dropped table needs a migration and the evidence-table rules do not apply here
(`truck_cost_schedules` is not in `RETENTION_FORBIDDEN` and holds no rows). The columns removed
from the CPM contract ship one merge ahead of their readers, as always.

---

## 5. Collectors — what we have, and the little we still need

Collectors and harness stay separated exactly as they are. A collector lands the finest grain the
source asserts, verbatim; the harness does arithmetic on facts that already carry their grain.
Nothing in this plan changes a collector's contract — it changes which of them Finance reads.

### 5.1 What we already have

| Source | Table | Grain | Coverage | Finance reads it? |
|---|---|---|---|---|
| McLeod ledger | `mcleod_gl_totals` | company × month × **glid × post_module**, line count, net + abs | 1,421 rows, 2025-12 → 2026-08 | **yes — the whole money input** |
| McLeod accounts | `mcleod_gl_accounts` | glid, descr, **type_id** | 226 accounts | **yes — sections and order** |
| Samsara | `samsara_ifta_jurisdiction_miles` | vehicle × jurisdiction × month | 2026-01 → 2026-08, 130→176 trucks | **yes — the whole distance input** |
| McLeod settlements | `mcleod_settlements` | tractor, driver, order, **payee_type**, pay, dates, void | 20,693 rows | **yes — owner-operator identification and pay** |
| McLeod deductions | `mcleod_deductions` | payee, payee type, tractor, code, D/R/E, **glid**, amount | 10,158 rows | **yes — owner-operator income classes (§1.3)** |
| McLeod billing | `mcleod_billing` | invoice, customer, order, tractor, **dispatcher**, `distance`, charges, canceled | 1,415 July rows | **yes — dispatcher tab, per-truck revenue** |
| McLeod movements | `mcleod_movements` | tractor, trailer, drivers, orders, miles, stops | 2,634 July rows | order↔truck lookup only |
| McLeod AP vouchers | `mcleod_ap_vouchers` | vendor, invoice, dates, amount, `ap_glid` | 1,464 rows | no — inside the ledger already |
| McLeod roster | `drivers` / `vehicles` / `trailers` | identity, service status | 164 / 190 / 235 | unit numbers only |
| **EFS SOAP** | `efs_transactions`, `fuel_transactions`, `efs_cards`, … | product line item, unit, driver, instant, settled cost, station | 2026-02-04 → live | **no — D-FLEET4.** Collection continues in full for the Fuel section |
| Samsara engine | `vehicle_engine_days` | vehicle × day, drive/idle/off seconds | 186 vehicles | no — **carries no distance** |

### 5.2 What we still need — the whole list

| # | Need | Kind | Blocked on |
|---|---|---|---|
| 1 | `mcleod_billing.distance` read instead of `billing_loaded_distance` (NULL on every row), and a ruling on which of the three distance columns is authoritative | classification | nothing (G2) |
| 2 | The active-truck rule, stated and printed | classification | nothing (G4) |
| 3 | The owner-operator deduction join wired into the harness | harness | nothing (G1) |
| 4 | Account code printed beside the name, because `descr` is truncated at source and is not unique | presentation | nothing (G3) |
| 5 | The ~10-family map over ~100 active accounts, signed once | classification | one owner sitting (G6) |
| 6 | `mcleod_office_lines` backfill — 0 rows against a live endpoint | ops | nothing. *Not required by this plan* — the money is already in the ledger. It buys the name behind $289,921/month if a boss asks |

**Nothing on this list needs a vendor, an API key, a credential, or a contract register.**

### 5.3 Collector work this plan deliberately does not do

Recorded so a later reader knows these were decided, not forgotten. Each becomes worth building
the day the report needs a grain finer than the fleet — which is the expansion path D-FLEET1
leaves open, not a debt it creates.

- **`fuel_detail` staging.** `FUEL_PURCHASES` (`tools/mcleod-agent/queries.mjs:348`) reads 27
  columns including the product split, `movement_id` and `post_key`, and `agent.mjs` never posts
  them. Still the right collector to build first if per-load fuel is ever wanted; not needed now.
- **FleetPal, tolls, the per-unit contract register.** Deleted from scope by §0, not deferred with
  a date. If per-truck cost returns, they return with it.
- **A weekly or daily mileage feed.** D-FLEET6 is a constraint of the only mileage source we have.
  A weekly Finance view means a new Samsara collector; a filter cannot produce it.
- **Deadhead inferred from McLeod stop coordinates** (`inferDeadheadLegs`). Built for the per-truck
  harness and correct for what it does, but it is an estimate, and Samsara measures the same thing
  directly (§1.5.2). It stays in the codebase for whatever still calls it and Finance does not use
  it. If nothing calls it after G7, it goes with the rest of the allocation apparatus.

---

## 6. What this plan refuses to do

- **No figure that is not a measurement or a stated sum of measurements.** No allocation, no basis,
  no apportionment — there is nothing left to allocate (D-FLEET8).
- **No per-truck cost column**, however plausible. The columns on Tab 4 are the ones that are
  precise, and adding a cost column later requires a source, not a rule.
- **No number where a measurement is absent:** a dash and a stated count, never a zero (D-FIN10).
  This now covers a whole month: a per-mile figure over a denominator missing part of the fleet is
  a measurement that is absent, not a measurement that is rough (G10).
- **No per-mile figure without its denominator named.** "Cost per mile driven" and "revenue per
  mile billed" are different questions with different divisors, and neither is ever printed as
  "per mile" alone (G9).
- **No page without its provenance.** Every tab states the sweep date and whether the month ties.
  Removing the Books check page removes the page, not the check (G8).
- **No deletion before its replacement is live** (G7 runs last).
- **No figure typed where a figure can be derived.** No dollar amount, truck count, month or rate
  is a constant in the harness. The measurements in §1 are acceptance fixtures and nothing else
  (§2.5).
- **No collector that pre-aggregates to a reporting period** (D-FLEET9). Where one does today and
  stopping is free, it stops (W1).
- **No weekly figure for a cost that does not happen weekly** (D-FLEET10). A monthly journal is
  named at its monthly value, never divided by four.
- **No open question in this file.** One appears, it gets a decision here before code moves.

---

## 7. Progress log — append one dated line per step, never edit the §3 table

Adjacent table rows conflict when parallel PRs each mark their own. The table is the plan; this is
the record.

- 2026-09-03 · plan written. D-FLEET1–8; supersedes the go-live plan's §4/§6 and the attribution
  plan in full. Measured first: the fiscal YTD ties to the printed statement to the cent on both
  sides, seven months of fleet cost-per-mile already exist in staged data, and the owner-operator
  deduction classes derive from the GL account join with no code table.
- 2026-09-03 · distance analysis added as §1.5, in answer to "do we pull McLeod's empty miles, and
  is Samsara really more precise". Both answered by measurement: McLeod holds no empty-mile figure
  in any of five candidate columns (`fuel_distance` is 0.4% above loaded, not empty miles), and
  Samsara wins on three counts — actual not routed, +15.5% fleet-wide because it contains the empty
  miles, and calendar-month by construction where McLeod's mileage sits on a settlement clock 4.3
  days late with 7.9% of July's movements delivered in June. The measurement also found Samsara's
  own limit: coverage was 9 and 16 trucks short in January and February, so D-FLEET5 splits into
  two eras — money from 2025-12, per-mile from 2026-03 — and G10 makes that a computed rule rather
  than a date. G9 adds the second denominator and the empty-mile figure (July: 10.5%).
- 2026-09-03 · plan re-framed after owner feedback that it read as a set of computed answers rather
  than as a specification for computing them. §2.5 is now the harness contract — signature,
  outputs, what each refuses to guess, and the three properties a test must pin — and §1 says
  plainly that its tables are acceptance fixtures over real staged rows, never content.
  D-FLEET6 restated: the period is a harness parameter, and what the product offers is a collector
  question. D-FLEET9 added: collectors stage the finest grain the source asserts.
- 2026-09-03 · weekly feasibility answered per collector (§1.8). Money is already daily at source —
  `gl_ledger.transaction_date` is on every line and the monthly grain is ours, not McLeod's, so W1
  removes it. Miles are monthly by Samsara's API (the IFTA endpoint takes a named month and 400s on
  the month in progress) and the stats feed keeps only the latest odometer, so weekly miles needs
  one new collector and a vendor-capability check first. The finding that shapes the tab: 26.2% of
  July's cost is 44 journal lines averaging $24,210 — VIP lease, insurance, payroll — so D-FLEET10
  keeps monthly journals out of any weekly per-mile figure and names them instead of spreading them.
- 2026-09-03 · **G2 — no change needed.** Building it found the plan wrong: the dispatcher rate
  already reads `mcleod_billing.distance`, not the empty `billing_loaded_distance`, through 0275,
  the reader, the service and the page. Verified against production July — 1,415 bills, 1,383 with
  a distance, 1,326,922 miles, $3.76 per mile fleet-wide. §1.7 carries the correction.
- 2026-09-03 · **G3 — the income statement.** `buildIncomeStatement` in
  `packages/shared/src/tmsCost/incomeStatement.ts`: pure, sections in McLeod's printed order,
  accounts by `glid` inside each (never by `descr`, which McLeod truncates to 28 characters so it
  is not unique), revenue flipped exactly once, balance-sheet classes excluded by name so that
  `unrecognisedNet` means "a class we have never seen", and a class matching neither the revenue nor
  the expense set reported as its own visible section instead of falling through — the silent drop
  §0.1 of the go-live plan found in `glIncome.ts`. `getIncomeStatement` widens a part-month window
  to the calendar months it touches, because GL totals are month-grained and prorating would be an
  allocation, and names the months the sweep has not reached. `GET /api/accounting/income-statement`
  under the existing `accounting` view gate. `IncomeStatementTable.vue` is a card per section with a
  row that opens to the posting modules behind it. 26 tests over three layers, each layer
  mutation-tested: balance-sheet exclusion, unrecognised-class folding, ordering by description,
  a null share printing as zero, a dropped org filter, hidden missing months, a collapsed fiscal
  year, a removed account code, and always-on to-date columns — every mutant killed.
- 2026-09-03 · **G4 + G10 — the truck count and the coverage guard**, built together because they
  are one measurement. `mileageCoverage.ts` (shared, pure): a month is complete when Samsara
  measured at least every truck that delivered a load, the truck count for a period is the busiest
  month rather than a sum, and a short month yields `null` for miles, for the truck count and for
  the empty-mile figure — with a reason naming which months and how many trucks, because "two
  months are incomplete" sends a reader looking for which. More measured trucks than delivering
  ones is HEALTHY, not an error: those ran without delivering. `getMileageCoverage` reads both
  collectors through their own interfaces — `readMonthlyMileageByMonth` keeps months apart where
  the existing reader collapses them, and `readBilledMilesByDeliveryMonth` buckets bills on
  **delivery date**, since bucketing July on invoice date puts February's empty miles at −8.8%.
  Cancelled bills are excluded. `GET /api/accounting/mileage-coverage`; a banner above the tabs
  states either the truck count and the empty percentage, or the reason there is no rate.
  19 tests, mutation-tested at both layers: every-month-complete, extra trucks counted as missing,
  the truck count summed across months, empty miles computed for a short month, cancelled bills
  counted, and bucketing on `bill_date` — all six killed. The API tests use filtering fixtures
  rather than flat arrays, because the recorder records filters without applying them and a flat
  array answers "April" with March's rows.
- 2026-09-03 · **G1 (harness half) — `computeFleetReport`.** Pure, period-parameterised, no constant
  in the file is a dollar, a truck count, a month or a rate. Totals come from the ledger unaltered;
  the contractor column is DERIVED from the subledgers; the company column is the remainder — an
  ordering chosen so that any derivation error lands in one named place with the contractor side's
  own inputs printed beside it, rather than in a residual quietly absorbed. Contractor revenue
  follows the ORDER, never the truck, and only deductions posting to a revenue account count as
  income: July's $53,917.64 of fuel advances repaid is a receivable settling, and counting it would
  overstate what contractors earn the carrier by about a quarter. Coverage gates every rate — a
  period short of trucks reports its money in full and every per-mile figure as `null` with the
  reason. Contractor miles need per-unit mileage; without it they show a dash rather than a split
  the data cannot make.

  **One mutant survived the first pass and that is the useful part of this entry.** Attributing
  contractor revenue by TRUCK instead of by order changed nothing, because every fixture order
  mapped one-to-one to a contractor truck. Four of this carrier's eight contractor tractors are
  MIXED — the same truck ran for a contractor and for a company driver — so the fixture gained one,
  and the mutant then killed four tests. Five of six mutants died on the first run; the sixth is
  the reason the fixture is shaped the way it is.
- 2026-09-03 · **G1 (service + route) and G5 (Overview tab).** `ledgerPeriod.ts` factors the month
  widening and the fiscal-year comparative out of the income statement so both services answer
  "which months did this cover" identically. `getFleetReport` issues six reads in parallel through
  the owning collectors' interfaces and does no arithmetic: voided settlements out, unposted bills
  out (the D-MC12 predicate every other revenue figure uses), deduction classes read from the chart
  of accounts already loaded for the ledger, Samsara miles re-keyed to tractor unit.
  `GET /api/accounting/fleet-report`. `FleetOverview.vue` leads the tabs — three headline cards, one
  three-column table (our trucks / contractors / everything) whose rows are the questions rather
  than the trucks, the contractor split's own arithmetic printed beneath so it can be checked, and
  the two denominators with what running empty costs.

  **Verified in a real browser**, not only in tests: July renders the printed statement's figures,
  and a February-shaped response renders every rate as a dash with the coverage reason above the
  tabs while the money still shows in full. The old per-truck stat strip is hidden on Overview and
  Income statement — it is the allocation harness's "earned per mile" and the overview's is the
  ledger's, and two figures under one label on one screen is how a reader stops trusting a page.
  The page description now follows the tab for the same reason. **Owed:** the twelve-month trend
  chart (G9), and the page rename, which belongs with G7.

  Seven service tests and eight component tests, all mutation-tested: voided settlements counted,
  unposted bills counted, every deduction typed as revenue, per-unit miles dropped, an absent rate
  rendered as $0.00, the empty-mile block always shown, and the contractor column duplicating the
  company's — every mutant killed.
- 2026-09-03 · **G9's trend chart — the last of the overview.** Twelve months of earned, spent and
  kept per mile under the overview: `computeFleetTrend` (pure), `getFleetTrend`,
  `GET /api/accounting/fleet-trend?to=&months=`, `FleetTrendChart.vue`. Three refusals are the
  content of it. A month whose mileage coverage was short of its fleet keeps its money and loses its
  rates, and the line BREAKS over it rather than being drawn through — a rate over a denominator
  missing eleven per cent of the trucks is the plausible-but-wrong figure this section exists to
  refuse, and a chart is the fastest way to publish one. A month the McLeod sweep has not reached is
  named under the chart instead of plotted at zero, because a drop to the axis is the most alarming
  shape a finance page can draw and it would be an artefact of an unfinished sweep. And the reason a
  month carries no rate is `periodDenominator` over that single month — the same rule, in the same
  words, as the banner above the tabs, so one refusal never gets two explanations.

  **Why it is its own endpoint.** The report and the trend cover different windows: the report reads
  the period the reader picked plus its fiscal year to date, the trend a fixed span of whole months
  ending at it. Folding them together widens every report read to a year for a chart the reader may
  never scroll to.

  **`chartTheme.ts` moved from `features/dashboard/` to `lib/`.** A feature may not import a sibling
  feature's internals (`lint:boundaries`) and finance is the second feature to need the palette; the
  alternative was a second copy of the colour resolver, which is how a product ends up with two chart
  looks and no way to change either. Three new tokens — `--viz-money-earned/-spent/-kept` — carry the
  cost palette's own hues on purpose and are validated under their own names by
  `check-chart-colors.mjs`, so three lines on one chart stay separable under protan, deutan and
  tritan simulation. Colour is never the only cue: every line is named in the legend and in the index
  tooltip that lists all three at once.

  **Verified in a real browser** by the recipe in §3.4, in both states: seven months where January
  and February are holes in the line with their reasons printed beneath, and a February-only span
  where there is no line at all and the reasons ARE the answer.

  Ten pure tests, seven service tests and nine component tests, all mutation-tested — eighteen
  mutants, every one killed: an unswept month plotted at zero, kept-per-mile taken as the difference
  of two rounded rates (March: 0.37 against the true 0.36), coverage ignored, the series reversed,
  the refusal reworded, a month's ledger given its neighbours' rows, a month's bucket keeping only
  its last row, the span counted back one month short, the window read unbounded, unswept months
  dropped silently instead of named, the coverage read given the exclusive bound, the gaps drawn
  through, a null rate rendered as zero, one colour for three lines, reasons repeated per month, a
  chart drawn with nothing to plot, the three lines given one shared name so the legend vanished,
  and the twelve-month window cut to six.

  **Two of those eighteen survived their first pass, and both were invisible in the output.** A
  ledger read with no upper bound and a coverage read given the exclusive bound both fetch months
  that are never plotted, so no assertion about the returned figures can see them; they died once
  the test asserted the QUERY — the `period_start` bounds the service issued, and the three Samsara
  month reads it made. A wasted read is not a wrong number, but it is the same class of defect: the
  service asking for something other than what it means.
- 2026-09-03 · **G11 — the ledger-coverage guard. Not planned; found by measuring production for
  G6.** Pulling the chart of accounts turned up a ninth ledger month nobody had looked at: August
  2026, holding $8,430.00 of expense, **no revenue at all**, and eleven lines. The financial sweep
  is run by hand behind the carrier's VPN and the last run was **2026-08-28 — four days before the
  month ended**. Nothing distinguished that from a finished month, because the only test anything
  applied was "does this month have rows" (`getLedgerCoverage`'s `sweptMonth: totals.length > 0` is
  that rule, verbatim).

  **It was on the screen.** The page opens on the last full calendar month, which on 2026-09-03 is
  August, so the finance overview said the fleet **earned $0.00, spent $8,430.00 and kept
  -$8,430.00**, and the twelve-month trend shipped that morning drew a cliff to the axis on its
  final point. Every figure was computed correctly from the rows that were there. That is the whole
  problem, and it is not a one-off state: it recurs every month between the 1st and the next sweep.

  **The rule is a comparison the rows already carry.** `period_end` is McLeod's own exclusive bound
  for the month and `swept_at` the run that staged it, so a month is complete when the sweep is
  dated strictly after the month ended - no date constant, and it keeps working for a sweep that
  stops for a fortnight next spring. Strictly after, not on: `swept_at` is UTC and the entries are
  booked in US local time, so a sweep at 00:30 UTC on the 1st ran the previous evening where the
  work happened. And the **oldest** sweep behind a month decides it, not the newest -
  `mcleod_gl_totals` is keyed per company as well as per month, so a month can hold one company
  swept after it closed and another swept mid-month, and a fleet total built from those is short by
  one company's books. (This carrier stages one company today, so the two agree; the fixture that
  discriminates them is deliberate, because no assertion about today's data would.)

  Partial months are excluded from the period **and** from the fiscal year to date, and are reported
  as their own state - `monthsPartial`, never folded into `monthsMissing`, because "the sweep has
  not reached August" and "the sweep reached August on the 28th" call for different actions from
  whoever reads them. The overview prints no money at all rather than zeros; the trend drops the
  month and names it; the income statement carries the sentence above its sections.

  **Verified in a real browser** in both states - August withheld with the reason and the trend
  ending at July, and July unchanged. Eight pure tests, six service tests and three component tests;
  fourteen mutants, every one killed, including the two that survived first: newest-sweep-instead-of-
  oldest, which no fixture could see until a second company was added to one, and a withheld state
  that also swallowed a window whose older month WAS finished.

  **Two things this leaves owed.** `getLedgerCoverage`'s `sweptMonth` still means "has rows" - it
  feeds the Company total tab, which G7 removes, so it is named here rather than patched. And the
  sweep itself has not run since 2026-08-28: August needs a re-run before it can be reported at all,
  which is an operational act, not a code change.
- 2026-09-03 · **G6 — the family map, measured and drafted. Awaiting one signature, and that is the
  whole remaining step.** Production holds **100 P&L accounts** with a posting between 2026-01-01 and
  2026-07-31. Every one is assigned below, and the families sum to **28,687,090.14 of revenue and
  25,126,042.28 of expense — the printed statement's own fiscal year to date, to the cent, on both
  sides**. Nothing is unassigned, and nothing is assigned twice; a gate is not needed to say so
  because the tie-out says it.

  Ten families of expense and four of income (the plan's §2 asks for ten rows; revenue is the top
  line, not a family of cost). Figures are Jan–Jul 2026, signed as the statement signs them —
  positive is more of that thing, and a negative is a genuine credit balance.

| Family | Jan–Jul $ | Accounts | `glid`s |
|---|---:|---:|---|
| **Freight and fuel surcharge** | 28505865.38 | 5 | 30000001 30000002 30000000 30000031 30000032 |
| **Charged to contractors** | 223982.01 | 3 | 30100010 40100000 30080000 |
| **Detention and accessorial** | 2242.75 | 5 | 30000011 30100030 30000012 30000010 30100000 |
| **Gain and loss on sale** | -45000.00 | 1 | 30050000 |
| **Company driver pay** | 7346088.87 | 5 | 40000001 40000000 40800000 40000031 40000032 |
| **Fuel and fluids** | 6399386.60 | 4 | 40050000 30220000 30340000 30210000 |
| **Lease, insurance and interest** | 4647578.35 | 8 | 40140000 40350000 40350040 40500000 40350070 40550000 40350060 40350020 |
| **Maintenance and tires** | 1383683.90 | 15 | 40160000 30240000 30230000 30350000 30250000 30300000 30270000 30260000 40150000 30290000 30380000 40780000 30330000 30320000 30310000 |
| **Tolls, scales and unloading** | 426945.91 | 4 | 40790000 40760000 40700000 40790002 |
| **Permits, IFTA and IRP** | 407616.64 | 12 | 40230000 40310000 40210000 40200000 40190000 40260000 40170000 40320000 40290000 40240000 40220000 40270000 |
| **Recruiting and screening** | 165064.70 | 7 | 42000000 47750000 40400000 43220000 40420000 40410000 43250000 |
| **Financing and collection** | 132589.01 | 6 | 40650000 12100000 42500000 40750000 42500001 50000000 |
| **Contractor pay** | 1363531.43 | 1 | 40000002 |
| **Office and administration** | 2853556.87 | 24 | 42350000 42200000 42300000 42100000 42200010 40250000 43200000 47000000 42600020 43300000 43000000 47500000 42800000 42400000 42600030 42700000 42600000 47250000 40810000 40820000 42600010 46000000 42900000 43230000 |

  **The five calls the data cannot make, each with a recommendation** — reviewed with the owner as
  [Ten Families of Silvicom's Ledger](https://claude.ai/code/artifact/5a3d1625-6693-4a17-8afe-f7f8c8a316bc):

  1. **Contractor pay is its own family** (40000002, 1,363,531.43). The overview already reports
     contractors in their own column; a family mixing them with company drivers cannot answer what
     our own drivers cost per mile.
  2. **IRP joins IFTA and the permits** although McLeod files it under `General & Admin Expenses`
     (40230000, 317,971.96). The class an account is filed under is a bookkeeping decision and the
     family is a management one; they do not have to agree. This is the single largest instance of
     the rule that makes this map underivable.
  3. **Recruiting stands alone** (165,064.70 over seven accounts and two McLeod classes) — it is the
     overhead the carrier actively turns up and down, and inside office costs nobody can see it.
  4. **Financing and collection is a family** (132,589.01) — quick pay, bank charges, bad debt,
     discount log, negative settlements. Each is too small to see alone and they are one thing.
  5. **Unloading fees ride with tolls and scales** (40700000, 7,562.11) rather than with driver pay:
     charged per load at a dock, as a toll is charged per trip on a road.

  **Two findings for the accountants, not for the code.** `30050000 Gain on Sale` is classed as
  revenue and holds a single **debit** of 45,000.00, so the statement reads it as −45,000.00 of
  income — a loss in an account named for the happier case, or an entry on the wrong side. And July's
  tolls are 184.40 against ~52,000 a month before it (already §6 of the handoff).

  **Nothing is built.** The map is a classification and shipping an unsigned one puts a grouping
  nobody ruled on the page — which is the same failure as a per-mile figure over a short
  denominator, wearing different clothes. The code behind it is small once the map is signed: a
  `glFamilies.ts` constant in shared, an aggregation over the statement's own sections, and a block
  above the income statement. The tie-out above is the acceptance test.
- 2026-09-03 · **G6 built — the map is signed.** The owner ruled all five open calls as recommended:
  contractors are their own family; IRP joins IFTA and the permits despite McLeod filing it under
  `General & Admin Expenses`; recruiting stands alone; quick pay, bank charges and bad debt become
  one "financing and collection" family; unloading fees ride with tolls and scales. `GL_FAMILIES` in
  `packages/shared/src/tmsCost/glFamilies.ts` is that signature in code, and
  `glFamilies.test.ts`'s "keeps the owner's five rulings" pins each one — a later reader
  "correcting" an account back to its McLeod class would be undoing a ruling, and now finds out.

  **Three properties, each a refusal rather than a feature.** An account the map has never seen gets
  its **own visible family**, counted, sorted last whatever its size — never folded into the nearest
  plausible group, because a map that absorbs the bookkeeper's next invention stops being true
  without ever saying so. A line's SIDE is the statement's, never the map's: a revenue account filed
  under an expense family lands ungrouped on the revenue side rather than moving dollars across the
  statement. And the summary **ties to the statement it summarises** on both sides, with the
  difference reported rather than asserted — the page prints "these families do not add up to the
  statement below; the statement is right" instead of showing two figures that disagree.

  **It rides on `/fleet-report`, not on `/income-statement`**, because the per-mile column needs the
  period's measured miles and only that service holds them. Rendering "fuel is 64 cents a mile"
  without a denominator the report trusts is the invented figure this whole section exists to
  refuse, so `perMile` is `null` wherever G10 withheld the denominator, and prints as a dash.

  Twelve pure tests, one service test and seven component tests. Thirteen mutants, every one killed:
  unmapped accounts dropped, the map deciding a line's side, ungrouped sorted by size, the ranking
  reversed, unrecognised classes swept into families, a null rate rendered as $0.00 and as zero
  per mile, the share taken against expenses instead of revenue, the ungrouped family styled like
  any other, drift never reported, the year-to-date column always shown, income and expense merged
  into one table, and a `glid` duplicated across two families.

  **Verified in a real browser** on the income statement tab: ten expense families largest first with
  their share of revenue and cost per mile, three income families beneath, and an ungrouped row in
  amber where an account the map does not name would appear.
