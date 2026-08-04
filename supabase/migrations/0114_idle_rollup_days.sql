-- 0114: idle_rollup_days — ONE pre-aggregated row per (vehicle, calendar day), maintained by the idle/HOS
-- sync jobs (diff-before-write). The Idling page reads THIS table (~trucks×days rows) instead of paging the
-- raw event tables (idle_events, hos_duty_segments, idle_park_sessions, vehicle_engine_days) into the
-- browser and re-aggregating on every refresh — the pattern that hit Postgres' statement timeout as the raw
-- tables grew. Raw tables remain the source of truth; this is derived state and can be rebuilt at any time.
create table if not exists idle_rollup_days (
  id                    uuid primary key default gen_random_uuid(),
  org_id                uuid not null references organizations(id) on delete cascade,
  vehicle_id            uuid not null references vehicles(id) on delete cascade,
  day                   date not null,
  -- engine-time totals (vehicle_engine_days grain, passed through)
  drive_sec             int not null default 0,
  idle_sec              int not null default 0,
  off_sec               int not null default 0,
  coverage_sec          int not null default 0,
  -- park-session idle split by mode (sufficient to reconstruct computeAvoidable exactly)
  managed_idle_sec      int not null default 0,   -- apu_or_off + optimized_cycling sessions
  continuous_idle_sec   int not null default 0,   -- continuous sessions (the avoidable candidate)
  -- HOS duty overlay on idle events (rest = SB/OFF, work = On Duty, other = uncovered/excluded/no-driver)
  rest_idle_sec         int not null default 0,
  work_idle_sec         int not null default 0,
  other_idle_sec        int not null default 0,
  -- the day's dominant driver (idle-event operators + assignment day-overlap), for the driver leaderboard
  attributed_driver_id  uuid references drivers(id) on delete set null,
  updated_at            timestamptz not null default now()
);

create unique index if not exists idx_idle_rollup_days_key     on idle_rollup_days (org_id, vehicle_id, day);
create index        if not exists idx_idle_rollup_days_org_day on idle_rollup_days (org_id, day, vehicle_id);

alter table idle_rollup_days enable row level security;
-- Org members read their fleet's rollup; ONLY the service role (sync jobs) writes — no client write policy.
drop policy if exists idle_rollup_days_select on idle_rollup_days;
create policy idle_rollup_days_select on idle_rollup_days for select using (org_id = auth_org_id());

comment on table idle_rollup_days is
  'Derived per-(vehicle, day) idle/duty rollup maintained by the idle+HOS syncs. Read path for the Idling page; rebuildable from raw tables at any time.';
