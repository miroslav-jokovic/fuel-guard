-- Scope the §396.17 claim to the ONE column it protects, instead of freezing the whole row.
--
-- ── WHAT THE CLAIM COSTS TODAY, MEASURED ────────────────────────────────────────────────────────
-- Finalizing an inspection projects the next due date onto the equipment and sets
-- `identity_source = 'manual'` so the McLeod sweep leaves that date alone. The threat is real —
-- `mcleod/rosterFields.ts` writes `dot_annual_inspection_expires_at` from McLeod's own inspection
-- date — but the defence is far too wide: `rosterIngest` responds to a non-CLAIMABLE row by skipping
-- the ENTIRE patch (`skippedOwned`), identity and link refresh included.
--
-- So one certified inspection stops McLeod maintaining that vehicle's VIN, plate, make, model, year
-- and registration. That is not a theory. On 2026-09-01 the first real identity sweep linked 200 of
-- 211 trailers and filled 200 trailer VINs where the roster had held zero — and reported
-- `office-owned=1`. The one it refused was trailer R535971, the only trailer with a certified
-- inspection, which therefore ended the sweep still carrying `vin = null`. Its own inspection locked
-- it out of its own VIN, and its filed report prints the VIN box ticked over an empty cell.
--
-- At 409 units the arithmetic is the whole fleet: every unit inspected goes dark to McLeod.
--
-- ── WHY A COLUMN AND NOT A CLEVERER READ ───────────────────────────────────────────────────────
-- The alternative was to have the sweep ask `maintenance` which subjects hold a live inspection.
-- That works, but it makes `mcleod` depend on `maintenance` for a fact about a `roster` row, and it
-- re-derives on every sweep something the projection already knows at the moment it writes. The
-- column sits on the row it describes, in the module that owns it, and is written by the same
-- function that writes the date it guards — one act, one place.
--
-- `identity_source` keeps its own job: who owns the row's IDENTITY. An office that genuinely wants
-- to own a vehicle outright still sets it, and the sweep still stands off. What stops happening is
-- an INSPECTION quietly claiming identity as a side effect of protecting a date.
--
-- ── 0285 BECOMES VESTIGIAL, AND IS LEFT ALONE ──────────────────────────────────────────────────
-- `vehicle_inspections.equipment_identity_source_before` exists to restore the identity claim when a
-- report is deleted. Once finalize stops making that claim there is nothing to restore, so the
-- column stops being written. It is NOT dropped here: reports filed between 0285 and this migration
-- carry real values, and the delete path still reads them for those rows. A column that has stopped
-- being written is cheap; a column dropped out from under filed evidence is not.
--
-- ── SHIPPED ALONE, ON PURPOSE ───────────────────────────────────────────────────────────────────
-- No code reads or writes this column yet. Railway serves a merge about three minutes in and
-- migrate.yml applies the schema about twelve, so a column and its first reader in one merge means
-- ~9 minutes of the API asking PostgREST for something the database has not got — which took the
-- inspections page down on 2026-09-01 (#430) and is what `lint:migration-ordering` now refuses.

alter table public.vehicles
  add column if not exists dot_annual_inspection_source text;

alter table public.trailers
  add column if not exists dot_annual_inspection_source text;

comment on column public.vehicles.dot_annual_inspection_source is
  'Who owns dot_annual_inspection_expires_at on this row. ''inspection'' = a certified §396.17 report
   set it and the TMS sweep must not overwrite THAT COLUMN — it may still write identity. NULL = the
   sweep owns it, which is the default and what every row carries until an inspection is certified.';

comment on column public.trailers.dot_annual_inspection_source is
  'Who owns dot_annual_inspection_expires_at on this row. ''inspection'' = a certified §396.17 report
   set it and the TMS sweep must not overwrite THAT COLUMN — it may still write identity. NULL = the
   sweep owns it, which is the default and what every row carries until an inspection is certified.';
