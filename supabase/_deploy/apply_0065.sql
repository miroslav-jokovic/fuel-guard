-- ────────────────────────────────────────────────────────────────────
-- MANUAL DEPLOY — 0065 default_equipment_type on route_fuel_settings (Fuel Planning load type)
-- Copy-paste into the Supabase SQL editor and run. Idempotent.
-- ────────────────────────────────────────────────────────────────────
alter table route_fuel_settings add column if not exists default_equipment_type text not null default 'dry_van';
