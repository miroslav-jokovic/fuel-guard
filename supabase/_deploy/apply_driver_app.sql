-- ═══════════════════════════════════════════════════════════════════════════════
-- FuelGuard — Driver App deploy bundle (migrations 0083 + 0084 + 0085)
--
-- Everything the Driver App needs in the database, in one runnable script. Paste into the Supabase
-- SQL editor (or psql) against the target project. Source of truth remains the individual migration
-- files — this bundle mirrors them exactly:
--     supabase/migrations/0083_driver_identity.sql   (identity: link a login to a roster driver)
--     supabase/migrations/0084_driver_scoped_rls.sql (driver-scoped RLS on existing tables)
--     supabase/migrations/0085_driver_loads.sql      (loads / stops / stop photos + storage)
-- Plan: docs/plans/drivers-app/DRIVER-APP-PLAN.md §12 / §14 / §16 (D3, D9, D10, D13, D14, SB1).
--
-- SAFE TO RE-RUN. Every statement is guarded (`if not exists` / `or replace` / `drop policy if
-- exists` before create), so applying twice is a no-op rather than an error.
--
-- ADDITIVE ONLY. No existing table, column, or policy is dropped or narrowed. The driver policies
-- are RESTRICTIVE (AND-combined): they constrain ONLY the 'driver' role and leave every existing
-- manager/admin PERMISSIVE policy untouched.
--
-- WHY RLS AND NOT JUST THE API: the driver app ships the anon key plus a driver JWT, so a driver can
-- call PostgREST directly. The database — not the API and not the UI — is the authorization
-- boundary (audit §21 / D10).
--
-- ── TWO OPS STEPS THIS SCRIPT CANNOT DO (dashboard settings, not SQL) ──────────
--   T1  Enable the Custom Access Token hook  →  Dashboard › Authentication › Hooks
--       (points at public.custom_access_token_hook). WITHOUT IT no org_id / user_role claims are
--       issued, auth_org_id() and auth_role() return null, and every driver sticks on "pending".
--   T9  Allow the app's deep link            →  Dashboard › Authentication › URL Configuration
--       Add redirect URL:  fuelguard://accept-invite
--       Without it GoTrue falls back to site_url and invite links open the web, not the app.
-- ═══════════════════════════════════════════════════════════════════════════════

begin;

-- ═══════════════════════════════════════════════════════════════════════════════
-- 0083 — DRIVER IDENTITY
-- Links a login user to a roster driver so a signed-in driver resolves to exactly one drivers row,
-- and lets an auth user be deleted (offboarding) without an FK violation.
-- ═══════════════════════════════════════════════════════════════════════════════

-- Which roster driver an invite provisions (required at the app layer when role = 'driver').
alter table invites add column if not exists driver_id uuid references drivers(id) on delete set null;

-- One login per driver, one driver per login, within an org — auth_driver_id() must be single-valued.
create unique index if not exists uq_drivers_org_user
  on drivers (org_id, user_id) where user_id is not null;

-- Offboarding: deleting an auth user must NULL the link, not fail. The original FK had no on-delete
-- action, which would block auth.admin.deleteUser once a driver is linked (audit §21 SB3 / D14).
alter table drivers drop constraint if exists drivers_user_id_fkey;
alter table drivers
  add constraint drivers_user_id_fkey
  foreign key (user_id) references auth.users(id) on delete set null;


-- ═══════════════════════════════════════════════════════════════════════════════
-- 0084 — DRIVER-SCOPED RLS
-- ═══════════════════════════════════════════════════════════════════════════════

-- Resolve the caller's driver row from the verified JWT `sub` claim.
-- SECURITY DEFINER so the internal read of drivers bypasses RLS — otherwise the drivers restrictive
-- policy below would recurse. `set search_path = ''` forces fully-qualified names (injection-safe).
create or replace function auth_driver_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select d.id
  from public.drivers d
  where d.org_id = public.auth_org_id()
    and d.user_id = nullif(current_setting('request.jwt.claims', true)::jsonb ->> 'sub', '')::uuid
  limit 1;
$$;

-- ── drivers: a driver sees only their own row ────────────────────────────────
drop policy if exists drivers_driver_scope on drivers;
create policy drivers_driver_scope on drivers as restrictive
  for select using (auth_role() <> 'driver' or id = auth_driver_id());

-- ── vehicles: a driver sees only vehicle(s) assigned to them ──────────────────
drop policy if exists vehicles_driver_scope on vehicles;
create policy vehicles_driver_scope on vehicles as restrictive
  for select using (auth_role() <> 'driver' or assigned_driver_id = auth_driver_id());

-- ── fuel_transactions: a driver reads only their own fills ────────────────────
drop policy if exists ftxn_driver_select on fuel_transactions;
create policy ftxn_driver_select on fuel_transactions as restrictive
  for select using (auth_role() <> 'driver' or driver_id = auth_driver_id());

-- ── fuel_transactions: a driver may insert ONLY their own fill, on an assigned
--    vehicle, with source 'manual' (closes attribution forgery — audit §21 SB1).
--    NOTE: D41 removed manual fuel capture from the driver app, so drivers no longer
--    insert fills at all. The policy is retained deliberately — it costs nothing and
--    keeps the DB defended if any client ever attempts a direct insert.
drop policy if exists ftxn_driver_insert on fuel_transactions;
create policy ftxn_driver_insert on fuel_transactions as restrictive
  for insert
  with check (
    auth_role() <> 'driver'
    or (
      driver_id = auth_driver_id()
      and source = 'manual'
      and exists (
        select 1 from public.vehicles v
        where v.id = fuel_transactions.vehicle_id
          and v.assigned_driver_id = auth_driver_id()
      )
    )
  );

-- ── driver_performance_weeks: a driver sees only their own settled week ────────
drop policy if exists dpw_driver_scope on driver_performance_weeks;
create policy dpw_driver_scope on driver_performance_weeks as restrictive
  for select using (auth_role() <> 'driver' or driver_id = auth_driver_id());

-- ── surfaces a driver has no business reading: deny the driver role outright ──
drop policy if exists anomalies_driver_deny on anomalies;
create policy anomalies_driver_deny on anomalies as restrictive
  for select using (auth_role() <> 'driver');

drop policy if exists memberships_driver_deny on memberships;
create policy memberships_driver_deny on memberships as restrictive
  for select using (auth_role() <> 'driver');

drop policy if exists thresholds_driver_deny on anomaly_thresholds;
create policy thresholds_driver_deny on anomaly_thresholds as restrictive
  for select using (auth_role() <> 'driver');


-- ═══════════════════════════════════════════════════════════════════════════════
-- 0085 — LOADS, STOPS & PROOF-OF-WORK PHOTOS  (Driver App Phase 3)
--
-- GREENFIELD (discovery finding, plan §14.2): the driver-facing load domain did not exist.
-- `driver_vehicle_assignments` (0051) is Samsara-keyed idle-attribution history; `tms_movements`
-- (0068) only answers "was this temperature-controlled?" — neither carries a driver, stops,
-- addresses, appointment windows, or status. These tables are new.
--
-- Drivers are READ-ONLY here: accepting a load and completing a stop go through the driver-scoped
-- API (service role), which server-derives identity from the JWT. A driver hitting PostgREST
-- directly can read their own work and write nothing.
-- ═══════════════════════════════════════════════════════════════════════════════

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

commit;


-- ═══════════════════════════════════════════════════════════════════════════════
-- VERIFICATION — run after applying. Each block should return the row(s) noted.
-- ═══════════════════════════════════════════════════════════════════════════════

-- 1) Schema: expect invites.driver_id, the partial unique index, and the FK set to SET NULL.
select
  (select count(*) from information_schema.columns
     where table_name = 'invites' and column_name = 'driver_id')                     as invites_driver_id,
  (select count(*) from pg_indexes
     where indexname = 'uq_drivers_org_user')                                        as uq_drivers_org_user,
  (select confdeltype from pg_constraint
     where conname = 'drivers_user_id_fkey')                                         as fk_on_delete;  -- expect 'n' (SET NULL)

-- 2) Helper function exists and is SECURITY DEFINER (prosecdef = true).
select proname, prosecdef
from pg_proc
where proname = 'auth_driver_id';

-- 3) All eight driver policies present and RESTRICTIVE (permissive = 'RESTRICTIVE').
select tablename, policyname, permissive, cmd
from pg_policies
where policyname in (
  'drivers_driver_scope', 'vehicles_driver_scope', 'ftxn_driver_select', 'ftxn_driver_insert',
  'dpw_driver_scope', 'anomalies_driver_deny', 'memberships_driver_deny', 'thresholds_driver_deny'
)
order by tablename, policyname;

-- 4) Loads domain: expect 3 tables, 12 policies (3 permissive select + 3 permissive write +
--    3 restrictive driver scope + 3 storage), and the load-photos bucket.
select
  (select count(*) from information_schema.tables
     where table_name in ('loads', 'load_stops', 'load_stop_photos'))                as load_tables,   -- expect 3
  (select count(*) from pg_policies
     where tablename in ('loads', 'load_stops', 'load_stop_photos'))                 as load_policies, -- expect 9
  (select count(*) from pg_policies where policyname like 'load_photos%')            as storage_pols,  -- expect 3
  (select count(*) from storage.buckets where id = 'load-photos')                    as bucket;        -- expect 1

-- 5) Sanity: no driver is double-linked (the unique index guarantees it; this proves the data).
select org_id, user_id, count(*)
from drivers
where user_id is not null
group by org_id, user_id
having count(*) > 1;   -- expect zero rows

-- Behavioural proof (allow + raw-PostgREST deny cases for every policy above) lives in the offline
-- matrix: `node supabase/tests/rls.test.mjs` — 50/50 green as of Phase 1.
