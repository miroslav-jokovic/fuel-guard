-- ─────────────────────────────────────────────────────────────────────────────────────────────────────
-- MANUAL DEPLOY — reefer trailer pairing provenance (GPS co-location inference)
-- Copy-paste into the Supabase SQL editor and run. Idempotent.
-- ─────────────────────────────────────────────────────────────────────────────────────────────────────
alter table trailers add column if not exists pairing_source     text;
alter table trailers add column if not exists pairing_confidence numeric(4,3);

comment on column trailers.pairing_source is
  'How assigned_vehicle_id was set: manual | samsara | inferred (GPS co-location). manual is never overwritten by a sync.';

-- Verify:
-- select unit_number, is_reefer, assigned_vehicle_id, pairing_source, pairing_confidence from trailers order by unit_number;
