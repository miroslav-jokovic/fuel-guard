-- 0658: every McLeod reference number on a stop, in the raw mirror (spec B §3.2 M-A, D-MKN4.3,
-- docs/plans/mcleod/v2/T1-driver-and-data.md N-2). 0659 is the same fact on `load_stops`, plus the
-- load's BOL number and its unmatched equipment codes.
--
-- ── THE GAP THIS CLOSES ──────────────────────────────────────────────────────────────────────────
-- The connector does not read McLeod's `reference_number` table at all: no statement in
-- `tools/mcleod-agent/queries.mjs` selects it, although the read-only login has held SELECT on it
-- since 2026-09-28 (spec B §0). Measured that day (LOADS-MIRROR-PLAN Q-LMR5): references hang off
-- STOPS only, `element_id` 128 on all 34,592 rows, joined on `stop_id` + `company_id`; the open board
-- carries ZZ, PO, P8, SI, CR, PU and more, and a P8 or PU on the pickup stop of 50 of 143 open
-- movements. That is the pickup number dispatchers type by hand today, and the number a shipper asks
-- a driver for at the dock.
--
-- ── WHAT THE COLUMN HOLDS ────────────────────────────────────────────────────────────────────────
-- McLeod's rows verbatim, as a jsonb array of {"qualifier","value"} (D-LMR3: raw keeps what McLeod
-- said; D-MKN4.3: every reference is kept, so the PU # rule of D-MKN4.4 is re-projectable from here).
-- Null = "McLeod not asked yet" (every stop before the feature); `[]` = "asked, none". The CHECK
-- refuses anything that is not an array, so a reader never has to guess the shape.
-- `reference_numbers`, not `references`: REFERENCES is a reserved word in Postgres.
--
-- ── SCHEMA ONLY, AND IN ITS OWN MERGE ────────────────────────────────────────────────────────────
-- A new column on a table written today, and a merge can be served before `migrate.yml` applies
-- its schema (docs/MIGRATION-DISCIPLINE.md §the-deploy-window). So nothing names it in this merge
-- (`lint:migration-ordering`): the agent's statement, the ingest and the projection follow (spec B
-- B4). Nullable with no default — the 0366 rule: missing is null, never a value nobody stated.
--
-- raw-access-waiver: mcleod collector's own DDL on its own raw table — no cross-module read.

alter table mcleod_dispatch_stops
  add column if not exists reference_numbers jsonb
    constraint mcleod_dispatch_stops_reference_numbers_array
    check (reference_numbers is null or jsonb_typeof(reference_numbers) = 'array');
comment on column mcleod_dispatch_stops.reference_numbers is
  'dbo.reference_number rows on this stop, verbatim: [{"qualifier","value"}]. Null = not read yet.';
