-- 0045: org-scoped LEARNED station coordinates (audit A3.1 — tenant isolation).
--
-- The generic provider geocode (geocode_cache) is PUBLIC data ("where is Pilot #123, Dallas TX") and stays a
-- shared, global cache. But a coordinate LEARNED from an org's OWN telematics (the median of that org's trucks'
-- observed stop positions at a station) is PRIVATE, org-specific data. Previously learnStationGeocodes wrote it
-- into the shared geocode_cache keyed only by station identity, so one org's learned pump coordinate became a
-- location-match / systematic-offset input for EVERY other org — a cross-tenant, poisonable detection input.
--
-- Fix: store learned coordinates per org. The reader (geocodeStation) prefers a learned coord for the SAME org,
-- then falls back to the shared provider cache.
create table if not exists station_geocode_learned (
  org_id     uuid not null references organizations(id) on delete cascade,
  query      text not null,                 -- station identity siteKey (brand+store# or name|city|state)
  lat        numeric(9,6) not null,
  lng        numeric(9,6) not null,
  samples    int,                            -- stop positions backing the estimate (transparency)
  updated_at timestamptz not null default now(),
  primary key (org_id, query)
);

-- RLS: org members read their own learned coordinates; the API (service role) writes. Mirrors idle_events etc.
alter table station_geocode_learned enable row level security;
drop policy if exists sgl_select on station_geocode_learned;
create policy sgl_select on station_geocode_learned for select using (org_id = auth_org_id());
drop policy if exists sgl_write on station_geocode_learned;
create policy sgl_write on station_geocode_learned for all
  using (org_id = auth_org_id() and auth_role() in ('admin', 'fleet_manager'))
  with check (org_id = auth_org_id() and auth_role() in ('admin', 'fleet_manager'));

-- Purge the legacy cross-tenant learned rows from the shared cache. They re-learn per-org on the next rebuild
-- (learnStationGeocodes is idempotent and runs at backfill start); meanwhile the reader falls back to the
-- provider geocode, so no fill loses its location check.
delete from geocode_cache where provider = 'learned';
