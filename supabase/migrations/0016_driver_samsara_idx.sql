-- FuelGuard — 0016 Unique index on drivers.samsara_driver_id
-- The column was added in 0015 as plain text with no constraint. Without a unique index the sync
-- service's in-memory dedup (Map keyed by samsara_driver_id) has no DB-level enforcement, so two
-- drivers in the same org could silently receive the same Samsara ID and corrupt reconciliation.
--
-- A PARTIAL unique index (where samsara_driver_id is not null) keeps NULLS DISTINCT (drivers not yet
-- linked to Samsara can coexist freely) while enforcing per-org uniqueness for linked rows.
-- The index also makes the sync's lookup by samsara_driver_id an index scan instead of a seqscan.

create unique index idx_drivers_samsara_id
  on drivers (org_id, samsara_driver_id)
  where samsara_driver_id is not null;
