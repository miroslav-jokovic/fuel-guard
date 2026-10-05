-- 0429: "when did this kind last succeed" reads one index entry instead of every finished job.
--
-- `financialFreshness.lastPollSuccesses` and `jobs.lastDoneJob` ask
-- `org_id = $1 and kind = $2 and status = 'done' order by finished_at desc limit 1`.
-- The only matching index is (org_id, kind, created_at desc), so Postgres reads every row of the
-- kind, filters on status, and sorts by finished_at. For `efs_soap_posted` that is ~103,000 rows.
--
-- ── MEASURED (production, 2026-10-05, right after the Micro → Small upgrade) ─────────────────────
-- Supabase warned the project was about to exhaust its Disk IO budget. pg_stat_statements since the
-- 16:35 restart: this read was the top disk reader, 254 MB read in 2 calls. EXPLAIN ANALYZE for
-- efs_soap_posted:
--   before: Sort over the created_at index, 16,632 buffers (~130 MB), 134 ms.
--   after (this index, built and rolled back in one transaction): Index Only Scan, 5 buffers, 0.07 ms.
--
-- ── DEPLOY WINDOW (docs/MIGRATION-DISCIPLINE.md) ─────────────────────────────────────────────────
-- Additive; no code depends on it. Partial on status = 'done', so queued/running/failed rows never
-- enter it. A plain CREATE INDEX blocks writes to `jobs` while it builds; the build in the
-- measurement was sub-second, and job writers retry on their next tick.

create index if not exists idx_jobs_org_kind_done_finished
  on public.jobs (org_id, kind, finished_at desc)
  where status = 'done';
