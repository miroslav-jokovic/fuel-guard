-- 0044: per-org idle settings. The comfort band + thresholds the idle classifier uses, SETTABLE by the fleet,
-- plus the learned SUGGESTION (from the idle-vs-temperature pattern) so an admin can adopt the data-driven
-- band. Changing these and re-running the idle sync re-classifies events.
create table if not exists idle_settings (
  org_id             uuid primary key references organizations(id) on delete cascade,
  min_idle_minutes   int      not null default 5,        -- idle shorter than this is a normal stop
  comfort_low_f      numeric(5,1) not null default 20,   -- below → cab heating justifies idle
  comfort_high_f     numeric(5,1) not null default 85,   -- above → cab cooling justifies idle
  idle_gal_per_hour  numeric(4,2) not null default 0.8,  -- idle burn when a fill has no measured fuel
  fuel_price_per_gal numeric(6,3) not null default 4.0,  -- $/gal fallback when an event has no measured cost
  suggested_low_f    numeric(5,1),                       -- learned (learnComfortBand)
  suggested_high_f   numeric(5,1),
  updated_at         timestamptz not null default now()
);

alter table idle_settings enable row level security;
drop policy if exists idle_settings_select on idle_settings;
create policy idle_settings_select on idle_settings for select using (org_id = auth_org_id());
drop policy if exists idle_settings_write on idle_settings;
create policy idle_settings_write on idle_settings for all
  using (org_id = auth_org_id() and auth_role() in ('admin', 'fleet_manager'))
  with check (org_id = auth_org_id() and auth_role() in ('admin', 'fleet_manager'));
