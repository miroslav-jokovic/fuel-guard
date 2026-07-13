-- 0051: time-ranged driver-vehicle assignments (CP4) so idle events Samsara left without an operator can be
-- attributed to the driver who had the truck at that time. Persisted by the vehicle sync; read by the idle sync.
create table if not exists driver_vehicle_assignments (
  org_id             uuid not null references organizations(id) on delete cascade,
  vehicle_samsara_id text not null,
  driver_samsara_id  text not null,
  start_at           timestamptz not null,
  end_at             timestamptz,                    -- null = open / ongoing
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

-- How each idle event's driver was resolved, for the Data Confidence panel: direct | inferred | none.
alter table idle_events add column if not exists driver_source text;
