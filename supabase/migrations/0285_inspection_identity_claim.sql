-- Remember what a report's equipment row was OWNED BY before finalize claimed it (D-AVI9).
--
-- ── WHY A COLUMN AND NOT A CONSTANT ─────────────────────────────────────────────────────────────
-- Finalizing a §396.17 report projects the next due date onto the truck AND sets
-- `vehicles.identity_source` / `trailers.identity_source` to 'manual'. That claim is deliberate: the
-- McLeod sweep's CLAIMABLE set is {'samsara','mcleod'}, so 'manual' is how an office-entered expiry
-- survives the next roster ingest (D-ARC3, `roster/equipmentInspection.ts`).
--
-- Deleting that report has to give the claim back — otherwise the vehicle is stranded as 'manual'
-- forever and the sweep silently stops maintaining its identity at all, not just its inspection
-- date. Measured on production 2026-09-01 while cleaning up one test report: 197 vehicles were
-- 'samsara' and exactly ONE was 'manual' — the truck that had been inspected.
--
-- The value to restore is not derivable after the fact. `identity_source` is `not null default
-- 'samsara'`, but a column default is what a NEW row gets, not what THIS row held; a fleet ingested
-- from McLeod would have been 'mcleod'. Writing 'samsara' back would be restating a fact about one
-- fleet's plumbing in code that cannot see it — a copy with a delay fuse. So the report records what
-- it displaced, and the delete puts that back.
--
-- ── NULL IS A REAL STATE, NOT A GAP ─────────────────────────────────────────────────────────────
-- Null means "this report never claimed anything": every report finalized before this column existed,
-- plus any draft. A delete must then leave `identity_source` alone rather than guess at it — the
-- honest behaviour for a claim we did not record.
--
-- ── SHIPPED ALONE, ON PURPOSE ───────────────────────────────────────────────────────────────────
-- No code reads or writes this column yet. Railway serves a merge about three minutes in and
-- migrate.yml applies the schema about twelve, so a column and its first reader in one merge means
-- ~9 minutes of the API asking PostgREST for something the database has not got — which took the
-- inspections page down on 2026-09-01 (#430) and is what `lint:migration-ordering` now refuses.
-- The writer (finalize) and the reader (the delete path) follow in the next merge.

alter table public.vehicle_inspections
  add column if not exists equipment_identity_source_before text;

comment on column public.vehicle_inspections.equipment_identity_source_before is
  'The equipment row''s identity_source at the moment this report was finalized, before finalize set
   it to ''manual'' to protect the projected expiry (D-AVI9/D-ARC3). Restored if the report is ever
   deleted. NULL = this report never made the claim (a draft, or a report filed before 0285).';
