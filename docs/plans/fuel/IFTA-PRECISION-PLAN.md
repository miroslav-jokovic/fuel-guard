# IFTA precision — the right trucks, all of their fuel, and a state page that can be worked

Opened 2026-10-05 after the jurisdiction drill-down shipped (#1293 miles per truck, #1296 fills per
truck). The owner's request, in one message: hide trucks that did not fuel in a state, page and filter
the list, bring in the cash and manual fuel receipts typed into McLeod, and make sure owner-operators
who are not under our IFTA account are not in our return. This plan is the order that work happens in
and the questions that block it. Its parent is `docs/plans/SAMSARA-IFTA-MILEAGE-PLAN.md` (S0–S5,
Q-IF1..6); nothing here changes a decision made there.

---

## 0. Ground truth (measured 2026-10-05 on production, read-only; none recalled)

| Fact | Measured |
|---|---|
| Fleet taxable miles, 2026 Q3 (`samsara_ifta_jurisdiction_miles`) | **4,806,959** |
| Fleet tractor gallons bought, 2026 Q3 (`fuel_transactions`) | **694,936** in **5,823** fills, every one `is_canonical` |
| `fuel_transactions.source` this year | **`fuel_card` 18,274 — and nothing else.** Zero manual, zero cash, zero McLeod. |
| McLeod fuel at FILL grain in our database | **None.** `financial_entries` holds McLeod fuel only as **301 AP vouchers** (no truck). `fuel_detail_hist` (65,847 rows, tractor + state + gallons) is read by the agent's `FUEL_PURCHASES` for money tie-outs and stored nowhere per fill. |
| `vehicles.ownership_type` / `owner_driver_id` / `ifta_account` (0099) | **NULL on all 272 rows.** The columns exist; nothing has ever written them. |
| Units paid as `payee_type = 'owner_operator'` in `mcleod_settlements` since 2026-06-01 | **16** |
| Their 2026 Q3 share | **377,069 mi (7.8%)** and **45,365 gal (6.5%)** — all inside our IFTA totals today |
| Owner-operator units with Q3 miles and **zero** fills on our cards | **718** (22,300 mi) and **512** (21,858 mi); **777** has 2 fills on 19,480 mi |
| Q3 fills with no truck | **87** of 5,823 (12 in Texas) |
| Drill-down vs ledger, Texas 2026 Q3 | **684 fills / 83,763.1 gal both ways** — `readJurisdictionFills` and 0256's `fuel_business_date` predicate agree exactly |

⚠ `mcleod_settlements` is swept from `lme_analytics`, the FROZEN restore (D-PREC12), so "since June"
means "up to whatever was restored" — the newest owner-operator settlement is 2026-09-01. Good enough to
size the problem; not good enough to decide a filing.

### 0.1 McLeod's own IFTA module — measured 2026-10-05 on `lme_analytics` (restore ends 2026-09-06)

The carrier already keeps an IFTA ledger in McLeod: **`dbo.fuel_tax_history`** (425,862 rows), one row
per tractor × state × source document, with `loaded_distance`, `empty_distance`, `fuel_volume`, a
`source` code, `source_date`, `process_date` and `void_date`. Its three sources:

| `source` | Rows (all time) | What it is | Evidence |
|---|---:|---|---|
| `X` | 352,921 | **Trip miles** per state, from dispatch movements | miles only, `movement_id` set; Jul–Aug 2026 = 3,033,367 mi |
| `O` | 71,686 | **Card fuel**, imported from EFS | Q3 2026 = **506,408.26 gal — identical** to `fuel_detail_hist`'s tractor gallons; all `interface_id = 'H'` ("EFS LLC"), 13-digit card on every line |
| `F` | **1,255** | **Fuel keyed by hand** — the cash / own-card receipts | no movement; `source_id` points at a document; entered in a batch in the first week after each quarter closes (`process_date` 2026-04-09…15 for Q1, **2026-07-06 for Q2**) |

What that settles:

- **Q-IP1 is answered: a manual receipt is `fuel_tax_history.source = 'F'`.** It is NOT in `fuel_detail`
  / `fuel_detail_hist` (every 2026 line there is the EFS interface) and NOT in `fuel_ticket_hist` (those
  are the EFS invoices, keyed by the two users who run the import). Volume is small but not noise:
  **2026 Q1 = 67 rows / 5,427 gal, Q2 = 49 rows / 3,499 gal**, ~25 per quarter historically.
- **Unit 512 is the counter-example to the "no fills = files its own IFTA" guess.** It is an
  owner-operator, it bought nothing on our cards in Q3, and it is the single largest source of `F`
  rows: **83 of 2026's rows, 6,700 gal**. Its fuel IS in the carrier's IFTA — on paper receipts. So the
  heuristic in §2 IP4 ("drove with no fills on our cards") is a reason to LOOK, never a reason to exclude.
- **Q3 2026's manual receipts do not exist yet anywhere.** The office keys them in the first week after
  the quarter (Q2's on 2026-07-06), so Q3's land around 2026-10-06 — and the analytics restore ends
  2026-09-06 regardless.
- **The live login cannot read any of it.** On `lme`, `silvicom_dispatch_ro` has `SELECT` on `tractor`
  but NOT on `fuel_tax_history`, `fuel_ticket_hist`, `fuel_detail_hist` or `drs_settle_hist` (all 0 from
  `HAS_PERMS_BY_NAME`). That is Q-IP3, now a measured fact rather than a suspicion.
- McLeod's dispatch miles (`X`) and Samsara's GPS miles are two independent readings of the same
  quarter — a third tie-out beside D-IF9's, available the day this table is read.
- **2 of 2026's 116 `F` rows duplicate an `O` row** (same tractor, state, day, gallons within 0.5): a
  receipt keyed by hand for a fill the card had already imported. The reader must drop those two shapes.

### 0.2 Ownership and McLeod's own fuel-tax exclusion — measured 2026-10-05 on LIVE `lme`

`dbo.tractor` carries **`exclude_fueltax`** — McLeod's per-truck switch for leaving a tractor out of the
fuel-tax (IFTA) module — beside `owner` and `pay_owner`. The live login reads `tractor`.

| `pay_owner` | `owner` | Active trucks | Paid as `owner_operator` in settlements |
|---|---|---:|---:|
| `D` | `SILVMEIL` (147) or blank (51) | 198 | **0** |
| `B` | `SCORELIL` | 9 | **9** |
| `O` | six owners (IVETJOIL ×2, KANEBGIL, QUALSCIL, ALLARONY, SWISSANM, YOANNAB) | 7 | **7** |

Every one of the 16 units settled as owner-operator is `B` or `O`; no `D` truck is. That is strong
evidence for D = company, B = a fleet owner (SCORELIL, 9 trucks), O = single owner-operator — still a
reading of the data, which is why Q-IP2 stays open for the carrier's one-line confirmation.

**`exclude_fueltax = 'N'` on every tractor McLeod holds, active or retired — zero exclusions, ever.**
The carrier's own IFTA therefore includes every owner-operator truck today, and so does ours. There is
nothing to filter out this quarter. What the owner asked for — "make sure owner-operators not under our
IFTA are filtered" — becomes: **follow McLeod's `exclude_fueltax` the day it changes**, dated, so a
re-filed quarter uses that quarter's value (D-IP3). That replaces IP4's hand-kept coverage table with
the carrier's own switch (derive, don't restate).

---

## 1. Decisions

**D-IP1 — The state page rests on the trucks that BOUGHT fuel there.** The owner's ruling, 2026-10-05.
`?show=` is `""` (bought fuel here), `drove` (drove here, bought none) or `all`. The trucks that drove
and bought nothing are one choice away, never removed: their miles are what make a jurisdiction OWED tax,
so the cards above the table keep the whole jurisdiction and the page says "Listing N of M trucks"
whenever the list is narrower than the cards. Shipped in step IP1.

**D-IP2 — "Owner-operator" is not the filter; "covered by our IFTA account" is.** A leased-on
owner-operator may report under the carrier's IFTA licence or under their own — the lease decides, per
truck. Excluding every owner-operator would be as wrong as excluding none. The fact the return needs is
per truck and per PERIOD: whose IFTA account carried this truck's miles in this quarter.

**D-IP3 — Coverage is dated.** A truck that leases on in August is ours from August. A flag on
`vehicles` holds one instant (see `updated-at-cannot-answer-did-it-happen`), and a re-filed Q2 must use
Q2's coverage, not today's. So coverage is its own history table with `effective_from`/`effective_to`,
not a column.

**D-IP4 — A truck outside our IFTA leaves BOTH halves.** Its miles and its fills leave the ledger, the
fleet MPG and the drill-down together. Removing one side moves the fleet MPG every liability scales with
(the 2026 Q2 10.5 mpg lesson, run in reverse).

**D-IP5 — Cash and manual receipts come from McLeod before they come from an upload.** ⚠ SUPERSEDED 2026-10-07 by D-IP7. The office already
keys them into McLeod's fuel entry. A second entry point in our app is the same receipt typed twice and a
duplicate waiting to happen. An upload is built only for receipts that provably never reach McLeod, and
then it stores the image (`fuel_transactions.receipt_path` already exists), because a tax-paid credit
without its receipt is a credit an auditor can refuse.

**D-IP6 — From McLeod, only the lines no card produced.** `fuel_detail_hist` also carries the card fills
EFS already gives us. Importing them would double-count fuel. Which column separates a hand-keyed
receipt from a card import is a MEASUREMENT (Q-IP1), not a guess.

**D-IP7 — Driver-paid fuel is uploaded as files, and the upload wins (supersedes D-IP5).** The owner's
ruling, 2026-10-07, after two files arrived: a fuel-discount app's IFTA report (40 fills, 3,397.5 gal,
14 states, Q3 2026 — all unit 512's, which no card and no McLeod receipt had shown) and McLeod's "Fuel
Ticket Hist Listing" (61 hand-keyed receipts, 6,094 gal, 718 and 777 nearly all of it). The office will
keep sending such CSV or Excel files, and July is added the same way later. Production held neither:
0434 is empty until the McLeod VM's read grant exists (Q-IP3, "granted when the VM is set up"). So
the file is an entry point of its own (IP8), and because the same fill can then arrive as the app's
row, the office's McLeod export AND McLeod's ledger, the IFTA read keeps ONE copy: card fill first,
then the fuel app's row, then the McLeod export, then McLeod's ledger (option b — "our entry wins", it
carries station, time and price). Dropped copies are counted on the page, never silent.

---

## 2. Steps

### IP1 · State page: rests on "bought fuel here", search, pages, filters in the link — BUILT 2026-10-05

Web only, no migration. `IftaJurisdictionPage.vue`: `?show=` and `?search=` live in the URL so a
filtered view can be sent; 25 trucks a page through `TablePagination`; the empty list says whether the
jurisdiction or the filter emptied it.

### IP2 · Measure how a manual receipt looks in McLeod — WAITS on Q-IP1

The probe is §4. One run answers which column(s) separate hand-keyed receipts from card imports, how
many there are per quarter, and whether they carry tractor, state and gallons.

### IP3 · Carrier confirms the ownership codes — WAITS on Q-IP2

`tractor.pay_owner` (D ×174, B ×9, O ×7) and `tractor.owner` (SILVMEIL ×174, SCORELIL ×9, six singles)
are unmapped by D-FG12 until the carrier says what they mean
(`docs/plans/mcleod/CARRIER-CODE-QUESTIONS.md` #2, #3). Once answered, the roster sync fills
`vehicles.ownership_type` and IP4 has a suggestion to show.

### IP4 · IFTA coverage, dated — REVISED 2026-10-05: mirror McLeod's `exclude_fueltax`

§0.2 found the carrier already keeps this fact per truck. So the roster sweep (live login, already reads
`tractor`) collects `exclude_fueltax`, `owner` and `pay_owner`; a change to `exclude_fueltax` writes a
dated row, and IP5 excludes a truck only for the days McLeod excluded it. The hand-decided table below
stays the fallback for a carrier that does not keep the flag in its TMS.

Original shape, kept for that fallback:

New table (next migration number; RLS on; owner module `ifta`): `vehicle_ifta_coverage (org_id,
vehicle_id, covered_by 'carrier' | 'own_account', ifta_account, effective_from, effective_to,
decided_by, decided_at, note)`. An office screen lists trucks needing a decision, with the evidence
beside each: the McLeod ownership code (IP3) and "drove N miles here with no fills on our cards" (718,
512, 777 today). A person decides; the decision is the row. Corrections are new rows, never edits.

### IP5 · The ledger, the MPG and the drill-down respect coverage

`ifta_period_jurisdictions` gains the coverage join in a NEW function version (applied migrations are
never edited); its reader ships a merge later (`lint:migration-ordering`). Both halves leave together
(D-IP4). The page says how many trucks and miles were excluded and why, beside the totals.

### IP6 · McLeod's hand-keyed fuel into the IFTA credit side — WAITS on Q-IP3

**Revised 2026-10-05 by §0.1.** The source is `fuel_tax_history` rows with `source = 'F'` — not
`fuel_detail_hist`, which holds only the EFS import we already have, so D-IP6's double-count risk does
not arise from reading `F` alone. Shape: a McLeod-owned raw staging table (`mcleod_fuel_tax_receipts`,
verbatim: tractor, state, `fuel_volume`, `source_date`, `process_date`, `void_date`, McLeod `id`) filled
by the agent; the IFTA reads (`ifta_period_jurisdictions`' successor and the drill-down) add it to the
purchased side as its own labelled source, "Receipt keyed in McLeod".

⚠ **Into the IFTA credit, NOT into `fuel_transactions`.** An `F` row has no card, no price and no time
of day — only a date, a state and gallons. Writing it into `fuel_transactions` would put it in front of
card-fraud scoring, MPG intervals and the spend report, all of which assume a card transaction. IFTA
needs gallons per state per quarter, which is exactly what the row has.

Also check before the first read: whether any `F` row duplicates an `O` row (same tractor, state, day,
gallons). The probe's duplicate check failed on a SQL Server aggregate rule and was not re-run.

### IP7 · The 87 fills with no truck

Separate and small: why they have no `vehicle_id` (card not assigned? unit unknown?) and attribute what
can be attributed. They are kept on their own row until then, so no total is wrong — only unexplained.

### IP8 · Driver-paid fuel uploads — BUILT 2026-10-07 (D-IP7)

0436 `ifta_fuel_receipt_uploads` + `ifta_fuel_receipts`: evidence, append-only by trigger (the one
change allowed is a void with a reason), pinned in `RETENTION_FORBIDDEN`, one live row per fingerprint
so a re-uploaded file adds only its new rows. `parseDriverFuelFile` (shared) reads both formats and
checks the fuel app's own "Total Gallons" lines against its rows; DEF, reefer, off-highway, unknown
states and voided McLeod tickets are refused or skipped with their line. Each row's truck: the unit in
the file, else the driver's Samsara assignment on the fill's day, else ONE question per driver or unit
answered on the preview — never guessed. `foldReceiptSources` applies D-IP7's order in both the ledger
and the state page. UI: "Driver-paid fuel" on the IFTA page (fuel managers upload; anyone who sees the
page sees the uploads), with an undo per upload. Both real files parse completely (40 + 61 rows, 0
refused, all 15 of the app's stated totals agree).

### IP9 · The return as Excel and PDF — BUILT

The owner asked for two tabs: miles by truck × state, gallons by truck × state, totals both ways.
Recommended and accepted shape (2026-10-07): Excel with (1) the return by state, (2) miles truck ×
state, (3) gallons truck × state with each truck's MPG, (4) every fill with its source, (5) what needs a
look (miles and no fuel, fills with no truck, dropped duplicates). PDF: the return by state, then one
block per truck — a 190 × 40 matrix does not print.

Built (2026-10-07): `GET /api/ifta/return.xlsx` and `/return.pdf?year&quarter` (fuel view, audited
`export.generated`), "Excel" and "PDF" on the IFTA page for the quarter it shows.

- **D-IP8 · One set of figures in the file, checked against the page.** The return tab is computed
  from the same truck rows as the two grids (`buildIftaReturnReport`, same `computeIftaPosition`), so
  a column total IS its return line by construction. It is then compared with the page's own position
  (`ledgerPosition`, now shared by the page and the export); a state that differs by more than a mile
  or 0.1 gal is listed under "Needs a look" (a sync landed between the reads; export again).
- **D-IP9 · Unrounded cells, live totals.** Grid cells hold the unrounded miles and gallons under a
  display format; totals are SUM formulas with cached values. Summing whole-mile cells drifts from the
  return by up to half a mile per truck.
- "Needs a look" also lists: fleet MPG outside `IFTA_MPG_BAND`, states with no rate, a truck with miles
  and no fuel, a truck MPG outside `PLAUSIBLE_FLEET_MPG` (carve-out recorded in `lint:mpg`, D-MPG2 per
  truck), fuel with no truck, and every receipt the duplicate rule dropped.
- Found while building: `pdfDraw.table()` drew each header a little lower than the one before and
  right-aligned headers overhung their figures by 6pt. Fixed for every document using it.

---

## 3. Open questions

| # | Question | Who | Candidate answers · recommendation | Blocks |
|---|---|---|---|---|
| **Q-IP1** | ~~How does a hand-keyed or cash receipt look in McLeod?~~ | — | **ANSWERED 2026-10-05 (§0.1): `fuel_tax_history.source = 'F'`.** Not in `fuel_detail_hist` (all EFS) nor `fuel_ticket_hist` (EFS invoices). | — |
| **Q-IP2** | **What do `tractor.pay_owner` D/B/O and `tractor.owner` codes mean?** | Carrier (Alex) | Likely D = company, O = owner-operator, B = ?; SILVMEIL = Silvicom. **One email; D-FG12 forbids guessing.** | IP3 |
| **Q-IP3** | **The live login (`silvicom_dispatch_ro` on `lme`) cannot read the fuel-tax tables — measured 2026-10-05.** | Carrier DBA (Alex) | `GRANT SELECT ON dbo.fuel_tax_history TO silvicom_dispatch_ro` — one table, read-only, no PII. **Recommended**: the frozen `lme_analytics` restore would make every quarter's manual fuel only as fresh as somebody's restore habit (D-PREC12). | IP6 |
| **Q-IP4** | ~~Which of the 16 owner-operator units file under their own IFTA account?~~ | — | **ANSWERED 2026-10-05 (§0.2): none, per McLeod.** `exclude_fueltax = 'N'` on every tractor; 512's fuel is in McLeod's IFTA as hand-keyed receipts. Follow the flag from now on (IP4 revised). | — |
| **Q-IP5** | ~~Do receipts that never reach McLeod exist?~~ | — | **ANSWERED 2026-10-07: the office sends CSV/Excel files and wants them uploaded (D-IP7, IP8).** The receipt image is not part of either file; storing it is not built. | — |

---

## 4. The McLeod probe for Q-IP1 (read-only; run against live `lme`, or `lme_analytics` if the live login cannot read it)

```sql
-- Q-IP1: how do hand-keyed / cash receipts differ from card imports? 2026 Q3, all four companies.
SELECT
  f.company_id,
  CASE WHEN NULLIF(LTRIM(RTRIM(f.fuel_card_id)), '') IS NULL THEN 'no card' ELSE 'card' END AS card,
  NULLIF(LTRIM(RTRIM(f.vendor_id)), '')                  AS vendor_id,
  COUNT(*)                                               AS lines,
  SUM(f.tractor_gals)                                    AS tractor_gals,
  SUM(CASE WHEN NULLIF(LTRIM(RTRIM(f.tractor_id)), '') IS NULL THEN 1 ELSE 0 END)       AS no_tractor,
  SUM(CASE WHEN NULLIF(LTRIM(RTRIM(f.truck_stop_state)), '') IS NULL THEN 1 ELSE 0 END) AS no_state,
  MIN(f.trans_date_time) AS first_at,
  MAX(f.trans_date_time) AS last_at
FROM dbo.fuel_detail_hist AS f
WHERE f.trans_date_time >= '2026-07-01' AND f.trans_date_time < '2026-10-01'
GROUP BY f.company_id,
         CASE WHEN NULLIF(LTRIM(RTRIM(f.fuel_card_id)), '') IS NULL THEN 'no card' ELSE 'card' END,
         NULLIF(LTRIM(RTRIM(f.vendor_id)), '')
ORDER BY lines DESC;

-- And ten example no-card lines, to see what a person actually typed.
SELECT TOP 10 f.id, f.company_id, f.tractor_id, f.trans_date_time, f.truck_stop_name, f.truck_stop_city,
       f.truck_stop_state, f.tractor_gals, f.tractor_cost, f.total_amount, f.vendor_id
FROM dbo.fuel_detail_hist AS f
WHERE f.trans_date_time >= '2026-07-01' AND f.trans_date_time < '2026-10-01'
  AND NULLIF(LTRIM(RTRIM(f.fuel_card_id)), '') IS NULL
ORDER BY f.trans_date_time DESC;
```

⚠ `vendor_id` is assumed to exist on `fuel_detail_hist` (212 columns, measured 2026-08-26) but is not one
of the columns the agent already selects. If SQL Server answers "Invalid column name", drop that column
and run the rest — run each statement on its own, since one bad column kills the whole batch.

---

## 5. Progress log

- 2026-10-05 — Plan opened. IP1 built on `claude/ifta-state-filters`, merged as #1302.
- 2026-10-05 — McLeod probed directly (read-only): Q-IP1 and Q-IP4 answered, Q-IP3 measured (§0.1, §0.2).
  IP4 revised to mirror `exclude_fueltax`; IP6 revised to read `fuel_tax_history.source = 'F'` into the
  IFTA credit side only, dropping the 2 rows that duplicate a card fill.
- 2026-10-05 — IP4 built (0433 `vehicle_fuel_tax_exclusions`; agent reads `exclude_fueltax` →
  `fuel_tax_excluded`; `recordFuelTaxExclusion` opens/closes dated periods from the vehicle sweep).
  Live dry run of the new query: 193 tractors, all `fuel_tax_excluded = false` — no rows will be written
  until the carrier flips the switch. The review routine Alex approved is rebuilt and changed by one
  column; he needs telling. IP5 (the IFTA reads honour the periods) is the next merge. Owner ruled the
  sandbox (`lme_analytics`) may backfill PAST quarters' hand-keyed fuel for IP6 while Q-IP3 is open.
- 2026-10-05 — IP4 merged (#1313). IP6 collection built: 0434 `mcleod_fuel_tax_receipts` (raw, service-role
  only), agent `FUEL_TAX_RECEIPTS` (source F only) on the financial sweep with a two-year nightly re-read
  that IS the backfill, `POST /api/tms/fuel-tax-receipts`, and `readFuelTaxReceipts` for the ifta module.
  Sandbox dry run: 447 receipts, 2024-Q4 → 2026-Q2, all valid, none dropped. Grant script gains
  `fuel_tax_history` on both databases (NOT YET RUN — Alex). Nothing reads the table yet; the IFTA
  ledger and the state page add it to "fuel bought" in the next merge, with the card-duplicate rule.
- 2026-10-05 — IP6 read side built: the IFTA ledger and the state page add McLeod's hand-keyed receipts
  to "gallons bought" as their own source. Ledger rows say "incl. N gal from receipts keyed in McLeod"
  and one line under the cards accounts for every receipt (kept, dropped as a card duplicate, or from a
  McLeod unit matched to no truck); with none it says gallons bought are card fills only. The state
  page lists each receipt as a fill row "Receipt keyed in McLeod" (date, state, gallons; no price,
  station or time), so a truck fuelled only on paper (512) is a truck that bought fuel there.
  Duplicate rule in shared (`dropCardDuplicateReceipts`): same truck, state, station-local day,
  gallons within 0.5, one card fill per receipt, closest first. Both pages call it, so the state
  page's gallons still equal the ledger row's. Receipts move the fleet MPG with them, deliberately —
  the return divides miles by ALL fuel. McLeod unit → truck by `mcleod_tractor_id`, then
  `unit_number`, retired trucks included. New boundary edge `ifta -> mcleod` (a read). Nothing shows on
  staging or production until a release plus one nightly `--financial` sweep fills 0434.
- 2026-10-07 — Two files analysed (fuel app CSV: unit 512, found from the driver's Samsara assignment;
  McLeod ticket export: 718/777). Production checked read-only: 0434 holds 0 rows; no ticket duplicates a
  card fill. Owner ruled D-IP7 (uploads; our entry wins over McLeod's copy; grant comes with the VM; July
  later the same way). IP8 built: 0436, shared parser + `foldReceiptSources`, `POST/GET
  /api/ifta/receipt-uploads` (+ `/:id/void`), the dialog on the IFTA page. IP9 (export) is next.
- 2026-10-07 — IP9 built: the return as Excel (return, miles grid, fuel grid + MPG, every fill, needs a
  look) and PDF (return, needs a look, a block per truck). D-IP8 (checked against the page), D-IP9
  (unrounded cells, live totals). `periodPurchases`/`rateDateFor` moved from the web hook to
  `@silvicom/shared` (`ledgerPosition`). 14 mutants, all killed.
