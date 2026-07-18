-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════
-- FuelGuard — PRECISION PROGRAM schema deploy (docs/12, Phases 1–6)
-- Copy-paste this ENTIRE block into the Supabase SQL editor and run it once.
-- Idempotent: every statement is "if not exists", so it is safe to re-run and safe if some columns already
-- exist. Wrapped in a transaction so it all applies or none does.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════
begin;

-- ── Learned per-truck tank-sensor reliability (gates the per-fill tank/volume/consumption rules) ──────────
--    (migration 0038) — included here so a fresh DB is complete; no-op if already applied.
alter table vehicles add column if not exists tank_sensor_reliable boolean not null default false;
alter table vehicles add column if not exists tank_fill_ratio       numeric(5,3);
comment on column vehicles.tank_sensor_reliable is
  'Learned: Samsara tank sensor reflects the whole billed fill (ratio ~1). Gates tank_fill_short + per-fill volume/MPG rules. Default false.';

-- ── Phase 2: learned COMBINED tank capacity (kills dual-tank false over-capacity / over-fuel) ─────────────
--    (migration 0039)
alter table vehicles add column if not exists observed_max_fill_gal numeric(6,1);
comment on column vehicles.observed_max_fill_gal is
  'Learned p95 of recent single-fill gallons ~= true (combined, for dual-tank) capacity. Raises effective capacity above an under-entered nameplate; never lowers it. Null until enough history.';

-- ── Phase 4: per-fill nearest-station distance (systematic wrong-pin detection) ───────────────────────────
--    (migration 0040)
alter table fuel_transactions add column if not exists samsara_nearest_station_miles numeric(7,1);
comment on column fuel_transactions.samsara_nearest_station_miles is
  'Truck GPS closest approach (mi) to the station pin that day. Clustering across a station''s fills flags a wrong pin (data error), suppressing a false location mismatch.';

-- ── Reefer trailer pairing provenance (GPS co-location inference) ─────────────────────────────────────────
--    (migration 0041)
alter table trailers add column if not exists pairing_source     text;
alter table trailers add column if not exists pairing_confidence numeric(4,3);
comment on column trailers.pairing_source is
  'How assigned_vehicle_id was set: manual | samsara | inferred (GPS co-location). manual is never overwritten by a sync.';

commit;

-- ── Verify (optional) — run after COMMIT; should return 5 rows ───────────────────────────────────────────
select table_name, column_name, data_type
from information_schema.columns
where (table_name = 'vehicles'          and column_name in ('tank_sensor_reliable','tank_fill_ratio','observed_max_fill_gal'))
   or (table_name = 'fuel_transactions' and column_name = 'samsara_nearest_station_miles')
   or (table_name = 'trailers'          and column_name in ('pairing_source','pairing_confidence'))
order by table_name, column_name;
