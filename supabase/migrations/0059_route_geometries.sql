-- 0059: cached HERE truck-route geometries. Keyed by a hash of (stops + truck profile + engine version) so a
-- profile/hazmat change or a logic bump misses the cache correctly. Global (route geometry is a geographic
-- fact, not org data): any authenticated org member reads; the service role writes.
create table if not exists route_geometries (
  id               uuid primary key default gen_random_uuid(),
  cache_key        text not null unique,
  polyline         jsonb not null,          -- decoded [{lat,lng}, ...]
  distance_meters  numeric not null,
  duration_seconds numeric,
  created_at       timestamptz not null default now()
);
alter table route_geometries enable row level security;
drop policy if exists route_geometries_select on route_geometries;
create policy route_geometries_select on route_geometries for select using (auth_org_id() is not null);
-- writes: service role only.
