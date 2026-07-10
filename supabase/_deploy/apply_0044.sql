-- ─────────────────────────────────────────────────────────────────────────────────────────────────────
-- MANUAL DEPLOY — per-org idle settings (idle Phase 3, docs/14): settable comfort band + learned suggestion
-- Copy-paste into the Supabase SQL editor and run. Idempotent.
-- ─────────────────────────────────────────────────────────────────────────────────────────────────────
create table if not exists idle_settings (
  org_id             uuid primary key references organizations(id) on delete cascade,
  min_idle_minutes   int      not null default 5,
  comfort_low_f      numeric(5,1) not null default 20,
  comfort_high_f     numeric(5,1) not null default 85,
  idle_gal_per_hour  numeric(4,2) not null default 0.8,
  fuel_price_per_gal numeric(6,3) not null default 4.0,
  suggested_low_f    numeric(5,1),
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

-- Verify:
-- select * from idle_settings;
