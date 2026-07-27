-- FuelGuard — 0085 driver loads & assignments (Driver App, Phase 3)
--
-- WHY THIS IS NEW (discovery finding, DRIVER-APP-PLAN.md §14.2): the plan assumed loads already
-- existed server-side. They do not. `driver_vehicle_assignments` (0051) is Samsara-keyed telematics
-- history for idle attribution (D30 excludes it from driver scope), and `tms_movements` (0068)
-- exists only to answer "was this a temperature-controlled load?" — it carries no driver, no stops,
-- no addresses, no appointment windows, no status. The driver-facing load domain is greenfield.
--
-- Shape: a LOAD is assigned to a driver and made of ordered STOPS; each stop can require named
-- PHOTOS as proof of work (JB-Hunt-style). Written so a TMS feed can adopt it later without a
-- migration (`source`/`provider`/`external_id` provenance columns).
--
-- Authorization: drivers get RESTRICTIVE read-only scope to their OWN loads. Drivers have NO write
-- policy at all — accepting a load and completing a stop go through the driver-scoped API
-- (service role), which server-derives identity. The DB is the boundary (D10): a driver hitting
-- PostgREST directly can read their own rows and write nothing.

-- ── loads ─────────────────────────────────────────────────────────────────────
create table if not exists loads (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references organizations(id) on delete cascade,
  driver_id     uuid references drivers(id) on delete set null,   -- the assigned driver
  vehicle_id    uuid references vehicles(id) on delete set null,
  trailer_id    uuid references trailers(id) on delete set null,
  ref           text not null,                                    -- human-facing load number
  status        text not null default 'offered',                  -- see the check below
  equipment     text,                                             -- 'Dry van' | 'Reefer' | 'Flatbed'
  commodity     text,
  hazmat        boolean not null default false,                   -- gates the Phase-6 hazmat step
  total_miles   numeric(8,1),
  accepted_at   timestamptz,
  completed_at  timestamptz,
  notes         text,
  -- Provenance so a McLeod/TMS feed can write these rows later with no schema change.
  source        text not null default 'manual',                   -- manual | tms
  provider      text,                                             -- 'mcleod' when source = 'tms'
  external_id   text,                                             -- movement/order id in the TMS
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint loads_status_check
    check (status in ('offered', 'accepted', 'in_transit', 'delivered', 'canceled')),
  constraint loads_source_check check (source in ('manual', 'tms'))
);

-- The driver app's three buckets (upcoming / current / previous) all filter on (driver, status).
create index if not exists idx_loads_driver on loads (org_id, driver_id, status, created_at desc);
create index if not exists idx_loads_status on loads (org_id, status);
-- Idempotent TMS ingest later; partial so manual loads (null external_id) are unconstrained.
create unique index if not exists uq_loads_external
  on loads (org_id, provider, external_id) where external_id is not null;

-- ── load_stops ────────────────────────────────────────────────────────────────
create table if not exists load_stops (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null references organizations(id) on delete cascade, -- denormalized: RLS reads it directly
  load_id           uuid not null references loads(id) on delete cascade,
  seq               integer not null,                             -- 1-based order along the run
  kind              text not null,                                -- pickup | dropoff
  name              text not null,                                -- shipper / consignee / facility
  address_line      text,
  city              text,
  state             text,
  postal_code       text,
  lat               numeric(9, 6),
  lon               numeric(9, 6),
  appointment_start timestamptz,
  appointment_end   timestamptz,
  status            text not null default 'pending',              -- pending | arrived | completed | skipped
  arrived_at        timestamptz,
  completed_at      timestamptz,
  -- Named photo slots the driver must capture here, e.g. {trailer,seal,bol}. Empty = none required.
  required_photos   text[] not null default '{}',
  skip_reason       text,                                         -- why a required photo was unavailable
  notes             text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint load_stops_kind_check check (kind in ('pickup', 'dropoff')),
  constraint load_stops_status_check check (status in ('pending', 'arrived', 'completed', 'skipped')),
  constraint uq_load_stops_seq unique (load_id, seq)
);

create index if not exists idx_load_stops_load on load_stops (load_id, seq);

-- ── load_stop_photos ──────────────────────────────────────────────────────────
-- `id` is the CLIENT-generated UUID from the outbox record: replaying a queued upload collides on
-- the primary key and no-ops instead of double-writing (the idempotency contract, plan §13.3.2).
create table if not exists load_stop_photos (
  id           uuid primary key,                                  -- client UUID — NOT auto-generated
  org_id       uuid not null references organizations(id) on delete cascade,
  load_id      uuid not null references loads(id) on delete cascade,
  stop_id      uuid not null references load_stops(id) on delete cascade,
  driver_id    uuid references drivers(id) on delete set null,
  slot         text not null,                                     -- which required_photos entry this fills
  storage_path text not null,                                     -- ${org}/${driver}/${load}/${id}.webp
  captured_at  timestamptz,
  uploaded_at  timestamptz not null default now(),
  created_at   timestamptz not null default now()
);

-- Non-unique on purpose: a retake adds a row, so the audit trail keeps every capture. "Is this slot
-- satisfied?" = the most recent row per (stop_id, slot).
create index if not exists idx_load_stop_photos_stop on load_stop_photos (stop_id, slot, uploaded_at desc);
create index if not exists idx_load_stop_photos_load on load_stop_photos (org_id, load_id);

-- ── RLS ───────────────────────────────────────────────────────────────────────
alter table loads enable row level security;
alter table load_stops enable row level security;
alter table load_stop_photos enable row level security;

-- PERMISSIVE: every org member may read their tenant's loads (managers, dispatch, auditors).
drop policy if exists loads_select on loads;
create policy loads_select on loads for select using (org_id = auth_org_id());

drop policy if exists load_stops_select on load_stops;
create policy load_stops_select on load_stops for select using (org_id = auth_org_id());

drop policy if exists load_stop_photos_select on load_stop_photos;
create policy load_stop_photos_select on load_stop_photos for select using (org_id = auth_org_id());

-- PERMISSIVE writes: dispatch-capable roles only. Drivers are deliberately absent — their writes go
-- through the driver-scoped API, which server-derives driver_id from the JWT.
drop policy if exists loads_write on loads;
create policy loads_write on loads for all
  using (org_id = auth_org_id() and auth_role() in ('admin', 'fleet_manager', 'dispatcher'))
  with check (org_id = auth_org_id() and auth_role() in ('admin', 'fleet_manager', 'dispatcher'));

drop policy if exists load_stops_write on load_stops;
create policy load_stops_write on load_stops for all
  using (org_id = auth_org_id() and auth_role() in ('admin', 'fleet_manager', 'dispatcher'))
  with check (org_id = auth_org_id() and auth_role() in ('admin', 'fleet_manager', 'dispatcher'));

drop policy if exists load_stop_photos_write on load_stop_photos;
create policy load_stop_photos_write on load_stop_photos for all
  using (org_id = auth_org_id() and auth_role() in ('admin', 'fleet_manager', 'dispatcher'))
  with check (org_id = auth_org_id() and auth_role() in ('admin', 'fleet_manager', 'dispatcher'));

-- RESTRICTIVE (AND-combined): a driver sees ONLY their own loads and everything hanging off them.
-- Managers are unaffected because the predicate short-circuits for any non-driver role.
drop policy if exists loads_driver_scope on loads;
create policy loads_driver_scope on loads as restrictive
  for select using (auth_role() <> 'driver' or driver_id = auth_driver_id());

drop policy if exists load_stops_driver_scope on load_stops;
create policy load_stops_driver_scope on load_stops as restrictive
  for select using (
    auth_role() <> 'driver'
    or exists (
      select 1 from public.loads l
      where l.id = load_stops.load_id and l.driver_id = public.auth_driver_id()
    )
  );

drop policy if exists load_stop_photos_driver_scope on load_stop_photos;
create policy load_stop_photos_driver_scope on load_stop_photos as restrictive
  for select using (auth_role() <> 'driver' or driver_id = auth_driver_id());

-- ── Storage: load photos ──────────────────────────────────────────────────────
-- Path layout `${org_id}/${driver_id}/${load_id}/${photo_id}.webp` — segment 1 gives tenant
-- isolation (the receipts pattern) and segment 2 gives DRIVER isolation, so one driver can never
-- read or overwrite another's proof-of-work photos (the D13 hardening, applied from day one here).
insert into storage.buckets (id, name, public)
values ('load-photos', 'load-photos', false)
on conflict (id) do nothing;

drop policy if exists load_photos_read on storage.objects;
create policy load_photos_read on storage.objects
  for select using (
    bucket_id = 'load-photos'
    and split_part(name, '/', 1) = auth_org_id()::text
    and (auth_role() <> 'driver' or split_part(name, '/', 2) = auth_driver_id()::text)
  );

drop policy if exists load_photos_insert on storage.objects;
create policy load_photos_insert on storage.objects
  for insert with check (
    bucket_id = 'load-photos'
    and split_part(name, '/', 1) = auth_org_id()::text
    and (auth_role() <> 'driver' or split_part(name, '/', 2) = auth_driver_id()::text)
  );

-- No driver UPDATE/DELETE on storage: a delivered photo is evidence. Only dispatch-capable roles
-- may remove one (e.g. a mis-upload), and never a driver covering a mistake after the fact.
drop policy if exists load_photos_delete on storage.objects;
create policy load_photos_delete on storage.objects
  for delete using (
    bucket_id = 'load-photos'
    and split_part(name, '/', 1) = auth_org_id()::text
    and auth_role() in ('admin', 'fleet_manager', 'dispatcher')
  );
