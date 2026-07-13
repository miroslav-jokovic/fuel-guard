-- ─────────────────────────────────────────────────────────────────────────────────────────────────────
-- MANUAL DEPLOY — faithful station-local transaction time (Transactions page time fix)
-- Copy-paste into the Supabase SQL editor and run. Idempotent.
--
-- After running: RE-IMPORT your EFS Transaction reports so tran_time is populated. Existing rows fall back to
-- the station-local time derived from fueled_at until re-imported.
-- ─────────────────────────────────────────────────────────────────────────────────────────────────────
alter table efs_transactions add column if not exists tran_time text;

-- Verify:
-- select unit, tran_date, tran_time, fueled_at, state from efs_transactions order by fueled_at desc limit 20;
