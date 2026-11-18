# Finance reports, second version — one page, three tabs, every figure checked against McLeod

**Status:** PROPOSED. Build order in §5; open questions in §6. **Owner:** Miki. **Written:** 2026-11-18
from the owner's request of the same day and from measurements taken that morning on production
Supabase and on the McLeod copy (`lme_analytics`, restored 2026-10-09 13:13Z, still the latest).

**The request.** Finance figures do not match a report pulled from McLeod even for complete months,
and the page is hard to read. Wanted: one page; an Overview tab with totals; a Trucks tab where a
click opens a truck's full financial page (earnings and expenses apart, cards for totals); a third
tab listing every other expense (office and the rest) as separate lists; date filtering the way the
other pages do it, with no preset ranges; earnings, expenses and cost per mile per truck and for the
fleet; "100% precise and reliable" for trucks, trailers and drivers; and a list of what McLeod holds,
what Silvicom 360 holds and what is missing.

**How this relates to the earlier plans.** [TRUCK-DRIVER-PNL-PLAN](./TRUCK-DRIVER-PNL-PLAN.md) stays
the plan for the per-truck and per-driver calculation (its P3–P7 and its rulings Q-TP1–12 are used
here unchanged). This file adds what that plan did not have: why the pages disagree with McLeod
today, the page itself, the Other expenses tab and its source, and the inventory.
[FLEET-REPORT-UI-PLAN](./FLEET-REPORT-UI-PLAN.md)'s period rail (D-FRUI1) is superseded by D-FR2.

---

## 1. Why the pages do not match McLeod today — measured 2026-11-18

### 1.1 The ledger totals DO match, to the cent

Every 2026 month, every posting module, production's `mcleod_gl_totals` against `gl_ledger` on the
copy: line counts and amounts are equal for all ten months (January–October). So the Overview and
the Income statement are the copy's own figures. Whatever differs from McLeod differs for one of the
three reasons below.

### 1.2 Reason one: October's fixes are in production but the data they need was never re-read

The credit-memo fix (D2b, #1687), the settlement-void fix (D3b, #1689), McLeod's open period (D4,
#1647), the per-posting check (#1698, #1703) and the truck census (#1699) are all merged and
released. Each needs a financial re-read by the agent to fill its columns. The last financial read
landed 2026-10-09 18:59Z, before any of them was released. In production today:

| What the fix needs | Rows holding it | Effect on the page |
|---|---:|---|
| `mcleod_billing.bill_type` | 0 of 13,000+ (every row empty) | credit memos still count as revenue and as loads |
| `mcleod_settlements.void_date` | 0 | voided settlements are never taken back (July: $47,338) |
| `mcleod_gl_control` | 0 rows | no month can be called closed or open from McLeod's own period |
| `mcleod_gl_key_lines` | 0 rows | the per-posting check has nothing to check |
| `mcleod_tractor_periods` | 0 rows | no truck-days, so nothing can be shared per truck |

Size of it, July 2026: the Per truck, Contractors, Per dispatcher and Week by week tabs add up to
**$5,201,876.04** of revenue. The ledger's BILL postings to receivables for July are **$4,815,320.41**. The tabs are
**$386,555.63 (8.0%) high**, and this is the mismatch the owner sees on a complete month.

A dry run of the re-read on 2026-11-18 (agent as on `main`, which equals `production`) read
everything and sent nothing: 25,572 settlements, 12,451 deductions, 1,913 vouchers, 26,524 movement
facts, 13,353 bills, 707 tractor periods, 2,805 office lines, ledger totals and 120,323 key lines for
January–August, `gl_control` TMS period 8. **The real run was refused to the assistant by the
permission classifier (it writes to production), so it is an owner action — F0.**

### 1.3 Reason two: the copy is 40 days old

McLeod itself has moved since 2026-10-09: August was the open period on the copy, and September and
October hold only recurring journals. A report printed from live McLeod today is a different
snapshot from the one 360 holds. Nothing in 360 can fix this; a refresh of the copy, or the nightly
feed on LME (request to Alex of 2026-11-13, not yet granted for the ledger tables), does.

### 1.4 Reason three: a printed month keeps changing

July printed on 2026-08-20 at $4,828,189.24 / $4,058,143.38 and re-read on 10-09 at $4,840,667.99 /
$4,091,395.64 (PNL plan §1.4). A page that silently follows the ledger will disagree with a paper
copy. D-TP6 (each published month is a snapshot with a restatement line) answers it and is built in
F6.

---

## 2. What McLeod holds, what 360 holds, what is missing

Row counts are the copy's, 2026-11-18. "Ties" means checked to the cent against the ledger.

### 2.1 Read from McLeod today

| McLeod table (rows) | What it is | In 360 | State |
|---|---|---|---|
| `gl_ledger` (760,570), `gl_ledger_hist` (1,767,734) | every posting | `mcleod_gl_days`, `mcleod_gl_totals` | ties, all of 2026 |
| `gl_account` (551) | account names | `mcleod_gl_accounts` | complete |
| `gl_control` (4) | the period McLeod is posting into | `mcleod_gl_control` | built, **empty until F0** |
| `billing_history` (157,127) | invoices and credit memos | `mcleod_billing` | present; `bill_type` **empty until F0** |
| `drs_settle_hist` (264,557) | driver and contractor pay | `mcleod_settlements` | present; `void_date` **empty until F0** |
| `drs_deduct_hist` (194,524) | settlement deductions | `mcleod_deductions` | present; a truck on 53–90% of dollars by type |
| `voucher`, `voucher_hist` (89,695) | AP invoices, header only | `mcleod_ap_vouchers` | present; **no expense account on a header** |
| `gl_ledger` module `OFF` | office payroll lines | `mcleod_office_lines` | present for July and August |
| `tractor` | service dates, owner | `mcleod_tractor_periods` | built, **empty until F0** |
| `fuel_tax_history` (439,015) | IFTA receipts | `mcleod_fuel_tax_receipts` | present |
| `movement`, `stop`, `orders` | loads and miles | `mcleod_movements`, dispatch tables | present |

### 2.2 In McLeod, not read — and what each would give

| McLeod table (rows) | What it holds | Worth reading? |
|---|---|---|
| `gl_ledger`, modules AP, DRS, OFF, DED, GJ, RJ, CASH, WIRE, per posting key | the expense ACCOUNT of every voucher, check and journal | **Yes — F3.** It is the only source of "which vendor, which account" for the Other expenses tab. |
| `gl_summary` (95,905) | McLeod's own balance per account per period | **Yes — F7.** Most likely what McLeod's printed income statement reads; a second, independent check on our totals. Columns not yet read. |
| `drs_check` (64,254) | one row per settlement check, with payee | Yes, with F4: it names the payee of every DRS line (Q-TP6, measured 10-21). |
| `fuel_detail_hist` (69,908) | McLeod's copy of each fuel purchase | Yes, later: the per-posting check for fuel (PNL plan C1). EFS already gives the per-truck figure. |
| `prorated_move`, `prorated_orderdist` (308,462 / 148,471) | McLeod's own split of an order's revenue over its movements | Probe first. It would put revenue on the right truck when two trucks moved one order. Not measured. |
| `recur_voucher`, `recur_voucher_dist` (313 / 723) | recurring vouchers | No: truck and trailer are empty on all 723 lines. |
| `drs_payroll_hist` (64,308) | payroll detail behind settlements | No: pay is already taken from settlements, which tie. |
| `voucher_dist` (385) | distribution lines of OPEN vouchers only | No. There is no history table behind it; the 10-10 plan to collect it ("lever 2") had no source. F3 replaces it. |
| `pft_report`, `pft_cost`, `cost_fact` | McLeod's profitability module | Empty. McLeod has no per-truck P&L of its own to compare with. |

**Measured again today:** `gl_ledger.tractor` and `gl_ledger.trailer` are filled on 0 of July's
12,657 income-statement lines, in every module. McLeod cannot say which truck a ledger dollar belongs
to; only the sub-ledgers can.

### 2.3 Held by 360 and not by McLeod

| Source | Gives | State in production |
|---|---|---|
| EFS card lines | fuel per truck and driver, to the fill | current; ties to the ledger's FUEL within $152 (August) |
| FleetPal service history | repairs per truck and trailer, parts and labour apart | current to 11-17 |
| Samsara odometer, IFTA miles | miles driven per truck | current |
| Toll tags and statements | tolls per truck | **0 statements and 0 tags entered** — the pages shipped 11-17, nothing uploaded yet |

### 2.4 Held by nobody — these can only be shared out by a rule

July 2026, from the ledger: VIP lease $500,000.00 (eight journal lines), insurance $170,363.80,
GPS $12,843.17, interest $9,774.40, office and administration about $558,000. No table in McLeod or
360 names a truck for any of it (PNL plan §1.6). They are spread over truck-days and miles under
Q-TP2's ruling, and every page prints which dollars are measured and which are shared.

---

## 3. How others report it — what was checked

- **FMCSA Form M** (annual report of Class I and II for-hire carriers, 49 CFR 369) is the
  government's shape for a carrier's income statement: freight revenue, then expense by nature —
  driver wages, other wages, fringes, fuel, tires, other operating supplies, taxes and licences,
  insurance, communications and utilities, depreciation, purchased transportation, equipment rents,
  building rents, gain or loss on disposals, miscellaneous — and operating statistics beside it
  (miles, loads, tractors and trailers in service). ⚠ The form's PDF refused download on 11-18 (HTTP
  403), so the line wording above is from memory of the form and is not verified against the 2026
  edition.
- **ATRI's Operational Costs of Trucking** (not government; FMCSA's own reports cite it) is the
  industry's per-mile standard. Vehicle lines: fuel, lease or purchase payments, repair and
  maintenance, insurance, permits and licences, tires, tolls. Driver lines: wages, benefits. Total
  2024: about $2.26 per mile.
- No government-published per-truck P&L application was found. The University of Minnesota's
  per-mile truck cost model splits fixed from variable cost, which is the same split as Q-TP2 (b).

**What we take from them (D-FR4).** The truck page and the Overview list cost in ATRI's per-mile
lines, so a truck's cost per mile can be read against a published benchmark line by line. Our ten
signed families (`GL_FAMILIES`) already map onto them; the map is written once, in shared, and the
family names on screen do not change.

---

## 4. Decisions proposed

- **D-FR1 — One page, three tabs.** `/finance` (the old `/fleet-report` and `/cpm` redirect).
  **Overview**: cards (earned, spent, kept, miles, cost per mile, kept per mile), then expense by
  family with its per-mile figure, then the income statement in McLeod's shape, collapsed, with
  Print. **Trucks**: one row per truck — earned, spent, kept, miles, cost per mile, measured share —
  filterable to company or contractor trucks; a row opens the truck's own page. **Other expenses**:
  every dollar that is not on a truck, one list per family, each line with date, vendor or payee,
  account, amount; totals per list; the tab's total plus the Trucks tab's total equals the ledger.
- **D-FR2 — The date filter is the house calendar range with presets off** (`DateRangeFilter`,
  `:presets="false"`, owner ruling 2026-11-10), in the URL. The page opens on the latest month
  McLeod has closed. Any range is allowed because the ledger is staged per day (`mcleod_gl_days`);
  the figures for a range are what McLeod prints for the same dates. A range that touches a month
  McLeod has not closed says so above the cards and names the month.
- **D-FR3 — The truck page** (`/finance/trucks/:unit`, same date range): cards for earned, spent,
  kept, miles, cost per mile and kept per mile; **Earnings** (each bill: date, order, customer,
  amount, credits shown as their own negative lines); **Expenses** grouped by family, each with its
  lines — settlements, fuel fills, repair jobs, tolls, deductions — and, under a heading of their
  own, the shared costs with the rule printed. A driver's page and a trailer's page are the same
  page on another key (PNL plan D-TP4, Q-TP4).
- **D-FR4 — Costs are listed in ATRI's per-mile lines** (§3).
- **D-FR5 — Precise means it adds up, and the page proves it.** Each tab carries one line:
  "Trucks $X + Other expenses $Y = ledger $Z, difference $0.00". When the difference is not zero the
  line turns into a warning and names the family (D-TP1). No tab shows a figure the line cannot
  cover.
- **D-FR6 — Where the retired tabs go.** Income statement → inside Overview. Contractors → a filter
  on Trucks. Week by week → retired; a week is a date range now. Per dispatcher → Q-FR2-1.

---

## 5. Build order — one PR each

| # | Step | Blocked on |
|---|---|---|
| **F0** | Re-read 2026 from the copy so October's fixes take effect (§1.2). Then re-measure July: the tabs must equal the ledger's BILL revenue. | **owner runs one command** (below) |
| **F1** | Ledger readers at daily grain for any date range (the fleet plan's W1c) | nothing |
| **F2** | The page: `/finance`, three tabs, the calendar range, Overview rebuilt (D-FR1, D-FR2); old addresses redirect | F1 |
| **F3** | Key lines for every module (collector + ingest), joined to voucher and check for the vendor or payee; the Other expenses tab | a migration only if the vendor name needs a column; agent re-read |
| **F4** | `computeTruckPnl` (PNL plan P3): measured rows, truck-days, the signed bases; refuses when Σ ≠ ledger | F0 (truck-days), F3 (DRS by payee) |
| **F5** | Trucks tab with cost and the truck page (D-FR3); FleetPal repairs and trailer costs traced (P4); tolls when statements exist (TL7) | F4 |
| **F6** | Driver rows and page (P5); month snapshots with a restatement line (D-TP6) | F5 |
| **F7** | `gl_summary` read and compared: "matches McLeod's own period balance" on the Overview | a column probe; Alex's grant for the nightly feed |

**F0, the command** (from a checkout of `main`, on the office network):

```
cd tools/mcleod-agent && FINANCIAL_WINDOW_DAYS=322 node --env-file=.env.sandbox agent.mjs --financial
```

It reads the copy and posts to production's ingest, about one minute. Re-sending is idempotent.

---

## 6. Open questions

- **Q-FR2-1 (blocks part of F2)** — Where does Per dispatcher go? (a) a fourth tab on `/finance`;
  (b) the Dispatch section, as "Dispatcher results"; (c) retired. *Recommended: (b).* It is a
  question about people booking freight, asked by the dispatch manager, and it needs no cost. Until
  ruled, F2 keeps the tab where it is rather than deleting a working report.
- **Q-FR2-2 (blocks F5's trailer page)** — A trailer's page shows its repairs and tolls only, or
  also a share of revenue? *Recommended: costs only.* No source says what a trailer earned.
- **Q-FR2-3 (blocks nothing, shortens the 40-day lag)** — Ask Alex Tzakov again for a refresh of the
  copy and for the ledger grants of the 11-13 request. Owner action.
- **Q-FR2-4 (blocks F7)** — May the agent read `gl_summary`? It is a new table for the grant list.
  *Recommended: yes, add it to `SILVICOM-GRANTS.sql` Part 2 and Part 4.*

---

## 7. Progress log — append one dated line per step

- 2026-11-18 · plan written. Measured: ledger totals equal the copy for all ten months of 2026;
  the sub-ledger tabs are 8.0% high on July revenue because the re-read that fills `bill_type`,
  `void_date`, `gl_control`, key lines and tractor periods never ran after their release; the copy is
  40 days old. The re-read was dry-run clean and its real run refused to the assistant (F0, owner).
  Found: `voucher_dist` has no history, so AP expense accounts come from the ledger's own key lines
  (F3); `gl_summary` exists and is unread (F7).
