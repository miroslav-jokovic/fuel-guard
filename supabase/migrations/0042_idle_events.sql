-- 0042: idle events — one row per Samsara idling event (from GET /idling/events). Powers idle tracking and
-- the driver fuel-scoring leaderboard. Samsara already classifies idle (engine on + not moving > 2 min,
-- PTO/aux aware); we store each event with our own classification (productive / justified / discretionary)
-- and the fuel/$ cost so we can score drivers on WASTEFUL idle during sleep / load / wait.
create table if not exists idle_events (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null references organizations(id) on delete cascade,
  samsara_event_id  text not null,                                    -- eventUuid (idempotency key)
  vehicle_id        uuid references vehicles(id) on delete set null,
  driver_id         uuid references drivers(id) on delete set null,
  started_at        timestamptz not null,
  duration_sec      int not null,
  pto_active        boolean not null default false,
  air_temp_f        numeric(6,1),                                     -- from airTemperatureMillicelsius
  fuel_gal          numeric(9,3),                                     -- from fuelConsumedMilliliters
  cost_usd          numeric(10,2),                                    -- from fuelCost.amount
  lat               numeric(9,6),
  lng               numeric(9,6),
  geofence_types    text[],                                           -- addressTypes (yard, customerSite, …)
  classification    text not null,                                    -- productive | justified | discretionary | brief
  created_at        timestamptz not null default now()
);
create unique index if not exists idx_idle_events_org_event  on idle_events (org_id, samsara_event_id);
create index        if not exists idx_idle_events_org_started on idle_events (org_id, started_at);
create index        if not exists idx_idle_events_driver      on idle_events (org_id, driver_id);

-- RLS: org members read; the service role (API) writes. Mirrors the vehicles/trailers pattern.
alter table idle_events enable row level security;
drop policy if exists idle_events_select on idle_events;
create policy idle_events_select on idle_events for select using (org_id = auth_org_id());
drop policy if exists idle_events_write on idle_events;
create policy idle_events_write on idle_events for all
  using (org_id = auth_org_id() and auth_role() in ('admin', 'fleet_manager'))
  with check (org_id = auth_org_id() and auth_role() in ('admin', 'fleet_manager'));
