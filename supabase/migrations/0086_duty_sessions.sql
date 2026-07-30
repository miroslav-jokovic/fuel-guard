-- 0086: duty sessions & equipment segments (Phase 3A, decisions D43/D44/D50).
--
-- "Equipment truth is a time-ranged duty session, not a column" (D43). A driver checks in with a
-- truck (and optionally a trailer) and every subsequent swap writes a new segment. Attribution of
-- fuel / idle / MPG at any instant is then a `where from_at <= t and (to_at is null or to_at > t)`
-- lookup — exact, rather than the "current pin" the schema modelled before, which quietly
-- mis-attributed a slip-seat or a shop loaner until an admin edited a row.
--
-- Terminology (D50): `vehicles.assigned_driver_id` = domicile default, `driver_vehicle_assignments`
-- (0051) = Samsara-inferred history (kept, non-truth-source), and THIS file's `driver_duty_sessions`
-- + `duty_equipment_segments` = the authoritative record.
--
-- The staged soft gate (D44): vehicle required, trailer optional at check-in; a trailer is only
-- required at the moment a trailer-equipment pickup is completed. The sweeper `close_stale_duty_
-- sessions` prevents the exclusive-vehicle index from jamming on the first driver who forgets to
-- sign off — without it, take-over is the only recovery, which is exactly the corruption D44 was
-- built to avoid.

-- ═══════════════════════════════════════════════════════════════════════════════
-- organization default for the timeout
-- ═══════════════════════════════════════════════════════════════════════════════
alter table organizations
  add column if not exists duty_session_timeout_hours integer not null default 16
    check (duty_session_timeout_hours between 4 and 48);

comment on column organizations.duty_session_timeout_hours is
  'How long a driver can be checked in before close_stale_duty_sessions() auto-signs them off
   with ended_reason=auto_timeout. Default 16h — long enough to cover a legal split-sleep day,
   short enough that a forgotten check-in does not lock a truck out for a week.';

-- ═══════════════════════════════════════════════════════════════════════════════
-- driver_duty_sessions
-- ═══════════════════════════════════════════════════════════════════════════════
create table if not exists driver_duty_sessions (
  id             uuid primary key,                          -- client UUID (idempotent offline replay)
  org_id         uuid not null references organizations(id) on delete cascade,
  driver_id      uuid not null references drivers(id)       on delete cascade,

  started_at     timestamptz not null default now(),
  ended_at       timestamptz,
  ended_reason   text
                   constraint duty_end_reason_check check (ended_reason is null or ended_reason in (
                     'driver', 'taken_over', 'auto_timeout', 'dispatch'
                   )),

  start_odometer numeric(8,1) check (start_odometer is null or start_odometer >= 0),
  end_odometer   numeric(8,1) check (end_odometer   is null or end_odometer   >= 0),

  source         text not null default 'driver_app'
                   constraint duty_source_check check (source in (
                     'driver_app', 'dispatch', 'telematics'
                   )),

  device_id      text,

  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),

  constraint duty_sessions_end_after_start check (ended_at is null or ended_at >= started_at)
);

-- ONE open shift per driver. Partial-unique so closed shifts do not conflict.
create unique index if not exists idx_duty_sessions_one_open_per_driver
  on driver_duty_sessions (driver_id)
  where ended_at is null;

create index if not exists idx_duty_sessions_org_started
  on driver_duty_sessions (org_id, started_at desc);

drop trigger if exists trg_duty_sessions_updated on driver_duty_sessions;
create trigger trg_duty_sessions_updated before update on driver_duty_sessions
  for each row execute function set_updated_at();

alter table driver_duty_sessions enable row level security;

drop policy if exists duty_sessions_select on driver_duty_sessions;
create policy duty_sessions_select on driver_duty_sessions for select
  using (org_id = auth_org_id());

-- Writes only via the RPCs below. Even manager UI ends a shift via `end_duty_session()` so the
-- action is recorded uniformly.
drop policy if exists duty_sessions_manager_write on driver_duty_sessions;
create policy duty_sessions_manager_write on driver_duty_sessions for all
  using (org_id = auth_org_id() and auth_role() in ('admin', 'fleet_manager', 'dispatcher'))
  with check (org_id = auth_org_id() and auth_role() in ('admin', 'fleet_manager', 'dispatcher'));

-- Driver visibility: only their own shifts. Driver writes go through the RPCs only.
drop policy if exists duty_sessions_driver_scope on driver_duty_sessions;
create policy duty_sessions_driver_scope on driver_duty_sessions
  as restrictive for select
  using (
    auth_role() <> 'driver'
    or driver_id = auth_driver_id()
  );

drop policy if exists duty_sessions_driver_no_write on driver_duty_sessions;
create policy duty_sessions_driver_no_write on driver_duty_sessions
  as restrictive for insert
  with check (auth_role() <> 'driver');

drop policy if exists duty_sessions_driver_no_update on driver_duty_sessions;
create policy duty_sessions_driver_no_update on driver_duty_sessions
  as restrictive for update
  using (auth_role() <> 'driver');

-- ═══════════════════════════════════════════════════════════════════════════════
-- duty_equipment_segments
-- ═══════════════════════════════════════════════════════════════════════════════
-- One row per (session, truck / trailer configuration). Half-open `[from_at, to_at)` so
-- back-to-back segments never both match a changeover instant. `to_at IS NULL` means the segment
-- is CURRENT.
create table if not exists duty_equipment_segments (
  id             uuid primary key,                          -- client UUID
  org_id         uuid not null references organizations(id) on delete cascade,
  session_id     uuid not null references driver_duty_sessions(id) on delete cascade,

  vehicle_id     uuid not null references vehicles(id) on delete restrict,
  trailer_id     uuid          references trailers(id) on delete set null,

  -- 'driver' | 'co_driver' — keeps team driving representable while the exclusive-truck index
  -- still fires on the *driver* seat.
  seat           text not null default 'driver'
                   constraint duty_seat_check check (seat in ('driver', 'co_driver')),

  from_at        timestamptz not null default now(),
  to_at          timestamptz check (to_at is null or to_at >= from_at),

  -- Who confirmed this segment: the driver at check-in, or dispatch overriding.
  confirmed_by   text not null default 'driver'
                   constraint duty_confirmed_by_check check (confirmed_by in ('driver', 'dispatch')),

  note           text,

  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

-- Exactly one *driver*-seat holder per truck at a time.
create unique index if not exists idx_duty_segments_one_driver_per_vehicle
  on duty_equipment_segments (vehicle_id)
  where to_at is null and seat = 'driver';

-- Exactly one holder per trailer at a time (any seat — a trailer only has one hooked truck).
create unique index if not exists idx_duty_segments_one_holder_per_trailer
  on duty_equipment_segments (trailer_id)
  where to_at is null and trailer_id is not null;

-- Attribution lookup path.
create index if not exists idx_duty_segments_session_from
  on duty_equipment_segments (session_id, from_at desc);
create index if not exists idx_duty_segments_org_from
  on duty_equipment_segments (org_id, from_at desc);
create index if not exists idx_duty_segments_vehicle_from
  on duty_equipment_segments (vehicle_id, from_at desc);

drop trigger if exists trg_duty_segments_updated on duty_equipment_segments;
create trigger trg_duty_segments_updated before update on duty_equipment_segments
  for each row execute function set_updated_at();

alter table duty_equipment_segments enable row level security;

drop policy if exists duty_segments_select on duty_equipment_segments;
create policy duty_segments_select on duty_equipment_segments for select
  using (org_id = auth_org_id());

drop policy if exists duty_segments_manager_write on duty_equipment_segments;
create policy duty_segments_manager_write on duty_equipment_segments for all
  using (org_id = auth_org_id() and auth_role() in ('admin', 'fleet_manager', 'dispatcher'))
  with check (org_id = auth_org_id() and auth_role() in ('admin', 'fleet_manager', 'dispatcher'));

drop policy if exists duty_segments_driver_scope on duty_equipment_segments;
create policy duty_segments_driver_scope on duty_equipment_segments
  as restrictive for select
  using (
    auth_role() <> 'driver'
    or exists (
      select 1 from driver_duty_sessions s
       where s.id = duty_equipment_segments.session_id
         and s.driver_id = auth_driver_id()
    )
  );

drop policy if exists duty_segments_driver_no_write on duty_equipment_segments;
create policy duty_segments_driver_no_write on duty_equipment_segments
  as restrictive for insert
  with check (auth_role() <> 'driver');

drop policy if exists duty_segments_driver_no_update on duty_equipment_segments;
create policy duty_segments_driver_no_update on duty_equipment_segments
  as restrictive for update
  using (auth_role() <> 'driver');

-- Add the duty-segment path to the vehicle driver scope introduced in 0083. A driver now sees a
-- vehicle if it is their domicile pin OR is the truck of their current open segment.
drop policy if exists vehicles_driver_scope on vehicles;
create policy vehicles_driver_scope on vehicles
  as restrictive for select
  using (
    auth_role() <> 'driver'
    or assigned_driver_id = auth_driver_id()
    or exists (
      select 1
        from duty_equipment_segments seg
        join driver_duty_sessions s on s.id = seg.session_id
       where seg.vehicle_id = vehicles.id
         and seg.to_at is null
         and s.driver_id = auth_driver_id()
         and s.ended_at is null
    )
  );

-- Same story for trailers — a driver may see the trailer they are currently pulling.
drop policy if exists trailers_driver_scope on trailers;
create policy trailers_driver_scope on trailers
  as restrictive for select
  using (
    auth_role() <> 'driver'
    or exists (
      select 1
        from duty_equipment_segments seg
        join driver_duty_sessions s on s.id = seg.session_id
       where seg.trailer_id = trailers.id
         and seg.to_at is null
         and s.driver_id = auth_driver_id()
         and s.ended_at is null
    )
  );

-- ═══════════════════════════════════════════════════════════════════════════════
-- RPCs — every mutation is one transaction (check-in / take-over / swap / end)
-- ═══════════════════════════════════════════════════════════════════════════════
-- These are the ONLY write paths for drivers, and dispatch uses them too so behaviour is uniform.
-- SECURITY DEFINER: they insert with authoritative timestamps and bypass the driver_no_write
-- RESTRICTIVE policy above. All arg names are prefixed `p_` to avoid shadowing column names.
--
-- Each function is preceded by a DROP FUNCTION IF EXISTS with its exact signature. `CREATE OR
-- REPLACE FUNCTION` cannot change a parameter NAME on an existing function (Postgres 42P13); the
-- explicit drop makes the migration safe to re-run even if a prior partial apply left a slightly
-- different signature behind.

-- ── start_duty_session ────────────────────────────────────────────────────────
-- Opens the shift AND writes the first equipment segment in one transaction. `p_take_over`, when
-- true, forcibly closes any prior segment holding the requested truck (`ended_reason=taken_over`
-- on the losing session if it becomes empty) — the caller must have shown the "who has this"
-- 409 dialog first (D44.6). When false, a conflict returns error code DL020.
drop function if exists start_duty_session(uuid,uuid,uuid,uuid,uuid,uuid,numeric,timestamptz,text,boolean,text);
create or replace function start_duty_session(
  p_org         uuid,
  p_driver      uuid,
  p_session_id  uuid,
  p_segment_id  uuid,
  p_vehicle     uuid,
  p_trailer     uuid          default null,
  p_odometer    numeric       default null,
  p_started_at  timestamptz   default null,
  p_device_id   text          default null,
  p_take_over   boolean       default false,
  p_confirmed_by text         default 'driver'
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := coalesce(p_started_at, now());
  v_conflict_session uuid;
begin
  -- Idempotency: replaying the same client UUID returns the existing session_id.
  if exists (select 1 from public.driver_duty_sessions where id = p_session_id) then
    return p_session_id;
  end if;

  -- Refuse if this driver already has an open shift (unless we're replaying the same session_id).
  if exists (
    select 1 from public.driver_duty_sessions
     where driver_id = p_driver and ended_at is null
  ) then
    raise exception 'shift_already_open' using errcode = 'DL020';
  end if;

  -- Truck-conflict handling — the D44.6 flow.
  select s.id into v_conflict_session
    from public.duty_equipment_segments seg
    join public.driver_duty_sessions s on s.id = seg.session_id
   where seg.vehicle_id = p_vehicle
     and seg.to_at is null
     and seg.seat = 'driver'
     and s.ended_at is null;

  if v_conflict_session is not null then
    if not p_take_over then
      raise exception 'vehicle_in_use' using errcode = 'DL021';
    end if;
    -- Take-over path: close the losing segment and end its session if it is now empty.
    update public.duty_equipment_segments
       set to_at = v_now, updated_at = v_now
     where session_id = v_conflict_session and to_at is null;
    update public.driver_duty_sessions
       set ended_at = v_now, ended_reason = 'taken_over', updated_at = v_now
     where id = v_conflict_session and ended_at is null;
  end if;

  -- Trailer conflict — same shape, no take-over path required (a trailer is a passive asset;
  -- taking the truck brings the trailer with it in almost every real case, and dispatch handles
  -- the rare exception manually).
  if p_trailer is not null and exists (
    select 1 from public.duty_equipment_segments seg
    join public.driver_duty_sessions s on s.id = seg.session_id
    where seg.trailer_id = p_trailer and seg.to_at is null and s.ended_at is null
  ) then
    raise exception 'trailer_in_use' using errcode = 'DL022';
  end if;

  insert into public.driver_duty_sessions (
    id, org_id, driver_id, started_at, start_odometer, source, device_id
  ) values (
    p_session_id, p_org, p_driver, v_now, p_odometer, 'driver_app', p_device_id
  );

  insert into public.duty_equipment_segments (
    id, org_id, session_id, vehicle_id, trailer_id, seat, from_at, confirmed_by
  ) values (
    p_segment_id, p_org, p_session_id, p_vehicle, p_trailer, 'driver', v_now, p_confirmed_by
  );

  return p_session_id;
end;
$$;

comment on function start_duty_session(uuid,uuid,uuid,uuid,uuid,uuid,numeric,timestamptz,text,boolean,text) is
  'Opens a duty session + its first equipment segment in one transaction. Idempotent on
   p_session_id. Raises DL020/DL021/DL022 for the three conflict shapes.';

-- ── change_duty_equipment ─────────────────────────────────────────────────────
-- Closes the current segment (`to_at = now()`) and opens a new one WITHOUT ending the shift.
-- Called for a truck swap, a trailer hook / drop, or both together.
drop function if exists change_duty_equipment(uuid,uuid,uuid,uuid,uuid,boolean,timestamptz,text,boolean);
create or replace function change_duty_equipment(
  p_org           uuid,
  p_driver        uuid,
  p_new_segment_id uuid,
  p_vehicle       uuid          default null,
  p_trailer       uuid          default null,
  p_clear_trailer boolean       default false,
  p_from_at       timestamptz   default null,
  p_note          text          default null,
  p_take_over     boolean       default false
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := coalesce(p_from_at, now());
  v_session uuid;
  v_cur record;
  v_next_vehicle uuid;
  v_next_trailer uuid;
begin
  -- Idempotency
  if exists (select 1 from public.duty_equipment_segments where id = p_new_segment_id) then
    select session_id into v_session
      from public.duty_equipment_segments where id = p_new_segment_id;
    return v_session;
  end if;

  select id into v_session
    from public.driver_duty_sessions
   where driver_id = p_driver and ended_at is null
   limit 1;
  if v_session is null then
    raise exception 'no_open_shift' using errcode = 'DL023';
  end if;

  select vehicle_id, trailer_id into v_cur
    from public.duty_equipment_segments
   where session_id = v_session and to_at is null
   limit 1;

  v_next_vehicle := coalesce(p_vehicle, v_cur.vehicle_id);
  v_next_trailer := case
                      when p_clear_trailer then null
                      when p_trailer is not null then p_trailer
                      else v_cur.trailer_id
                    end;

  -- Take-over on truck swap — same shape as start_duty_session.
  if p_vehicle is not null and p_vehicle <> v_cur.vehicle_id then
    if exists (
      select 1 from public.duty_equipment_segments seg
      join public.driver_duty_sessions s on s.id = seg.session_id
      where seg.vehicle_id = p_vehicle
        and seg.to_at is null and seg.seat = 'driver'
        and s.ended_at is null
    ) then
      if not p_take_over then
        raise exception 'vehicle_in_use' using errcode = 'DL021';
      end if;
      update public.duty_equipment_segments
         set to_at = v_now, updated_at = v_now
       where vehicle_id = p_vehicle and to_at is null and seat = 'driver';
    end if;
  end if;

  if v_next_trailer is not null and v_next_trailer is distinct from v_cur.trailer_id
     and exists (
       select 1 from public.duty_equipment_segments seg
       join public.driver_duty_sessions s on s.id = seg.session_id
       where seg.trailer_id = v_next_trailer and seg.to_at is null and s.ended_at is null
     )
  then
    raise exception 'trailer_in_use' using errcode = 'DL022';
  end if;

  update public.duty_equipment_segments
     set to_at = v_now, updated_at = v_now
   where session_id = v_session and to_at is null;

  insert into public.duty_equipment_segments (
    id, org_id, session_id, vehicle_id, trailer_id, seat, from_at, confirmed_by, note
  ) values (
    p_new_segment_id, p_org, v_session, v_next_vehicle, v_next_trailer, 'driver', v_now,
    'driver', p_note
  );

  return v_session;
end;
$$;

comment on function change_duty_equipment(uuid,uuid,uuid,uuid,uuid,boolean,timestamptz,text,boolean) is
  'Closes the current equipment segment and opens the next one without ending the shift.
   Idempotent on p_new_segment_id.';

-- ── end_duty_session ──────────────────────────────────────────────────────────
drop function if exists end_duty_session(uuid,uuid,timestamptz,numeric,text);
create or replace function end_duty_session(
  p_org       uuid,
  p_driver    uuid,
  p_ended_at  timestamptz default null,
  p_odometer  numeric     default null,
  p_reason    text        default 'driver'
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := coalesce(p_ended_at, now());
  v_session uuid;
begin
  select id into v_session
    from public.driver_duty_sessions
   where driver_id = p_driver and ended_at is null
   limit 1;
  if v_session is null then
    return null;   -- idempotent: already ended
  end if;

  update public.duty_equipment_segments
     set to_at = v_now, updated_at = v_now
   where session_id = v_session and to_at is null;

  update public.driver_duty_sessions
     set ended_at = v_now,
         ended_reason = p_reason,
         end_odometer = coalesce(p_odometer, end_odometer),
         updated_at = v_now
   where id = v_session;

  return v_session;
end;
$$;

-- ── close_stale_duty_sessions — sweeper cron ──────────────────────────────────
-- Closes every shift that has been open longer than the org's `duty_session_timeout_hours`.
-- Wired to `dutySessionSweeper` in apps/api/src/schedulers.ts; without this the exclusive-vehicle
-- index locks a truck out forever the first time a driver forgets to sign off (D44).
drop function if exists close_stale_duty_sessions();
create or replace function close_stale_duty_sessions()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := now();
  v_count integer := 0;
  r record;
begin
  for r in
    select s.id, s.driver_id, o.duty_session_timeout_hours
      from public.driver_duty_sessions s
      join public.organizations o on o.id = s.org_id
     where s.ended_at is null
       and s.started_at < v_now - make_interval(hours => o.duty_session_timeout_hours)
  loop
    update public.duty_equipment_segments
       set to_at = v_now, updated_at = v_now
     where session_id = r.id and to_at is null;
    update public.driver_duty_sessions
       set ended_at = v_now, ended_reason = 'auto_timeout', updated_at = v_now
     where id = r.id;
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

comment on function close_stale_duty_sessions() is
  'Auto-signs off any duty session past its org timeout. Idempotent — safe to run on a schedule.';

-- Grant EXECUTE. `authenticated` covers every logged-in role; the definer functions themselves
-- refuse anything the driver has no right to do.
grant execute on function start_duty_session(uuid,uuid,uuid,uuid,uuid,uuid,numeric,timestamptz,text,boolean,text) to authenticated;
grant execute on function change_duty_equipment(uuid,uuid,uuid,uuid,uuid,boolean,timestamptz,text,boolean) to authenticated;
grant execute on function end_duty_session(uuid,uuid,timestamptz,numeric,text) to authenticated;
grant execute on function close_stale_duty_sessions() to service_role;
