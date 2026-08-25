# Fuel Spend Reconciliation & Weekly Statement Intelligence — Analysis + Build Plan

**Date:** 2026-08-24 · Research complete, no code changed yet.
**Driving question (the carrier's, not ours):** *fuel spend is going up — by how much, and why?*
**Scope:** rebuild `/fuel-reconciliation` from a monthly line-matcher into a weekly spend-intelligence
surface fed by the Pilot Flying J direct-bill statement (PDF), the EFS API feed, and our own
`fuel_transactions`.

Every number below was measured against **real production data** (Silvicom, org 139445) and the real
statement `db139445F.pdf` (invoice 795506105, period 08/17/26–08/23/26). Nothing here is estimated.

---

## 0. What exists today (audit)

| Piece | File | State |
|---|---|---|
| Page | `apps/web/src/pages/FuelReconciliationPage.vue` (238 ln) | Upload → parse → match → table. **Ephemeral**: nothing is persisted, so there is no week-over-week anything. |
| Parser | `packages/shared/src/reconcile/pilotFuelReport.ts` (329 ln) | Parses the **monthly "All Transactions" Excel export** only. Keys on `Authorization_No` / `Card_No` / `Quantity` headers. The weekly statement has none of those. |
| File decode | `apps/web/src/features/fueling/usePriceUpload.ts` → `readReportGrid` | `.xlsx`/`.xlsm` (ExcelJS), HTML-table-named-`.xls`, `.csv`. **No PDF.** Legacy binary `.xls` is rejected with a convert prompt. |
| System side | `apps/web/src/features/reconcile/useFuelReconcile.ts` | Reads `fuel_transactions` in the report window, `tank_type='tractor'` only. |
| Matching | `reconcilePilotFuel` | Greedy on **card last-4 + business date**, closest gallons. |
| Brands | `packages/shared/src/smartFueling/brands.ts`, `efsImport/reconcile.ts` | Brand slugs (`pilot`/`flying_j`/`one9`/…) exist; `fuel_stations` is populated (540 pilot, 253 flying_j, 106 one9, 616 loves, …). `fuel_transactions` carries **no brand and no station link**. |
| Policy | `route_fuel_settings` | `avoid_states = {CA}`, `avoid_brands = {one9}`, `preferred_brands = {pilot, flying_j}`. Set, but **compliance is never measured**. |

### Gaps that block the ask

1. The weekly statement is a **PDF** and cannot be uploaded at all.
2. Its layout is a billing statement, not the monthly export — a different parser entirely.
3. Nothing is persisted → no trend, no week-over-week, no "why did spend rise".
4. No brand/network dimension on actual fills → "ONE9 usage" and "off-network" are unanswerable.
5. Discount capture is never computed, even though the statement prints both sides of it.

---

## 1. The weekly statement — decoded (verified, not assumed)

`StatementDBS_US`, Microsoft Reporting Services, 25 pages, **text layer with word-level coordinates**
(confirmed via `pdftotext -bbox-layout`). Columns are at stable x-anchors; rows cluster by y. A
column-band parser reproduces the file exactly — this is not OCR and carries no OCR risk.

**Prototype result — validated against all five statements** (2026-07-20 → 2026-08-23, 3,919 lines):

| Statement | Period | Lines | Amount Δ | Retail Δ | Units Δ | Savings Δ |
|---|---|---|---|---|---|---|
| 790722856 | 07/20–07/26 | 778 | **$0.00** | **$0.00** | +3.5 | +$82 (0.27%) |
| 791794052 | 07/27–08/02 | 785 | **$0.00** | **$0.00** | +2.7 | +$77 (0.27%) |
| 793170296 | 08/03–08/09 | 782 | **$0.00** | **$0.00** | +3.4 | +$48 (0.15%) |
| 794335795 | 08/10–08/16 | 725 | **$0.00** | **$0.00** | +3.8 | +$42 (0.15%) |
| 795506105 | 08/17–08/23 | 849 | **$0.00** | **$0.00** | +4.7 | +$24 (0.08%) |

**Amount and retail tie to the cent on every file.** Two residuals, both understood:

- **Units (+2.7 to +4.7 of ~56,000).** `units × cost == amount` holds on **every row of all five files**,
  so the parsed per-line units are exactly what Pilot printed. Pilot's `Customer Total` sums *unrounded*
  quantities while printing them at 0.1 gal. **Units cannot tie to the cent by construction** — D-FR3
  gates hard on amount + retail, and gates units at a tolerance.
- **Savings (+0.08% to +0.27%).** Pilot computes `Savings Total` from per-unit prices rounded to 3 dp;
  we compute Σ(retail − amount) from totals. Excluding the merchandise lines accounts for most of the
  gap. Gated as a cross-check at ≤0.5%, not as an equality.

Column anchors are **self-calibrating**: the statement's second header line is 21 tokens that name every
column in order, so anchors are read off each page rather than hardcoded. Across all 125 pages of the
five files, **exactly one anchor set was observed** — the layout is perfectly stable, and any future
drift recalibrates automatically instead of silently shifting a column.

### Product codes — resolved empirically, not guessed

Cross-referenced the statement's per-code totals against `efs_transactions.item` for the identical
week. Counts *and* quantities agree line-for-line:

| Pilot `Prod` | Statement lines / units | EFS `item` | EFS lines / qty | Meaning |
|---|---|---|---|---|
| `020` | 478 / 57,902.8 | `ULSD` | 483 / 58,190 | Tractor road diesel |
| `033` | **23 / 526.6** | **`ULSR`** | **23 / 527** | **Reefer (dyed, off-road) diesel** |
| `140` | **342 / 2,412.1** | **`DEFD`** | **342 / 2,409** | **DEF** |
| `021` | **1 / 46.5** | **`DSL1`** | **1 / 46** | Diesel #1 (winter blend) |

Exact-count agreement on three of four codes is conclusive — and the monthly export's own
`ProductDescription` column independently confirms it in Pilot's words: **`20` Truck Diesel, `33`
Reefer, `140` Diesel Exhaust Fluid, plus a `Miscellaneous` class**. No inference required. `033 → tank_type='reefer'` matters: today
the recon page filters `tank_type='tractor'`, so **every reefer line on the statement is currently
reported as "missing in our system"** — a permanent false-positive block.

### Other structure the statement carries that we throw away today

- **`Retail Total` vs `Amount` per line** — the discount, line by line. Pilot prints `Savings SubTotal`
  daily and `Savings Total` ($31,082.10) for the week; both equal Σ(Retail − Amount). Free validation.
- **`Loc.`** = the Pilot-family store number. **All 319 distinct sites on this statement resolve to a
  brand** by joining `fuel_stations` on `(store_number, state)` restricted to `PILOT_FAMILY_BRANDS`.
  Zero unresolved. This is the ONE9 detector.
- **`Card Number`** is the **last 6 digits** of the EFS PAN (`7083050030490367971` → `367971`), not the
  last 4 the current matcher uses. Stricter, collision-free join key, available for free.
- **`Odometer Reading`** — an independent odometer per fill, from the pump, usable to cross-check MPG.
- **5 merchandise lines** ($86.60) posted through the `Misc./Disc.` column with sales tax — in-store
  card purchases, invisible today.

---

## 2. What the data actually says (the findings that justify the build)

### 2.1 The headline: the market, then volume, then discount compression

Built from a **13-week unified series** — the June+July monthly export plus all five weekly statements
(2026-06-01 → 2026-08-23), which join with a validated overlap week (§7). Truck Diesel only.

| Week of | Src | Gallons | Net $/gal | Retail $/gal | Discount $/gal |
|---|---|---|---|---|---|
| 06-07 | export | 52,653 | 4.4339 | 5.1650 | 0.7311 |
| 06-14 | export | 52,387 | 4.1294 | 4.9405 | **0.8111** |
| 06-21 | export | 54,279 | **3.9516** | **4.7275** | 0.7759 |
| 06-28 | export | 44,792 | 4.0094 | 4.6803 | 0.6710 |
| 07-05 | export | 46,790 | 4.1227 | 4.7287 | 0.6060 |
| 07-12 | export | 53,937 | 4.5014 | 5.0935 | 0.5922 |
| 07-19 | export | 52,961 | 4.7946 | 5.3628 | 0.5682 |
| 07-20 | **stmt** | 53,937 | 4.8111 | 5.3847 | 0.5736 |
| 07-27 | **stmt** | 53,738 | 4.9361 | 5.4713 | 0.5351 |
| 08-03 | **stmt** | 53,827 | 4.8000 | 5.4098 | 0.6098 |
| 08-10 | **stmt** | 50,322 | 4.9913 | 5.5347 | 0.5435 |
| 08-17 | **stmt** | 57,903 | **5.2157** | **5.7468** | 0.5311 |

**Spend bridge, 4-week averages** (weekly gallons swing ±10%, so single-week pairs are too noisy to
reason from — the report must smooth):

| | Jun 7 – Jul 4 | Jul 27 – Aug 23 |
|---|---|---|
| Gallons / week | 51,027 | 53,947 |
| Net $/gal | $4.1343 | $4.9900 |
| Retail $/gal | $4.8847 | $5.5447 |
| Discount $/gal | $0.7503 | $0.5546 |
| **Weekly spend** | **$210,964** | **$269,199** |

| Component | $/week | Share |
|---|---|---|
| **Market (retail up $0.66/gal)** | **+$35,605** | **61.1%** |
| Volume (+2,920 gal/week, +5.7%) | +$12,071 | 20.7% |
| Discount compression (−$0.196/gal) | +$10,558 | 18.1% |
| **Total** | **+$58,234/week** (≈$3.0M/yr) | residual **$0** |

### 2.1.1 The discount compression is market-linked, not a repricing

**Correcting an earlier reading in this document's first draft.** Comparing *June-month* to *July-month*
averages made the discount look like the dominant cause (−$0.173/gal ≈ $33k/month) and the by-state
decomposition showed it was a rate change rather than a mix shift — drivers had *not* changed where they
fueled. That much still holds. But "rate change" was then read as *"Pilot may have repriced us,"* and
the weekly and daily series do not support that:

- **No step.** Daily discount across the suspected 2026-07-01 break: 0.889, 0.707, 0.776, 0.640, 0.772,
  0.701, 0.707, **0.636, 0.657, 0.578, 0.635, 0.705, 0.590, 0.738, 0.611** — a noisy downward drift, no
  discontinuity anywhere.
- **It tracks the market inversely.** Over the 13 weeks, `corr(retail/gal, discount/gal) = **−0.614**`,
  slope **−$0.177 of discount per $1.00 of retail**. The discount was *widest* ($0.81/gal) in the week the
  market **bottomed** (06-14/06-21, retail $4.73–4.94, net $3.95).
- June's monthly average was flattered by exactly that trough. The month-vs-month comparison was
  confounded; the weekly series is not.

This is the signature of a **rack-linked / cost-plus** deal, where the discount mechanically compresses
when rack rises faster than street retail — not of a contract being repriced. **The report must not send
the carrier to argue a repricing the data doesn't show.** It should present the correlation and the
implied slope, and let §8.1 (the actual contract terms) settle the mechanism.

The methodological lesson is load-bearing for the build: **a bridge computed on monthly averages, or on a
single week pair, produces a materially wrong attribution.** §4.6 is specified on trailing 4-week
averages for that reason.

**Everything below is real money and directly actionable — but it is the ~39% of the increase that is
not the market.**

### 2.2 Discount capture — $24,761 across the five statement weeks

Per-line captured discount vs **that week's own median** (so a moving market can't create a phantom gap):

| Week of | Median $/gal | Below-median shortfall | Zero-discount lines |
|---|---|---|---|
| 07-20 | $0.5950 | $4,093 | 6 ($2,849) |
| 07-27 | $0.5323 | $4,387 | 6 ($3,104) |
| 08-03 | $0.6219 | $5,323 | **0** |
| 08-10 | $0.5632 | $4,605 | 2 ($1,132) |
| 08-17 | $0.5872 | $6,354 | 9 ($4,342) |
| **Total** | | **$24,761** | 23 |

**≈$5,000/week ≈ $257k/year**, consistent across all five weeks. Distribution within the 08-17 week:

| Captured discount | Lines | Gallons | Spend | Gap vs median |
|---|---|---|---|---|
| **$0.00 (none)** | 9 | 818 | $4,342 | $480 |
| < $0.10/gal | 23 | 2,847 | $15,042 | $1,513 |
| $0.10–0.30 | 55 | 6,550 | $35,714 | $2,452 |
| $0.30–0.60 | 178 | 21,724 | $115,015 | $1,892 |
| $0.60–1.00 | 213 | 25,964 | $131,890 | −$3,088 |

Note the week of 08-03: **zero zero-discount lines and the best median capture of the five.** It is also
the only week with **no ONE9 fills** (§2.3). That is the whole thesis of this feature in one data point.

### 2.3 ONE9 — every zero-discount line on every statement is a ONE9 site

Brand resolved by joining `Loc.` + `State` to `fuel_stations` over `PILOT_FAMILY_BRANDS`. **582 of 582
distinct site/state pairs across all five statements resolved — 100%, zero unknowns.**

| Week of | ONE9 lines | Gallons | Spend | $/gal | Discount | Other off-brand |
|---|---|---|---|---|---|---|
| 07-20 | 3 | 304 | $1,457 | $4.802 | **$0.000** | 3 ln / $1,392 |
| 07-27 | 6 | 553 | $2,815 | $5.090 | **$0.000** | 1 ln / $402 |
| 08-03 | **0** | 0 | $0 | — | — | 0 |
| 08-10 | 3 | 237 | $1,188 | $5.017 | **$0.000** | 0 |
| 08-17 | 9 | 723 | $3,876 | $5.359 | **$0.000** | 1 ln / $568 |

**Not one ONE9 gallon in five weeks captured a cent of discount**, against $0.53–0.61/gal on
Pilot/Flying J — while also carrying the highest posted price. ONE9 is on `avoid_brands` and is used
anyway; usage is per-unit and repeating (unit 754 hit ONE9 three times in two days across Latta SC,
Wilmington OH and Elliston VA; unit 729 twice at Sparks NV). ≈$9,300 of ONE9 spend in five weeks, of
which ≈$1,100 is pure foregone discount before the price premium.

### 2.4 Off-network (non-Pilot-family) spend

Statement week: **76 EFS lines, $2,555** off the Pilot family. Full August: **$17,474 across 108
lines**. The outliers are where the money is:

| Site | State | $/gal |
|---|---|---|
| TA EXPRESS OLANCHA | CA | **$7.007** |
| UNITED PACIFIC #252, Long Beach | CA | **$6.919** |
| LOVES #1035, Trinidad | CO | $5.449 |
| TA EXPRESS SUMMIT | SD | $5.069 |

### 2.5 California

| Week of | Lines | Gallons | Spend | $/gal | Avg fill | Excess vs week's fleet $/gal |
|---|---|---|---|---|---|---|
| 07-20 | 8 | 614 | $3,894 | $6.343 | 76.7 gal | $941 |
| 07-27 | 21 | 1,742 | $11,315 | $6.494 | 83.0 gal | $2,715 |
| 08-03 | 18 | 1,527 | $9,455 | $6.193 | 84.8 gal | $2,127 |
| 08-10 | 9 | 726 | $4,737 | $6.522 | 80.7 gal | $1,112 |
| 08-17 | 16 | 1,461 | $9,905 | $6.780 | **91.3 gal** | $2,285 |

≈**$9,200 of CA premium over five weeks**. Buy-minimum discipline is working but **eroding** — average CA
fill has crept 76.7 → 91.3 gal while the fleet-wide average fill is ~121 gal, so the gap that
`avoid_states = {CA}` is supposed to create is closing. Monthly context from `fuel_transactions`:
June $5.604/gal → July $6.058 → August $6.281. Worst sites: Pilot Boron 200 ($6.62), Pilot Tehachapi
#1094 ($6.57), Pilot Barstow 282 ($6.56).

### 2.6 A live classification bug this work must fix

`STATION_BRANDS` in `packages/shared/src/efsImport/reconcile.ts` matches Flying J with
`/\bflying\s*j\b/i` and `/\bflyingj\b/i`. EFS actually writes **`FJ-TULSA 706`, `FJ 1372`,
`FJ BIG SPRINGS 904`** — neither pattern matches. Measured impact: **488 transactions / $281,330 in
August alone** classified as brandless independents. Same blind spot in
`brandFromLocationName` (`smartFueling/brands.ts`). Because `parseStationIdentity` feeds the geocode
`siteKey`, this also degrades the `location_mismatch` and `impossible_travel` anomaly signals.

### 2.7 Ancillary spend nobody reports

EFS, statement week: `SCLE` (CAT scale) **172 lines / $2,208** — ≈$115k/yr. Plus `STAX`, `WWFL`
(washer fluid), `ANFR`, `OIL`, and the 5 in-store merchandise lines. DEF ran 2,412 gal against 57,903
diesel gal = **4.2% dosing**, above the 2–3% engines actually consume — a purchase-vs-consumption gap
worth its own tile.

---

## 3. Design decisions

**D-FR1 — One dropzone, format-agnostic.** Sniff the *content*, not the extension: `%PDF` → PDF path,
`PK` → xlsx, OLE → the existing convert prompt, else HTML/CSV. Then detect the **layout**
(weekly statement vs monthly All-Transactions export) from the decoded content, not the file type. A
`.pdf`, `.xlsx` and `.csv` of the same statement must produce the identical normalized rows.

**D-FR2 — PDF decode at the UI edge, parsing stays pure.** `pdfjs-dist`, dynamically imported exactly
like ExcelJS, produces `{text, x, y, page}` words. `packages/shared` gets
`parsePilotStatement(words)` — pure, dataset-free, unit-tested against a checked-in word fixture from
this real statement. No PDF library in `packages/shared`, no PDF library on the API.

**D-FR3 — Tie-out is a hard gate, not a warning.** The parser must reproduce the statement's own
printed `** Customer Total`, per-product `Customer Total`, and `Savings Total`. Mismatch beyond $0.01 /
0.1 gal ⇒ the file is **rejected** with the delta shown. A silently-wrong reconciliation of a $1M/month
spend is worse than no reconciliation. (Same discipline as the `RESULT`-line rule for PGlite matrices.)

**D-FR4 — Persist statements.** New tables `fuel_statements` + `fuel_statement_lines`. Without history
there is no week-over-week and the driving question stays unanswerable. Evidence-grade: re-uploading
the same invoice number supersedes by inserting a new statement and marking the prior one superseded —
**never** an UPDATE, never a DELETE (`RETENTION_FORBIDDEN` discipline). Ingest is a set-based INSERT;
no `.upsert()` with a partial payload (`lint:upserts`).

**D-FR5 — Brand resolution is a join, not a column on the fill.** Resolve
`(Loc., State) → fuel_stations(store_number, state) ∈ PILOT_FAMILY_BRANDS` at ingest and store the
resolved `station_id` + `brand` **on the statement line** (a statement fact, provable from the file).
`fuel_transactions` additionally gets a nullable `station_id` so EFS-side fills carry the same
dimension. Unresolved sites are surfaced and counted, never guessed (the existing `known: false`
convention in `brandFromLocationName`).

**D-FR6 — Match on card last-6 + business date.** Report card = last 6 of PAN, verified. Fall back to
last-4 only when a 6-digit card is absent, and label the row so a weaker match is visible.

**D-FR7 — Reconcile all four products, not just tractor diesel.** Drop the `tank_type='tractor'`
filter; map `020→tractor`, `033→reefer`, `021→tractor`, `140→def`, and match within product class.

**D-FR8 — Three-way tie-out.** Pilot statement ↔ EFS feed ↔ `fuel_transactions`. Today only the last
two are compared. The statement is the **billing** truth (what we pay); EFS is the **authorization**
truth. They disagreed by $1,553 in the sample week — that delta is a finding, and it needs a home.

**D-FR9 — Fix the FJ brand regex as its own change, ahead of the feature.** §2.6 is a live defect with
its own test; it does not belong buried in a feature branch.

---

## 4. The report surface

Page becomes tabbed. Each tab is one question, each tile filters the table beneath it.

### 4.1 Overview
Week totals; gallons / spend / $/gal; net vs retail; **savings captured $ and ¢/gal vs the statement's
own printed Savings Total**; three-way tie-out (statement ↔ EFS ↔ system) with the dollar delta stated
plainly; parse tie-out badge.

### 4.2 Discount capture ← *"transactions that maybe didn't catch our discounts"*
Every line with captured ¢/gal. Bands as in §2.2. Per-site, per-state, per-brand roll-ups with a
**gap-vs-median dollar** column so the biggest leaks sort to the top. Where `fuel_prices` has a
contract/posted price for that site+day, compare per-fill against it instead of the median. Repeat
offenders (site × week) get named — GA, IL and FL ran $0.21–0.23/gal against $0.60+ in TX/OK/KY/NE,
which looks structural, not accidental.

### 4.3 California ← *explicit ask*
Every CA fill: site, unit, driver, gallons, $/gal, CA premium vs the same-day fleet average, and
**excess-vs-benchmark dollars**. Fill-size discipline (avg CA fill vs fleet avg) so buy-minimum
compliance is visible. Rolls up to a monthly CA trend. Ties directly to `avoid_states = {CA}`.

### 4.4 ONE9 & off-brand ← *explicit ask*
Every fill at a brand on `avoid_brands`, with the zero-discount penalty and the premium vs the nearest
Pilot/FJ price that day. Grouped by unit and driver, because §2.3 shows this is per-driver behaviour,
not random.

### 4.5 Off-network ← *explicit ask*
EFS fills with no Pilot-family site. Per-fill premium vs what the network would have cost.
Merchant / state / unit / driver breakdown.

### 4.6 Why spend moved — the variance bridge ← *the actual goal*

Decomposition of Δspend into additive, signed components that **sum to the actual delta with zero
residual** (proved in §2.1 — the 4-week bridge residual is exactly $0):

```
Δspend = Δvolume            (gallons × old net price)
       + Δretail            (the market — 61.1% of the current increase)
       + Δdiscount RATE     (same site, different discount)
       + Δdiscount MIX      (same discount, different site share)
       + Δnetwork mix + Δstate mix
       + Δancillary
```

Three non-negotiables, each learned the hard way in §2.1.1:

1. **Trailing 4-week averages, never a single week pair.** Weekly gallons swing ±10%; the 08-10 → 08-17
   pair attributes 74% to volume, the smoothed 4-week bridge attributes 21%. A single-pair bridge is
   not just noisy, it is wrong.
2. **Rate and mix must be split.** A bridge that only says "discount capture fell" cannot distinguish
   *"our vendor repriced us"* from *"our drivers fueled at worse sites"*, and those have opposite
   remedies. §2.1.1 proves the split is computable and ties out to $0.0002/gal by state.
3. **Show the discount↔retail correlation alongside the rate bar.** A rate bar on its own reads as an
   accusation. `corr(retail, discount)` and its slope tell the reader whether the compression is
   market-linked (§2.1.1: −0.614, −$0.177 per $1.00 retail) or genuinely anomalous. Without it the
   report will send someone to argue a repricing that never happened.

Rendered as a waterfall, with drill-down from any bar to the sites driving it, ranked by dollars. This
is the one screen that answers *"why is fuel costing more?"* with attribution instead of a number.

### 4.7 Ancillary & DEF
Scale (`SCLE`), oil, washer fluid, in-store merchandise, DEF. DEF-to-diesel dosing ratio with the
2–3% expected band drawn on it (currently 4.2%).

### 4.8 Exceptions
Missing-in-system / missing-on-report / amount / gallon mismatch (today's buckets, kept), plus:
duplicate ticket or auth number, cards or units on the statement absent from our roster, and statement
odometer vs our odometer.

---

## 5. Work packages

| WP | Deliverable | Gates |
|---|---|---|
| ~~WP0~~ | **SHIPPED 2026-08-24.** Bigger than the `FJ-` regex: the two brand matchers were unified onto one catalog (`STATION_BRAND_RULES` in `smartFueling/brands.ts`) and the EFS path gained ONE9, Mr. Fuel, EZ Trip, Road Ranger and the `PFJ`/`FJ` abbreviations. Unbranded spend **$1,045,342 → $24,158** (34% → 0.8% of all fuel since 2026-06-01); the remainder is genuinely independent. `pride`/`arco` start-anchored after `\bpride\b` mis-claimed "CAT SCALES  NATIVE PRIDE". 26 real production name shapes pinned in tests. | `pnpm test` ✅ · `lint:boundaries` ✅ · `lint:comment-claims` ✅ |
| ~~WP1~~ | **SHIPPED 2026-08-24.** `pdfjs-dist` in `apps/web`; `@/lib/pdfWords` (lazy import, worker off the main thread); grid decoder promoted from `features/fueling` to `@/lib/reportGrid`; `features/reconcile/loadFuelReport` sniffs magic bytes and normalises PDF **and** grid formats to one shape. Dropzone accepts `.pdf`. | typecheck ✅ · build ✅ (pdf chunk 427 kB lazy) · `lint:boundaries` ✅ |
| ~~WP2~~ | **SHIPPED 2026-08-24.** `reconcile/pilotStatement.ts` (463 ln) + `pilotStatementTieOut.ts`. Parses the printed product legend, splits pdfjs's merged text runs, separates fuel from bundled in-store charges, rejects on tie-out failure. 10 tests on a real-geometry fixture; all five real statements tie out through the browser path. | `pnpm test` ✅ · `lint:filesize` ✅ · `lint:boundaries` ✅ · `lint:tokens` ✅ |
| ~~WP3~~ | **SHIPPED 2026-08-24** as `0243` (0242 was taken by the McLeod branch mid-session). `fuel_statements` + `fuel_statement_lines` + `fuel_transactions.station_id` + the private `fuel-statements` bucket. Append-only by trigger: a superseded row is frozen ENTIRELY, so even re-pointing it at the same replacement (which would silently move `superseded_at`) is refused. Both tables pinned in `RETENTION_FORBIDDEN`. `fuel-statements` matrix: 26 passed. | `lint:migrations` ✅ · `check-rls.mjs` ✅ · `lint:upserts` ✅ · matrix `RESULT: 26 passed, 0 failed` |
| ~~WP4~~ | **SHIPPED 2026-08-24.** `POST /api/fueling/statements` + `fuelStatementIngest`. The server **re-parses the words** rather than trusting the client and refuses anything that misses the vendor's printed totals; brands resolve on (store number, state); the source PDF is stored and hashed server-side; supersede runs after the lines land so a failed upload never retires a good statement. 10 service tests incl. `expectOrgScoped`. | `pnpm test` ✅ · org-scoping asserted ✅ |
| ~~WP5~~ | **SHIPPED 2026-08-24.** `packages/shared/src/fuelSpend/` — `types` (one source-agnostic row shape), `varianceBridge` (weekly series, exact 4-component bridge with a shift-share rate/mix split, discount↔market correlation), `discountCapture` (week-relative median benchmark, bands, roll-ups), `policyExceptions` (avoid-brand / avoid-state / off-network, each priced against the *other* fills), `ancillary` (reefer, DEF ratio, bundled merchandise). 30 tests incl. the bridge property test over 200 pseudo-random shapes on two grouping dimensions. Verified against all five real statements: residual **$0**. | `pnpm test` ✅ · `lint:filesize` ✅ · `lint:boundaries` ✅ |
| **WP6** | Page rebuild: tabs, tiles, `DataTable`/`FilterBar`/`FilterSelect`, CSV export per tab. Page splits into `features/reconcile/` components to hold the file budget. | `lint:tokens`, `lint:ui-adoption`, `lint:filesize`, `preview:local` |
| **WP7** | Statement history: week-over-week and month-over-month trend, the waterfall, backfill of prior statements as they're uploaded. | `pnpm test` |

WP0 and WP1 are independent and can run in parallel. WP2 gates WP3–WP5. WP6 gates on WP5.

**Status 2026-08-24: WP0–WP5 shipped.** Statements persist and every question in §4 is now a pure
function over them. What remains is WP6/WP7 — the tabs that render this and the trend that reads back
from the stored statements rather than a single upload.

**WP5 verified against the real five statements** (3,919 lines), reproducing the Python prototype:

| | Analytics output |
|---|---|
| Discount shortfall, 5 weeks | **$24,766** ($4,093 / $4,387 / $5,323 / $4,605 / $6,358) |
| ONE9 / avoid-brand | 18 lines, 1,766 gal, $9,065, **$0.000/gal captured** |
| California | 72 lines, 6,070 gal, $39,305, $6.475/gal, **$9,445 excess**; avg fill 84.3 gal vs 121.9 elsewhere |
| Off-network | 23 lines, 2,222 gal, $11,426, $0.000/gal captured, $423 excess |
| DEF ratio | 11,366 gal against 269,772 diesel = **4.21%**, outside the 2–3% band |
| Bridge (trailing 2×2 wk) | Δ$14,894/wk — market 75.6%, volume 11.5%, disc rate 11.1%, disc mix 1.8%, **residual $0** |
| discount↔retail | corr **−0.673**, slope −$0.153 per $1.00 retail |

**Earlier status.** Uploading any of the five weekly PDFs on
`/fuel-reconciliation` now parses, ties out against the statement's own printed totals, and reconciles;
and every fill now carries a correct brand, so "how much at ONE9 / off-network" is answerable from the
EFS feed and not only from a statement. WP3+ (persistence, the analytics tabs, the variance bridge)
remain.

**One consequence of WP0 to expect.** `parseStationIdentity`'s `siteKey` is the geocode cache key, so a
station that used to fall back to `name|city|state` and now resolves to `brand#store` no longer finds
its learned coordinate (283 rows today: 84 store-keyed, the rest name-keyed). That is a cache miss, not
a wrong coordinate — `stationGeocodeLearning` recomputes from `fuel_transactions` + Samsara positions on
its next run and self-heals. Orphaned rows are inert and can be pruned later. Collision audit over all
1,009 production names: 1,005 distinct siteKeys, one collision (`pilot#287`, Burbank OH / Lodi OH) which
is the SAME store under two nearby town names — pre-existing, and exactly what store-number keying is
for.

---

## 6. Risks

| Risk | Mitigation |
|---|---|
| Pilot changes the statement layout (x-anchors move) | Anchors are derived from the header row at parse time, not hardcoded; the tie-out gate (D-FR3) turns any drift into a loud rejection rather than wrong numbers. |
| A future statement contains an unmapped product code | Unknown codes are surfaced and counted, never bucketed into diesel. Same `known: false` convention as brands. |
| `fuel_stations` misses a new site | 0/319 unresolved today; unresolved sites are reported as their own count and excluded from brand roll-ups rather than defaulted to `pilot`. |
| `pdfjs-dist` bundle weight | Dynamic import, same pattern as ExcelJS — only paid on upload. |
| The +4.7-unit parse delta | Root-caused before WP2 ships; the tie-out gate means it can never ship silently. |
| Statement ↔ EFS $1,553 disagreement | Not a bug to hide — §4.1 gives it a permanent home, and WP4 records both sides. |

---

## 7. Available history (confirmed 2026-08-24 — all files in hand)

| Source | Coverage | Format | Status |
|---|---|---|---|
| `SILVICOM - June+July 2026 Savings.xlsx` | **2026-06-01 → 07-27**, 6,100 lines | Monthly "All Transactions" export | Parsed ✅ |
| `db139445F5 / F3 / F2 / F1 / F.pdf` | **2026-07-20 → 08-23**, 3,919 lines | Weekly statement PDF | Parsed ✅, all five tie out |
| `cp139445.xlsx` / `.xls` | spot | Monthly export | Cross-format fixture |
| EFS API feed | continuous | `efs_transactions` | Live |

**Unbroken 13-week series from 2026-06-01**, so §4.6 is useful the day it ships.

**Cross-format validation passed.** The two sources overlap on one week and agree:

| | Lines | Gallons | Net $/gal | Discount $/gal |
|---|---|---|---|---|
| Monthly export, wk 07-19 | 437 | 52,961 | $4.7946 | $0.5682 |
| Weekly statement, wk 07-20 | 444 | 53,937 | $4.8111 | $0.5736 |

Export weeks run Sun–Sat and statement weeks Mon–Sun, so a one-day offset is expected and fully explains
the gap. **This overlap week becomes a permanent regression test for D-FR1** — the same fuel, two vendor
formats, one normalized row shape.

One consequence for WP2: the monthly export carries `Disc PPU`, `Retail PPU` and `Savings` columns the
weekly statement does not, and its `TransactionDate` is an **Excel serial** (`46174`), not a string —
`dateYMD` must handle serials, and the derived columns must be **recomputed from InvoiceTotal/RetailTotal
rather than trusted**, so both formats produce provably identical rows.

The five PDFs also give WP2 **five independent parser fixtures** rather than one, and 125 pages of
evidence that the column layout is stable.

---

## 8. Open questions for Miki

1. **Contract discount terms — still the highest-value unknown, and `fuel_discount_rules` is empty in
   production.** §2.1.1 measures `corr(retail, discount) = −0.614`, slope −$0.177 per $1.00 of retail:
   the discount narrows as the market rises. That is the **cost-plus / rack-linked** signature and it
   argues *against* a repricing. But a flat ¢/gal deal would show slope ≈ 0 and a retail-minus-percent
   deal would show slope *positive* — so the measured −0.177 is itself evidence about the contract, and
   the contract would confirm it. Please send the agreement or rate sheet. It decides what §4.2
   benchmarks against (contract entitlement vs observed median) and what the report may conclude.
2. ~~The weekly PDFs~~ — **received 2026-08-24** (five, not four: 07/20 → 08/23). All five parse and
   tie out; see §1 and §7. No longer open.
3. **Statement retention.** Store the source PDF in Supabase storage as evidence alongside the parsed
   lines, or parsed lines only?
4. **ONE9 policy.** Is ONE9 genuinely emergency-only (per `route_fuel_settings`), so §4.4 is an
   exception report — or is it tolerated, making it a cost report?
5. **Any rebate or volume-tier settled off-invoice?** The statement's discount is what posts at the
   pump. If Pilot also pays a quarterly volume rebate, the true captured discount is higher than
   anything measurable here, and §4.2's benchmark must account for it.
6. **Gallons are up 5.7% (4-week average) — do we know why?** More trucks, more miles, or worse MPG? It
   is 20.7% of the spend increase (§2.1) and the only component this report cannot explain from fuel
   data alone; it needs the fleet/odometer side.

---

# Part B — Operating analytics from the EFS feed (2026-08-24)

**Correcting Part A's framing.** Part A built the statement pipeline on the premise that the weekly
Pilot PDF was the road to "why is fuel up". It is not, and the carrier said so: the EFS feed is live
and continuous (21,428 lines back to 2026-02-04), the statements are five weeks that arrive by hand,
and the trend question needs neither of them to be uploaded. The statement pipeline keeps its value —
it is the only source of per-line POSTED retail, so discount capture has no other home, and it is the
right tool for finding a fill we were billed for and never recorded. It is not the spine.

The spine is `fuel_transactions` + `vehicle_engine_days` + the odometer, joined nightly.

## What the data supports (measured 2026-08-24 against production)

| Source | Rows | Coverage |
|---|---|---|
| `efs_transactions` | 21,428 | 2026-02-04 → 08-24 |
| `fuel_transactions` | 11,265 | same; `vehicle_id` 97.5%, `driver_id` 97.7%, `odometer` 97.6%, `miles_since_last` 86% |
| `vehicle_engine_days` | 19,169 | 2026-04-14 → |
| `idle_rollup_days` | 20,116 | 2026-04-15 →, idle classified with HOS evidence |
| `driver_scores` | 1,288 | weekly Samsara miles — a mileage source INDEPENDENT of the odometer |
| `declined_transactions` | 3,357 | 2026-02-04 → |
| `loads` | **0** | no dispatch data, so no revenue-per-mile and no loaded-vs-empty MPG |

## Decisions

**D-FS1 — The rollup is org × vehicle × day, and carries no fuel dimension.** Miles and engine seconds
are properties of a truck's day and cannot be split across the two states it bought fuel in. A grain
carrying state or brand would either duplicate the day's miles onto every dimension row or park them on
an arbitrary one. State/site/brand drill-downs read `fuel_transactions` directly — 11k rows, fast
enough that pre-aggregating buys nothing.

**D-FS2 — Unattributed fuel is kept, on its own row.** 160 fills since 2026-06-01 ($25,953, 0.88% of
spend) carry no vehicle. A spend report that cannot be reconciled to the invoice is worth less than no
report. `nulls not distinct` on the unique index is what makes that row upsertable rather than
multiplying on every rebuild.

**D-FS3 — MPG is Σmiles ÷ Σ`mpg_gallons`, never ÷ Σ`gallons_tractor`.** A rejected odometer interval
loses its miles and keeps its gallons, because the fuel was still bought. Dividing trustworthy miles by
every gallon collapses MPG. Weekly fleet MPG computed the naive way over 2026-06 reads 85.7, 55.4,
35.8, then 6.94 — only the last is real, and a report printing that series shows an efficiency collapse
that never happened.

**D-FS4 — Interval miles are allocated across their days by drive time.** `miles_since_last` spans the
gap between two fills, so a truck fuelling every third day books three days of driving against one
date. `vehicle_engine_days.drive_sec` covers every truck that fuels (170/170), so miles and the gallons
paired with them are spread in proportion to how far the truck actually drove each day. Intervals are
half-open on the left, so no day is counted twice. A day driven THROUGH therefore carries miles and
gallons while having bought nothing — the `fuel_spend_days_miles_pair` constraint is written to permit
exactly that, and to refuse either one appearing without the other.

**D-FS5 — Derived, therefore not evidence.** Every row is reproducible from its sources, so the table
is deliberately absent from `RETENTION_FORBIDDEN` and carries no append-only trigger. `fuel_statements`
(0243) is the opposite case and is pinned.

**D-FS6 — Non-fuel spend is out of scope; DEF is in.** CAT scale, oil and washer fluid ($9,073 over
five weeks) stay in `efs_transactions` for the ancillary report. DEF does not: `fuel_transactions`
carries none at all and DEF is $55,512 of a five-week bill, so a "total fuel spend" without it is wrong
by more than every discount finding combined. It is joined from EFS by unit number, which matched
2,394 of 2,397 lines; the three that miss go to the unattributed row.

**D-FS7 — Miles are scaled to the measured MPG, and say so.** The first draft carried the gap between
`gallons_tractor` and `mpg_gallons` as a third "unmeasured gallons" bridge term. It was exact and
useless: measured coverage moved 92.2% → 97.5% between two real weeks and produced a −$13,400 bar
describing nothing but our own ability to measure. `miles` is now the measured miles scaled by the
measured share, `milesMeasured` keeps the provable figure beside it, and below `MIN_MEASURED_SHARE`
(60%) the split is withheld rather than extrapolated.

**D-FS8 — The comparison uses the last COMPLETE period.** Comparing a two-day week against a finished
one is the easiest way to publish a 60% collapse in spend that never happened.

## The bridge

```
Δspend  =  pump price  +  volume                       (exact, Laspeyres volume / Paasche price)
volume  =  distance  +  efficiency                     (exact: gal = miles ÷ MPG)
distance=  more trucks  +  each truck covering more    (exact, shift-share)
```

Every split returns its residual, computed before rounding, so a chart asserts the identity rather than
trusting it. Property-tested over 200 pseudo-random period pairs plus shapes chosen to break it
(efficiency moving against volume, a shrinking fleet, a contaminated odometer, a period with no
mileage at all).

**Verified end to end against production** (2026-08-03 → 08-23, 2,509 fills, 5,233 engine days, 3,439
derived truck-days, 15 intervals refused):

| Week of | Trucks | Gallons | Spend | $/gal | MPG | Proven | Idle | mi/truck |
|---|---|---|---|---|---|---|---|---|
| 08-03 | 165 | 53,999 | $259,298 | 4.8019 | 7.453 | 97.5% | 52.1% | 2,439 |
| 08-10 | 165 | 53,656 | $262,751 | 4.8970 | 7.518 | 91.9% | 53.1% | 2,445 |
| 08-17 | 162 | 58,190 | $303,707 | 5.2192 | 7.651 | 95.0% | 53.6% | 2,748 |

```
Δ spend  +$40,955   residual $0
  Pump price       +$18,752   +$0.3222/gal on 58,190 gal
  Miles driven     +$27,230   +41,807 mi at 7.52 MPG
  Fuel efficiency   −$5,026   +0.13 MPG — saved $5,026
  distance from:   −7,335 mi fewer trucks, +49,142 mi busier trucks
```

The fleet did not grow; each truck drove ~300 miles more, into a market $0.32/gal dearer, and improving
MPG gave $5,026 of it back.

## Two data-quality facts the report must keep gating on

- **`miles_since_last` is corrupt before ~2026-06-22.** The plausibility gate
  (`MAX_INTERVAL_MILES = 2500`) and the fleet-MPG band (3–12) exist for this; without them the June
  series shows a fake collapse.
- **`idle_rollup_days` has coverage holes** in the weeks of 07-13 and 07-20 (`idle_sec` smaller than
  its own `rest_idle_sec` component). Not yet gated — idle is reported here only as a share of engine
  time, and the avoidable-idle costing on the Idling page is a separate, already-defensible pipeline.

## What is NOT built

Items 9–39 of the analysis catalogue: state/site/brand mix, truck- and driver-level MPG ranking, idle
in dollars joined to the fuel bill, tank-capacity and GPS-mismatch integrity checks, DEF dosing ratio,
declines, and the weekly emailed digest. `fuel_transactions.station_id` is still 0% populated, so brand
and off-network questions remain unanswerable from the EFS side; the backfill is the next unblock.
