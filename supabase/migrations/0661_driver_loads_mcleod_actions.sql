-- 0661: the driver can WORK the McLeod load 0655 lets him SEE — one definition of "who may act", replays
-- by the outbox record id, late evidence that is kept instead of refused, "Got it", and the one signature
-- change of `driver_complete_stop` (M-A; docs/plans/mcleod/v2/T1-driver-and-data.md N-8; D-MK19, D-MK20,
-- D-MK21, D-MK23).
--
-- ── THE GAP ──────────────────────────────────────────────────────────────────────────────────────
-- 0655 shows a McLeod (`tms`) load to the driver its CURRENT dispatch names, and to the load's McLeod
-- co-driver when that dispatch names the McLeod driver (O-3), at pending_approval, approved, in_transit,
-- delivered and canceled. The action door was left as 0141 built it: `assert_driver_load` admits only
-- `loads.driver_id = p_driver` (0141:79-86), `driver_complete_stop` works a stop only at accepted /
-- in_transit (0141:304-305) and late photos only at in_transit / delivered (0645:79-80). So after 0655 a
-- co-driver, a driver the office sent a load McLeod seats on somebody else, and EVERY driver of a
-- pending_approval / approved load see the load and get DL002 or DL003 on their first tap — a 409/404
-- that parks the action in the outbox's Needs attention. And the reverse hole (spec A C1/C3/C4, still
-- true of 0141): an UNSENT McLeod load is workable by its McLeod driver_id through the API, although no
-- phone shows it.
--
-- ── ONE DEFINITION ───────────────────────────────────────────────────────────────────────────────
-- `driver_visible_tms_load_ids(p_org, p_driver)` is 0655's body with the caller's claims made parameters
-- (service role only: it takes a tenant and a driver). 0655's policy helper `auth_visible_tms_load_ids()`
-- is re-created as a one-line wrapper over it — same name, same ACL, same answer — so the three driver
-- scopes, this action door and (from N-9) the API read ONE body. Deriving beats restating: the copy in
-- driverLoads.ts `tmsLoadsVisibleTo` is the restatement N-9 retires.
-- `driver_load_access(p_org, p_driver, p_load)` answers 'current' (0655 shows it now) | 'late' (D-MK20:
-- the driver was ever dispatched it) | 'none'. Every driver function below asks it, and nothing else.
-- The tms status list is not written a second time: 'current' already requires one of
-- TMS_DRIVER_VISIBLE_STATUSES (the policies' list), and the matrix reads the shared constant's source to
-- pin that the two agree.
--
-- ── WHY LATE EVIDENCE RETURNS INSTEAD OF RAISING (D-MK20, D-MK15) ────────────────────────────────
-- A phone that queued "completed, with the BOL photo" offline and comes back after the office re-sent
-- the load to someone else, or after McLeod removed the stop, holds the only proof of that work. A raise
-- rolls back the transaction, and the photo rows with it — the storage reconciler then deletes the
-- objects (storageReconcile.ts:297). So the function stores the photos and an event flagged
-- `late_evidence: true` with a `late_reason`, touches NO load_stops or loads column (the current holder's
-- facts are theirs), and returns `{status: 'late_evidence'}`. A driver never dispatched the load is
-- still refused (DL002), as before.
--
-- ── REPLAYS (D-MK23) ─────────────────────────────────────────────────────────────────────────────
-- Every action takes the outbox record id as `p_action_id` and writes its primary event WITH that id.
-- `load_action_seen` answers true when that event exists for the same org, load, kind (and stop): the
-- replay is a no-op. It is called right after the driver-in-org check and BEFORE access, so a replayed
-- owner-operator decline (which unassigned the load) is a no-op, not DL002. An id already used for
-- another load, kind or stop is DL012. A null id keeps 0141's state-based idempotency until N-18 makes
-- it required.
--
-- ── THE TEAM RULE (O-3, 0655's) ──────────────────────────────────────────────────────────────────
-- Both seats work the same stops. A tms Arrive on a stop the other seat already finished answers
-- `already_done` (cD DR-12); a second Complete with new photos records them and changes nothing else
-- (`photos_added`); each seat acknowledges ("Got it") separately.
--
-- ── A McLEOD LOAD'S STATUS STAYS McLEOD'S (D-LMR2) ───────────────────────────────────────────────
-- For a tms load, stop work never moves `loads.status` (0141's accepted → in_transit and → delivered
-- are manual-only), accept / decline / start are refused (DL014 / DL013: McLeod has no such step), and
-- Complete never fabricates an arrival (spec A §3.1 step 5): it uses the Arrive the Complete carries
-- (`p_arrived_at`, D-MK21), or leaves arrived_at empty.
--
-- ── ERROR CODES ──────────────────────────────────────────────────────────────────────────────────
-- DL012 action id reused for another action · DL013 a McLeod load starts at its first stop · DL014
-- McLeod loads are not accepted or declined in the app / a manual load has no "Got it" · DL015 "Got it"
-- without an action id. None was used before this migration (grep, 2026-11-27).
--
-- ── DEPLOY WINDOW ────────────────────────────────────────────────────────────────────────────────
-- Functions, one widened CHECK, one nullable column. Today's API calls every RPC by NAMED arguments
-- (`runRpc`, apps/api/src/modules/loads/driverLoads.ts:230-238: p_org, p_driver, p_load, p_stop,
-- p_status, p_skip_reason, p_photos, p_reason, p_actor_user, p_occurred_at) — every one of those names
-- is kept, and every new parameter is defaulted, so the old calls resolve to the new functions.
-- `runRpc` reads only `error`, so `driver_complete_stop`'s `void → jsonb` is invisible to it. The drop
-- and create of each function run in this one transaction, so no call meets a missing function.
-- No application code reads anything new in this merge (lint:migration-ordering; N-9 is the reader).
--
-- ── ROLLBACK ─────────────────────────────────────────────────────────────────────────────────────
-- A later migration re-creating 0141's / 0645's functions from their text and 0655's helper body. The
-- `acknowledged` kind and `load_stop_photos.sha256` stay (additive; nothing narrows).

-- ── 1. who may see and work a McLeod load now ─────────────────────────────────────────────────────
create function public.driver_visible_tms_load_ids(p_org uuid, p_driver uuid)
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select cur.load_id
    from (
      select distinct on (d.load_id) d.load_id, d.driver_id
        from public.load_dispatches d
       where d.org_id = p_org
         and d.load_id in (
           select m.load_id from public.load_dispatches m
            where m.org_id = p_org and m.driver_id = p_driver
           union
           select l.id from public.loads l
            where l.org_id = p_org and l.co_driver_id = p_driver
         )
       order by d.load_id, d.sent_at desc, d.id desc
    ) cur
    join public.loads l on l.id = cur.load_id
   where p_driver is not null
     and (cur.driver_id = p_driver or (cur.driver_id = l.driver_id and l.co_driver_id = p_driver));
$$;

comment on function public.driver_visible_tms_load_ids(uuid, uuid) is
  'M-A (N-8): McLeod loads whose CURRENT dispatch (newest sent_at, then id) names p_driver, or names the load''s '
  'McLeod driver while p_driver is its McLeod co-driver (O-3). The one body behind auth_visible_tms_load_ids() '
  'and driver_load_access(). Service role only.';

revoke all on function public.driver_visible_tms_load_ids(uuid, uuid) from public, anon, authenticated;
grant execute on function public.driver_visible_tms_load_ids(uuid, uuid) to service_role;

-- 0655's policy helper becomes a wrapper: same name, same ACL, same answer, one body.
create or replace function public.auth_visible_tms_load_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select public.driver_visible_tms_load_ids(public.auth_org_id(), public.auth_driver_id());
$$;

comment on function public.auth_visible_tms_load_ids() is
  'S1.1 (DF-1, O-3, D-LMR5): McLeod loads whose CURRENT dispatch names the calling driver, or names the '
  'load''s McLeod driver while the caller is its McLeod co-driver. Caller-scoped policy helper, no '
  'parameter; since 0661 a wrapper over driver_visible_tms_load_ids(auth_org_id(), auth_driver_id()).';

-- 0655's ACL, re-stated (create or replace keeps it; this says so): a policy evaluates the helper as the
-- requesting role, so anon, authenticated and service_role execute it, and PUBLIC holds nothing (0643 §6).
revoke all on function public.auth_visible_tms_load_ids() from public;
grant execute on function public.auth_visible_tms_load_ids() to anon, authenticated, service_role;

-- ── 2. D-MK20: current, late, or none ─────────────────────────────────────────────────────────────
-- 'current' = 0655 shows it now (tms: in the set above AND a TMS_DRIVER_VISIBLE_STATUSES status; manual:
-- 0141's driver_id rule). 'late' = was ever dispatched it: a load_dispatches row names the driver, or a
-- driver event of this load carries payload.driver_id = the driver, or the load has a dispatch and the
-- driver holds a McLeod seat. A McLeod repower is covered by the first arm (raw keeps no seat history —
-- the mirror overwrites seats, mirrorLoads.ts — so a repower can only be known through the dispatch it
-- undid). An UNDISPATCHED McLeod load is 'none' for its seat holders: they never saw it (0655), so no
-- queued action of theirs can exist.
create function public.driver_load_access(p_org uuid, p_driver uuid, p_load uuid)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_source text;
  v_status text;
  v_driver uuid;
  v_co     uuid;
begin
  select l.source, l.status, l.driver_id, l.co_driver_id
    into v_source, v_status, v_driver, v_co
    from public.loads l
   where l.id = p_load and l.org_id = p_org;
  if v_source is null or p_driver is null then
    return 'none';
  end if;
  if v_source <> 'tms' then
    return case when v_driver = p_driver then 'current' else 'none' end;
  end if;
  if p_load in (select public.driver_visible_tms_load_ids(p_org, p_driver))
     and v_status in ('pending_approval', 'approved', 'in_transit', 'delivered', 'canceled') then
    return 'current';
  end if;
  if exists (select 1 from public.load_dispatches d
              where d.org_id = p_org and d.load_id = p_load and d.driver_id = p_driver)
     or exists (select 1 from public.load_events e
                 where e.org_id = p_org and e.load_id = p_load
                   and e.actor_role = 'driver' and e.payload->>'driver_id' = p_driver::text)
     or (p_driver in (v_driver, v_co)
         and exists (select 1 from public.load_dispatches d where d.org_id = p_org and d.load_id = p_load))
  then
    return 'late';
  end if;
  return 'none';
end;
$$;

comment on function public.driver_load_access(uuid, uuid, uuid) is
  'M-A (N-8, D-MK20): ''current'' when 0655 shows the load to the driver now, ''late'' when the driver was ever '
  'dispatched it, ''none'' otherwise. Service role only.';

revoke all on function public.driver_load_access(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.driver_load_access(uuid, uuid, uuid) to service_role;

-- ── 3. assert_driver_load: same signature and return (aA A-11) ────────────────────────────────────
-- Manual: 0141's body unchanged (0141:79-86). tms: DL002 only when access is 'none' — closes spec A's
-- hole (an undispatched McLeod load was workable by its McLeod driver_id) and admits the co-driver and
-- the dispatched non-seat 0655 shows. A 'late' driver passes; each caller decides what late means.
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
  v_source text;
  v_status text;
begin
  if not exists (
    select 1 from public.drivers d where d.id = p_driver and d.org_id = p_org
  ) then
    -- Deliberately the same error a foreign load produces: a caller probing ids learns nothing
    -- about which of the two was wrong.
    raise exception 'driver not in this organization' using errcode = 'DL002';
  end if;

  select l.source into v_source from public.loads l where l.id = p_load and l.org_id = p_org;

  if v_source is distinct from 'tms' then
    select l.status into v_status
      from public.loads l
     where l.id = p_load and l.org_id = p_org and l.driver_id = p_driver;
  elsif public.driver_load_access(p_org, p_driver, p_load) <> 'none' then
    select l.status into v_status from public.loads l where l.id = p_load and l.org_id = p_org;
  end if;

  if v_status is null then
    raise exception 'load not found for this driver' using errcode = 'DL002';
  end if;
  return v_status;
end;
$$;

comment on function public.assert_driver_load(uuid, uuid, uuid) is
  'Verifies a driver belongs to the org and may act on the load (manual: owns it, 0141; McLeod: '
  'driver_load_access is not ''none'', 0661); returns the load status. Raises DL002 otherwise.';

revoke all on function public.assert_driver_load(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.assert_driver_load(uuid, uuid, uuid) to service_role;

-- ── 4. replays (N7, spec A §5.2, aA A-14/A-15) ────────────────────────────────────────────────────
-- null id → false; no event with that id → false; same org + load + kind (+ stop) → true; else DL012.
create function public.load_action_seen(
  p_action_id uuid,
  p_org       uuid,
  p_load      uuid,
  p_kinds     text[],
  p_stop      uuid default null
) returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_action_id is null then
    return false;
  end if;
  if not exists (select 1 from public.load_events e where e.id = p_action_id) then
    return false;
  end if;
  if exists (
    select 1 from public.load_events e
     where e.id = p_action_id
       and e.org_id = p_org
       and e.load_id = p_load
       and e.kind = any(p_kinds)
       and (p_stop is null or e.payload->>'stop_id' = p_stop::text)
  ) then
    return true;
  end if;
  raise exception 'action id % was already used for another action', p_action_id using errcode = 'DL012';
end;
$$;

comment on function public.load_action_seen(uuid, uuid, uuid, text[], uuid) is
  'M-A (N-8, D-MK23): true when the outbox record p_action_id already wrote its event on this load (same kind, '
  'same stop); false when it has not; DL012 when the id was used for another load, kind or stop.';

revoke all on function public.load_action_seen(uuid, uuid, uuid, text[], uuid) from public, anon, authenticated;
grant execute on function public.load_action_seen(uuid, uuid, uuid, text[], uuid) to service_role;

-- ── 5. the new kind, keeping 0660's list ──────────────────────────────────────────────────────────
-- 0660's list (0660:76-80, main's newest definition of the CHECK) plus `acknowledged`, written only by
-- driver_acknowledge_load. The shared contract (LOAD_EVENT_KINDS) learns it in THIS merge, 0645's rule.
alter table public.load_events drop constraint load_events_kind_check;
alter table public.load_events add constraint load_events_kind_check check (kind in (
  'created','submitted','approved','rejected','assigned','reassigned','released','accepted','declined','started',
  'stop_arrived','stop_completed','stop_skipped','equipment_mismatch','amended','canceled','completed',
  'load_changed','exception_resolved','stop_photo_added','stop_removed_in_mcleod','stop_mirror_refused',
  'acknowledged'));

-- ── 6. per-photo content hash (spec D M-D2, folded into M-A by D-MK19) ────────────────────────────
-- Nullable: rows before this have none. Lower-case hex, 64 characters, or nothing. MK4's
-- mcleod_image_sends (stop_id, kind, sha256) (D-MK8) reads this one column for both photo doors.
alter table public.load_stop_photos add column if not exists sha256 text
  constraint load_stop_photos_sha256_check check (sha256 is null or sha256 ~ '^[0-9a-f]{64}$');

comment on column public.load_stop_photos.sha256 is
  'SHA-256 of the photo file as the phone uploaded it, lower-case hex (M-A, spec D M-D2). Null before 0661.';

-- ── 7. driver_accept_load / driver_decline_load / driver_start_load ───────────────────────────────
-- 0141's bodies, with: the replay check first; McLeod loads refused by name (there is no accept,
-- decline or start step in McLeod — DL014 / DL013); the primary event written with the action id.
drop function public.driver_accept_load(uuid, uuid, uuid, uuid, timestamptz);
create function public.driver_accept_load(
  p_org         uuid,
  p_driver      uuid,
  p_load        uuid,
  p_actor_user  uuid        default null,
  p_occurred_at timestamptz default null,
  p_action_id   uuid        default null
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
  if not exists (select 1 from public.drivers d where d.id = p_driver and d.org_id = p_org) then
    raise exception 'driver not in this organization' using errcode = 'DL002';
  end if;
  if public.load_action_seen(p_action_id, p_org, p_load, array['accepted']) then
    return;
  end if;
  if exists (select 1 from public.loads l where l.id = p_load and l.org_id = p_org and l.source = 'tms') then
    raise exception 'McLeod loads are not accepted or declined in the app' using errcode = 'DL014';
  end if;

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

  insert into public.load_events (id, org_id, load_id, actor_user_id, actor_role, kind, from_status, to_status, payload, occurred_at)
  values (coalesce(p_action_id, gen_random_uuid()), p_org, p_load, p_actor_user, 'driver', 'accepted', 'offered', 'accepted',
          jsonb_build_object('driver_id', p_driver, 'action_id', p_action_id), v_now);

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

-- D46 forks here: an owner-operator's decline unassigns and returns the load to `approved`; a company
-- driver's decline records the exception and leaves dispatch to decide.
drop function public.driver_decline_load(uuid, uuid, uuid, text, uuid, timestamptz);
create function public.driver_decline_load(
  p_org         uuid,
  p_driver      uuid,
  p_load        uuid,
  p_reason      text,
  p_actor_user  uuid        default null,
  p_occurred_at timestamptz default null,
  p_action_id   uuid        default null
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
  if not exists (select 1 from public.drivers d where d.id = p_driver and d.org_id = p_org) then
    raise exception 'driver not in this organization' using errcode = 'DL002';
  end if;
  -- Before access: a replayed owner-operator decline finds the load already unassigned, so the
  -- ownership check below would answer DL002 for work that was done.
  if public.load_action_seen(p_action_id, p_org, p_load, array['declined']) then
    return;
  end if;
  if exists (select 1 from public.loads l where l.id = p_load and l.org_id = p_org and l.source = 'tms') then
    raise exception 'McLeod loads are not accepted or declined in the app' using errcode = 'DL014';
  end if;

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

    insert into public.load_events (id, org_id, load_id, actor_user_id, actor_role, kind, from_status, to_status, payload, occurred_at)
    values (coalesce(p_action_id, gen_random_uuid()), p_org, p_load, p_actor_user, 'driver', 'declined', v_status, 'approved',
            jsonb_build_object('reason', p_reason, 'unassigned', true, 'driver_id', p_driver, 'action_id', p_action_id), v_now);
  else
    update public.loads
       set declined_at = v_now,
           decline_reason = p_reason,
           updated_at = now()
     where id = p_load;

    insert into public.load_events (id, org_id, load_id, actor_user_id, actor_role, kind, from_status, to_status, payload, occurred_at)
    values (coalesce(p_action_id, gen_random_uuid()), p_org, p_load, p_actor_user, 'driver', 'declined', v_status, v_status,
            jsonb_build_object('reason', p_reason, 'unassigned', false, 'driver_id', p_driver, 'action_id', p_action_id), v_now);
  end if;
end;
$$;

drop function public.driver_start_load(uuid, uuid, uuid, uuid, timestamptz);
create function public.driver_start_load(
  p_org         uuid,
  p_driver      uuid,
  p_load        uuid,
  p_actor_user  uuid        default null,
  p_occurred_at timestamptz default null,
  p_action_id   uuid        default null
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status text;
  v_now    timestamptz := coalesce(p_occurred_at, now());
begin
  if not exists (select 1 from public.drivers d where d.id = p_driver and d.org_id = p_org) then
    raise exception 'driver not in this organization' using errcode = 'DL002';
  end if;
  if public.load_action_seen(p_action_id, p_org, p_load, array['started']) then
    return;
  end if;
  if exists (select 1 from public.loads l where l.id = p_load and l.org_id = p_org and l.source = 'tms') then
    raise exception 'a McLeod load starts at its first stop' using errcode = 'DL013';
  end if;

  v_status := public.assert_driver_load(p_org, p_driver, p_load);

  if v_status = 'in_transit' then
    return; -- idempotent replay
  end if;
  if v_status <> 'accepted' then
    raise exception 'cannot start in status %', v_status using errcode = 'DL003';
  end if;

  update public.loads set status = 'in_transit', updated_at = now() where id = p_load;

  insert into public.load_events (id, org_id, load_id, actor_user_id, actor_role, kind, from_status, to_status, payload, occurred_at)
  values (coalesce(p_action_id, gen_random_uuid()), p_org, p_load, p_actor_user, 'driver', 'started', 'accepted', 'in_transit',
          jsonb_build_object('driver_id', p_driver, 'action_id', p_action_id), v_now);
end;
$$;

-- ── 8. driver_complete_stop: the signature change, once (D-MK19) ──────────────────────────────────
-- Steps, in order (T1 N-8; 0141:280-400 is the base, and every step says per source):
--   1 driver in org · 2 replay · 3 access, load, status legality, stop · 4 late evidence · 5 status gate
--   6 same status again · 7 terminal · 8 reason and required photos · 9 times · 10 stop row and photos
--   11 load side (manual only) · 12 the T-4 slot · 13 the stop event · 14 the answer.
drop function public.driver_complete_stop(uuid, uuid, uuid, uuid, text, text, jsonb, uuid, timestamptz);
create function public.driver_complete_stop(
  p_org              uuid,
  p_driver           uuid,
  p_load             uuid,
  p_stop             uuid,
  p_status           text,                              -- 'arrived' | 'completed' | 'skipped'
  p_skip_reason      text        default null,
  p_photos           jsonb       default '[]'::jsonb,   -- [{id, slot, storage_path, captured_at, sha256}, ...]
  p_actor_user       uuid        default null,
  p_occurred_at      timestamptz default null,
  p_action_id        uuid        default null,          -- the outbox record id (D-MK23)
  p_arrived_at       timestamptz default null,          -- the Arrive the Complete carries (D-MK21, cD DR-9(1))
  p_arrive_action_id uuid        default null,          -- that Arrive's own record id, so the late Arrive is a replay
  p_mcleod_write     boolean     default false          -- the fleet kill only (D-MK12); read by T-4's block
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_access       text;
  v_load_source  text;
  v_load_status  text;
  v_external_id  text;
  v_stop_status  text;
  v_stop_seq     integer;
  v_stop_arrived timestamptz;
  v_removed_at   timestamptz;
  v_required     text[];
  v_missing      text[];
  v_now          timestamptz := coalesce(p_occurred_at, now());
  v_event_kind   text;
  v_has_reason   boolean := coalesce(btrim(p_skip_reason), '') <> '';
  v_photos       jsonb := case when jsonb_typeof(p_photos) = 'array' then p_photos else '[]'::jsonb end;
  v_added        integer;
  v_slots        text[];
  v_late_reason  text;
  v_sent_at      timestamptz;
  v_carried      timestamptz;
  v_time_flags   text[] := '{}'::text[];
  v_mcleod       text;
begin
  -- 1. the driver is in this organization (0141:77's check, inline: the replay check comes before access).
  if not exists (select 1 from public.drivers d where d.id = p_driver and d.org_id = p_org) then
    raise exception 'driver not in this organization' using errcode = 'DL002';
  end if;

  -- 2. a replay of an action this call already recorded.
  if public.load_action_seen(p_action_id, p_org, p_load, array['stop_arrived', 'stop_completed', 'stop_skipped'], p_stop) then
    return jsonb_build_object('status', 'replayed');
  end if;

  -- 3. access, the load (read with org_id, aA A-55), the status asked for, the stop.
  v_access := public.driver_load_access(p_org, p_driver, p_load);
  if v_access = 'none' then
    raise exception 'load not found for this driver' using errcode = 'DL002';
  end if;
  select l.source, l.status, l.external_id
    into v_load_source, v_load_status, v_external_id
    from public.loads l
   where l.id = p_load and l.org_id = p_org;

  if p_status is null or p_status not in ('arrived', 'completed', 'skipped') then
    raise exception 'illegal stop status %', p_status using errcode = 'DL010';
  end if;

  select s.status, s.seq, coalesce(s.required_photos, '{}'), s.arrived_at, s.mcleod_removed_at
    into v_stop_status, v_stop_seq, v_required, v_stop_arrived, v_removed_at
    from public.load_stops s
   where s.id = p_stop and s.load_id = p_load;
  if v_stop_seq is null then
    raise exception 'stop not found on this load' using errcode = 'DL005';
  end if;

  v_event_kind := case p_status
                    when 'arrived'   then 'stop_arrived'
                    when 'completed' then 'stop_completed'
                    when 'skipped'   then 'stop_skipped'
                  end;

  -- 4. late evidence (D-MK20, D-MK15): kept, flagged, and nothing of the current holder's is touched.
  --    Returns before the T-4 slot, so nothing is enqueued to McLeod.
  if v_access = 'late' or v_removed_at is not null then
    v_late_reason := case when v_access = 'late' then 'not_current_driver' else 'removed_in_mcleod' end;

    if jsonb_array_length(v_photos) > 0 then
      insert into public.load_stop_photos (id, org_id, load_id, stop_id, driver_id, slot, storage_path, captured_at, sha256)
      select (elem->>'id')::uuid, p_org, p_load, p_stop, p_driver, elem->>'slot', elem->>'storage_path',
             nullif(elem->>'captured_at', '')::timestamptz, nullif(elem->>'sha256', '')
        from jsonb_array_elements(v_photos) elem
      on conflict (id) do nothing;
    end if;

    insert into public.load_events (id, org_id, load_id, actor_user_id, actor_role, kind, payload, occurred_at)
    values (coalesce(p_action_id, gen_random_uuid()), p_org, p_load, p_actor_user, 'driver', v_event_kind,
            jsonb_build_object(
              'stop_id', p_stop,
              'seq', v_stop_seq,
              'photos', jsonb_array_length(v_photos),
              'skip_reason', p_skip_reason,
              'driver_id', p_driver,
              'action_id', p_action_id,
              'late_evidence', true,
              'late_reason', v_late_reason
            ),
            v_now);

    return jsonb_build_object('status', 'late_evidence', 'late_reason', v_late_reason);
  end if;

  -- 5. status gate. Manual: 0141:304-305 unchanged. tms: access 'current' already means one of the five
  --    statuses 0655's policies show (TMS_DRIVER_VISIBLE_STATUSES), so no second list is written here.
  if v_load_source <> 'tms' and v_load_status not in ('accepted', 'in_transit') then
    raise exception 'cannot work a stop in load status %', v_load_status using errcode = 'DL003';
  end if;

  -- 6. the same status again. The outbox retries, and a team's second seat re-sends: any NEW photo is
  --    recorded (0645's `stop_photo_added`, no new kind — cD DR-11 adjusted) and nothing else changes.
  --    The event takes a fresh id: the action id stays free for its own kind, so a replay of this very
  --    call is answered by the photos' client ids, not DL012.
  if v_stop_status = p_status then
    with added as (
      insert into public.load_stop_photos (id, org_id, load_id, stop_id, driver_id, slot, storage_path, captured_at, sha256)
      select (elem->>'id')::uuid, p_org, p_load, p_stop, p_driver, elem->>'slot', elem->>'storage_path',
             nullif(elem->>'captured_at', '')::timestamptz, nullif(elem->>'sha256', '')
        from jsonb_array_elements(v_photos) elem
      on conflict (id) do nothing
      returning slot
    )
    select count(*)::integer, array_agg(distinct slot order by slot) into v_added, v_slots from added;

    if v_added > 0 then
      insert into public.load_events (org_id, load_id, actor_user_id, actor_role, kind, payload, occurred_at)
      values (p_org, p_load, p_actor_user, 'driver', 'stop_photo_added',
              jsonb_build_object('stop_id', p_stop, 'seq', v_stop_seq, 'photos', v_added, 'slots', to_jsonb(v_slots),
                                 'driver_id', p_driver, 'action_id', p_action_id),
              v_now);
      return jsonb_build_object('status', 'photos_added', 'added', v_added);
    end if;
    return jsonb_build_object('status', 'replayed');
  end if;

  -- 7. a finished stop. A McLeod Arrive on it is the other seat's stale tap (cD DR-12): a no-op. Every
  --    other change of a finished stop is still refused (0141:313-315).
  if v_stop_status in ('completed', 'skipped') then
    if v_load_source = 'tms' and p_status = 'arrived' then
      return jsonb_build_object('status', 'already_done', 'stop_status', v_stop_status);
    end if;
    raise exception 'stop already %', v_stop_status using errcode = 'DL003';
  end if;

  -- 8. D21 (0141:318-337, unchanged): a skip needs a reason; a completion with a required photo missing
  --    needs one too.
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
       select elem->>'slot' from jsonb_array_elements(v_photos) elem
     );
    if v_missing is not null and not v_has_reason then
      raise exception 'required photo(s) missing without a reason: %', array_to_string(v_missing, ', ')
        using errcode = 'DL006';
    end if;
  end if;

  -- 9. times. Manual: 0141:342 unchanged (an arrival is stamped with the action's time when none is
  --    set). McLeod: Arrive stamps its own time; Complete takes ONLY the arrival it carries — never its
  --    own time (no fabricated arrival, spec A §3.1 step 5). M-A's plausibility rules (T2 §T-4.2): a
  --    carried arrival after the departure is not used and is flagged; an action before the current
  --    dispatch was sent is flagged. Evidence is never refused for a time; T-4's
  --    mcleod_stop_clear_outcome answers `implausible_time` when time_flags is non-empty.
  if v_load_source = 'tms' then
    select d.sent_at into v_sent_at
      from public.load_dispatches d
     where d.org_id = p_org and d.load_id = p_load
     order by d.sent_at desc, d.id desc
     limit 1;
    if v_sent_at is not null and v_now < v_sent_at then
      v_time_flags := v_time_flags || 'before_dispatch'::text;
    end if;
    if p_status = 'completed' and v_stop_arrived is null and p_arrived_at is not null then
      if p_arrived_at > v_now then
        v_time_flags := v_time_flags || 'arrival_after_departure'::text;
      else
        v_carried := p_arrived_at;
      end if;
    end if;
  end if;

  -- 10. the stop row (0141:340-346's shape) and its photos (0141:349-362, with the hash).
  update public.load_stops
     set status = p_status,
         arrived_at = case
                        when v_load_source = 'tms' then
                          case p_status
                            when 'arrived'   then coalesce(arrived_at, v_now)
                            when 'completed' then coalesce(arrived_at, v_carried)
                            else arrived_at
                          end
                        when p_status in ('arrived', 'completed') and arrived_at is null then v_now
                        else arrived_at
                      end,
         completed_at = case when p_status in ('completed', 'skipped') then v_now else completed_at end,
         skip_reason  = case when v_has_reason then p_skip_reason else skip_reason end,
         updated_at = now()
   where id = p_stop;

  -- The arrival a Complete carried is recorded as its own event under the Arrive's record id, so the
  -- Arrive record that syncs later is a replay (step 2), not a second arrival.
  if v_carried is not null then
    insert into public.load_events (id, org_id, load_id, actor_user_id, actor_role, kind, payload, occurred_at)
    values (coalesce(p_arrive_action_id, gen_random_uuid()), p_org, p_load, p_actor_user, 'driver', 'stop_arrived',
            jsonb_build_object('stop_id', p_stop, 'seq', v_stop_seq, 'photos', 0, 'driver_id', p_driver,
                               'action_id', p_arrive_action_id, 'carried_by', p_action_id),
            v_carried)
    on conflict (id) do nothing;
  end if;

  -- Photos land in the same transaction, idempotent by their client-supplied primary key.
  if jsonb_array_length(v_photos) > 0 then
    insert into public.load_stop_photos (id, org_id, load_id, stop_id, driver_id, slot, storage_path, captured_at, sha256)
    select (elem->>'id')::uuid, p_org, p_load, p_stop, p_driver, elem->>'slot', elem->>'storage_path',
           nullif(elem->>'captured_at', '')::timestamptz, nullif(elem->>'sha256', '')
      from jsonb_array_elements(v_photos) elem
    on conflict (id) do nothing;
  end if;

  -- 11. the load side. Manual only: the first worked stop starts the load (D45 F1, 0141:365-370). A
  --     McLeod load's status stays McLeod's (D-LMR2).
  if v_load_source <> 'tms' and v_load_status = 'accepted' and p_status in ('arrived', 'completed') then
    update public.loads set status = 'in_transit', updated_at = now() where id = p_load;

    insert into public.load_events (org_id, load_id, actor_user_id, actor_role, kind, from_status, to_status, occurred_at)
    values (p_org, p_load, p_actor_user, 'driver', 'started', 'accepted', 'in_transit', v_now);
  end if;

  -- 12. the McLeod write.
  v_mcleod := 'off';
  -- T-4 (v2/T2-transport.md §T-4.6) inserts the McLeod enqueue block here; v_load_source, v_external_id, v_now and v_mcleod are in scope.

  -- 13. the stop event, under the action id.
  insert into public.load_events (id, org_id, load_id, actor_user_id, actor_role, kind, payload, occurred_at)
  values (coalesce(p_action_id, gen_random_uuid()), p_org, p_load, p_actor_user, 'driver', v_event_kind,
          jsonb_build_object(
            'stop_id', p_stop,
            'seq', v_stop_seq,
            'photos', jsonb_array_length(v_photos),
            'skip_reason', p_skip_reason,
            'missing_photos', to_jsonb(coalesce(v_missing, '{}'::text[])),
            'driver_id', p_driver,
            'action_id', p_action_id,
            'time_flags', to_jsonb(v_time_flags),
            'mcleod_write', v_mcleod
          ),
          v_now);

  -- Manual: every stop finished → the load is delivered (0141:389-399). Not a McLeod load (D-LMR2).
  if v_load_source <> 'tms' and not exists (
    select 1 from public.load_stops
     where load_id = p_load and status not in ('completed', 'skipped')
  ) then
    update public.loads
       set status = 'delivered', completed_at = v_now, updated_at = now()
     where id = p_load;
    insert into public.load_events (org_id, load_id, actor_user_id, actor_role, kind, from_status, to_status, occurred_at)
    values (p_org, p_load, p_actor_user, 'driver', 'completed', 'in_transit', 'delivered', v_now);
  end if;

  -- 14. the answer.
  return jsonb_build_object('status', 'recorded', 'stop_status', p_status);
end;
$$;

comment on function public.driver_complete_stop(uuid, uuid, uuid, uuid, text, text, jsonb, uuid, timestamptz, uuid, timestamptz, uuid, boolean) is
  'Records a driver''s arrive / complete / skip on a stop (0141; McLeod actions, replays and late evidence since '
  '0661). Returns {status: recorded | replayed | photos_added | already_done | late_evidence, ...}.';

-- ── 9. driver_acknowledge_load: "Got it" (spec A §4.1, aA A-39/A-55) ──────────────────────────────
-- One `acknowledged` event per dispatch per driver: a second phone, or a replay, writes nothing; a
-- re-send is a new dispatch and is acknowledged again; both seats acknowledge separately.
create function public.driver_acknowledge_load(
  p_org         uuid,
  p_driver      uuid,
  p_load        uuid,
  p_action_id   uuid,
  p_actor_user  uuid        default null,
  p_occurred_at timestamptz default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_access   text;
  v_source   text;
  v_dispatch uuid;
begin
  if p_action_id is null then
    raise exception 'action id required' using errcode = 'DL015';
  end if;
  if not exists (select 1 from public.drivers d where d.id = p_driver and d.org_id = p_org) then
    raise exception 'driver not in this organization' using errcode = 'DL002';
  end if;
  if public.load_action_seen(p_action_id, p_org, p_load, array['acknowledged']) then
    return jsonb_build_object('status', 'replayed');
  end if;

  v_access := public.driver_load_access(p_org, p_driver, p_load);
  if v_access = 'none' then
    raise exception 'load not found for this driver' using errcode = 'DL002';
  end if;
  if v_access = 'late' then
    return jsonb_build_object('status', 'late_evidence');
  end if;

  select l.source into v_source from public.loads l where l.id = p_load and l.org_id = p_org;
  if v_source <> 'tms' then
    raise exception 'a manual load is accepted, not acknowledged' using errcode = 'DL014';
  end if;

  select d.id into v_dispatch
    from public.load_dispatches d
   where d.org_id = p_org and d.load_id = p_load
   order by d.sent_at desc, d.id desc
   limit 1;

  if exists (
    select 1 from public.load_events e
     where e.org_id = p_org and e.load_id = p_load and e.kind = 'acknowledged'
       and e.payload->>'dispatch_id' = v_dispatch::text
       and e.payload->>'driver_id' = p_driver::text
  ) then
    return jsonb_build_object('status', 'replayed', 'dispatch_id', v_dispatch);
  end if;

  insert into public.load_events (id, org_id, load_id, actor_user_id, actor_role, kind, payload, occurred_at)
  values (p_action_id, p_org, p_load, p_actor_user, 'driver', 'acknowledged',
          jsonb_build_object('dispatch_id', v_dispatch, 'driver_id', p_driver),
          coalesce(p_occurred_at, now()));

  return jsonb_build_object('status', 'recorded', 'dispatch_id', v_dispatch);
end;
$$;

comment on function public.driver_acknowledge_load(uuid, uuid, uuid, uuid, uuid, timestamptz) is
  'M-A (N-8): the driver''s "Got it" on the McLeod load the office sent — one acknowledged event per dispatch '
  'per driver. Returns {status: recorded | replayed | late_evidence, dispatch_id}.';

-- ── 10. driver_add_stop_photos (0645): same signature and return ─────────────────────────────────
-- The tms status gate is access 'current' (any of 0655's five) instead of 0645:79-80's in_transit /
-- delivered; a 'late' driver's photos are stored and the event is flagged. The 14-day window and the
-- photo checks are 0645's, unchanged; each photo's sha256 is stored.
create or replace function public.driver_add_stop_photos(
  p_org         uuid,
  p_driver      uuid,
  p_load        uuid,
  p_stop        uuid,
  p_photos      jsonb,                                   -- [{id, slot, storage_path, captured_at, sha256}, ...]
  p_actor_user  uuid        default null,
  p_occurred_at timestamptz default null
) returns integer                                        -- how many photos this call added
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_load_status  text;
  v_source       text;
  v_access       text;
  v_stop_status  text;
  v_stop_seq     integer;
  v_completed_at timestamptz;
  v_prefix       text := p_org::text || '/' || p_driver::text || '/';
  v_added        integer;
  v_slots        text[];
begin
  v_load_status := public.assert_driver_load(p_org, p_driver, p_load);
  v_access := public.driver_load_access(p_org, p_driver, p_load);
  select l.source into v_source from public.loads l where l.id = p_load and l.org_id = p_org;

  select s.status, s.seq, s.completed_at
    into v_stop_status, v_stop_seq, v_completed_at
    from public.load_stops s
   where s.id = p_stop and s.load_id = p_load;
  if v_stop_seq is null then
    raise exception 'stop not found on this load' using errcode = 'DL005';
  end if;
  -- Manual: 0645's gate. McLeod: assert_driver_load admitted 'current' (one of 0655's five statuses)
  -- or 'late' (stored and flagged below).
  if v_source <> 'tms' and v_load_status not in ('in_transit', 'delivered') then
    raise exception 'cannot add photos in load status %', v_load_status using errcode = 'DL003';
  end if;
  if v_stop_status <> 'completed' then
    raise exception 'late photos go on a completed stop (this one is %)', v_stop_status using errcode = 'DL003';
  end if;
  if v_completed_at is null or v_completed_at < now() - interval '14 days' then
    raise exception 'this stop finished more than 14 days ago' using errcode = 'DL007';
  end if;

  if jsonb_typeof(p_photos) is distinct from 'array' or jsonb_array_length(p_photos) = 0 then
    raise exception 'no photos to add' using errcode = 'DL010';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_photos) elem
     where coalesce(btrim(elem->>'slot'), '') = ''
        or coalesce(elem->>'storage_path', '') not like v_prefix || '%'
        or coalesce(elem->>'id', '') = ''
  ) then
    raise exception 'each photo needs an id, a slot and a path under this driver' using errcode = 'DL010';
  end if;

  with added as (
    insert into public.load_stop_photos (id, org_id, load_id, stop_id, driver_id, slot, storage_path, captured_at, sha256)
    select
      (elem->>'id')::uuid,
      p_org,
      p_load,
      p_stop,
      p_driver,
      elem->>'slot',
      elem->>'storage_path',
      nullif(elem->>'captured_at', '')::timestamptz,
      nullif(elem->>'sha256', '')
    from jsonb_array_elements(p_photos) elem
    on conflict (id) do nothing
    returning slot
  )
  select count(*)::integer, array_agg(distinct slot order by slot) into v_added, v_slots from added;

  if v_added > 0 then
    insert into public.load_events (org_id, load_id, actor_user_id, actor_role, kind, payload, occurred_at)
    values (p_org, p_load, p_actor_user, 'driver', 'stop_photo_added',
            jsonb_build_object('stop_id', p_stop, 'seq', v_stop_seq, 'photos', v_added, 'slots', to_jsonb(v_slots),
                               'driver_id', p_driver)
              || case when v_access = 'late'
                      then jsonb_build_object('late_evidence', true, 'late_reason', 'not_current_driver')
                      else '{}'::jsonb end,
            coalesce(p_occurred_at, now()));
  end if;

  return v_added;
end;
$$;

comment on function public.driver_add_stop_photos(uuid, uuid, uuid, uuid, jsonb, uuid, timestamptz) is
  'Adds late photos to a COMPLETED stop without touching it; returns how many were new (0645, D-DV30; McLeod '
  'access and the sha256 since 0661).';

-- ── grants: service role only, like every driver load function (0141) ─────────────────────────────
revoke all on function public.driver_accept_load(uuid, uuid, uuid, uuid, timestamptz, uuid) from public, anon, authenticated;
revoke all on function public.driver_decline_load(uuid, uuid, uuid, text, uuid, timestamptz, uuid) from public, anon, authenticated;
revoke all on function public.driver_start_load(uuid, uuid, uuid, uuid, timestamptz, uuid) from public, anon, authenticated;
revoke all on function public.driver_complete_stop(uuid, uuid, uuid, uuid, text, text, jsonb, uuid, timestamptz, uuid, timestamptz, uuid, boolean) from public, anon, authenticated;
revoke all on function public.driver_acknowledge_load(uuid, uuid, uuid, uuid, uuid, timestamptz) from public, anon, authenticated;
revoke all on function public.driver_add_stop_photos(uuid, uuid, uuid, uuid, jsonb, uuid, timestamptz) from public, anon, authenticated;

grant execute on function public.driver_accept_load(uuid, uuid, uuid, uuid, timestamptz, uuid) to service_role;
grant execute on function public.driver_decline_load(uuid, uuid, uuid, text, uuid, timestamptz, uuid) to service_role;
grant execute on function public.driver_start_load(uuid, uuid, uuid, uuid, timestamptz, uuid) to service_role;
grant execute on function public.driver_complete_stop(uuid, uuid, uuid, uuid, text, text, jsonb, uuid, timestamptz, uuid, timestamptz, uuid, boolean) to service_role;
grant execute on function public.driver_acknowledge_load(uuid, uuid, uuid, uuid, uuid, timestamptz) to service_role;
grant execute on function public.driver_add_stop_photos(uuid, uuid, uuid, uuid, jsonb, uuid, timestamptz) to service_role;
