-- 0076: Idle foundation — the reliable engine-time facts derived from Samsara engineStates. The idle rework
-- computes "engine-on = drive + idle" per truck per day (with honest coverage) and classifies each stationary
-- park session's mode, so the separate avoidable-hours module reads STORED FACTS instead of re-deriving from
-- Samsara. Both tables are org-scoped; the API (service role) writes, org members read.

-- Per-truck / per-day engine-time split (see aggregateEngineDays). engine_on = drive_sec + idle_sec;
-- coverage_sec / 86400 = the day's data confidence.
create table if not exists vehicle_engine_days (
  id                 uuid primary key default gen_random_uuid(),
  org_id             uuid not null references organizations(id) on delete cascade,
  vehicle_id         uuid not null references vehicles(id) on delete cascade,
  day                date not null,                                  -- calendar day in tz_offset_minutes
  drive_sec          int  not null default 0,                        -- engineStates "On" (running + moving)
  idle_sec           int  not null default 0,                        -- "Idle" (running, stationary)
  off_sec            int  not null default 0,                        -- "Off" (shut down / APU)
  coverage_sec       int  not null default 0,                        -- = drive+idle+off (observed time only)
  tz_offset_minutes  int  not null default 0,                        -- day-boundary offset used (0 = UTC)
  synced_at          timestamptz not null default now()
);
create unique index if not exists idx_vehicle_engine_days_key on vehicle_engine_days (org_id, vehicle_id, day);
create index        if not exists idx_vehicle_engine_days_org_day on vehicle_engine_days (org_id, day);

alter table vehicle_engine_days enable row level security;
drop policy if exists vehicle_engine_days_select on vehicle_engine_days;
create policy vehicle_engine_days_select on vehicle_engine_days for select using (org_id = auth_org_id());
-- writes: service role only (the API upserts with the service key, which bypasses RLS); no client write policy.

-- Per stationary park session (>=30 min) with its measured idle mode — the input to the avoidable algorithm.
create table if not exists idle_park_sessions (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references organizations(id) on delete cascade,
  vehicle_id    uuid not null references vehicles(id) on delete cascade,
  started_at    timestamptz not null,
  ended_at      timestamptz not null,
  duration_sec  int  not null,
  idle_sec      int  not null,                                       -- engine-on idle during the park
  off_sec       int  not null,                                       -- engine-off during the park (APU/hotel/shutdown)
  cycles        int  not null default 0,                             -- Off<->running transitions (auto start/stop)
  mode          text not null,                                       -- continuous | optimized_cycling | apu_or_off
  synced_at     timestamptz not null default now()
);
create unique index if not exists idx_idle_park_sessions_key on idle_park_sessions (org_id, vehicle_id, started_at);
create index        if not exists idx_idle_park_sessions_veh on idle_park_sessions (org_id, vehicle_id, started_at desc);

alter table idle_park_sessions enable row level security;
drop policy if exists idle_park_sessions_select on idle_park_sessions;
create policy idle_park_sessions_select on idle_park_sessions for select using (org_id = auth_org_id());
-- writes: service role only.
