-- ─────────────────────────────────────────────────────────────────────────────────────────────────
-- mcleod_billing gains the mileage the invoice was actually raised on
-- ─────────────────────────────────────────────────────────────────────────────────────────────────
-- 0257 staged `billing_loaded_distance` and `billing_empty_distance` as billing's own mileage
-- assertion. Measured against June 2026 on 2026-08-28, both are EMPTY: 0 of 1,640 posted bills
-- populate either. They join `pay_distance`, `manifest_loaded_distance` and
-- `manifest_empty_distance` on the list of McLeod distance columns this carrier never fills — the
-- trap that has now caught three separate readings, and the reason nothing here is trusted until a
-- row count is taken.
--
-- The column that IS populated is plain `distance`: 1,614 of those same 1,640 bills, 1,513,720
-- miles in June. That is the denominator two things need and neither could have:
--
--   · Revenue per mile per DISPATCHER (owner request 2026-08-28). Billing is the only money table
--     that carries both the dispatcher and the trip, so this is the one place the question can be
--     answered without inventing a join.
--   · A WEEKLY view of cost. GL totals are month-grained, so a week's overhead can only ever be
--     prorated by that week's share of the month's miles — and the miles have to come from a date
--     the load actually happened on. `mcleod_movements.settled_at` cannot supply it: it is McLeod's
--     BATCH stamp, 3,337 June movements across 164 distinct values, so bucketing by it would charge
--     a fortnight of running to whichever week the batch posted.
--
-- Kept beside the two empty columns rather than replacing them. They are what McLeod asserts, which
-- is nothing, and deleting them would erase the measurement that says so.
alter table mcleod_billing
  add column if not exists distance numeric(10,1);

-- raw-access-waiver: this migration widens the mcleod raw staging table it names — the owning
-- collector's own DDL, no cross-module read.
