-- 0165: Phase 3 numeric telemetry evidence.
-- This is an observational summary only; it does not alter idle scoring or equipment authority.

create table if not exists idle_telemetry_windows (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  vehicle_id uuid not null references vehicles(id) on delete cascade,
  window_start timestamptz not null,
  window_end timestamptz not null,
  data_status text not null default 'insufficient',
  battery_sample_count int not null default 0,
  battery_min_mv numeric(10,2),
  battery_max_mv numeric(10,2),
  battery_avg_mv numeric(10,2),
  rpm_sample_count int not null default 0,
  rpm_min numeric(10,2),
  rpm_max numeric(10,2),
  rpm_avg numeric(10,2),
  engine_load_sample_count int not null default 0,
  engine_load_min_pct numeric(6,2),
  engine_load_max_pct numeric(6,2),
  engine_load_avg_pct numeric(6,2),
  ecu_speed_sample_count int not null default 0,
  ecu_speed_min_mph numeric(8,2),
  ecu_speed_max_mph numeric(8,2),
  ecu_speed_avg_mph numeric(8,2),
  source text not null default 'vehicle_stats_history',
  evidence_version text not null default 'vehicle-stats-v1',
  synced_at timestamptz not null default now(),
  unique (org_id, vehicle_id),
  check (window_end > window_start),
  check (data_status in ('observed', 'insufficient')),
  check (battery_sample_count >= 0 and rpm_sample_count >= 0 and engine_load_sample_count >= 0 and ecu_speed_sample_count >= 0),
  check (battery_min_mv is null or battery_min_mv >= 0),
  check (battery_max_mv is null or battery_max_mv >= 0),
  check (engine_load_min_pct is null or engine_load_min_pct between 0 and 100),
  check (engine_load_max_pct is null or engine_load_max_pct between 0 and 100),
  check (ecu_speed_min_mph is null or ecu_speed_min_mph >= 0),
  check (ecu_speed_max_mph is null or ecu_speed_max_mph >= 0)
);

create index if not exists idx_idle_telemetry_windows_org_status
  on idle_telemetry_windows (org_id, data_status);

alter table idle_telemetry_windows enable row level security;
drop policy if exists idle_telemetry_windows_select on idle_telemetry_windows;
create policy idle_telemetry_windows_select on idle_telemetry_windows
  for select using (org_id = auth_org_id());
