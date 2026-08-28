# Cost-attribution ruling worksheets — R1, R2, R4

**Status:** AWAITING THE OWNER'S RULINGS. **Prepared:** 2026-08-28, from recon questions F6
(deduct-code vocabulary with 2026 dollars) and F10 (every GL account that moved money in 2026,
named from `gl_account`). Parent: [TRUCK-COST-ATTRIBUTION-PLAN](./TRUCK-COST-ATTRIBUTION-PLAN.md).

Nothing in this file is a decision. Each proposal column is a starting point measured from the
data; the owner strikes or confirms per row, the ruling gets a date, and only then does code move.

## R4 — which accounts are "jurisdictional taxes" (T2 allocates them by Samsara state miles)

Measured candidates, 2026 net dollars, from F10. Proposed: ALL rows below rule IN unless struck.

| glid | Account | 2026 net | Note |
|---|---|---:|---|
| 40230000 | IRP | $317,971.96 | plate apportionment IS per-state by construction |
| 40310000 | IFTA | $39,281.08 | the tax whose denominator Samsara already measures |
| 40210000 | OR Monthly | $38,079.79 | Oregon weight-mile tax |
| 40190000 | NM Quaterly | $11,196.86 | |
| 40260000 | NM permit | $7,869.96 | |
| 40170000 | KY Quaterly | $7,267.66 | KYU weight-distance |
| 40320000 | CT Permit | $2,576.74 | |
| 40290000 | ID permit | $2,538.45 | |
| 40240000 | NY Quaterly | $1,562.05 | NY HUT |
| 40220000 | Highway Use Tax | $179.07 | |
| 40270000 | NY permits | $24.00 | |

**Boundary question for the owner:** `40200000 Business Licenses and Permit` (2026 net **−$17,824**,
a credit) — jurisdictional (allocate by state miles), per-unit fixed (a T1 schedule category), or
neither? The negative net says refunds or reclassifications ran through it; ruling needed before it
lands anywhere.

## R2 — deduct-code classes (T3 nets recoveries against truck cost)

F6 measured ~115 codes. The taxonomy the plan proposed (`driver_cost_recovery` / `pass_through` /
`earnings_adjustment`) turns out to be one class short: McLeod's own `deduction_type` **R** rows are
REIMBURSEMENTS — the carrier paying a driver back for truck costs paid out of pocket (scales,
lumper, parking). Those are not recoveries; they are truck operating cost arriving via the
settlement. So T3's classification table gets FOUR classes:

- `truck_cost` — reimbursement of a real truck expense; ADDS to that truck's cost.
- `truck_cost_recovery` — the carrier charging a cost back (to an owner-operator, or a driver at
  fault); SUBTRACTS from that truck's cost pool.
- `pass_through` — advances repaid, escrow movements; never touches CPM.
- `earnings_adjustment` — pay-shaped items; stays on the settlement side, already counted there.

Top codes by 2026 dollars, with the measured `deduction_type` and the proposed class. `?` marks a
code whose meaning the data cannot establish — those rows NEED the owner's reading, not a guess.

| Code | Type | 2026 $ | n | Proposed class | Reading |
|---|---|---:|---:|---|---|
| FEE | D | 412,932.38 | 1,393 | truck_cost_recovery **?** | dispatch/service fee charged to owner-operators? |
| SL | D | 205,092.94 | 110 | **?** | unreadable from the code alone |
| RRO | R | 157,125.57 | 116 | **?** | reimbursement, large and unnamed |
| O10 | D | 156,609.54 | 157 | **?** | paired with U10 — escrow over/under? |
| TR | R | 129,791.24 | 292 | truck_cost **?** | toll reimbursement? trailer rent? |
| TRR | D | 120,014.92 | 300 | truck_cost_recovery **?** | truck/trailer rental charged back? |
| DS | E | 111,300.00 | 58 | earnings_adjustment | driver salary-shaped |
| MRU | R | 101,403.41 | 258 | **?** | |
| U10 | D | 99,432.88 | 262 | **?** | pair of O10 |
| ADV | D | 95,812.83 | 387 | pass_through | advance repayment — the advance was the cash event |
| TOW | D | 72,410.88 | 177 | truck_cost_recovery | towing charged back |
| CAI | D | 66,000.00 | 264 | truck_cost_recovery **?** | collision/liability insurance charged to owner-ops? |
| SAL | D | 59,446.55 | 64 | **?** | salary garnish? |
| STO | E | 55,550.00 | 712 | earnings_adjustment | stop pay |
| GOS | R | 45,000.00 | 1 | **?** | single row, $45k — ruling by inspection |
| TOP | D | 49,412.59 | 73 | **?** | |
| UNL | D | 49,178.14 | 209 | truck_cost_recovery **?** | unloading charged back? |
| LUM | R | 50,558.88 | 215 | truck_cost | lumper reimbursement |
| TOR | R | 51,225.45 | 51 | **?** | |
| CLM | D | 36,719.74 | 192 | truck_cost_recovery | claims charged back |
| TT2 / TT1 | D | 61,342.71 | 254 | **?** | |
| OWR | D | 32,880.08 | 34 | **?** | |
| TRL | D | 32,325.00 | 144 | truck_cost_recovery **?** | trailer rent charged to owner-ops? |
| LAY | E | 31,850.00 | 219 | earnings_adjustment | layover pay |
| NEG | E | 29,405.23 | 17 | earnings_adjustment | negative settlement carryover (GL 12100000 agrees) |
| TR1 / TR2 | R | 56,184.37 | 235 | truck_cost **?** | with TR — family needs one reading |
| BOD | E+D | 23,043.27 | 109 | **?** | |
| L1D / L2D / L3D | E | 29,650.00 | 172 | earnings_adjustment **?** | per-drop pay? |
| OIL | D | 19,111.03 | 34 | truck_cost_recovery **?** | oil changes charged back? |
| IRP | D | 17,717.00 | 13 | truck_cost_recovery | IRP charged to owner-operators |
| OAI | D | 12,570.78 | 93 | truck_cost_recovery **?** | occupational accident insurance? |
| SCR | R | 11,255.37 | 858 | truck_cost | scale-ticket reimbursement |
| CIT | D | 11,369.73 | 80 | pass_through **?** | citations passed to the driver at fault? |
| GPS | D | 6,407.28 | 216 | truck_cost_recovery | GPS fee charged back |
| DEN | E | 8,802.00 | 100 | earnings_adjustment | detention pay |

Everything below ~$10k/year (≈60 more codes) waits for a second pass — ruling the top table
covers the overwhelming share of 2026 deduction dollars, and a wrong guess on a small code is
still a wrong guess.

**Owner-operator interaction (D-MC20):** most `truck_cost_recovery` candidates charge
owner-operators, whose trucks are excluded from company CPM. Their recoveries reduce the
owner-operator POOL, not any company truck — T3 must key recoveries to the charged truck and let
the existing pooling rule route them.

## R1 — overhead basis (T6): what the named accounts say

2026 G&A per F10 is dominated by Subcontracted Labor: Office ($1,449,926), Salaries & Wages
($380,023), Payroll Tax ($286,880), Rent ($188,499) — none of which follows any one truck.
Recommendation stands: **`total_miles` over Samsara measured miles** — overhead follows activity,
and the denominator is already measured per truck. Alternative on the table: `equal_per_truck`
(a truck-month is the capacity unit). The harness supports both; the report prints whichever is
ruled. No default flips until this line carries the owner's ruling and a date.

## Rulings, when made (append here, dated)

- *(pending)*
