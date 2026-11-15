-- 0612: five reads the API repeats all day get an index that matches them, and five indexes that
-- serve nothing are dropped (database audit 2026-11-15, P7 + P8).
--
-- ── THE GAP ─────────────────────────────────────────────────────────────────────────────────────
-- pg_stat_statements on production, 41 days since the 2026-10-05 restart. Each of these scans far
-- more of its table than it returns, on every call:
--   A  fuel_transactions — newest `samsara_recon_checked_at` for an org (`samsaraFeedHealth.ts`,
--      `scoringHealth.ts`): 59,559 calls. Reads all 19,489 entries of
--      idx_ftxn_recon_status_checked and sorts them to return one row.
--   B  fuel_transactions by `import_id` (`cascadeScope.ts`, `backfill.ts`, `efsSync.ts`,
--      `efsProcessing.ts`): ~25,000 calls, each a sequential scan of the table.
--   C  fuel_prices by org + product + `observed_at >=` (the planner's price read): 23,320 calls.
--      idx_fuel_prices_lookup has `station_id` between org and product, so the whole org is walked.
--   D  efs_transactions by `import_id`: 6,832 calls, sequential scan.
--   E  efs_processing_runs `status = 'running' and updated_at < …` (the stranded-run check in
--      `efsProcessingScheduler.ts`): 117,998 calls, sequential scan of 16,403 rows to find none.
--
-- ── MEASURED (production, 2026-11-15; each index built and rolled back in one transaction) ──────
--        buffers before → after     time before → after
--   A        7,173 → 4                18.8 ms → 0.12 ms
--   B        4,034 → 3                17.5 ms → 0.05 ms
--   C        1,201 → 14                7.1 ms → 0.30 ms
--   D        1,746 → 3                 7.6 ms → 0.08 ms
--   E          339 → 1                 3.9 ms → 0.05 ms
-- E was measured as a partial index; it ships as a plain (status, updated_at) index instead.
-- PostgREST sends `status` as a bind parameter, and a partial index is only usable while the
-- planner keeps a custom plan for the statement — a plain index on 16,403 rows costs nothing and
-- does not depend on that.
-- Write cost: `import_id` is never updated; `samsara_recon_checked_at` is already a key of
-- idx_ftxn_recon_status_checked, so its updates were not HOT before this either.
--
-- ── THE DROPS ───────────────────────────────────────────────────────────────────────────────────
-- Read from `pg_stat_user_indexes` (scan count and `last_idx_scan`) and `pg_index`:
--   · idx_hos_seg_org_time_linked — 229 MB, the largest index on the database's third-largest
--     table. 31 scans in 41 days, the last on 2026-10-09: no statement the API runs today plans
--     through it. 0113 built it for a duty-split page ordered on (started_at, id); whatever issues
--     that page today, the planner has not chosen this index for it in five weeks.
--   · idx_imports_file_hash, idx_efs_processing_import, idx_drivers_samsara_id,
--     idx_drivers_efs_driver_id — each has the SAME key columns and predicate as a unique index on
--     the same table (uq_imports_org_file_hash, efs_processing_runs_org_id_import_id_key,
--     uq_drivers_org_samsara, uq_drivers_org_efs). The unique twin answers every lookup and every
--     ON CONFLICT (which infers its arbiter from columns, not an index name); the copy is only
--     maintained on write.
-- NOT dropped, and why: idx_scoring_attempts_transaction_started (130 MB, 4 scans) is the only
-- index behind `scoring_attempts_transaction_id_fkey ON DELETE CASCADE` — without it, deleting one
-- fuel transaction scans 679 MB — and 0356 reserves it for the verdict walk.
-- idx_idle_park_sessions_veh differs from the unique key by sort direction and is in live plans.
--
-- ── DEPLOY WINDOW (docs/MIGRATION-DISCIPLINE.md) ─────────────────────────────────────────────────
-- No column and no reader changes; code either side of this migration issues the same statements.
-- Each plain CREATE INDEX blocks writes to its table while it builds: the largest heap is
-- fuel_transactions at 32 MB. DROP INDEX takes a brief exclusive lock on its table.

create index if not exists idx_ftxn_org_recon_checked
  on public.fuel_transactions (org_id, samsara_recon_checked_at desc)
  where samsara_recon_checked_at is not null;

create index if not exists idx_ftxn_import
  on public.fuel_transactions (import_id)
  where import_id is not null;

create index if not exists idx_fuel_prices_org_product_observed
  on public.fuel_prices (org_id, product, observed_at);

create index if not exists idx_efs_transactions_import
  on public.efs_transactions (import_id)
  where import_id is not null;

create index if not exists idx_efs_processing_status_updated
  on public.efs_processing_runs (status, updated_at);

drop index if exists public.idx_hos_seg_org_time_linked;
drop index if exists public.idx_imports_file_hash;
drop index if exists public.idx_efs_processing_import;
drop index if exists public.idx_drivers_samsara_id;
drop index if exists public.idx_drivers_efs_driver_id;
