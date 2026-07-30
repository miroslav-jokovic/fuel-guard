-- 0085: driver loads — the loads / load_stops / load_stop_photos schema (Phase 3, D45 baseline).
--
-- The tables the app has been coded against since Phase 3 was scoped: a load with its ordered stops
-- and the per-stop photo evidence a driver captures. 0087 tightens the lifecycle on top of these
-- (changes the status default to `draft`, adds actor-timestamp columns, adds the guard trigger and
-- the `load_events` timeline); this migration lays down the columns those depend on.
--
-- Everything is org-scoped; every table has RLS enabled from day one. Driver visibility is granted
-- by RESTRICTIVE `_driver_scope` policies that 0087 later narrows to the subset of statuses a
-- driver may see (D45).

-- ═══════════════════════════════════════════════════════════════════════════════
-- loads
-- ═══════════════════════════════════════════════════════════════════════════════
create table if not exists loads (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references organizations(id) on delete cascade,

  -- Human-readable id — the freight bill / load number a driver sees on a rate confirmation. Unique
  -- per org (dispatch re-uses references from the TMS which are only unique inside a carrier).
  ref            text not null,

  -- Lifecycle. 0085 ships `offered` as default; 0087 changes it to `draft` (D45), because a load
  -- that lands driver-visible before human approval defeats the whole point of the gate.
  status         text not null default 'offered'
                   constraint loads_status_check check (status in (
                     'draft', 'pending_approval', 'approved',
                     'offered', 'accepted', 'in_transit', 'delivered', 'canceled'
                   )),

  -- The plan (D50 "load assignment" definition) — dispatch's intent, not necessarily what the
  -- driver actually rolls with. D47 flags mismatches, never overwrites.
  driver_id      uuid references drivers(id)  on delete set null,
  vehicle_id     uuid references vehicles(id) on delete set null,
  trailer_id     uuid references trailers(id) on delete set null,

  -- Load body — kept minimal here; 0087 adds the actor+timestamp columns for the lifecycle.
  equipment      text,                            -- 'Dry van' | 'Reefer' | 'Flatbed' | 'Bobtail' | …
  commodity      text,
  hazmat         boolean not null default false,
  total_miles    numeric(6,1),
  notes          text,

  -- Provenance. `manual` = created in the dispatch UI; `tms` = ingested by tmsIngest (D48).
  -- `external_id` unique per (org, provider) so a re-sync is idempotent.
  source         text not null default 'manual'
                   constraint loads_source_check check (source in ('manual', 'tms')),
  provider       text,
  external_id    text,

  -- Timestamps the app reads. `accepted_at` / `completed_at` are set by the driver flow;
  -- 0087 adds submitted_at / approved_at / released_at / assigned_at / declined_at / cancel_reason
  -- and the actor columns.
  accepted_at    timestamptz,
  completed_at   timestamptz,
  created_by     uuid references auth.users(id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

-- Uniqueness. `ref` is human-scoped per org; the (provider, external_id) key is TMS-scoped and only
-- applies to ingested rows.
create unique index if not exists idx_loads_org_ref
  on loads (org_id, ref);
create unique index if not exists idx_loads_provider_ext
  on loads (org_id, provider, external_id)
  where source = 'tms' and external_id is not null;

-- Access paths the queries in dispatchLoads.ts and driverLoads.ts hit hot.
create index if not exists idx_loads_org_status_created
  on loads (org_id, status, created_at desc);
create index if not exists idx_loads_org_driver_status
  on loads (org_id, driver_id, status)
  where driver_id is not null;

create trigger trg_loads_updated before update on loads
  for each row execute function set_updated_at();

alter table loads enable row level security;

-- Manager PERMISSIVE — the whole org, all statuses. Dispatch/admins get this by role.
drop policy if exists loads_select on loads;
create policy loads_select on loads for select
  using (org_id = auth_org_id());

drop policy if exists loads_write on loads;
create policy loads_write on loads for all
  using (org_id = auth_org_id() and auth_role() in ('admin', 'fleet_manager', 'dispatcher'))
  with check (org_id = auth_org_id() and auth_role() in ('admin', 'fleet_manager', 'dispatcher'));

-- Driver RESTRICTIVE — only your own loads. 0087 narrows this to the DRIVER_VISIBLE_STATUSES set
-- so a load in `draft` / `pending_approval` / `approved` never reaches a phone before human
-- approval + release (D45).
drop policy if exists loads_driver_scope on loads;
create policy loads_driver_scope on loads
  as restrictive for select
  using (
    auth_role() <> 'driver'
    or driver_id = auth_driver_id()
  );

-- Deny driver writes to loads outright — every driver action goes through a SECURITY DEFINER RPC
-- (0087) that writes a load_event in the same transaction. A raw PostgREST write would skip the
-- audit half.
drop policy if exists loads_driver_no_write on loads;
create policy loads_driver_no_write on loads
  as restrictive for insert
  with check (auth_role() <> 'driver');

drop policy if exists loads_driver_no_update on loads;
create policy loads_driver_no_update on loads
  as restrictive for update
  using (auth_role() <> 'driver');

-- ═══════════════════════════════════════════════════════════════════════════════
-- load_stops
-- ═══════════════════════════════════════════════════════════════════════════════
create table if not exists load_stops (
  id                 uuid primary key default gen_random_uuid(),
  org_id             uuid not null references organizations(id) on delete cascade,
  load_id            uuid not null references loads(id) on delete cascade,

  seq                integer not null check (seq >= 1 and seq <= 50),
  kind               text not null
                       constraint load_stops_kind_check check (kind in ('pickup', 'dropoff')),

  name               text not null,
  address_line       text,
  city               text,
  state              text,
  postal_code        text,
  lat                numeric(9,6) check (lat is null or (lat between -90  and 90)),
  lon                numeric(9,6) check (lon is null or (lon between -180 and 180)),

  appointment_start  timestamptz,
  appointment_end    timestamptz
                       check (appointment_end is null
                              or appointment_start is null
                              or appointment_end >= appointment_start),

  status             text not null default 'pending'
                       constraint load_stops_status_check check (status in (
                         'pending', 'arrived', 'completed', 'skipped'
                       )),
  arrived_at         timestamptz,
  completed_at       timestamptz,

  -- Named photo slots the driver must capture at this stop. `text[]` (rather than a lookup table)
  -- lets dispatch add a slot without a migration — the contract in `loadsContract.ts` labels the
  -- known ones and falls back to the raw value.
  required_photos    text[] not null default '{}',

  skip_reason        text,
  notes              text,

  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

-- One stop per (load, seq). Dispatch may replace the whole stop list; `replaceStops()` in
-- dispatchLoads.ts upserts on this exact conflict key.
create unique index if not exists idx_load_stops_load_seq
  on load_stops (load_id, seq);

create index if not exists idx_load_stops_org_load
  on load_stops (org_id, load_id);

create trigger trg_load_stops_updated before update on load_stops
  for each row execute function set_updated_at();

alter table load_stops enable row level security;

drop policy if exists load_stops_select on load_stops;
create policy load_stops_select on load_stops for select
  using (org_id = auth_org_id());

drop policy if exists load_stops_write on load_stops;
create policy load_stops_write on load_stops for all
  using (org_id = auth_org_id() and auth_role() in ('admin', 'fleet_manager', 'dispatcher'))
  with check (org_id = auth_org_id() and auth_role() in ('admin', 'fleet_manager', 'dispatcher'));

-- Driver visibility mirrors the parent load — only stops of loads the driver is on.
-- 0087 narrows this further via the parent's status predicate.
drop policy if exists load_stops_driver_scope on load_stops;
create policy load_stops_driver_scope on load_stops
  as restrictive for select
  using (
    auth_role() <> 'driver'
    or exists (
      select 1 from loads l
       where l.id = load_stops.load_id
         and l.driver_id = auth_driver_id()
    )
  );

-- Driver writes go through the `driver_complete_stop` RPC (0087). No direct writes.
drop policy if exists load_stops_driver_no_write on load_stops;
create policy load_stops_driver_no_write on load_stops
  as restrictive for insert
  with check (auth_role() <> 'driver');

drop policy if exists load_stops_driver_no_update on load_stops;
create policy load_stops_driver_no_update on load_stops
  as restrictive for update
  using (auth_role() <> 'driver');

-- ═══════════════════════════════════════════════════════════════════════════════
-- load_stop_photos
-- ═══════════════════════════════════════════════════════════════════════════════
-- The proof of work a driver captures at each stop. Row is small — the image lives in Supabase
-- Storage at `${org}/${driver}/${load}/${photoId}.${ext}` (see `stopPhotoPath` in
-- loadsContract.ts). The Storage bucket policy is added below.
create table if not exists load_stop_photos (
  id             uuid primary key,                          -- client UUID: idempotent replay
  org_id         uuid not null references organizations(id) on delete cascade,
  load_id        uuid not null references loads(id)         on delete cascade,
  stop_id        uuid not null references load_stops(id)    on delete cascade,
  driver_id      uuid references drivers(id) on delete set null,

  slot           text not null,                             -- 'trailer' | 'seal' | 'bol' | …
  storage_path   text not null,                             -- key inside the bucket
  captured_at    timestamptz,                               -- driver-clock time at capture (may lag upload by hours)
  uploaded_at    timestamptz not null default now()
);

create index if not exists idx_load_stop_photos_org_stop
  on load_stop_photos (org_id, stop_id);
create index if not exists idx_load_stop_photos_org_load
  on load_stop_photos (org_id, load_id);
create index if not exists idx_load_stop_photos_driver_uploaded
  on load_stop_photos (driver_id, uploaded_at desc)
  where driver_id is not null;

alter table load_stop_photos enable row level security;

drop policy if exists load_stop_photos_select on load_stop_photos;
create policy load_stop_photos_select on load_stop_photos for select
  using (org_id = auth_org_id());

drop policy if exists load_stop_photos_write on load_stop_photos;
create policy load_stop_photos_write on load_stop_photos for all
  using (org_id = auth_org_id() and auth_role() in ('admin', 'fleet_manager', 'dispatcher'))
  with check (org_id = auth_org_id() and auth_role() in ('admin', 'fleet_manager', 'dispatcher'));

drop policy if exists load_stop_photos_driver_scope on load_stop_photos;
create policy load_stop_photos_driver_scope on load_stop_photos
  as restrictive for select
  using (
    auth_role() <> 'driver'
    or driver_id = auth_driver_id()
  );

-- Driver INSERT is allowed here: the photo row is created by the same request that uploads the
-- image, and the RPC in 0087 (`driver_complete_stop`) writes it. A driver posting directly would
-- get through this policy, but the parent stop is still driver-locked and the RPC is the only path
-- that can actually complete the stop — so a rogue row would be an orphaned photo, not evidence.
drop policy if exists load_stop_photos_driver_insert on load_stop_photos;
create policy load_stop_photos_driver_insert on load_stop_photos
  as restrictive for insert
  with check (
    auth_role() <> 'driver'
    or (driver_id = auth_driver_id()
        and exists (
          select 1 from loads l
           where l.id = load_stop_photos.load_id
             and l.driver_id = auth_driver_id()
        ))
  );

-- ═══════════════════════════════════════════════════════════════════════════════
-- Storage bucket — the images themselves
-- ═══════════════════════════════════════════════════════════════════════════════
-- Path convention: `${org}/${driver}/${load}/${photoId}.${ext}`. Splitting on `/` gives:
--   [1] = org_id, [2] = driver_id, [3] = load_id, [4] = filename
-- The policies read those positions and match to the driver / org context.
insert into storage.buckets (id, name, public, file_size_limit)
values ('load-photos', 'load-photos', false, 15 * 1024 * 1024)          -- 15 MB per image
on conflict (id) do nothing;

-- Managers / dispatchers in the same org may read every photo.
drop policy if exists load_photos_manager_read on storage.objects;
create policy load_photos_manager_read on storage.objects for select
  using (
    bucket_id = 'load-photos'
    and (storage.foldername(name))[1]::uuid = auth_org_id()
    and auth_role() in ('admin', 'fleet_manager', 'dispatcher', 'auditor', 'safety_manager')
  );

-- A driver may read only their own folder.
drop policy if exists load_photos_driver_read on storage.objects;
create policy load_photos_driver_read on storage.objects for select
  using (
    bucket_id = 'load-photos'
    and (storage.foldername(name))[1]::uuid = auth_org_id()
    and (storage.foldername(name))[2]::uuid = auth_driver_id()
  );

-- A driver may write only into their own folder — enforces the path convention at the boundary.
drop policy if exists load_photos_driver_write on storage.objects;
create policy load_photos_driver_write on storage.objects for insert
  with check (
    bucket_id = 'load-photos'
    and (storage.foldername(name))[1]::uuid = auth_org_id()
    and (storage.foldername(name))[2]::uuid = auth_driver_id()
  );
