# Finance — profit and cost per mile for every truck and every driver

**Status:** PROPOSED — waits on the owner's answers in §6. **Owner:** Miki. **Written:** 2026-10-19,
from a read-only measurement of production Supabase and the McLeod sandbox (`lme_analytics`,
restored 2026-10-09 13:13Z) taken the same day.

**What this reopens.** On 2026-09-03 the owner ruled Finance a *fleet* report (D-FLEET1) with
*nothing allocated* (D-FLEET8), because no per-truck cost source was precise enough
([FINANCE-FLEET-REPORT-PLAN](./FINANCE-FLEET-REPORT-PLAN.md) §0). On 2026-10-19 the owner asked for
the opposite shape: every expense that can be related to a truck or a driver placed on it, the rest
spread over the active trucks, and the whole thing "100% precise and reliable in date cutoffs and
numbers". This plan is what that takes. It does not edit the fleet plan; if Q-TP1 is answered yes,
the fleet plan gets one dated line saying D-FLEET1 and D-FLEET8 are superseded by this file, and its
fleet totals stay exactly as they are — they become the control that every truck row must add up to.

**What changed since 09-03 that makes it defensible.** FleetPal is live (every repair job resolves
to a tractor or a trailer), EFS carries unit and driver on every fill, settlements carry tractor and
driver on every row, Samsara odometer readings are staged daily (W3b), and the ledger is staged at
daily grain (W1). The 09-03 objection was "no source"; for about two thirds of the money there now is
one, and for the rest the owner is now choosing a rule rather than asking for a measurement.

---

## 0. What "100% precise" means here

A truck's cost can be precise in one of two ways, and the report must say which, dollar by dollar:

1. **Measured** — a sub-ledger row names the truck (a settlement, a fuel fill, a bill, a repair job).
2. **Spread** — a ledger dollar no source attributes, divided over the active trucks by a rule the
   owner signed, printed on the page.

So "precise" is a property of the WHOLE, not a claim that every dollar is measured: for every month
and every expense family, **the per-truck figures add up to the general ledger to the cent**, the
measured share and the spread share are printed per truck, and nothing is counted twice or left out.
A truck row that cannot satisfy that is not printed. Same refusals as the fleet report: a dash, never
a zero (D-FIN10); a month McLeod has not closed is never presented as final.

---

## 1. Measured 2026-10-19

### 1.1 Freshness — the report can only be as current as McLeod's close

| Source | Latest row | Swept | Note |
|---|---|---|---|
| GL (`mcleod_gl_totals` / `_days`) | 2026-10-07 | 2026-10-09 from the 10-09 restore | Dec 2025 → Aug 2026 complete in modules; **Sep and Oct hold only `RJ`** |
| Settlements, deductions, billing, AP headers, movements | 2026-10-08/09 | 2026-10-09 | current at the restore, 10 days old today |
| EFS fills | today | hourly | ours |
| FleetPal service history | 2026-10-17 | today | ours |
| Samsara odometer / IFTA miles | today / Sep 2026 | today | ours |

The McLeod financial sweep still runs **by hand from a laptop against a hand-restored copy**. The
nightly feed on the live database waits on Alex's grant (request drafted 2026-10-10,
`tools/mcleod-agent/review/REQUEST-TO-ALEX-2026-10-10-FINANCE.md`); nothing in production shows it
granted. Until it is, every figure in this plan is as old as the last restore.

### 1.2 How much of the money a source can put on a truck — July 2026

July is the latest month McLeod has closed (see §1.5). Expense by signed family
(`GL_FAMILIES`), as re-swept 2026-10-09:

| Family | July $ | Share | Per-truck source | Truck-coded |
|---|---:|---:|---|---|
| Company driver pay | 1,194,536.71 | 29.2% | settlements (`tractor_unit`, `driver_external_id`) | **100%** of $1,049,670.68 |
| Fuel and fluids | 1,024,443.98 | 25.0% | EFS card lines (`unit`, driver) | **100%** of $1,081,541 |
| Lease, insurance, interest | 688,293.37 | 16.8% | **none** (§1.6) | 0% |
| Office and administration | 558,341.41 | 13.6% | none — overhead by nature | 0% |
| Maintenance and tires | 265,633.05 | 6.5% | FleetPal service history | **100%** to a tractor or a trailer; trailers ≈ ⅓ |
| Contractor pay | 225,682.75 | 5.5% | settlements | **100%** of $212,492.09 |
| Tolls, scales, unloading | 71,653.31 | 1.8% | none collected | 0% |
| Permits, IFTA, IRP | 31,966.97 | 0.8% | Samsara state miles (derivable) | 0% today |
| Recruiting, financing, unmapped | 30,844.09 | 0.8% | none | 0% |
| **Total** | **4,091,395.64** | | | |

**About 60% of expense is measured per truck today** (driver pay + contractor pay + fuel), **66%**
with FleetPal, and the remaining ~34% is spread — of which half is lease and insurance. Revenue is
almost entirely measured: 99.97% of July's billing carries a tractor and a driver.

Deductions are partly coded: by dollars, type `E` 90%, `D` 53% and `R` 9% carry a tractor.

August coverage of trucks: **168 trucks worked** (a settlement or a bill), 166 with Samsara miles,
164 with EFS fuel, 101 with a FleetPal job.

### 1.3 Four defects in what is shipped today — each one makes a truck's figure wrong

These are wrong numbers on the current pages, whatever is decided about allocation.

**D1 — accessorial revenue counted twice.** McLeod's `billing_history.total_charges` already
includes `other_charge` (order 0131243: rate 4,250.00 + other 614.64 = total 4,864.64; July's 1,415
bills: `total_charges` = `totalcharge_and_excisetax` = 4,877,410.27, of which other 117,040.58).
Six readers add `other_charge` on top: `fleetReport.ts:164` (Per truck and Contractors tabs),
`billingActivity.ts:51` (Week by week), `mcleod/financialReads.ts:227` (billed miles by month),
`dispatcherEarnings.ts:91` (Per dispatcher), `ledgerCoverage.ts:67`, and `projection.ts:149`, which
writes a second `accessorial_revenue` row into `financial_entries` beside a `linehaul_revenue` row
that already holds it. July overstatement ≈ **$117k (2.4%)**, concentrated on the trucks that drew
the accessorials.

**D2 — credit memos counted as revenue.** McLeod stores a credit as a separate bill row with
`bill_type = 'C'` and a POSITIVE `total_charges`; the GL posts it as a credit to receivables. We do
not collect `bill_type`. Joining July's GL `BILL` lines to `billing_history` by `post_key`: 1,467
invoices (`I`) post +$5,028,444.73 and **55 credits (`C`) post −$213,124.32**, which we stage as
+$213,124.32 — **$426k (8.8%) of July revenue on the wrong side**, each on the truck the credited load
ran on. 2026 to date: 377 credits, $1.34M. The `canceled`/`rebilled` columns (0270) read zero
because McLeod does not use them for this. The fleet totals are unaffected (they come from the
ledger); the Per truck, Contractors, Per dispatcher and Week by week tabs are.

**D3 — the settlement figure is not the one the ledger posts.** The GL `SET` module joins
`drs_settle_hist` exactly on `accrual_key` (July: 2,719 rows, every one dated on its `accrual_date`).
It posts `orig_posted_pay` — $1,351,844.16 against the GL's $1,353,362.59 — while every report reads
`total_pay`, $1,262,162.77 live. Voids reverse through `SETV` (−$47,338). After voids the GL still
carries $44k (3.4%) more driver pay than `total_pay`, and the `DRS` module adds $124k of July P&L
expense that no per-driver reader sees. Which figure is a driver's cost is a decision (Q-TP6), but
it must be one that adds up to `SET + SETV + DRS`.

**D4 — "the month is posted" passes a month McLeod has not closed.** Q10 (built 10-10) withholds a
month until it carries last complete month's leading revenue and expense modules. August passes —
it has `BILL` and `SET` — yet its `AP` is $179k against $382k–$450k in April–July and its `GJ` has
64 lines against 120–202. McLeod's own answer is in `gl_control`: company TMS reads **fiscal year
2026, period 8, `prior_post = 'N'`** — August is still the OPEN period and posting into a closed one
is refused. Spreading August's overhead today would spread a number that is still growing.

### 1.4 A closed month still moved

July was printed on 2026-08-20 at revenue $4,828,189.24 / expense $4,058,143.38 and ties to that
to the cent (fleet plan §1.1). Re-swept on 2026-10-09 it reads **$4,840,667.99 / $4,091,395.64**.
So a published month can change after it is printed, and a per-truck month — which is a function of
the ledger month — changes with it. The report has to show *which* version it is and what moved.

### 1.5 Date cutoffs — which date the GL books each source on

Measured by joining each sub-ledger to `gl_ledger` on its posting key (sandbox, July 2026, TMS):

| Source | GL books it on | Evidence | Reader today |
|---|---|---|---|
| Bills | **`delivery_date`** | 1,507 of 1,522 posting keys (bill date: 201) | `delivery_date` ✓ — the 15 others are owed an explanation |
| Settlements | **`accrual_date`** | 2,719 of 2,719 | `accrued_at` ✓ |
| EFS fuel | the fill, local wall time | FUEL module ties −$152.25 in August (`mcleod-fuel-tieout`) | `localWallClock` ✓ |
| AP vouchers | `distribution_date` | F7 | ✓ — but headers carry no expense account (D-FP17) |
| FleetPal jobs | **no GL date** — the repair is invoiced through AP or reimbursed through `DRS` later | — | reconcile per month, never per day |
| GJ / RJ journals | the journal date; lumps (VIP lease = six lines a month) | — | spread, never measured |

So every measured source already has a date that matches the GL's month, and the rule is: **a
dollar belongs to the month the ledger put it in, proven per source by the posting-key join**, not
by a date column we chose. FleetPal is the one source with no posting key; it is placed by job
completion date and its month total is trued up to the GL maintenance family (§2, D-TP2).

### 1.6 What has no per-truck source — re-measured in McLeod

- **Recurring vouchers**: `recur_voucher_dist`, 723 lines, $2.55M — `tractor` and `trailer` filled
  on **zero**.
- **Truck loans**: company `TMS4` (VIP Equipment Holding) carries 48 amortized schedules due in
  August ($562,583.19, of which $111,004.22 interest), named by contract ("Daimler 26 (355906)",
  "Navistar 2"), never by unit. A contract can cover several trucks.
- **Insurance**: `tractor.insurance_amount` is filled on 77 of 245 active tractors and sums to
  $11.8M — an insured VALUE, not a premium. A possible spread basis (Q-TP3), not a cost.
- McLeod's profitability module (`pft_cost`, `cost_fact`) is empty, as on 2026-08-28.

So lease, insurance and office overhead are spread or they are mapped by hand. There is no third
option and no collector to build.

### 1.7 Trailers

FleetPal puts about a third of maintenance on trailers ($111,347.78 of $326,845.84 in July). A
trailer is linked to a truck by McLeod's load (`loads.trailer_id`, D-TL1: McLeod for planning), and
the Samsara GPS pairing disagrees with it on 72 of 114 current loads
([TRAILER-LINK-PLAN](../dispatch-loads/TRAILER-LINK-PLAN.md)). A trailer's cost therefore goes to
the truck that pulled it on the day, by the McLeod movement, or it is spread (Q-TP4).

### 1.8 Shop labour

FleetPal job totals include labour ($65,980.92 on tractors and $41,004.34 on trailers in July), and
FleetPal runs about 43% ABOVE McLeod's maintenance family because shop labour is payroll in McLeod
(`fleetpal-is-larger-than-the-ledger`). Putting FleetPal labour on a truck AND spreading the payroll
account that paid the mechanic counts it twice. Which payroll accounts carry the shop is not
measured (D-FP18 says so).

---

## 2. Decisions this plan proposes

- **D-TP1 — The ledger is the total; sub-ledgers place it.** For each month and each GL family:
  `Σ trucks = GL family total`, to the cent. A truck's figure in a family is its measured rows plus
  its share of the family's remainder (`GL − Σ measured`). A remainder below zero (measured exceeds
  the ledger, e.g. FleetPal labour) is not spread negative — the family refuses and names itself.
- **D-TP2 — Every dollar carries its tier, and the page prints the tiers.** `measured` (a
  sub-ledger row names the truck), `traced` (a named rule from a sub-ledger fact — a trailer's repair
  to the truck that pulled it that day), `spread` (an owner-signed basis). Each truck row shows its
  measured share; the fleet header shows the family-level split.
- **D-TP3 — Spread over truck-days, not trucks.** "Active" is per day: a truck bought on the 20th
  carries eleven days of the month's lease, a sold one stops on its sale date (`winding_down`,
  D-DB11; `tractor_status` is the census, `mcleod-tractor-status-is-the-census`). The basis per
  family is Q-TP2.
- **D-TP4 — A driver's P&L is derived from the truck's, never computed beside it.** Driver pay,
  fuel by card and revenue by bill are measured per driver; the driver's share of the truck's other
  costs follows the days (or miles) they drove it. Σ drivers = Σ trucks, asserted.
- **D-TP5 — A month is final only when McLeod has closed it.** The collector stages `gl_control`
  (company, fiscal year, current period) every sweep; a month earlier than the current period is
  `closed`, the current one is `open` and shown labelled preliminary (D-FLEET11), and Q10's module
  rule stays as the second check. Replaces D4.
- **D-TP6 — Every published month is a snapshot.** A per-truck month records the sweep stamp it was
  computed from. A later sweep that moves the ledger shows a restatement line ("July re-swept
  10-09: revenue +$12,478.75, expense +$33,252.26") instead of silently changing the numbers.
- **D-TP7 — Revenue is signed by bill type and dated on delivery.** `bill_type` is collected;
  `C` is negative. `total_charges` is the revenue; `other_charge` is a breakdown of it, never added.
  Acceptance: per-truck revenue for a closed month equals the ledger's `BILL` revenue to the cent.
- **D-TP8 — Contractors are their own rows.** An owner-operator truck carries the revenue it
  earned, the contractor pay it was settled, and the deductions it was charged — never the
  carrier's lease and insurance on trucks it does not own. Its share of office overhead is Q-TP5.

---

## 3. Build order — one PR each, the fixes first

| # | Step | Why first | Blocked on |
|---|---|---|---|
| **P0a** | D1: stop adding `other_charge` in the six readers; drop the second projection entry | live wrong numbers, no migration | nothing |
| **P0b** | D2: `bill_type` on `mcleod_billing` (migration), collected by `BILLING_HISTORY`, `C` signed negative in every reader (one merge behind the column) | live wrong numbers | next migration number; agent re-sweep |
| **P0c** | Source tie-outs per closed month: bills ↔ `BILL`, settlements ↔ `SET+SETV`, EFS ↔ `FUEL` — the collector sends per-posting-key GL totals for those three modules so each tie is a join, not a pair of totals that happen to agree | the instrument everything after is accepted by | Q-TP6 for the settlement figure |
| **P0d** | D-TP5: stage `gl_control`; month status from McLeod's own open period | stops spreading open months | `gl_control` in the finance grant |
| **P1** | Nightly finance feed on live LME (lever 1 of 10-10) | without it every month is a hand restore old | **Alex's grant** |
| **P2** | Truck-days: the active census per truck per day, from `tractor_status` + the roster's service dates | spread basis | Q-TP2/Q-TP3 |
| **P3** | `computeTruckPnl` (shared, pure): period × families × measured rows × truck-days × basis → truck rows + per-family tie-out; refuses when `Σ ≠ GL` | the harness | P0a–c, P2 |
| **P4** | FleetPal into the harness: tractor jobs measured, trailer jobs traced through the McLeod movement, labour per Q-TP7 | maintenance is 6.5% | Q-TP4, Q-TP7 |
| **P5** | Per-driver rows derived from P3 (D-TP4) | — | Q-TP8 |
| **P6** | Per truck tab gains cost, net and cost per mile with the tier shares; a truck drill-down by family × tier; a Per driver tab | the page | P3 |
| **P7** | Permits / IFTA by state miles (derivable from `samsara_ifta_jurisdiction_miles`) moves 0.8% from spread to traced | small, last | — |

Acceptance for P3 onward: July and August 2026 as fixtures from real staged rows; for each,
`Σ trucks = GL` per family to the cent, `Σ drivers = Σ trucks`, and every mutant that drops a tier,
double-counts a source or spreads onto an inactive day is killed.

---

## 4. What this plan refuses to do

- **No truck row whose families do not add up to the ledger.** The tie-out is a precondition,
  as in the fleet report (§2.5 there).
- **No spread of a month McLeod has not closed** presented as final (D-TP5).
- **No dollar placed twice** — FleetPal labour and the payroll that paid it, EFS fuel and the
  `PILOKNTN` fuel invoice (D-FS2), a deduction and the expense it recovered.
- **No truck number read from free text** ("Registration 771 & 773", "Daimler 26") — that is a
  guess D-MC12 forbids. A hand mapping is a ruling (Q-TP9), entered once, auditable.
- **No spread basis the page does not print.**

---

## 5. Done when

For a month McLeod has closed, the Per truck tab shows for every truck that worked: revenue, cost by
family, net, cost and net per mile driven, and the measured share of its cost; the fleet header
states `Σ trucks = ledger, residual $0.00` per family; and the Per driver tab adds up to it.

---

## 6. Open questions — each blocks the step named, with a recommendation

**Owner ruling, 2026-10-19:** fix the four defects D1–D4 first, then build the per-truck and
per-driver P&L on the recommended answer to every question below, Q-TP1 through Q-TP10. Q-TP1's
"yes" reverses the 09-03 fleet-only rulings D-FLEET1 and D-FLEET8, and `FINANCE-FLEET-REPORT-PLAN.md`
§0 says so beside them. Q-TP10 stays an owner action: the grant request to Alex now names
`gl_control` and `fiscal_year_dtl`.

- **Q-TP1 (blocks everything after P0)** — Reverse D-FLEET1/D-FLEET8: Finance reports per truck and
  per driver, with unattributed cost spread. *Recommended: yes, under §0's definition — the tiers
  printed, the ledger tie-out enforced.* P0a–P0d are needed either way and do not wait on this.
- **Q-TP2 (blocks P2/P3)** — The spread basis per family. (a) everything equally per active
  truck-day; (b) truck fixed (lease, insurance, GPS) per active truck-day, office/recruiting/financing
  per mile driven; (c) everything per mile. *Recommended: (b)* — a parked truck still owes its lease,
  and overhead follows the work. (a) is what "spread among all active trucks" says literally; it
  makes a truck that ran 3,000 miles carry the same office cost as one that ran 12,000.
- **Q-TP3 (blocks P3)** — Insurance by insured value (`tractor.insurance_amount`, 77 of 245 filled)
  or like the other fixed costs. *Recommended: like the other fixed costs* until the value is filled
  for every truck; a basis that covers a third of the fleet is a basis for a third of the fleet.
- **Q-TP4 (blocks P4)** — Trailer costs to the truck that pulled the trailer that day (McLeod
  movement) or spread. *Recommended: traced through McLeod*, a trailer's idle days spread like fixed
  cost.
- **Q-TP5 (blocks P3)** — Do owner-operator trucks carry a share of office overhead? *Recommended:
  yes, per mile* — dispatch, billing and safety work for them too; never lease or insurance (D-TP8).
- **Q-TP6 (blocks P0c)** — A driver's pay is `orig_posted_pay` net of voids (what the GL books) or
  `total_pay` (what the driver received). *Recommended: what the GL books*, with the `DRS` module's
  $124k/month measured onto drivers before anyone calls driver pay precise. Needs one more sandbox
  measurement: which `DRS` lines carry a payee.
- **Q-TP7 (blocks P4)** — Is FleetPal labour the in-house shop (payroll) or vendor work orders, and
  which payroll accounts pay the shop? *Recommended: until measured, put FleetPal's external cost
  (parts, services, fees) on the truck and leave labour in the spread payroll* — under-placing is
  visible in the measured share; double-counting is not visible anywhere.
- **Q-TP8 (blocks P5)** — Team trucks: a driver's share of the truck's costs by days on the truck or
  by their share of the settlement pay. *Recommended: by settlement pay on the movement* — it is
  already per driver and McLeod splits it.
- **Q-TP9 (no step blocked)** — Map the 48 TMS4 loan schedules to units by hand so lease and
  interest become traced rather than spread (~17% of expense). *Recommended: not now* — spread first,
  then decide with the per-truck page in front of the owner; the mapping is a list of schedule →
  units, never amounts.
- **Q-TP10 (blocks P1)** — Chase Alex for the finance grant (10-10 request) and add `gl_control` to
  it. Owner action.
- **Q-TP11 (blocks nothing; sharpens loads and billed miles)** — When a credit memo is followed by a
  re-bill of the same order (I, C, I), the order has two invoices. D2b takes the credit off revenue,
  so revenue nets correctly. But the credit counts as no load and no miles while both invoices
  count, so that load's miles and load count appear twice. Not measured: the 10-19 sandbox session
  measured credits against the receivable, not their orders, and the sandbox was unreachable on
  10-19 evening. *Recommended: measure July's `C` rows by order shape (`nI+mC`) and by distance
  carried. If re-bills are common, count one load per order rather than one per invoice.*

---

## 7. Progress log — append one dated line per step

- 2026-10-19 · plan written from the owner's request for per-truck and per-driver P&L. Measured:
  ~60% of July expense is measured per truck (66% with FleetPal); four live defects found (D1
  accessorials counted twice in six readers, D2 credit memos counted as revenue, D3 settlement pay
  not the ledger's figure, D4 open month passing the posted check); McLeod's `gl_control` named as
  the close signal; bills post on delivery date and settlements on accrual date, both by posting-key
  join.
- 2026-10-19 · owner ruled: defects first, then P1–P7 on every recommended answer (§6). D1 is
  PR #1642. The schema halves of D2 and D3 are PR #1643 (`0491` `mcleod_billing.bill_type`, `0492`
  `mcleod_settlements.void_date`). D4 has a PR (`0493` `mcleod_gl_control`, the open period on the
  fleet report and income statement). The D2b/D3b collector and readers ship once 0491/0492 have
  applied. Sandbox acceptance figures for D2b/D3b: July posted bills tie to the GL BILL receivable
  (1,467 I = +5,028,444.73, 55 C = −213,124.32). Voided settlements with a transfer date tie to SETV
  to the cent in May–Aug. The SET residual of $1.1k–$8.2k/month is GL "Payable from Settlement" lines
  with no settlement row.
- 2026-10-20 · D1 (#1642) merged. Main reached 0495 first, and `supabase db push` refuses a version
  older than the last one applied, so #1643's migrations are now `0496` `mcleod_billing.bill_type`
  and `0497` `mcleod_settlements.void_date`, and D4's is `0498` `mcleod_gl_control` (#1647). D2b
  (credits signed negative, never counted as a load) waits on 0496 applying to staging.
- 2026-10-20 · D3b built on Q-TP6's recommended answer: driver and contractor pay are what the GL
  books. One shared rule (`settlementLedger.ts`): SET books `posted_pay` on the accrual date for
  every live row and every row alone on its accrual key; SETV takes a voided, transferred row back on
  its `void_date`. The sweep, ingest and readers carry `void_date` (0501). The projection writes a
  second, negative `setv:` entry per reversal. The ledger coverage claims SET and SETV, names the
  "Payable from Settlement" residual, and counts voids swept before 0501 that cannot be dated yet.
  The fleet report's contractor column reads the same figure. 0501 applied to staging 10-20. Acceptance
  is May–Aug SETV to the cent once the re-sweep has refilled `void_date`.
- 2026-10-21 · #1643 and D4 #1647 merged 10-20 after one more renumbering past main's 0499: the
  columns are `0500` `mcleod_billing.bill_type` and `0501` `mcleod_settlements.void_date`, and
  `mcleod_gl_control` is `0502`, all applied to staging the same day. D2b is rebased onto main and
  cites 0500.
- 2026-10-21 · P0c started. Sandbox, July 2026, company TMS: no posting key in BILL, SET, SETV or
  FUEL spans two dates, and each key posts exactly one line to its control account (BILL 1,522 on
  12000000; SET 2,723 on 205000xx; SETV 46 on 20500010; FUEL 2,274 on 20550000), so a per-key join is
  exact. P0c ships in two merges, because a caller of a new function follows it into production:
  **P0c-a** `0509` `mcleod_gl_key_lines` and its month-replace function (15,183 rows for July, every
  account of each posting kept), then **P0c-b** the sweep, the ingest and the per-key ties for BILL,
  SET and SETV. FUEL's per-key tie needs McLeod's `fuel_detail` staged (collector step C1); until
  then the fuel tie stays the account-level F12.
