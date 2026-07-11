-- ─────────────────────────────────────────────────────────────────────────────────────────────────────
-- MANUAL DEPLOY — org-scoped learned station coordinates (audit A3.1, tenant isolation)
-- Copy-paste into the Supabase SQL editor and run. Idempotent.
--
-- Moves telematics-LEARNED pump coordinates out of the shared geocode_cache (where one org's private data
-- became every org's location-check input) into a per-org table the reader prefers for the same org. The
-- shared provider geocode (public data) is unchanged. The DELETE purges the legacy cross-tenant learned rows;
-- they re-learn per-org on the next Rebuild.
-- ─────────────────────────────────────────────────────────────────────────────────────────────────────
create table if not exists station_geocode_learned (
  org_id     uuid not null references organizations(id) on delete cascade,
  query      text not null,
  lat        numeric(9,6) not null,
  lng        numeric(9,6) not null,
  samples    int,
  updated_at timestamptz not null default now(),
  primary key (org_id, query)
);

alter table station_geocode_learned enable row level security;
drop policy if exists sgl_select on station_geocode_learned;
create policy sgl_select on station_geocode_learned for select using (org_id = auth_org_id());
drop policy if exists sgl_write on station_geocode_learned;
create policy sgl_write on station_geocode_learned for all
  using (org_id = auth_org_id() and auth_role() in ('admin', 'fleet_manager'))
  with check (org_id = auth_org_id() and auth_role() in ('admin', 'fleet_manager'));

delete from geocode_cache where provider = 'learned';

-- Verify:
-- select count(*) from station_geocode_learned;
-- select count(*) from geocode_cache where provider = 'learned';  -- expect 0
