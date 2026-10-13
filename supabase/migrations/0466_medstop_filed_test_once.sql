-- 0466 — a Med-Stop test is filed into the qualification file at most once (MEDSTOP-PLAN.md §6 F-4).
--
-- ── WHY ─────────────────────────────────────────────────────────────────────────────────────────
-- MS2b files a verified NEGATIVE pre-employment drug test as a `drug_test` qualification record by
-- itself, from the hourly Med-Stop sweep, with Med-Stop's test id as `reference` and
-- `detail.source = 'medstop'`. A §391.51 review COUNTS records, and the sweep is the kind of writer
-- that runs again: a retried job, a sweep that filed and then failed to mark the test handled, a
-- second process during a deploy. The code checks before it inserts; this index is the half that
-- cannot forget — the A-10 pattern (0376: one record per invitation, a duplicate answers 23505,
-- which `insertQualificationRecord` reports as "duplicate", i.e. already on file).
--
-- Partial, so it constrains only what the sweep files: an office user may still file a drug test
-- by hand with any reference they like, and that row is evidence this index has no opinion about.
--
-- ── WHY ITS OWN FILE ────────────────────────────────────────────────────────────────────────────
-- `qualification_records` is the evidence module's table; 0464 is the medstop module's. One
-- migration, one module's tables (`lint:table-writers`).
create unique index if not exists uq_qualification_records_medstop_test
  on public.qualification_records (org_id, reference)
  where kind in ('drug_test', 'alcohol_test') and (detail ->> 'source') = 'medstop';
