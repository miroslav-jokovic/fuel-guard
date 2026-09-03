# Finance — the fleet report

**Status:** ACTIVE. **Owner:** Miki. **Written:** 2026-09-03, after two scope rulings that made
the previous programme wrong rather than incomplete.

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
  `samsara_ifta_jurisdiction_miles`, per vehicle per month.
- **D-FLEET4 — EFS keeps collecting, and is not a Finance source.** The SOAP feed continues in
  full for the Fuel section, anomalies, card control and driver work. Finance reads fuel as GL
  lines (`40050000 Fuel for Hired Vehicles`, `30220000 DEF`, `30340000 Reefer Fuel`) like every
  other expense. **This is what removes the reporting-era start date:** the old 2026-07-01 boundary
  existed only because EFS raw history begins 2026-02-04. McLeod's ledger goes back further, so
  the report goes back further.
- **D-FLEET5 — the reporting era starts 2026-01-01.** Seven complete months are already staged and
  the fiscal year-to-date ties to the printed income statement to the cent (§1.1). 2025-12 exists
  in the ledger but has no Samsara miles, so it is available as a money-only comparison and not as
  a per-mile month.
- **D-FLEET6 — the grain is the calendar month.** Not a preference: the ledger is monthly and the
  only per-vehicle mileage feed we have is monthly. A weekly view is a new collector, not a filter.
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

### 1.5 Dispatchers compute today

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

The rate-per-mile column shipped in #522 reads `billing_loaded_distance`, which is **NULL on all
1,415 bills**, so it prints a dash for every dispatcher. `distance` is populated on all 1,415.
That is G2, and it is a one-line change.

---

## 2. The report

One Finance section, four tabs. Plain word leads, industry term in the hover, method behind
`ExplainerPanel`. One table per tab, everything paginates.

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
| **G1** | **The fleet harness** | A new pure module: ledger revenue + ledger expenses + Samsara miles + truck count → the §1.2 and §1.3 tables. Replaces `computeCpm`'s allocation path entirely. The owner-operator split reads `payee_type`, the loads, and the deduction-account join of §1.3. Invariant test: company + owner-operator == ledger, to the cent, or the report refuses to render. | nothing |
| **G2** | **Dispatcher rate per mile** | Read `distance`, not `billing_loaded_distance`. Then decide which of the three distance columns is authoritative and delete or document the other two — a column that is never non-null is a claim the store cannot support. | nothing |
| **G3** | **Income statement tab** | Section + account code + name + month + YTD + % of revenue, ordered by `type_id` then `glid`. Account code printed beside the name (§1.4). Expand a row to its posting modules. | nothing |
| **G4** | **Active-truck rule** | A truck is active in a month if Samsara measured miles for it. Same source as the denominator, so the count and the miles can never disagree. Printed on every tab. July = 172 (163 company, 9 owner-operator). | nothing |
| **G5** | **Overview tab and the trend** | The six headline figures, the three-column split, the twelve-month chart, and the provenance line. | G1, G4 |
| **G6** | **The family summary** | ~10 families over the ~100 active accounts, keyed on `glid`, signed once. Recommended, not required: `type_id` alone reproduces the statement, but it cannot answer "fuel is 20% of revenue". Cannot be derived — McLeod types `40790002 Tolls OO` and `40220002 2290 OO` as `Income Tax Expense`, and `descr` is not unique. | one signing session |
| **G7** | **The removals** | §4, as its own PR after G1–G5 are live. | G1–G5 |
| **G8** | **Provenance line and the retained tie-out** | The monthly close keeps running as the internal proof; its verdict prints as one line in `PageHeader` instead of as a page. | G1 |

**Ordering:** G2 and G3 first — both are visible improvements with no dependencies, and G3 is the
tab the bosses will use most. Then G4, G1, G5 as the fleet model proper. G6 in parallel with the
owner. G7 last, so nothing is deleted before its replacement is live.

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

---

## 6. What this plan refuses to do

- **No figure that is not a measurement or a stated sum of measurements.** No allocation, no basis,
  no apportionment — there is nothing left to allocate (D-FLEET8).
- **No per-truck cost column**, however plausible. The columns on Tab 4 are the ones that are
  precise, and adding a cost column later requires a source, not a rule.
- **No number where a measurement is absent:** a dash and a stated count, never a zero (D-FIN10).
- **No page without its provenance.** Every tab states the sweep date and whether the month ties.
  Removing the Books check page removes the page, not the check (G8).
- **No deletion before its replacement is live** (G7 runs last).
- **No open question in this file.** One appears, it gets a decision here before code moves.

---

## 7. Progress log — append one dated line per step, never edit the §3 table

Adjacent table rows conflict when parallel PRs each mark their own. The table is the plan; this is
the record.

- 2026-09-03 · plan written. D-FLEET1–8; supersedes the go-live plan's §4/§6 and the attribution
  plan in full. Measured first: the fiscal YTD ties to the printed statement to the cent on both
  sides, seven months of fleet cost-per-mile already exist in staged data, and the owner-operator
  deduction classes derive from the GL account join with no code table.
