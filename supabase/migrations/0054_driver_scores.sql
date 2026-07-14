-- 0054: current/provisional Samsara-sourced component scores per driver-week (Safety + Efficiency). The idle
-- component is computed live from idle_events; this table holds only what needs a Samsara API pull. Refreshed
-- by the driver-score sync; frozen weeks live in driver_performance_weeks. Member-read; admin/fleet_manager
-- write (service role writes in practice). (docs/16-DRIVER-PERFORMANCE.md)
create table if not exists driver_scores (
  id                 uuid primary key default gen_random_uuid(),
  org_id             uuid not null references organizations(id) on delete cascade,
  driver_id          uuid not null references drivers(id) on delete cascade,
  samsara_driver_id  text,
  week_start         date not null,                 -- Monday in the org's week timezone
  week_end           date not null,
  window_start       timestamptz not null,          -- actual UTC window fetched
  window_end         timestamptz not null,
  -- Safety (GET /safety-scores/drivers)
  safety_score       numeric(5,1),
  drive_distance_mi  numeric(10,1),
  drive_time_hours   numeric(8,2),
  harsh_accel_count  int,
  harsh_brake_count  int,
  harsh_turn_count   int,
  crash_count        int,
  speeding_ms        bigint,
  safety_raw         jsonb,                          -- verbatim behaviors[]+speeding[]
  -- Efficiency (GET /driver-efficiency/drivers; nullable — beta / graceful degrade)
  efficiency_score        numeric(5,1),
  efficiency_grade_letter text,                       -- set when org returns A–G (then efficiency_score is null)
  engine_on_hours    numeric(8,2),
  idling_pct         numeric(5,1),
  efficiency_raw     jsonb,
  synced_at          timestamptz not null default now()
);
create unique index if not exists idx_driver_scores_org_driver_week on driver_scores (org_id, driver_id, week_start);
create index if not exists idx_driver_scores_org_week on driver_scores (org_id, week_start);

alter table driver_scores enable row level security;
drop policy if exists driver_scores_select on driver_scores;
create policy driver_scores_select on driver_scores for select using (org_id = auth_org_id());
drop policy if exists driver_scores_write on driver_scores;
create policy driver_scores_write on driver_scores for all
  using (org_id = auth_org_id() and auth_role() in ('admin', 'fleet_manager'))
  with check (org_id = auth_org_id() and auth_role() in ('admin', 'fleet_manager'));
