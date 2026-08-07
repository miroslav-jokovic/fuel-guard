-- FuelGuard — 0143 align the duty-session error contract with the API, and close two gaps
--
-- SAME DEFECT CLASS AS 0141. `apps/api/src/services/dutySessions.ts:27-32` maps SQLSTATEs
-- DG001–DG005 onto clean 409/404 responses, and `dutySessions.test.ts` asserts each of those
-- mappings. Migration `0086` raises DL020, DL021, DL022 and DL023 — codes nothing maps. So every
-- real-world duty conflict (a truck already checked out, a driver with a shift still open) has been
-- surfacing to a driver as an unhandled 500 rather than "Unit 214 is with Marcus since 04:12".
--
-- The API's names win: they are the ones with tests behind them, and DG-for-duty is clearer than
-- DL-for-duty-inside-the-loads-range. Mapping:
--
--     DG001  vehicle_in_use        (was DL021)
--     DG002  trailer_in_use        (was DL022)
--     DG003  shift_already_open    (was DL020)
--     DG004  no_open_shift         (was DL023)
--     DG005  equipment not in this organization   ← NEVER RAISED BEFORE
--
-- TWO GAPS CLOSED WHILE HERE, both specced by `supabase/tests/duty-sessions.test.mjs` and neither
-- implemented (that file has not executed in months — stale migration filenames, repaired in the
-- same change):
--
--   1. DG005. Nothing checked that the vehicle or trailer a driver checks into belongs to their
--      organization. `start_duty_session` inserted whatever uuid it was handed. RLS does not save us
--      here: these are SECURITY DEFINER functions called by the service role, so the org boundary has
--      to be checked in the body or not at all. A driver could have opened a shift on another
--      tenant's truck.
--   2. A no-op equipment change wrote a new segment anyway — closing the current one and opening an
--      identical replacement. Harmless-looking, but it shreds the equipment timeline that duty
--      attribution and the D47 mismatch check both read, and it does it every time a driver
--      re-confirms the truck they are already in.

-- ── start_duty_session ────────────────────────────────────────────────────────
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

  -- The equipment must belong to this organization. Checked here because these functions run as the
  -- service role, where RLS is not in the path.
  if not exists (select 1 from public.vehicles v where v.id = p_vehicle and v.org_id = p_org) then
    raise exception 'vehicle not found in this organization' using errcode = 'DG005';
  end if;
  if p_trailer is not null
     and not exists (select 1 from public.trailers t where t.id = p_trailer and t.org_id = p_org) then
    raise exception 'trailer not found in this organization' using errcode = 'DG005';
  end if;

  if exists (
    select 1 from public.driver_duty_sessions
     where driver_id = p_driver and ended_at is null
  ) then
    raise exception 'shift_already_open' using errcode = 'DG003';
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
      raise exception 'vehicle_in_use' using errcode = 'DG001';
    end if;
    update public.duty_equipment_segments
       set to_at = v_now, updated_at = v_now
     where session_id = v_conflict_session and to_at is null;
    update public.driver_duty_sessions
       set ended_at = v_now, ended_reason = 'taken_over', updated_at = v_now
     where id = v_conflict_session and ended_at is null;
  end if;

  if p_trailer is not null and exists (
    select 1 from public.duty_equipment_segments seg
    join public.driver_duty_sessions s on s.id = seg.session_id
    where seg.trailer_id = p_trailer and seg.to_at is null and s.ended_at is null
  ) then
    raise exception 'trailer_in_use' using errcode = 'DG002';
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

-- ── change_duty_equipment ─────────────────────────────────────────────────────
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
  if exists (select 1 from public.duty_equipment_segments where id = p_new_segment_id) then
    select session_id into v_session
      from public.duty_equipment_segments where id = p_new_segment_id;
    return v_session;
  end if;

  if p_vehicle is not null
     and not exists (select 1 from public.vehicles v where v.id = p_vehicle and v.org_id = p_org) then
    raise exception 'vehicle not found in this organization' using errcode = 'DG005';
  end if;
  if p_trailer is not null
     and not exists (select 1 from public.trailers t where t.id = p_trailer and t.org_id = p_org) then
    raise exception 'trailer not found in this organization' using errcode = 'DG005';
  end if;

  select id into v_session
    from public.driver_duty_sessions
   where driver_id = p_driver and ended_at is null
   limit 1;
  if v_session is null then
    raise exception 'no_open_shift' using errcode = 'DG004';
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

  -- Nothing actually changed. Re-confirming the truck you are already in is a normal thing for a
  -- driver to do, and it must not shred the equipment timeline that duty attribution and the D47
  -- mismatch check read.
  if v_next_vehicle is not distinct from v_cur.vehicle_id
     and v_next_trailer is not distinct from v_cur.trailer_id then
    return v_session;
  end if;

  if p_vehicle is not null and p_vehicle <> v_cur.vehicle_id then
    if exists (
      select 1 from public.duty_equipment_segments seg
      join public.driver_duty_sessions s on s.id = seg.session_id
      where seg.vehicle_id = p_vehicle
        and seg.to_at is null and seg.seat = 'driver'
        and s.ended_at is null
    ) then
      if not p_take_over then
        raise exception 'vehicle_in_use' using errcode = 'DG001';
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
    raise exception 'trailer_in_use' using errcode = 'DG002';
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
