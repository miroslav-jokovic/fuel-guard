-- FuelGuard — 0141 repair the driver load RPC contract
--
-- WHAT WAS BROKEN. `0087` defines four driver mutations that derive the acting driver from
-- `auth_driver_id()`, which reads the caller's JWT. `apps/api/src/services/driverLoads.ts:167` calls
-- them through the SERVICE-ROLE client with a completely different parameter set:
--
--     admin.rpc(fn, { p_org, p_driver, p_load, ...args })
--
-- Against 0087 as shipped, every driver load mutation fails twice over: PostgREST cannot resolve a
-- function with those argument names, and even if it could, the service role has no JWT so
-- `auth_driver_id()` is null and the body raises '42501 not a driver' immediately. Accept, decline,
-- start and complete-stop — the whole driver write path — could never have worked. It was never
-- caught because `supabase/tests/load-lifecycle.test.mjs` calls the functions a THIRD way
-- (positionally, 3 and 4 args) and has not executed in months (stale migration filenames, repaired
-- alongside this).
--
-- WHICH SIDE IS RIGHT. The service's shape is. These RPCs are reached only through the API — no
-- client calls them directly (verified: zero `.rpc(` for these names in apps/driver or apps/web) —
-- and the API is the layer that has already authenticated the driver and resolved their org. A
-- SECURITY DEFINER function invoked by the service role cannot read a user JWT by definition, so
-- deriving identity from `auth_driver_id()` was never viable for this call path.
--
-- The safety that `auth_driver_id()` provided is not dropped, it is made explicit: every function now
-- verifies that `p_driver` is a live driver row IN `p_org`, and that the load belongs to both. The
-- caller may name a driver; it may not name one from another tenant.
--
-- ALSO FIXED HERE:
--   · Error codes now match what the API actually maps (`PG_TO_API` in driverLoads.ts). 0087 raised
--     'DL404', which that map has no entry for — so "load not found" surfaced to a driver as an
--     unhandled 500 instead of a 404.
--   · D21 is enforced server-side for the first time: completing a stop while a required photo is
--     missing, or skipping a stop at all, now requires a reason. Until now the rule lived only in the
--     driver app, so any replayed or malformed request bypassed it.
--
-- Behaviour otherwise preserved exactly: the D46 owner-operator decline fork, the implicit
-- accepted → in_transit promotion on the first worked stop, idempotent photo insertion by client
-- UUID, and auto-delivery when no stop remains open.

-- ── the column D47 needs ──────────────────────────────────────────────────────
-- Which SHIFT accepted this load. `driverLoads.ts:177-180` has documented this behaviour since Phase
-- 3B ("stamps the driver's active duty session onto the load"), and
-- `load-lifecycle.test.mjs:163-166` has asserted it — but the column was never added, so both were
-- describing something that could not happen.
--
-- Deliberately a point-in-time stamp, not a running attribution: it answers "which shift took this
-- on", which is what the D47 equipment check compares against. "Which truck was the driver in when
-- they worked stop 3" is a different question and stays a time-range join over
-- driver_duty_sessions x duty_equipment_segments — a stored answer to that would be wrong the first
-- time a driver swapped trucks mid-load.
alter table loads
  add column if not exists duty_session_id uuid references driver_duty_sessions(id) on delete set null;

comment on column loads.duty_session_id is
  'The duty session that accepted this load. Stamped by driver_accept_load; anchors the D47 equipment-mismatch check (0141).';

-- ── shared ownership check ────────────────────────────────────────────────────
-- One place decides "is this driver allowed to act on this load", so the four functions cannot drift
-- apart the way their signatures did.
create or replace function public.assert_driver_load(
  p_org    uuid,
  p_driver uuid,
  p_load   uuid
) returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_status text;
begin
  if not exists (
    select 1 from public.drivers d where d.id = p_driver and d.org_id = p_org
  ) then
    -- Deliberately the same error a foreign load produces: a caller probing ids learns nothing
    -- about which of the two was wrong.
    raise exception 'driver not in this organization' using errcode = 'DL002';
  end if;

  select l.status into v_status
    from public.loads l
   where l.id = p_load and l.org_id = p_org and l.driver_id = p_driver;

  if v_status is null then
    raise exception 'load not found for this driver' using errcode = 'DL002';
  end if;
  return v_status;
end;
$$;

comment on function public.assert_driver_load(uuid, uuid, uuid) is
  'Verifies a driver belongs to the org and owns the load; returns the load status. Raises DL002 otherwise (0141).';

-- ── driver_accept_load ────────────────────────────────────────────────────────
drop function if exists driver_accept_load(uuid, timestamptz);
drop function if exists driver_accept_load(uuid, uuid, uuid, uuid, timestamptz);
create function driver_accept_load(
  p_org         uuid,
  p_driver      uuid,
  p_load        uuid,
  p_actor_user  uuid        default null,
  p_occurred_at timestamptz default null
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status          text;
  v_now             timestamptz := coalesce(p_occurred_at, now());
  v_session         uuid;
  v_actual_vehicle  uuid;
  v_actual_trailer  uuid;
  v_planned_vehicle uuid;
begin
  v_status := public.assert_driver_load(p_org, p_driver, p_load);

  -- Idempotent: a replayed offline accept is a no-op, not an error. The outbox retries.
  if v_status = 'accepted' then
    return;
  end if;
  if v_status <> 'offered' then
    raise exception 'load is not offered (currently %)', v_status using errcode = 'DL001';
  end if;

  -- The driver's open shift and the equipment they are ACTUALLY in right now.
  select s.id, seg.vehicle_id, seg.trailer_id
    into v_session, v_actual_vehicle, v_actual_trailer
    from public.driver_duty_sessions s
    left join public.duty_equipment_segments seg
      on seg.session_id = s.id and seg.to_at is null and seg.seat = 'driver'
   where s.driver_id = p_driver and s.org_id = p_org and s.ended_at is null
   order by s.started_at desc
   limit 1;

  select l.vehicle_id into v_planned_vehicle from public.loads l where l.id = p_load;

  update public.loads
     set status = 'accepted',
         accepted_at = v_now,
         duty_session_id = coalesce(v_session, duty_session_id),
         updated_at = now()
   where id = p_load;

  insert into public.load_events (org_id, load_id, actor_user_id, actor_role, kind, from_status, to_status, occurred_at)
  values (p_org, p_load, p_actor_user, 'driver', 'accepted', 'offered', 'accepted', v_now);

  -- D47: the driver is in a different truck from the one dispatch planned. This is INFORMATION, not
  -- an error — a driver who swapped trucks at 4am must still be able to take the load, and dispatch's
  -- plan is not overwritten by what the yard actually did. The event is how the office finds out.
  if v_actual_vehicle is not null
     and v_planned_vehicle is not null
     and v_actual_vehicle <> v_planned_vehicle then
    insert into public.load_events (org_id, load_id, actor_user_id, actor_role, kind, payload, occurred_at)
    values (p_org, p_load, p_actor_user, 'driver', 'equipment_mismatch',
            jsonb_build_object(
              'planned_vehicle_id', v_planned_vehicle,
              'actual_vehicle_id', v_actual_vehicle,
              'actual_trailer_id', v_actual_trailer,
              'duty_session_id', v_session
            ),
            v_now);
  end if;
end;
$$;

-- ── driver_decline_load ───────────────────────────────────────────────────────
-- D46 forks here: an owner-operator's decline unassigns and returns the load to `approved`; a company
-- driver's decline records the exception and leaves dispatch to decide.
drop function if exists driver_decline_load(uuid, text, text, timestamptz);
drop function if exists driver_decline_load(uuid, uuid, uuid, text, uuid, timestamptz);
create function driver_decline_load(
  p_org         uuid,
  p_driver      uuid,
  p_load        uuid,
  p_reason      text,
  p_actor_user  uuid        default null,
  p_occurred_at timestamptz default null
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status text;
  v_type   text;
  v_now    timestamptz := coalesce(p_occurred_at, now());
begin
  v_status := public.assert_driver_load(p_org, p_driver, p_load);

  if coalesce(btrim(p_reason), '') = '' then
    raise exception 'a decline reason is required' using errcode = 'DL006';
  end if;
  if v_status not in ('offered', 'accepted') then
    raise exception 'cannot decline in status %', v_status using errcode = 'DL003';
  end if;

  v_type := public.resolve_driver_type(p_driver);

  if v_type = 'owner_operator' then
    update public.loads
       set status = 'approved',
           driver_id = null,
           -- Back in the queue means back to un-released. Leaving released_at set would make the
           -- load look dispatched to every query that reads it as "has this gone out yet".
           released_at = null,
           declined_at = v_now,
           decline_reason = p_reason,
           updated_at = now()
     where id = p_load;

    insert into public.load_events (org_id, load_id, actor_user_id, actor_role, kind, from_status, to_status, payload, occurred_at)
    values (p_org, p_load, p_actor_user, 'driver', 'declined', v_status, 'approved',
            jsonb_build_object('reason', p_reason, 'unassigned', true), v_now);
  else
    update public.loads
       set declined_at = v_now,
           decline_reason = p_reason,
           updated_at = now()
     where id = p_load;

    insert into public.load_events (org_id, load_id, actor_user_id, actor_role, kind, from_status, to_status, payload, occurred_at)
    values (p_org, p_load, p_actor_user, 'driver', 'declined', v_status, v_status,
            jsonb_build_object('reason', p_reason, 'unassigned', false), v_now);
  end if;
end;
$$;

-- ── driver_start_load ─────────────────────────────────────────────────────────
drop function if exists driver_start_load(uuid, timestamptz);
drop function if exists driver_start_load(uuid, uuid, uuid, uuid, timestamptz);
create function driver_start_load(
  p_org         uuid,
  p_driver      uuid,
  p_load        uuid,
  p_actor_user  uuid        default null,
  p_occurred_at timestamptz default null
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status text;
  v_now    timestamptz := coalesce(p_occurred_at, now());
begin
  v_status := public.assert_driver_load(p_org, p_driver, p_load);

  if v_status = 'in_transit' then
    return; -- idempotent replay
  end if;
  if v_status <> 'accepted' then
    raise exception 'cannot start in status %', v_status using errcode = 'DL003';
  end if;

  update public.loads set status = 'in_transit', updated_at = now() where id = p_load;

  insert into public.load_events (org_id, load_id, actor_user_id, actor_role, kind, from_status, to_status, occurred_at)
  values (p_org, p_load, p_actor_user, 'driver', 'started', 'accepted', 'in_transit', v_now);
end;
$$;

-- ── driver_complete_stop ──────────────────────────────────────────────────────
drop function if exists driver_complete_stop(uuid, uuid, text, text, jsonb, timestamptz);
drop function if exists driver_complete_stop(uuid, uuid, uuid, uuid, text, text, jsonb, uuid, timestamptz);
create function driver_complete_stop(
  p_org         uuid,
  p_driver      uuid,
  p_load        uuid,
  p_stop        uuid,
  p_status      text,                                    -- 'arrived' | 'completed' | 'skipped'
  p_skip_reason text        default null,
  p_photos      jsonb       default '[]'::jsonb,         -- [{id, slot, storage_path, captured_at}, ...]
  p_actor_user  uuid        default null,
  p_occurred_at timestamptz default null
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_load_status  text;
  v_stop_status  text;
  v_stop_seq     integer;
  v_required     text[];
  v_missing      text[];
  v_now          timestamptz := coalesce(p_occurred_at, now());
  v_event_kind   text;
  v_has_reason   boolean := coalesce(btrim(p_skip_reason), '') <> '';
begin
  v_load_status := public.assert_driver_load(p_org, p_driver, p_load);

  if p_status not in ('arrived', 'completed', 'skipped') then
    raise exception 'illegal stop status %', p_status using errcode = 'DL010';
  end if;

  select s.status, s.seq, coalesce(s.required_photos, '{}')
    into v_stop_status, v_stop_seq, v_required
    from public.load_stops s
   where s.id = p_stop and s.load_id = p_load;
  if v_stop_seq is null then
    raise exception 'stop not found on this load' using errcode = 'DL005';
  end if;
  if v_load_status not in ('accepted', 'in_transit') then
    raise exception 'cannot work a stop in load status %', v_load_status using errcode = 'DL003';
  end if;
  -- The outbox retries. A replayed sync of the SAME outcome must be a no-op, not an error, or a
  -- driver in a dead zone ends up with a permanently stuck queue item for work they already did.
  -- A DIFFERENT outcome on a finished stop is still refused.
  if v_stop_status = p_status then
    return;
  end if;
  if v_stop_status in ('completed', 'skipped') then
    raise exception 'stop already %', v_stop_status using errcode = 'DL003';
  end if;

  -- D21, enforced server-side for the first time. The rule lived only in the driver app, so a
  -- replayed or hand-made request could finish a stop with no photo and no explanation — and the
  -- explanation is the entire point: a missing bill of lading with a reason is a note to dispatch,
  -- a missing bill of lading without one is a hole in the record.
  if p_status = 'skipped' and not v_has_reason then
    raise exception 'skipping a stop requires a reason' using errcode = 'DL006';
  end if;

  if p_status = 'completed' and array_length(v_required, 1) is not null then
    select array_agg(req)
      into v_missing
      from unnest(v_required) as req
     where req not in (
       select slot from public.load_stop_photos where stop_id = p_stop
       union
       select elem->>'slot' from jsonb_array_elements(coalesce(p_photos, '[]'::jsonb)) elem
     );
    if v_missing is not null and not v_has_reason then
      raise exception 'required photo(s) missing without a reason: %', array_to_string(v_missing, ', ')
        using errcode = 'DL006';
    end if;
  end if;

  update public.load_stops
     set status = p_status,
         arrived_at = case when p_status in ('arrived', 'completed') and arrived_at is null then v_now else arrived_at end,
         completed_at = case when p_status in ('completed', 'skipped') then v_now else completed_at end,
         skip_reason  = case when v_has_reason then p_skip_reason else skip_reason end,
         updated_at = now()
   where id = p_stop;

  -- Photos land in the same transaction, idempotent by their client-supplied primary key.
  if jsonb_typeof(p_photos) = 'array' and jsonb_array_length(p_photos) > 0 then
    insert into public.load_stop_photos (id, org_id, load_id, stop_id, driver_id, slot, storage_path, captured_at)
    select
      (elem->>'id')::uuid,
      p_org,
      p_load,
      p_stop,
      p_driver,
      elem->>'slot',
      elem->>'storage_path',
      nullif(elem->>'captured_at', '')::timestamptz
    from jsonb_array_elements(p_photos) elem
    on conflict (id) do nothing;
  end if;

  -- First worked stop = the load has actually started (D45 F1).
  if v_load_status = 'accepted' and p_status in ('arrived', 'completed') then
    update public.loads set status = 'in_transit', updated_at = now() where id = p_load;

    insert into public.load_events (org_id, load_id, actor_user_id, actor_role, kind, from_status, to_status, occurred_at)
    values (p_org, p_load, p_actor_user, 'driver', 'started', 'accepted', 'in_transit', v_now);
  end if;

  v_event_kind := case p_status
                    when 'arrived'   then 'stop_arrived'
                    when 'completed' then 'stop_completed'
                    when 'skipped'   then 'stop_skipped'
                  end;

  insert into public.load_events (org_id, load_id, actor_user_id, actor_role, kind, payload, occurred_at)
  values (p_org, p_load, p_actor_user, 'driver', v_event_kind,
          jsonb_build_object(
            'stop_id', p_stop,
            'seq', v_stop_seq,
            'photos', coalesce(jsonb_array_length(p_photos), 0),
            'skip_reason', p_skip_reason,
            'missing_photos', to_jsonb(coalesce(v_missing, '{}'::text[]))
          ),
          v_now);

  -- Every stop finished → the load is delivered.
  if not exists (
    select 1 from public.load_stops
     where load_id = p_load and status not in ('completed', 'skipped')
  ) then
    update public.loads
       set status = 'delivered', completed_at = v_now, updated_at = now()
     where id = p_load;
    insert into public.load_events (org_id, load_id, actor_user_id, actor_role, kind, from_status, to_status, occurred_at)
    values (p_org, p_load, p_actor_user, 'driver', 'completed', 'in_transit', 'delivered', v_now);
  end if;
end;
$$;

-- ── grants ────────────────────────────────────────────────────────────────────
-- Service role only. These are reached exclusively through the API, which has already authenticated
-- the driver; granting them to `authenticated` (as 0087 did) would let any signed-in user name any
-- driver id in their own org and act as them.
revoke all on function public.assert_driver_load(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function driver_accept_load(uuid, uuid, uuid, uuid, timestamptz) from public, anon, authenticated;
revoke all on function driver_decline_load(uuid, uuid, uuid, text, uuid, timestamptz) from public, anon, authenticated;
revoke all on function driver_start_load(uuid, uuid, uuid, uuid, timestamptz) from public, anon, authenticated;
revoke all on function driver_complete_stop(uuid, uuid, uuid, uuid, text, text, jsonb, uuid, timestamptz) from public, anon, authenticated;

grant execute on function public.assert_driver_load(uuid, uuid, uuid) to service_role;
grant execute on function driver_accept_load(uuid, uuid, uuid, uuid, timestamptz) to service_role;
grant execute on function driver_decline_load(uuid, uuid, uuid, text, uuid, timestamptz) to service_role;
grant execute on function driver_start_load(uuid, uuid, uuid, uuid, timestamptz) to service_role;
grant execute on function driver_complete_stop(uuid, uuid, uuid, uuid, text, text, jsonb, uuid, timestamptz) to service_role;
