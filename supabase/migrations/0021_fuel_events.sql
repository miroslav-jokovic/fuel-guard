-- FuelGuard — 0021 fuel events (real-time siphoning)
-- Stores Samsara "sudden fuel level drop" alerts (siphoning signal) received via webhook. A sudden drop
-- is fuel LEAVING the tank with no purchase — a direct theft signal independent of the card feed.
create table if not exists fuel_events (
  id                 uuid primary key default gen_random_uuid(),
  org_id             uuid not null references organizations(id) on delete cascade,
  vehicle_id         uuid references vehicles(id) on delete set null,
  samsara_vehicle_id text,
  event_type         text not null default 'fuel_drop',   -- fuel_drop | fuel_rise
  happened_at        timestamptz not null,
  drop_pct           numeric(5,1),                         -- magnitude of the drop, %
  fuel_pct_before    numeric(5,1),
  fuel_pct_after     numeric(5,1),
  lat                numeric(9,6),
  lng                numeric(9,6),
  address            text,
  external_ref       text,                                 -- Samsara eventId (idempotent re-delivery)
  raw                jsonb not null default '{}',
  created_at         timestamptz not null default now()
);
create unique index if not exists idx_fuel_events_extref on fuel_events (org_id, external_ref) where external_ref is not null;
create index if not exists idx_fuel_events_org_time on fuel_events (org_id, happened_at desc);

-- RLS: read = org members; writes are service-role only (the webhook handler performs them).
alter table fuel_events enable row level security;
drop policy if exists fuel_events_select on fuel_events;
create policy fuel_events_select on fuel_events for select using (org_id = auth_org_id());
