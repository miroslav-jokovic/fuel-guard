-- FuelGuard — 0086 duty sessions & equipment segments (Driver App, Phase 3A)
--
-- WHY THIS EXISTS (DRIVER-APP-PLAN.md §14.2b / §14.4, decisions D43 + D44 + D50).
-- Until now the app answered "what is this driver driving?" with `vehicles.assigned_driver_id` — a
-- STATIC column a fleet manager sets — and could not answer "which trailer?" at all, because
-- `trailers.assigned_vehicle_id` (0030) ties a trailer to a VEHICLE, never to a driver and never to a
-- point in time. Slip-seating, shop loaners, rentals and drop-and-hook were therefore unrepresentable,
-- and every fuel / idle / MPG attribution that leaned on that column was wrong until an admin edited a
-- row. `driver_vehicle_assignments` (0051) exists precisely because of this gap, and its
-- `driver_source` column ('direct' | 'inferred' | 'none') records how unreliable the Samsara inference
-- is.
--
-- SHAPE. A DUTY SESSION is one driver's shift. Within it, an EQUIPMENT SEGMENT records the truck and
-- trailer they were in over a half-open time window. Changing either closes the current segment and
-- opens a new one WITHOUT ending the shift — because drop-and-hook happens mid-shift, and a fuel
-- purchase at 14:10 must attribute to whatever trailer was hooked AT 14:10, not to whatever is hooked
-- at sign-off. That makes attribution an exact lookup:
--     where from_at <= t and (to_at is null or to_at > t)
-- which is the query the detection engine currently approximates from Samsara.
--
-- AUTHORIZATION (D10, unchanged posture). Org members read; dispatch-capable roles write; drivers get
-- a RESTRICTIVE read scope to their OWN rows and have NO write policy at all. Every driver write goes
-- through the driver-scoped API, which server-derives `driver_id` from the verified JWT. The driver
-- app ships the anon key + a driver JWT, so the DATABASE is the authorization boundary.
--
-- ALSO CLOSES THREE PRE-EXISTING LEAKS (plan §14.2b finding F4). `0084` scoped drivers, vehicles,
-- fuel_transactions, driver_performance_weeks, anomalies, memberships and thresholds — but NOT
-- `trailers` (0030), `driver_time_off` (0068) or `tms_movements` (0068), all of which are plain
-- `select using (org_id = auth_org_id())`. A driver JWT hitting PostgREST today reads every trailer in
-- the fleet, every driver's home-time, and every TMS movement. Fixed at the bottom of this file.
--
-- ADDITIVE. No existing table or column is dropped or narrowed. Two policies are REPLACED
-- (`vehicles_driver_scope`, widened — a driver must be able to read the truck they slip-seated into)
-- using the established drop-then-create pattern (see 0078).

-- ── org setting: when does an abandoned shift auto-close? ─────────────────────
-- REQUIRED by D44.5, not a nicety: the partial unique index below makes a truck exclusive to its
-- current holder, so without an auto-close the first driver who forgets to sign off locks that unit
-- out of the fleet forever. Default 16h ≈ the HOS on-duty maximum plus margin.
alter table organizations
  add column if not exists duty_session_timeout_hours integer not null default 16;
do $$
begin
  alter table organizations
    add constraint organizations_duty_timeout_check
    check (duty_session_timeout_hours between 1 and 168);
exception
  when duplicate_object then null;
end $$;

-- ── driver_duty_sessions ──────────────────────────────────────────────────────
-- `id` is the CLIENT-generated UUID from the outbox: replaying a queued check-in collides on the
-- primary key and no-ops instead of opening a second shift (the idempotency contract, plan §13.3).
create table if not exists driver_duty_sessions (
  id             uuid primary key,                              -- client UUID — NOT auto-generated
  org_id         uuid not null references organizations(id) on delete cascade,
  driver_id      uuid not null references drivers(id) on delete cascade,
  started_at     timestamptz not null default now(),
  ended_at       timestamptz,                                   -- null = ACTIVE
  ended_reason   text,                                          -- driver | taken_over | auto_timeout | dispatch
  start_odometer numeric(10, 1),                                -- anchors MPG / idle basis for the shift
  end_odometer   numeric(10, 1),
  start_lat      numeric(9, 6),
  start_lon      numeric(9, 6),
  device_id      text,
  source         text not null default 'driver_app',            -- driver_app | dispatch | telematics
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint duty_sessions_source_check
    check (source in ('driver_app', 'dispatch', 'telematics')),
  constraint duty_sessions_end_reason_check
    check (ended_reason is null or ended_reason in ('driver', 'taken_over', 'auto_timeout', 'dispatch')),
  constraint duty_sessions_window_check
    check (ended_at is null or ended_at >= started_at),
  -- An ended session always says WHY. Auto-closes must stay distinguishable from real sign-offs, or
  -- they quietly pollute every attribution analysis built on this table.
  constraint duty_sessions_end_paired_check
    check ((ended_at is null) = (ended_reason is null))
);

-- One open shift per driver. A driver cannot be on duty twice.
create unique index if not exists uq_duty_session_active
  on driver_duty_sessions (org_id, driver_id) where ended_at is null;
create index if not exists idx_duty_sessions_driver
  on driver_duty_sessions (org_id, driver_id, started_at desc);
-- The dispatch "who is on duty right now" board (plan §14.9).
create index if not exists idx_duty_sessions_open
  on driver_duty_sessions (org_id, started_at desc) where ended_at is null;

-- ── duty_equipment_segments ───────────────────────────────────────────────────
-- Also client-UUID keyed, for the same replay reason.
--
-- FK note: `on delete restrict` on both equipment columns is deliberate. Duty history is evidence —
-- a vehicle or trailer that a driver actually operated cannot be erased out from under it. Retire
-- equipment with its `status` column instead of deleting the row. (`on delete set null` would be
-- actively wrong for trailers, where null already MEANS "bobtail": deleting a trailer would silently
-- rewrite history to say the driver was running empty.)
create table if not exists duty_equipment_segments (
  id           uuid primary key,                                -- client UUID — NOT auto-generated
  org_id       uuid not null references organizations(id) on delete cascade,
  session_id   uuid not null references driver_duty_sessions(id) on delete cascade,
  driver_id    uuid not null references drivers(id) on delete cascade,  -- denormalized: RLS + attribution read it directly
  vehicle_id   uuid not null references vehicles(id) on delete restrict,
  trailer_id   uuid references trailers(id) on delete restrict, -- null = bobtail / not hooked yet
  seat         text not null default 'driver',                  -- driver | co_driver (team operation)
  from_at      timestamptz not null default now(),
  to_at        timestamptz,                                     -- null = CURRENT
  confirmed_by text not null default 'driver',                  -- driver | dispatch
  note         text,
  created_at   timestamptz not null default now(),
  constraint duty_seg_seat_check check (seat in ('driver', 'co_driver')),
  constraint duty_seg_confirmed_by_check check (confirmed_by in ('driver', 'dispatch')),
  constraint duty_seg_window_check check (to_at is null or to_at >= from_at)
);

-- One current segment per session — a driver is in exactly one truck at a time.
create unique index if not exists uq_duty_seg_current
  on duty_equipment_segments (session_id) where to_at is null;

-- THE constraint that keeps attribution honest: one seated driver per truck, and per trailer, right
-- now. Enforced by the database, so there is no application-level race window in which two drivers
-- both believe they have Unit 214. `seat = 'driver'` scopes it so team operation (a co-driver sharing
-- the same truck and trailer) stays representable without weakening the rule.
create unique index if not exists uq_duty_seg_vehicle_in_use
  on duty_equipment_segments (org_id, vehicle_id)
  where to_at is null and seat = 'driver';
create unique index if not exists uq_duty_seg_trailer_in_use
  on duty_equipment_segments (org_id, trailer_id)
  where to_at is null and seat = 'driver' and trailer_id is not null;

-- Attribution lookups: "who/what was on this asset at time t".
create index if not exists idx_duty_seg_vehicle_time
  on duty_equipment_segments (org_id, vehicle_id, from_at desc);
create index if not exists idx_duty_seg_driver_time
  on duty_equipment_segments (org_id, driver_id, from_at desc);
create index if not exists idx_duty_seg_trailer_time
  on duty_equipment_segments (org_id, trailer_id, from_at desc) where trailer_id is not null;
create index if not exists idx_duty_seg_session
  on duty_equipment_segments (session_id, from_at);

-- ── RLS ───────────────────────────────────────────────────────────────────────
alter table driver_duty_sessions enable row level security;
alter table duty_equipment_segments enable row level security;

-- PERMISSIVE: every org member may read their tenant's duty data (dispatch board, auditors, and the
-- attribution paths that will prefer it over Samsara inference — plan §17.3).
drop policy if exists duty_sessions_select on driver_duty_sessions;
create policy duty_sessions_select on driver_duty_sessions for select using (org_id = auth_org_id());

drop policy if exists duty_segments_select on duty_equipment_segments;
create policy duty_segments_select on duty_equipment_segments for select using (org_id = auth_org_id());

-- PERMISSIVE writes: dispatch-capable roles only (they can correct a bad check-in or close a stuck
-- session from the Assignments board). Drivers are deliberately absent — their writes go through the
-- driver-scoped API, which server-derives driver_id from the JWT.
drop policy if exists duty_sessions_write on driver_duty_sessions;
create policy duty_sessions_write on driver_duty_sessions for all
  using (org_id = auth_org_id() and auth_role() in ('admin', 'fleet_manager', 'dispatcher'))
  with check (org_id = auth_org_id() and auth_role() in ('admin', 'fleet_manager', 'dispatcher'));

drop policy if exists duty_segments_write on duty_equipment_segments;
create policy duty_segments_write on duty_equipment_segments for all
  using (org_id = auth_org_id() and auth_role() in ('admin', 'fleet_manager', 'dispatcher'))
  with check (org_id = auth_org_id() and auth_role() in ('admin', 'fleet_manager', 'dispatcher'));

-- RESTRICTIVE (AND-combined): a driver sees ONLY their own duty history. Managers are unaffected —
-- the predicate short-circuits for any non-driver role.
drop policy if exists duty_sessions_driver_scope on driver_duty_sessions;
create policy duty_sessions_driver_scope on driver_duty_sessions as restrictive
  for select using (auth_role() <> 'driver' or driver_id = auth_driver_id());

drop policy if exists duty_segments_driver_scope on duty_equipment_segments;
create policy duty_segments_driver_scope on duty_equipment_segments as restrictive
  for select using (auth_role() <> 'driver' or driver_id = auth_driver_id());

-- ── vehicles: widen the driver scope to the truck they actually checked into ──
-- 0084 scoped a driver to `assigned_driver_id` only. Under D43 that column is a DEFAULT (the truck
-- pinned as "Your truck" in the picker), not the truth — so a driver who slip-seats into another unit
-- would lose the ability to read the row Home renders. Adds the current-segment vehicle; keeps every
-- other restriction intact.
drop policy if exists vehicles_driver_scope on vehicles;
create policy vehicles_driver_scope on vehicles as restrictive
  for select using (
    auth_role() <> 'driver'
    or assigned_driver_id = auth_driver_id()
    or exists (
      select 1 from public.duty_equipment_segments s
      where s.vehicle_id = vehicles.id
        and s.driver_id = public.auth_driver_id()
        and s.to_at is null
    )
  );

-- ── F4a — trailers: a driver reads only trailers they have actually operated ──
-- Was `select using (org_id = auth_org_id())` since 0030, i.e. the entire trailer roster. The PICKER
-- does not read this table: it comes from `GET /api/me/equipment` (service role, minimal projection),
-- precisely so RLS can stay closed here.
drop policy if exists trailers_driver_scope on trailers;
create policy trailers_driver_scope on trailers as restrictive
  for select using (
    auth_role() <> 'driver'
    or exists (
      select 1 from public.duty_equipment_segments s
      where s.trailer_id = trailers.id
        and s.driver_id = public.auth_driver_id()
    )
  );

-- ── F4b/F4c — TMS tables (0068): drivers get their own time-off, no movements ─
-- Both were org-wide selects, exposing every colleague's home-time and the whole movement history.
do $$
begin
  if to_regclass('public.driver_time_off') is not null then
    drop policy if exists driver_time_off_driver_scope on driver_time_off;
    create policy driver_time_off_driver_scope on driver_time_off as restrictive
      for select using (auth_role() <> 'driver' or driver_id = auth_driver_id());
  end if;
  if to_regclass('public.tms_movements') is not null then
    drop policy if exists tms_movements_driver_deny on tms_movements;
    create policy tms_movements_driver_deny on tms_movements as restrictive
      for select using (auth_role() <> 'driver');
  end if;
end $$;

-- ═════════════════════════════════════════════════════════════════════════════
-- Atomic duty mutations (called by the driver-scoped API with the service role).
--
-- These are functions and not two supabase-js calls because opening a shift writes a session AND its
-- first segment, and a take-over closes someone ELSE's row in the same breath. supabase-js cannot span
-- a transaction, so a two-step insert would leave orphan sessions whenever the second call failed.
-- Conflicts raise custom SQLSTATEs the API maps straight to HTTP:
--     DG001 vehicle in use · DG002 trailer in use · DG003 shift already open
--     DG004 no active shift · DG005 equipment not found in this org
-- ═════════════════════════════════════════════════════════════════════════════

create or replace function start_duty_session(
  p_org        uuid,
  p_driver     uuid,
  p_session    uuid,
  p_segment    uuid,
  p_vehicle    uuid,
  p_trailer    uuid    default null,
  p_odometer   numeric default null,
  p_started_at timestamptz default null,
  p_device_id  text    default null,
  p_take_over  boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_started timestamptz := coalesce(p_started_at, now());
  v_open    uuid;
  v_holder  uuid;
  v_unit    text;
begin
  -- Idempotent replay of a queued offline check-in: same client UUID → return, do not re-open.
  if exists (select 1 from public.driver_duty_sessions where id = p_session) then
    return p_session;
  end if;

  -- Equipment must belong to this tenant. Checked explicitly so the caller gets DG005 rather than a
  -- raw FK violation.
  if not exists (select 1 from public.vehicles v where v.id = p_vehicle and v.org_id = p_org) then
    raise exception 'vehicle not found in org' using errcode = 'DG005';
  end if;
  if p_trailer is not null
     and not exists (select 1 from public.trailers t where t.id = p_trailer and t.org_id = p_org) then
    raise exception 'trailer not found in org' using errcode = 'DG005';
  end if;

  -- One open shift per driver (the index enforces it; this raises the precise code first).
  select id into v_open
  from public.driver_duty_sessions
  where org_id = p_org and driver_id = p_driver and ended_at is null;
  if v_open is not null then
    raise exception 'shift already open: %', v_open using errcode = 'DG003';
  end if;

  -- Vehicle held by someone else? Take-over ends THEIR shift (they are no longer in a truck), which
  -- is the honest reading of "someone else got in this unit". Never silent — the caller must have
  -- passed p_take_over after showing the driver who holds it and since when (D44.6).
  select s.driver_id into v_holder
  from public.duty_equipment_segments s
  where s.org_id = p_org and s.vehicle_id = p_vehicle and s.to_at is null and s.seat = 'driver';
  if v_holder is not null then
    if not p_take_over then
      select unit_number into v_unit from public.vehicles where id = p_vehicle;
      raise exception 'vehicle % in use by driver %', coalesce(v_unit, '?'), v_holder using errcode = 'DG001';
    end if;
    update public.duty_equipment_segments set to_at = v_started
      where org_id = p_org and vehicle_id = p_vehicle and to_at is null and seat = 'driver';
    update public.driver_duty_sessions
      set ended_at = v_started, ended_reason = 'taken_over', updated_at = now()
      where org_id = p_org and driver_id = v_holder and ended_at is null;
  end if;

  -- Trailer held by someone else? Take-over drops it from THEIR segment (a trailer swap does not end
  -- their shift — they simply no longer have that box) by closing the segment and reopening it bare.
  if p_trailer is not null then
    v_holder := null;
    select s.driver_id into v_holder
    from public.duty_equipment_segments s
    where s.org_id = p_org and s.trailer_id = p_trailer and s.to_at is null and s.seat = 'driver';
    if v_holder is not null then
      if not p_take_over then
        select unit_number into v_unit from public.trailers where id = p_trailer;
        raise exception 'trailer % in use by driver %', coalesce(v_unit, '?'), v_holder using errcode = 'DG002';
      end if;
      insert into public.duty_equipment_segments
        (id, org_id, session_id, driver_id, vehicle_id, trailer_id, seat, from_at, confirmed_by, note)
      select gen_random_uuid(), s.org_id, s.session_id, s.driver_id, s.vehicle_id, null, s.seat,
             v_started, 'dispatch', 'trailer taken over'
      from public.duty_equipment_segments s
      where s.org_id = p_org and s.trailer_id = p_trailer and s.to_at is null and s.seat = 'driver';
      update public.duty_equipment_segments set to_at = v_started
        where org_id = p_org and trailer_id = p_trailer and to_at is null and seat = 'driver'
          and from_at < v_started;
    end if;
  end if;

  insert into public.driver_duty_sessions
    (id, org_id, driver_id, started_at, start_odometer, device_id, source)
  values
    (p_session, p_org, p_driver, v_started, p_odometer, p_device_id, 'driver_app');

  insert into public.duty_equipment_segments
    (id, org_id, session_id, driver_id, vehicle_id, trailer_id, from_at, confirmed_by)
  values
    (p_segment, p_org, p_session, p_driver, p_vehicle, p_trailer, v_started, 'driver');

  return p_session;
end;
$$;

create or replace function change_duty_equipment(
  p_org     uuid,
  p_driver  uuid,
  p_segment uuid,
  p_vehicle uuid    default null,   -- null = keep the current truck
  p_trailer uuid    default null,   -- see p_clear_trailer
  p_clear_trailer boolean default false,  -- true = dropped the trailer (bobtail)
  p_from_at timestamptz default null,
  p_note    text    default null,
  p_take_over boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_from    timestamptz := coalesce(p_from_at, now());
  v_session uuid;
  v_cur     public.duty_equipment_segments%rowtype;
  v_vehicle uuid;
  v_trailer uuid;
  v_holder  uuid;
  v_unit    text;
begin
  -- Idempotent replay of a queued swap.
  if exists (select 1 from public.duty_equipment_segments where id = p_segment) then
    return p_segment;
  end if;

  select id into v_session
  from public.driver_duty_sessions
  where org_id = p_org and driver_id = p_driver and ended_at is null;
  if v_session is null then
    raise exception 'no active shift' using errcode = 'DG004';
  end if;

  select * into v_cur
  from public.duty_equipment_segments
  where session_id = v_session and to_at is null;

  v_vehicle := coalesce(p_vehicle, v_cur.vehicle_id);
  v_trailer := case when p_clear_trailer then null else coalesce(p_trailer, v_cur.trailer_id) end;

  if not exists (select 1 from public.vehicles v where v.id = v_vehicle and v.org_id = p_org) then
    raise exception 'vehicle not found in org' using errcode = 'DG005';
  end if;
  if v_trailer is not null
     and not exists (select 1 from public.trailers t where t.id = v_trailer and t.org_id = p_org) then
    raise exception 'trailer not found in org' using errcode = 'DG005';
  end if;

  -- Nothing actually changed — don't write a segment that says the same thing twice.
  if v_vehicle = v_cur.vehicle_id and v_trailer is not distinct from v_cur.trailer_id then
    return v_cur.id;
  end if;

  if v_vehicle <> v_cur.vehicle_id then
    select s.driver_id into v_holder
    from public.duty_equipment_segments s
    where s.org_id = p_org and s.vehicle_id = v_vehicle and s.to_at is null and s.seat = 'driver';
    if v_holder is not null then
      if not p_take_over then
        select unit_number into v_unit from public.vehicles where id = v_vehicle;
        raise exception 'vehicle % in use by driver %', coalesce(v_unit, '?'), v_holder using errcode = 'DG001';
      end if;
      update public.duty_equipment_segments set to_at = v_from
        where org_id = p_org and vehicle_id = v_vehicle and to_at is null and seat = 'driver';
      update public.driver_duty_sessions
        set ended_at = v_from, ended_reason = 'taken_over', updated_at = now()
        where org_id = p_org and driver_id = v_holder and ended_at is null;
    end if;
  end if;

  if v_trailer is not null and v_trailer is distinct from v_cur.trailer_id then
    v_holder := null;
    select s.driver_id into v_holder
    from public.duty_equipment_segments s
    where s.org_id = p_org and s.trailer_id = v_trailer and s.to_at is null and s.seat = 'driver';
    if v_holder is not null then
      if not p_take_over then
        select unit_number into v_unit from public.trailers where id = v_trailer;
        raise exception 'trailer % in use by driver %', coalesce(v_unit, '?'), v_holder using errcode = 'DG002';
      end if;
      update public.duty_equipment_segments set to_at = v_from
        where org_id = p_org and trailer_id = v_trailer and to_at is null and seat = 'driver';
    end if;
  end if;

  update public.duty_equipment_segments set to_at = v_from where id = v_cur.id;

  insert into public.duty_equipment_segments
    (id, org_id, session_id, driver_id, vehicle_id, trailer_id, seat, from_at, confirmed_by, note)
  values
    (p_segment, p_org, v_session, p_driver, v_vehicle, v_trailer, v_cur.seat, v_from, 'driver', p_note);

  update public.driver_duty_sessions set updated_at = now() where id = v_session;
  return p_segment;
end;
$$;

create or replace function end_duty_session(
  p_org      uuid,
  p_driver   uuid,
  p_ended_at timestamptz default null,
  p_odometer numeric default null,
  p_reason   text default 'driver'
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ended   timestamptz := coalesce(p_ended_at, now());
  v_session uuid;
begin
  select id into v_session
  from public.driver_duty_sessions
  where org_id = p_org and driver_id = p_driver and ended_at is null;
  -- Idempotent: ending an already-ended shift is a no-op for the caller, not an error, because an
  -- offline sign-off may drain twice.
  if v_session is null then
    return null;
  end if;

  update public.duty_equipment_segments
    set to_at = greatest(v_ended, from_at)
    where session_id = v_session and to_at is null;

  update public.driver_duty_sessions
    set ended_at = greatest(v_ended, started_at),
        ended_reason = p_reason,
        end_odometer = coalesce(p_odometer, end_odometer),
        updated_at = now()
    where id = v_session;

  return v_session;
end;
$$;

-- The D44.5 sweeper. Closes shifts idle past the org's threshold with a DISTINGUISHABLE reason, so
-- an auto-close never masquerades as a driver sign-off in attribution analysis. Called on an interval
-- by the API's scheduler; safe to run concurrently (it only touches rows already past the cutoff).
create or replace function close_stale_duty_sessions()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_closed integer := 0;
  r record;
begin
  for r in
    select s.id, s.started_at, o.duty_session_timeout_hours as hrs
    from public.driver_duty_sessions s
    join public.organizations o on o.id = s.org_id
    where s.ended_at is null
      and s.started_at < now() - make_interval(hours => o.duty_session_timeout_hours)
  loop
    update public.duty_equipment_segments
      set to_at = greatest(now(), from_at)
      where session_id = r.id and to_at is null;
    update public.driver_duty_sessions
      set ended_at = now(), ended_reason = 'auto_timeout', updated_at = now()
      where id = r.id;
    v_closed := v_closed + 1;
  end loop;
  return v_closed;
end;
$$;
