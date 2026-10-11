-- 0428: an index that matches how odometer readings are paged.
--
-- `samsaraOdometerReads.fetchReadings` pages `org_id = $1 and reading_at between $2 and $3
-- order by vehicle_id, reading_at` with OFFSET. Its comment said the identity index
-- (org_id, vehicle_id, source, day) covered that order; it does not — `source` and `day` sit
-- between `vehicle_id` and `reading_at`.
--
-- ── MEASURED (production, 2026-10-05, after the 15:06–15:48 UTC outage) ─────────────────────────
-- pg_stat_statements since the 15:48 restart: this query was the top buffer consumer, 104 calls
-- reading 14,820 MB from shared buffers (~143 MB a call) on a 7 MB table, on a Micro instance with
-- 6 MB of free memory. EXPLAIN ANALYZE of one 90-day page at OFFSET 10000:
--   before: Index Scan on the identity index, 13,067 rows removed by filter, Incremental Sort,
--           10,289 buffers, 304 ms.
--   after (this index, built and rolled back in one transaction): Index Scan with the date range in
--           the Index Cond, no sort, 7,021 buffers, 10.8 ms.
--
-- ── DEPLOY WINDOW (docs/MIGRATION-DISCIPLINE.md) ─────────────────────────────────────────────────
-- Additive; no code depends on it. A plain CREATE INDEX blocks writes to this table while it builds:
-- 52,380 rows, built in well under a second in the measurement above, and the only writer is the
-- odometer sync's batched upsert, which waits and proceeds.

create index if not exists idx_samsara_odometer_readings_org_vehicle_reading_at
  on public.samsara_odometer_readings (org_id, vehicle_id, reading_at);
