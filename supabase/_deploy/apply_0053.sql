-- ────────────────────────────────────────────────────────────────────
-- MANUAL DEPLOY — 0053 driver_performance_settings (docs/16-DRIVER-PERFORMANCE.md)
-- Copy-paste into the Supabase SQL editor and run. Idempotent.
-- Per-org weights / normalization / eligibility gate / reward config for driver grading. Admin-only write.
-- ────────────────────────────────────────────────────────────────────
create table if not exists driver_performance_settings (
  org_id                    uuid primary key references organizations(id) on delete cascade,
  weight_safety             numeric(5,2) not null default 0.50,
  weight_efficiency         numeric(5,2) not null default 0.25,
  weight_idling             numeric(5,2) not null default 0.25,
  normalization_method      text  not null default 'percentile',
  min_cohort_for_percentile int   not null default 20,
  min_distance_mi           numeric not null default 500,
  min_drive_hours           numeric not null default 10,
  reward_top_n              int   not null default 3,
  trailing_weeks            int   not null default 3,
  settle_hours              int   not null default 96,
  efficiency_enabled        boolean not null default true,
  week_starts_on            int   not null default 1,
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

-- Verify:
-- select * from driver_performance_settings;
