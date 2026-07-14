-- 0053: per-org driver-performance settings — the weights, normalization method, eligibility gate, reward
-- size, trailing window, and settle delay used to grade drivers each week (docs/16-DRIVER-PERFORMANCE.md).
-- Admin-only write, mirroring anomaly_thresholds. week_timezone null → falls back at read time to
-- organizations.operating_hours->>'tz'. Changing these and re-running the snapshot re-grades future weeks.
create table if not exists driver_performance_settings (
  org_id                    uuid primary key references organizations(id) on delete cascade,
  weight_safety             numeric(5,2) not null default 0.50,
  weight_efficiency         numeric(5,2) not null default 0.25,
  weight_idling             numeric(5,2) not null default 0.25,
  normalization_method      text  not null default 'percentile',   -- percentile | zscore | raw
  min_cohort_for_percentile int   not null default 20,
  min_distance_mi           numeric not null default 500,          -- weekly exposure gate (miles)
  min_drive_hours           numeric not null default 10,           -- weekly exposure gate (hours)
  reward_top_n              int   not null default 3,
  trailing_weeks            int   not null default 3,
  settle_hours              int   not null default 96,              -- delay before a week is frozen (72h efficiency lag)
  efficiency_enabled        boolean not null default true,
  week_starts_on            int   not null default 1,               -- 1 = Monday (ISO)
  week_timezone             text,
  updated_at                timestamptz not null default now()
);
drop trigger if exists trg_driver_perf_settings_updated on driver_performance_settings;
create trigger trg_driver_perf_settings_updated before update on driver_performance_settings
  for each row execute function set_updated_at();

alter table driver_performance_settings enable row level security;
drop policy if exists dps_select on driver_performance_settings;
create policy dps_select on driver_performance_settings for select using (org_id = auth_org_id());
drop policy if exists dps_write on driver_performance_settings;
create policy dps_write on driver_performance_settings for all
  using (org_id = auth_org_id() and auth_role() = 'admin')
  with check (org_id = auth_org_id() and auth_role() = 'admin');
