# FuelGuard Data Reliability — Analysis & Findings

**Date:** 2026-07-02 · **Scope:** EFS import, Dashboard fuel spend graph, location mismatch alerts, odometer mismatches. Analysis only — no code changed.

---

## Executive summary

The three symptoms you're seeing share a small set of root causes:

1. **Timestamps are the core weakness.** EFS times are stored as if they were UTC (they're local site time), date-only rows are anchored at "noon UTC", and Samsara reconciliation silently **rewrites `fueled_at`** to a GPS-matched stop time. The dashboard then buckets by UTC calendar day. Together these move spend onto the wrong dates — the graph is mostly displaying what's in the DB, not a rendering bug (though the chart has one real display flaw too).
2. **The Samsara history fetch is not paginated.** One API call is made for a 36–60 hour window; if Samsara returns more than one page of GPS points, the day's samples are silently truncated. This single bug plausibly explains most false location-mismatch alerts *and* many bogus Samsara odometers (which then feed odometer-mismatch alerts and wrong `fueled_at` rewrites).
3. **Import dedupe/merge keys can eat rows.** Fuel events are keyed by `card|invoice`; if EFS reuses invoice numbers (per-site sequential numbering is common), rows from different days get merged into one event (gallons summed onto the first day) or dropped as "duplicates" of an earlier import → missing days + inflated spend on other days.

---

## 1. EFS report upload — missing days / wrong data

**Where:** `packages/shared/src/efsImport.ts`, `apps/web/src/features/import/*`

### 1a. `card|invoice` merge key can collapse different transactions (HIGH)
`normalizeTransactionRows` merges lines into one fueling event per `card|invoice`. That's correct for multi-line invoices, but:

- If a merchant **reuses invoice numbers across days**, two different fill-ups on different days merge into ONE event — gallons and cost summed, dated by whichever row came first. Day B disappears; Day A's spend inflates. This exactly matches "not all days loaded + some dates show wrong spend."
- Across imports, the same `card|invoice` seen in an older file marks the new row as a **duplicate** and silently drops it (`existingRefs` + `ignoreDuplicates: true`).
- The merge key ignores date entirely. Adding `tran_date` to the key would fix both without breaking legitimate multi-line merges.

### 1b. Silent drops with no visibility (MEDIUM)
Several paths quarantine or drop rows with little/no surfacing: unparseable dates → `skipped`; non-fuel items → `skipped` (fine, but the skip report isn't persisted); upsert `ignoreDuplicates` losses aren't counted after commit. There's no per-day row-count reconciliation ("file said N rows across D days; DB got M"). That's why bad loads are only discovered later on the dashboard.

### 1c. CSV/XLSX header detection is fragile (MEDIUM)
- CSV header hunting splits lines on raw commas (quoted headers with commas break column counts) and only scans the first 8 lines.
- XLSX picks the **first sheet** with a recognizable header — a summary sheet could win over the data sheet.
- XLSX header row uses `includeEmpty: false`, so an empty header cell mid-row shifts all subsequent columns one left → values land under the wrong headers (odometer under city, etc.). This is a plausible source of "data is not correct" for specific files.

### 1d. Reject report fallback timestamp is fabricated (LOW)
`normalizeRejectRows` falls back to `new Date().toISOString()` (import time) when the date can't be parsed — declined attempts get today's date instead of being quarantined.

---

## 2. Dashboard "Fuel spend" graph

**Where:** `packages/shared/src/dashboard.ts`, `apps/api/src/services/scoring.ts` (line ~349), `DashboardPage.vue`

### 2a. `fueled_at` is silently rewritten after scoring (HIGH)
For date-only EFS rows, Samsara reconciliation **overwrites `fueled_at`** with the matched GPS stop time (`scoring.ts`: `...(reconAt ? { fueled_at: txn.fueledAt } : {})`). Consequences:

- A fill at 7 pm Central becomes `01:00 UTC next day`. The dashboard buckets by `iso.slice(0,10)` (UTC day) → **spend moves to the wrong date**.
- The date-only recon window is ±30 h, and the anchor stop is chosen by city/state text matching — the matched stop can be on the **wrong calendar day entirely** (or the wrong visit) — worse when the sample set is truncated (see §3a).
- Rows that were recon-matched shift; rows that weren't stay on the EFS date → the graph looks right for some dates and wrong for others, which is exactly your symptom.

### 2b. Missing days aren't zero-filled (MEDIUM)
`spendTrend` only emits days that have transactions, and the chart uses those dates as category labels. A day with no data simply vanishes — June 3 sits next to June 7 with no gap. Combined with 1a (dropped days), this reads as "data for some dates is not correct." Zero-filling the range would make gaps honest and instantly visible.

### 2c. UTC day bucketing (MEDIUM)
Even without the rewrite, bucketing by UTC day misdates any transaction with a real evening timestamp for a US fleet. Bucketing should be in the org's timezone (`organizations.operating_hours.tz` already exists).

---

## 3. Location mismatch alerts (mostly false)

**Where:** `apps/api/src/lib/samsara.ts`, `packages/shared/src/samsara.ts`, `samsaraRecon.ts`, `geocode.ts`

### 3a. Stats-history fetch never paginates (CRITICAL — likely the main culprit)
`makeSamsaraFetcher` makes **one** call to `/fleet/vehicles/stats/history` for a 36 h (precise) or 60 h (date-only) window and never follows `pagination.endCursor` — unlike `listAllPages`, which every other Samsara call correctly uses. A truck pinging GPS every few seconds easily exceeds one page over 1.5–2.5 days, so samples cover only the **start** of the window.

The mismatch logic then asks "was the truck EVER in the EFS state that day?" over a truncated sample set. If the actual station visit fell in the truncated part, but earlier samples had resolvable addresses, `basis = "not_in_state"` → **false location_mismatch alert** with high confidence language ("the card was used where the truck was not"). The same truncation feeds wrong anchor stops → wrong Samsara odometer → false odometer mismatches → wrong `fueled_at` rewrites (§2a).

### 3b. Time-of-day assumptions (HIGH)
EFS POS times are local site time but stored as UTC (`efsDateTimeToIso` appends `Z`). The recon partially compensates (`approxFuelingUtcMs` adds a per-state standard-time offset; wide window), but:

- `preciseTime` rows keep the naive-UTC `fueled_at` in the DB. Time-based rules then run on it: `off_hours_fueling` and `rapid_repeat_fueling` evaluate a 7 am local fill as 1–2 am org time → false behavioral signals that corroborate cases.
- A real fill at exactly 12:00:00 UTC is misclassified as "date-only" by `isNoonSentinel` (edge case).

### 3c. Data & matching fragility (MEDIUM)
- EFS city/state can be the merchant's billing location, not the physical station — the state check inherits that.
- City comparison is exact-normalized equality; EFS truncations/abbreviations ("FT WORTH", "OKLAHOMA CIT") fail, dropping the anchor to "nearest in-state stop," which degrades the odometer read.
- Geocoding (Nominatim, `limit=1`, free-text) can pin the wrong POI; `POI_CLASSES` includes `highway`, so a road segment can count as "site" precision. Wrong geocodes never create a mismatch (proximity only confirms) but they waste the strongest confirm signal. `countrycodes=us` means Canadian stations never geocode. Failed lookups are cached `resolved=false` forever and never retried.
- Wrong `samsara_vehicle_id` mapping or a driver typing the wrong unit number makes a truthful "truck wasn't there" alert that is operationally a false positive. Worth auditing the vehicle↔Samsara mapping table before trusting any location alert.

The design itself is sound (state-level presence + proximity confirm, date-only rows never flag). Fix 3a and 3b and the false-positive rate should drop sharply.

---

## 4. Odometer mismatches

**Where:** `anomalyRules.ts`, `odometer.ts`, `samsara.ts`, `reports.ts`

### 4a. The accuracy report ignores the learned offset (HIGH)
The `odometer_mismatch` rule correctly applies the per-vehicle learned offset (dash − Samsara OBD) before the ±5 mi check. But the **odometer-accuracy report** (`odometerAccuracy` in `odometer.ts`, used by `/reports/odometer-accuracy*`) compares raw `|entered − samsara|` with no offset. Any truck with a replaced cluster or OBD calibration gap shows every fill as a "mismatch" in the report even though the anomaly engine considers it fine. This is very likely why the report's mismatches look untrustworthy.

### 4b. The Samsara reference odometer is only as good as the anchor stop (HIGH)
`crossSourceOdometer` comes from interpolating the day's odometer track at the chosen anchor stop. With truncated samples (§3a), city-name matching failures (§3c), or multiple same-state stops disambiguated by a guessed time (§3b), the anchor can be a stop hours away → reference odometer off by tens/hundreds of miles → false `odometer_mismatch` despite a correct driver entry.

### 4c. ±5 miles default tolerance is tight (MEDIUM)
Against a GPS-interpolated reference with 0.1 mi rounding, anchor-time uncertainty of ±1 h (DST ignored) and drivers entering odometers a few minutes before/after the pump, 5 mi will flag honest entries. Consider 10–15 mi once 4a/4b are fixed, then tighten with data.

### 4d. Offset learner interactions (LOW)
`learnOdometerOffset` is robust (median, cluster requirement), but it learns from `samsara_odometer` values that may themselves be corrupted by 4b — bad anchors can poison the offset, which then mis-tunes the rule. Fix the anchor quality first, then re-learn offsets (a rebuild recomputes them).

### 4e. Chain effects on MPG rules (MEDIUM)
`previousTxn`/`computed_mpg`/`miles_since_last` use `fueled_at` ordering — which recon rewrites — and driver-entered odometers. Wrong dates or merged transactions (§1a) reorder the chain and produce wrong MPG, feeding `mpg_deviation` noise into case scoring.

---

## Priority fix list (when you're ready)

| # | Fix | Addresses |
|---|-----|-----------|
| 1 | Paginate `/fleet/vehicles/stats/history` (follow `endCursor`, like `listAllPages`) | False location alerts, bad Samsara odometers, bad time recovery |
| 2 | Stop rewriting `fueled_at`; store recovered time in a separate column (`matched_at` exists as `samsara_recon_at`) and keep the EFS business date for reporting | Dashboard wrong dates, MPG chain ordering |
| 3 | Add `tran_date` to the fuel-event merge/dedupe key | Missing days, inflated days |
| 4 | Bucket dashboard trends in org timezone + zero-fill missing days | Graph correctness & honesty |
| 5 | Apply the learned odometer offset in the accuracy report (or show raw + adjusted) | Untrustworthy odometer report |
| 6 | Store EFS local time with the station's timezone instead of fake-UTC (derive tz from state, as recon already does) | Off-hours/rapid-repeat false signals |
| 7 | Persist an import reconciliation summary (rows per day: file vs DB, skipped, deduped) and surface it on the Import page | Silent data loss detection |
| 8 | Loosen odometer tolerance (10–15 mi), re-learn offsets after 1–2 land | Odometer false positives |
| 9 | Harden file parsing: quoted-CSV header scan, `includeEmpty: true` for XLSX headers, sheet selection by best (not first) match | Per-file corruption |
| 10 | Geocode hygiene: retry failed cache entries with TTL, drop `highway` from site-precision classes, add `countrycodes=us,ca` | Better GPS confirms (fewer "unknown"s) |

**Suggested order:** 1 → 2 → 3 are the big three; then 4–5 make what users see truthful; 6–10 are quality hardening. After 1–3, run a full rebuild (`backfillOrg` without `skipRecon`, rate-limited) so historical rows get clean Samsara data — the current stored values were produced by the truncated fetches.

---

## What is working well

The core architecture is solid: pure/testable parsing and rules, faithful EFS store separate from derived events, idempotent upserts, ambiguous-key matching that refuses to guess, the multi-axis case correlation that keeps lone weak signals from spamming alerts, and date-only rows never raising location flags. The problems are concentrated in timestamp handling, one missing pagination loop, and dedupe keys — all fixable without redesign.
