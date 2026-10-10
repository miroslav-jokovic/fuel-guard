-- 0452 — saved views on the Dispatch board: widen saved_views.table_id's closed vocabulary.
--
-- DISPATCH-BOARD-PLAN.md §5 (saved views and the column picker, "still owed" after DB5b). 0278 closed
-- `table_id` to the one table that had views, 'roster.drivers', so that a crafted request cannot
-- fill the table with rows no surface lists. The board is the second such surface; it is spelled
-- 'dispatch.board', the same string `SAVED_VIEW_TABLES` in packages/shared/src/savedViewContract.ts
-- gains in the NEXT merge.
--
-- ── WHY THIS SHIPS ALONE ────────────────────────────────────────────────────────────────────────
-- The vocabulary is a closed list on both sides, and the database is the side that refuses. If the
-- contract gained 'dispatch.board' in the same merge, staging could serve the code before
-- migrate-staging widened the check, and the board's first Save would answer a check violation
-- (docs/MIGRATION-DISCIPLINE.md §the-deploy-window). Widening first is harmless: nothing writes the
-- new value until the contract admits it.
--
-- The check is replaced, not edited: 0278 is applied. Every existing row is 'roster.drivers', which
-- the new check admits, so the validation scan cannot fail.
--
-- Rollback: delete from saved_views where table_id = 'dispatch.board'; then restore 0278's check.

alter table saved_views drop constraint if exists saved_views_table_id_check;
alter table saved_views
  add constraint saved_views_table_id_check check (table_id in ('roster.drivers', 'dispatch.board'));
