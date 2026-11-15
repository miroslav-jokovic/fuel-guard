-- 0611: the `load-photos` bucket gets the 15 MB per-file limit 0085 declared for it and production
-- never had (database audit 2026-11-15, S6).
--
-- ── THE GAP ─────────────────────────────────────────────────────────────────────────────────────
-- 0085 creates the bucket with `file_size_limit = 15 * 1024 * 1024` and `on conflict (id) do
-- nothing`. Read from production `storage.buckets` on 2026-11-15: `load-photos` is the only one of
-- 14 buckets whose `file_size_limit` is NULL — the row existed before 0085 ran, so the insert was
-- skipped and the limit never landed. It is also the one bucket a DRIVER writes to directly from
-- the app (`load_photos_driver_write`, `apps/driver/src/data/handlers.ts`), so it is the bucket
-- where "no limit" means a signed-in phone can store a file of any size.
--
-- ── WHY THIS SHAPE ──────────────────────────────────────────────────────────────────────────────
-- The figure is 0085's own, not a new decision. `where file_size_limit is null` so a database that
-- did get 0085's value, or a limit set deliberately since, is left alone. The bucket is empty on
-- production (0 objects), so no stored file is larger than the limit it gains.
-- A MIME allow-list is NOT added here: 13 of 14 buckets have none, and choosing each list means
-- reading every uploader — recorded in the audit report as remaining work, not guessed at.
--
-- ── DEPLOY WINDOW (docs/MIGRATION-DISCIPLINE.md) ─────────────────────────────────────────────────
-- One row in `storage.buckets`; no table, column or reader changes. Order-independent.

update storage.buckets
   set file_size_limit = 15 * 1024 * 1024
 where id = 'load-photos'
   and file_size_limit is null;
