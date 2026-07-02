# Data Reliability Fixes — Implemented

**Date:** 2026-07-02 · Companion to `DATA-RELIABILITY-FINDINGS.md`. All 10 report items implemented. Nothing committed — review and commit when ready.

**Verification:** shared 214/214, api 24/24 (incl. new pagination regression tests), web 9/9 · `tsc`/`vue-tsc` clean on all three packages · eslint clean on every touched file.

---

## What changed

### 1. Samsara stats-history is now paginated — `apps/api/src/lib/samsara.ts`
Follows `pagination.endCursor` and merges every page's `gps` + `fuelPercents` arrays (cap: 40 pages ≈ a full day at 5s pings). This was the root cause of most false location-mismatch alerts and bad reference odometers. Regression-tested in `apps/api/src/lib/samsara.test.ts`.

### 2. `fueled_at` is never rewritten anymore — `apps/api/src/services/scoring.ts`
The telematics-recovered instant lives only in `samsara_recon_at` and is applied **in memory** for time-based rules. Stored `fueled_at` stays the EFS business time, so dashboard dates, dedupe keys, and the MPG chain are stable. Rolling windows anchor on stored time; the denormalized `anomalies.fueled_at` now matches the fuel log.

### 3. EFS times are true UTC — `packages/shared/src/efsImport.ts`
New `efsInstant()` converts the station's wall-clock POS time to UTC via a state→IANA timezone map (DST-correct via `Intl`, incl. Arizona/Newfoundland/Saskatchewan). Date-only rows keep the noon-UTC sentinel and are marked `precision: "date"` — a time is never fabricated. Unknown state → deterministic naive-UTC fallback. **Known limitation (documented in code):** split-timezone states use their dominant zone — worst case ±1h, absorbed by the wide recon windows.

### 4. Explicit `fueled_at_precision` column
Written at import, backfilled by migration; the scorer reads the column instead of guessing from a noon-sentinel heuristic. Rules hardened alongside: `rapid_repeat_fueling` and `odometer_implausible_jump` now require **both** endpoints to be real instants (a sentinel endpoint falls back to the miles/day cap).

### 5. Date-scoped dedupe keys
- fuel events: `card|invoice|business-date` (blank-invoice fallbacks also date-scoped)
- faithful EFS lines: `…|amt|tran_date`
- declines: `card|invoice|code|date`

A reused invoice number can no longer merge two days into one event (gallons inflation) or drop a later day as a "duplicate". `tran_date` is the printed station-local date, so an evening fill crossing the UTC boundary still dedupes on the right day (tested).

### 6. Dashboard: org-timezone bucketing + zero-fill — `packages/shared/src/dashboard.ts`
`aggregateDashboard(..., { tz })` buckets trend days in the org's timezone (`operating_hours.tz`, wired in `useDashboard` and `summary.pdf`). Spend zero-fills missing days ($0 is a real value); MPG uses `null` gaps (`spanGaps: false` in the chart). Missing data is now *visible* instead of silently absent.

### 7. Reject rows never get a fabricated timestamp
`normalizeRejectRows` returns `{ declined, skipped }`; unparseable dates are quarantined (previously stamped with import-time "now"). Declined scoring also detects noon-sentinel declines instead of assuming every decline is precise.

### 8. Odometer accuracy report matches the anomaly rule — `packages/shared/src/odometer.ts`
Applies the learned per-vehicle offset (`vehicles.odometer_offset`) before measuring deviation; default tolerance 5 → 10 mi everywhere (rule, report, thresholds default + migration for rows still at the old default). CSV header now says "Off > 10 mi (offset-adjusted)".

### 9. Import reconciliation summary — `useImport.ts` + `imports.summary`
Every commit now verifies itself: per-day row counts from the file, expected-new vs actually-inserted counts (EFS lines, fuel events, declines) queried back from the DB, with explicit `shortfall_*` fields. Silent data loss becomes a number you can alert on.

### 10. File parsing hardening — `readFile.ts`
CSV parsed fully via PapaParse before header detection (quoted commas/newlines safe); XLSX headers read positionally (`includeEmpty`) so an empty header cell no longer shifts every following column under the wrong header; sheet selection now picks the *best* sheet (recognized EFS header > most rows) instead of the first non-empty one.

### 11. Geocode hygiene — `geocode.ts`
`highway` removed from site-precision classes (road centroids no longer masquerade as exact station coords); `countrycodes=us,ca` (Canadian stations were unresolvable); unresolved cache entries retry after 30 days instead of failing forever.

### 12. Migration — `supabase/migrations/0026_data_reliability.sql`
Ordering is load-bearing (restore → refs → tz-shift):
1. `efs_state_tz()` SQL helper (mirrors the TS map).
2. Adds `fueled_at_precision`, **restores** business time on rows the old scorer overwrote (join back to `efs_transactions` via ref prefix), then backfills precision.
3. Appends the business date to all existing `external_ref`s (idempotent regex guard; uniqueness preserved).
4. Converts historical naive-"UTC" wall times to true UTC via `AT TIME ZONE` (DST-correct per date); guarded to skip manual rows, sentinel rows, and rows still equal to `samsara_recon_at` (already true UTC).
5. Threshold default 5 → 10 mi; `imports.summary jsonb`; `geocode_cache.updated_at`.

---

## Deployment order (important)

1. Apply migration `0026` **before** deploying the new code (new imports write date-scoped refs + precision; old data must be rewritten first so dedupe stays consistent).
2. Deploy api + web.
3. Run **POST `/api/transactions/backfill`** (the existing live-recon endpoint, admin/fleet_manager) once per org. Historical `samsara_*` values were produced by truncated single-page fetches — they must be re-reconciled with the paginated fetcher before you trust historical alerts. It runs in the background and is geocode-rate-limited; a large org takes a few minutes.
4. Note: `REBUILD_ON_BOOT` re-scores with *stored* Samsara values (skipRecon) — it is not a substitute for step 3.

## Known residual limitations (deliberate, documented)

- Split-timezone states use the dominant zone (±1h worst case; recon windows absorb it).
- Rare blank-invoice + blank-TransactionId rows use a time-based fallback key; pre-migration rows of that shape could re-import once as duplicates (fallback keys embed the old naive time). No such rows exist unless EFS omitted both fields.
- EFS city/state can be a merchant's billing location; the state-presence check inherits that (mitigated by GPS proximity confirm).
- `supabase/_deploy/*.sql` are stale convenience snapshots (0001→0016) and were not regenerated; `supabase/migrations/` remains the source of truth.
