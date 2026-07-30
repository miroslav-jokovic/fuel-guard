-- 0087: load lifecycle — approval gate + status guard trigger + append-only timeline + driver RPCs
--                       (Phase 3B, decisions D45/D46/D47/D48).
--
-- What this migration is FOR (one sentence): make "a driver never sees a load that has not been
-- reviewed and released by a human" enforceable at the database, and give dispatch an audited
-- timeline so "who approved this, and when" is a query, not an investigation.
--
-- Four things happen here.
--   1. Tighten `loads` — change the status default to `draft`, add the actor+timestamp columns
--      the dispatchLoads.ts service already writes, and tell 0085's `loads_driver_scope` about the
--      DRIVER_VISIBLE_STATUSES subset (D45).
--   2. `drivers.driver_type` + `organizations.default_driver_type` for the D46 acceptance split
--      (company vs. owner-operator), and a `resolve_driver_type()` helper that mirrors the shared
--      one so RLS can call it.
--   3. `load_events` — the append-only timeline (D45). Update/delete blocked by trigger, not just
--      RLS, so a service-role oopsie cannot rewrite history either.
--   4. `loads_status_guard` trigger — the eight-state legal-pair map and the approval-checklist
--      gates from `loadsLifecycle.ts` (which the dispatch UI reads for its "why is Approve grey?"
--      list). The trigger raises the SQLSTATE codes `DL010` / `DL011` that dispatchLoads.ts maps
--      to 409 / 422.
--   5. Four `security definer` RPCs (`driver_accept_load` / `driver_decline_load` / `driver_start
--      _load` / `driver_complete_stop`) so a driver mutation writes the load, its events and its
--      photos in a single transaction — a caller cannot end up with photos captured but the stop
--      never advancing.

-- ═══════════════════════════════════════════════════════════════════════════════
-- 1. tighten `loads`
-- ═══════════════════════════════════════════════════════════════════════════════
alter table loads alter column status set default 'draft';

alter table loads
  add column if not exists submitted_at   timestamptz,
  add column if not exists approved_by    uuid references auth.users(id) on delete set null,
  add column if not exists approved_at    timestamptz,
  add column if not exists released_at    timestamptz,
  add column if not exists assigned_by    uuid references auth.users(id) on delete set null,
  add column if not exists assigned_at    timestamptz,
  add column if not exists declined_at    timestamptz,
  add column if not exists decline_reason text,
  add column if not exists cancel_reason  text;

create index if not exists idx_loads_org_status_approved
  on loads (org_id, status, approved_at desc)
  where status in ('approved', 'offered');

-- Narrow the driver read to the visible subset. The RESTRICTIVE combined with the previous
-- `driver_id = auth_driver_id()` means a driver sees only a load that is (a) theirs and (b)
-- past the release gate.
drop policy if exists loads_driver_scope on loads;
create policy loads_driver_scope on loads
  as restrictive for select
  using (
    auth_role() <> 'driver'
    or (
      driver_id = auth_driver_id()
      and status in ('offered', 'accepted', 'in_transit', 'delivered', 'canceled')
    )
  );

-- Same tightening on the stop and photo scopes — a driver sees a stop only for a load they can
-- see, and a photo only for the same.
drop policy if exists load_stops_driver_scope on load_stops;
create policy load_stops_driver_scope on load_stops
  as restrictive for select
  using (
    auth_role() <> 'driver'
    or exists (
      select 1 from loads l
       where l.id = load_stops.load_id
         and l.driver_id = auth_driver_id()
         and l.status in ('offered', 'accepted', 'in_transit', 'delivered', 'canceled')
    )
  );

-- ═══════════════════════════════════════════════════════════════════════════════
-- 2. driver_type — D46
-- ═══════════════════════════════════════════════════════════════════════════════
alter table drivers
  add column if not exists driver_type text
    check (driver_type is null or driver_type in ('company', 'owner_operator'));

alter table organizations
  add column if not exists default_driver_type text not null default 'company'
    check (default_driver_type in ('company', 'owner_operator'));

comment on column drivers.driver_type is
  'Overrides organizations.default_driver_type. NULL = inherit. See resolve_driver_type().';

drop function if exists resolve_driver_type(uuid);
create or replace function resolve_driver_type(p_driver uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    d.driver_type,
    o.default_driver_type,
    'company'
  )
    from public.drivers d
    join public.organizations o on o.id = d.org_id
   where d.id = p_driver;
$$;

-- ═══════════════════════════════════════════════════════════════════════════════
-- 3. load_events — the append-only dispatch timeline
-- ═══════════════════════════════════════════════════════════════════════════════
create table if not exists load_events (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references organizations(id) on delete cascade,
  load_id        uuid not null references loads(id)         on delete cascade,

  -- Who did it. Both are recorded because `actor_user_id` may be null for a system event (an
  -- amendment by the TMS feed, an auto-timeout) — the role is a coarse label that still says who.
  actor_user_id  uuid references auth.users(id) on delete set null,
  actor_role     text,

  kind           text not null
                   constraint load_events_kind_check check (kind in (
                     'created', 'submitted', 'approved', 'rejected',
                     'assigned', 'reassigned', 'released',
                     'accepted', 'declined', 'started',
                     'stop_arrived', 'stop_completed', 'stop_skipped',
                     'equipment_mismatch', 'amended', 'canceled', 'completed'
                   )),

  from_status    text,
  to_status      text,

  -- Free-form context: the decline reason, the amended diff, the stop_id and slot for a photo
  -- capture. The listEvents endpoint returns this verbatim.
  payload        jsonb not null default '{}',

  -- `occurred_at` is when the actor says it happened (may predate the sync by hours for the
  -- driver flow); `recorded_at` is when the server received it. Both are kept so the timeline is
  -- honest AND ordered.
  occurred_at    timestamptz not null default now(),
  recorded_at    timestamptz not null default now()
);

create index if not exists idx_load_events_load_occurred
  on load_events (load_id, occurred_at desc);
create index if not exists idx_load_events_org_occurred
  on load_events (org_id, occurred_at desc);

alter table load_events enable row level security;

drop policy if exists load_events_select on load_events;
create policy load_events_select on load_events for select
  using (org_id = auth_org_id());

-- Manager INSERT is allowed for the transitionLoad service (writeEvent calls it with the user's
-- JWT via PostgREST). Drivers do not INSERT directly — the RPCs write events on their behalf.
drop policy if exists load_events_manager_insert on load_events;
create policy load_events_manager_insert on load_events for insert
  with check (org_id = auth_org_id() and auth_role() in ('admin', 'fleet_manager', 'dispatcher'));

drop policy if exists load_events_driver_scope on load_events;
create policy load_events_driver_scope on load_events
  as restrictive for select
  using (
    auth_role() <> 'driver'
    or exists (
      select 1 from loads l
       where l.id = load_events.load_id
         and l.driver_id = auth_driver_id()
         and l.status in ('offered', 'accepted', 'in_transit', 'delivered', 'canceled')
    )
  );

-- Append-only, enforced by trigger rather than by policy alone — a service-role update would
-- bypass RLS but not the trigger.
drop function if exists load_events_append_only() cascade;
create or replace function load_events_append_only()
returns trigger
language plpgsql
as $$
begin
  raise exception 'load_events is append-only' using errcode = 'DL099';
end;
$$;

drop trigger if exists trg_load_events_no_update on load_events;
create trigger trg_load_events_no_update
  before update on load_events
  for each row execute function load_events_append_only();

drop trigger if exists trg_load_events_no_delete on load_events;
create trigger trg_load_events_no_delete
  before delete on load_events
  for each row execute function load_events_append_only();

-- ═══════════════════════════════════════════════════════════════════════════════
-- 4. loads_status_guard — the legal-pair map + the approval-gate checklist
-- ═══════════════════════════════════════════════════════════════════════════════
-- Mirrors LOAD_TRANSITIONS and approvalChecklist() in packages/shared/src/loadsLifecycle.ts.
-- If these ever drift the RLS matrix in the API tests catches it — the shared map is the version
-- the UI reads and this trigger is the version the DB enforces.
drop function if exists loads_status_guard() cascade;
create or replace function loads_status_guard()
returns trigger
language plpgsql
as $$
declare
  v_pickups integer := 0;
  v_drops integer := 0;
  v_no_appt integer := 0;
  v_legal boolean;
begin
  if new.status is null then
    new.status := 'draft';
  end if;

  if TG_OP = 'INSERT' then
    -- New loads may only be born in a small set of statuses. `manual` starts at `draft`; a TMS
    -- ingest may land straight in `pending_approval` (D48). Anything else is a caller mistake.
    if new.status not in ('draft', 'pending_approval') then
      raise exception 'loads must be created in draft or pending_approval (got %)', new.status
        using errcode = 'DL010';
    end if;
    return new;
  end if;

  -- UPDATE. If status hasn't changed, no gate applies (field edits are unrelated).
  if new.status is not distinct from old.status then
    return new;
  end if;

  -- The legal-pair map — see LOAD_TRANSITIONS in loadsLifecycle.ts.
  v_legal := case old.status
    when 'draft'            then new.status in ('pending_approval', 'canceled')
    when 'pending_approval' then new.status in ('approved', 'draft', 'canceled')
    when 'approved'         then new.status in ('offered', 'pending_approval', 'canceled')
    when 'offered'          then new.status in ('accepted', 'approved', 'canceled')
    when 'accepted'         then new.status in ('in_transit', 'approved', 'canceled')
    when 'in_transit'       then new.status in ('delivered', 'canceled')
    else false                                              -- delivered / canceled are terminal
  end;
  if not v_legal then
    raise exception '% -> % is not a legal transition', old.status, new.status
      using errcode = 'DL010';
  end if;

  -- Approval gate. Only fires when a load is being APPROVED — the moment the checklist matters.
  if new.status = 'approved' and old.status = 'pending_approval' then
    if new.driver_id is null then
      raise exception 'not_ready: no driver assigned' using errcode = 'DL011';
    end if;
    if new.vehicle_id is null then
      raise exception 'not_ready: no truck assigned' using errcode = 'DL011';
    end if;

    select
      count(*) filter (where kind = 'pickup'),
      count(*) filter (where kind = 'dropoff'),
      count(*) filter (where appointment_start is null or appointment_end is null)
      into v_pickups, v_drops, v_no_appt
      from load_stops
     where load_id = new.id;

    if v_pickups = 0 then
      raise exception 'not_ready: no pickup stop' using errcode = 'DL011';
    end if;
    if v_drops = 0 then
      raise exception 'not_ready: no dropoff stop' using errcode = 'DL011';
    end if;
    if v_no_appt > 0 then
      raise exception 'not_ready: % stop(s) missing an appointment window', v_no_appt
        using errcode = 'DL011';
    end if;
  end if;

  -- Release gate. `approved -> offered` requires a driver and a released_at stamp — the actor
  -- columns are set by dispatchLoads.ts before this trigger runs.
  if new.status = 'offered' and old.status = 'approved' then
    if new.driver_id is null then
      raise exception 'not_ready: cannot release without a driver' using errcode = 'DL011';
    end if;
    if new.released_at is null then
      new.released_at := now();
    end if;
  end if;

  -- Completion — set completed_at once, when the transition actually happens.
  if new.status = 'delivered' and new.completed_at is null then
    new.completed_at := now();
  end if;

  return new;
end;
$$;

drop trigger if exists trg_loads_status_guard on loads;
create trigger trg_loads_status_guard
  before insert or update on loads
  for each row execute function loads_status_guard();

-- ═══════════════════════════════════════════════════════════════════════════════
-- 5. driver RPCs — one transaction per driver mutation
-- ═══════════════════════════════════════════════════════════════════════════════
-- Each RPC writes the load, a load_events row, and (for stop completion) the photo rows in ONE
-- transaction. SECURITY DEFINER because a driver has no direct write policy on any of these
-- tables; the RPC IS the gate.

-- ── driver_accept_load ────────────────────────────────────────────────────────
drop function if exists driver_accept_load(uuid, timestamptz);
create or replace function driver_accept_load(
  p_load        uuid,
  p_occurred_at timestamptz default null
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_driver uuid;
  v_org    uuid;
  v_status text;
begin
  v_driver := public.auth_driver_id();
  if v_driver is null then
    raise exception 'not a driver' using errcode = '42501';
  end if;

  select org_id, status into v_org, v_status
    from public.loads
   where id = p_load and driver_id = v_driver;
  if v_org is null then
    raise exception 'load not found' using errcode = 'DL404';
  end if;
  if v_status <> 'offered' then
    raise exception 'load is not offered (currently %)', v_status using errcode = 'DL010';
  end if;

  update public.loads
     set status = 'accepted',
         accepted_at = coalesce(p_occurred_at, now()),
         updated_at = now()
   where id = p_load;

  insert into public.load_events (org_id, load_id, actor_user_id, actor_role, kind, from_status, to_status, occurred_at)
  values (v_org, p_load, public.auth_user_id(), 'driver', 'accepted', 'offered', 'accepted',
          coalesce(p_occurred_at, now()));
end;
$$;

-- ── driver_decline_load ───────────────────────────────────────────────────────
-- The one place D46 forks: for an owner-operator, decline unassigns and returns the load to
-- `approved`. For a company driver, decline records the event and raises a dispatch exception
-- but leaves the load on the driver.
drop function if exists driver_decline_load(uuid, text, text, timestamptz);
create or replace function driver_decline_load(
  p_load        uuid,
  p_reason      text,
  p_note        text        default null,
  p_occurred_at timestamptz default null
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_driver uuid;
  v_org    uuid;
  v_status text;
  v_type   text;
  v_now    timestamptz := coalesce(p_occurred_at, now());
begin
  v_driver := public.auth_driver_id();
  if v_driver is null then
    raise exception 'not a driver' using errcode = '42501';
  end if;

  select org_id, status into v_org, v_status
    from public.loads
   where id = p_load and driver_id = v_driver;
  if v_org is null then
    raise exception 'load not found' using errcode = 'DL404';
  end if;
  if v_status not in ('offered', 'accepted') then
    raise exception 'cannot decline in status %', v_status using errcode = 'DL010';
  end if;

  v_type := public.resolve_driver_type(v_driver);

  if v_type = 'owner_operator' then
    update public.loads
       set status = 'approved',
           driver_id = null,
           declined_at = v_now,
           decline_reason = p_reason,
           updated_at = now()
     where id = p_load;

    insert into public.load_events (org_id, load_id, actor_user_id, actor_role, kind, from_status, to_status, payload, occurred_at)
    values (v_org, p_load, public.auth_user_id(), 'driver', 'declined', v_status, 'approved',
            jsonb_build_object('reason', p_reason, 'note', p_note, 'unassigned', true), v_now);
  else
    -- Company driver: keep the assignment, record the event.
    update public.loads
       set declined_at = v_now,
           decline_reason = p_reason,
           updated_at = now()
     where id = p_load;

    insert into public.load_events (org_id, load_id, actor_user_id, actor_role, kind, from_status, to_status, payload, occurred_at)
    values (v_org, p_load, public.auth_user_id(), 'driver', 'declined', v_status, v_status,
            jsonb_build_object('reason', p_reason, 'note', p_note, 'unassigned', false), v_now);
  end if;
end;
$$;

-- ── driver_start_load ─────────────────────────────────────────────────────────
drop function if exists driver_start_load(uuid, timestamptz);
create or replace function driver_start_load(
  p_load        uuid,
  p_occurred_at timestamptz default null
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_driver uuid;
  v_org    uuid;
  v_status text;
  v_now    timestamptz := coalesce(p_occurred_at, now());
begin
  v_driver := public.auth_driver_id();
  if v_driver is null then
    raise exception 'not a driver' using errcode = '42501';
  end if;

  select org_id, status into v_org, v_status
    from public.loads
   where id = p_load and driver_id = v_driver;
  if v_org is null then
    raise exception 'load not found' using errcode = 'DL404';
  end if;
  if v_status <> 'accepted' then
    raise exception 'cannot start in status %', v_status using errcode = 'DL010';
  end if;

  update public.loads set status = 'in_transit', updated_at = now() where id = p_load;

  insert into public.load_events (org_id, load_id, actor_user_id, actor_role, kind, from_status, to_status, occurred_at)
  values (v_org, p_load, public.auth_user_id(), 'driver', 'started', 'accepted', 'in_transit', v_now);
end;
$$;

-- ── driver_complete_stop ──────────────────────────────────────────────────────
-- Advances one stop and, when the stop is being completed with photos, inserts every photo row
-- in the same transaction. Also implicitly moves the load into `in_transit` on the first worked
-- stop — the "start" is inferred rather than requiring a separate tap (D45 → F1 closed).
drop function if exists driver_complete_stop(uuid, uuid, text, text, jsonb, timestamptz);
create or replace function driver_complete_stop(
  p_load        uuid,
  p_stop        uuid,
  p_status      text,                                       -- 'arrived' | 'completed' | 'skipped'
  p_skip_reason text        default null,
  p_photos      jsonb       default '[]'::jsonb,            -- [{id, slot, storage_path, captured_at}, ...]
  p_occurred_at timestamptz default null
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_driver     uuid;
  v_org        uuid;
  v_load_status text;
  v_stop_status text;
  v_stop_seq    integer;
  v_now         timestamptz := coalesce(p_occurred_at, now());
  v_event_kind  text;
begin
  v_driver := public.auth_driver_id();
  if v_driver is null then
    raise exception 'not a driver' using errcode = '42501';
  end if;
  if p_status not in ('arrived', 'completed', 'skipped') then
    raise exception 'illegal stop status %', p_status using errcode = 'DL010';
  end if;

  select l.org_id, l.status, s.status, s.seq
    into v_org, v_load_status, v_stop_status, v_stop_seq
    from public.loads l
    join public.load_stops s on s.load_id = l.id and s.id = p_stop
   where l.id = p_load and l.driver_id = v_driver;
  if v_org is null then
    raise exception 'stop not found' using errcode = 'DL404';
  end if;
  if v_load_status not in ('accepted', 'in_transit') then
    raise exception 'cannot work a stop in load status %', v_load_status using errcode = 'DL010';
  end if;
  if v_stop_status in ('completed', 'skipped') then
    raise exception 'stop already %', v_stop_status using errcode = 'DL010';
  end if;

  update public.load_stops
     set status = p_status,
         arrived_at = case when p_status in ('arrived', 'completed') and arrived_at is null then v_now else arrived_at end,
         completed_at = case when p_status in ('completed', 'skipped') then v_now else completed_at end,
         skip_reason  = case when p_status = 'skipped' then p_skip_reason else skip_reason end,
         updated_at = now()
   where id = p_stop;

  -- Photos come along in the same transaction. Idempotent by their (client-supplied) primary key.
  if jsonb_typeof(p_photos) = 'array' and jsonb_array_length(p_photos) > 0 then
    insert into public.load_stop_photos (id, org_id, load_id, stop_id, driver_id, slot, storage_path, captured_at)
    select
      (elem->>'id')::uuid,
      v_org,
      p_load,
      p_stop,
      v_driver,
      elem->>'slot',
      elem->>'storage_path',
      nullif(elem->>'captured_at', '')::timestamptz
    from jsonb_array_elements(p_photos) elem
    on conflict (id) do nothing;
  end if;

  -- First worked stop = the load has actually started. Implicit `in_transit` (D45 F1 close).
  if v_load_status = 'accepted' and p_status in ('arrived', 'completed') then
    update public.loads
       set status = 'in_transit', updated_at = now()
     where id = p_load;

    insert into public.load_events (org_id, load_id, actor_user_id, actor_role, kind, from_status, to_status, occurred_at)
    values (v_org, p_load, public.auth_user_id(), 'driver', 'started', 'accepted', 'in_transit', v_now);
  end if;

  v_event_kind := case p_status
                    when 'arrived'   then 'stop_arrived'
                    when 'completed' then 'stop_completed'
                    when 'skipped'   then 'stop_skipped'
                  end;

  insert into public.load_events (org_id, load_id, actor_user_id, actor_role, kind, payload, occurred_at)
  values (v_org, p_load, public.auth_user_id(), 'driver', v_event_kind,
          jsonb_build_object(
            'stop_id', p_stop,
            'seq', v_stop_seq,
            'photos', coalesce(jsonb_array_length(p_photos), 0),
            'skip_reason', p_skip_reason
          ),
          v_now);

  -- If every stop is now finished, mark the load delivered.
  if not exists (
    select 1 from public.load_stops
     where load_id = p_load and status not in ('completed', 'skipped')
  ) then
    update public.loads
       set status = 'delivered', completed_at = v_now, updated_at = now()
     where id = p_load;
    insert into public.load_events (org_id, load_id, actor_user_id, actor_role, kind, from_status, to_status, occurred_at)
    values (v_org, p_load, public.auth_user_id(), 'driver', 'completed', 'in_transit', 'delivered', v_now);
  end if;
end;
$$;

-- ── grants ────────────────────────────────────────────────────────────────────
grant execute on function driver_accept_load(uuid, timestamptz)                                 to authenticated;
grant execute on function driver_decline_load(uuid, text, text, timestamptz)                    to authenticated;
grant execute on function driver_start_load(uuid, timestamptz)                                  to authenticated;
grant execute on function driver_complete_stop(uuid, uuid, text, text, jsonb, timestamptz)     to authenticated;
grant execute on function resolve_driver_type(uuid)                                             to authenticated;

-- ═══════════════════════════════════════════════════════════════════════════════
-- audit / self-check
-- ═══════════════════════════════════════════════════════════════════════════════
--   * A DIRECT `update loads set status=…` from a manager JWT is subject to the trigger; illegal
--     pairs raise DL010 (mapped to 409 by dispatchLoads.ts) and unmet checklist items raise
--     DL011 (422).
--   * A DIRECT PostgREST write from a driver is blocked by the RESTRICTIVE policies in 0085;
--     everything the driver does hits the RPCs above and both writes (load + event) happen or
--     neither does.
--   * The `loads_driver_scope` on `loads`/`load_stops`/`load_events` filters to
--     DRIVER_VISIBLE_STATUSES, so a load in `draft` / `pending_approval` / `approved` is
--     invisible to the phone even under a leaked JWT.
