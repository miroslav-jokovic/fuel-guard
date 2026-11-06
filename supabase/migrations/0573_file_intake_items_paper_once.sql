-- 0573 — one review row per paper of a read piece, however many times it is asked for
-- (DRIVER-PAPER-INTAKE-PLAN PI3).
--
-- Paper intake turns a finished read into `file_intake_items` rows when the review page asks for its
-- batch, which it does every few seconds while pieces are still being read — from every tab that has
-- it open. Two asks at the same moment would each see "no rows yet" and insert the piece twice, and
-- the reviewer would be asked to file every paper of it twice. A read's papers are found by their
-- source and their first page; within one source no two rows start on the same page (paper intake
-- assigns each page to exactly one row), so that pair is the paper's identity. The second insert
-- meets this index, and the service treats its 23505 as "already done".
--
-- An index on a table no released code reads or writes (0505 shipped schema-only; nothing filed from
-- it yet — measured 2026-11-06: 0 rows on production), so it cannot fail to build and the deploy
-- window (MIGRATION-DISCIPLINE §the-deploy-window) has no old reader to break.
create unique index if not exists file_intake_items_paper_once_idx
  on public.file_intake_items (org_id, source_id, page_from)
  where page_from is not null;
