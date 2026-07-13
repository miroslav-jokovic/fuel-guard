-- ────────────────────────────────────────────────────────────────────
-- MANUAL DEPLOY — driver-assignment attribution fallback (CP4)
-- Copy-paste into the Supabase SQL editor and run. Idempotent.
--
-- Adds a table of time-ranged driver-vehicle assignments (filled by the vehicle sync) plus a column recording
-- how each idle event's driver was resolved. After running, the next vehicle sync persists assignments and the
-- next idle sync attributes operator-less events to the assigned driver.
-- ────────────────────────────────────────────────────────────────────
create table if not exists driver_vehicle_assignments (
  org_id             uuid not null references organizations(id) on delete cascade,
  vehicle_samsara_id text not null,
  driver_samsara_id  text not null,
  start_at           timestamptz not null,
  end_at             timestamptz,
  updated_at         timestamptz not null default now(),
  primary key (org_id, vehicle_samsara_id, driver_samsara_id, start_at)
);
create index if not exists idx_dva_org_vehicle_start on driver_vehicle_assignments (org_id, vehicle_samsara_id, start_at);
alter table driver_vehicle_assignments enable row level security;
drop policy if exists dva_select on driver_vehicle_assignments;
create policy dva_select on driver_vehicle_assignments for select using (org_id = auth_org_id());
drop policy if exists dva_write on driver_vehicle_assignments;
create policy dva_write on driver_vehicle_assignments for all
  using (org_id = auth_org_id() and auth_role() in ('admin', 'fleet_manager'))
  with check (org_id = auth_org_id() and auth_role() in ('admin', 'fleet_manager'));
alter table idle_events add column if not exists driver_source text;

-- Verify:
-- select driver_source, count(*) from idle_events group by driver_source;
