-- FuelGuard — 0087 load lifecycle & the dispatch approval gate (Driver App, Phase 3B)
--
-- WHY THIS EXISTS (DRIVER-APP-PLAN.md §14.2b / §14.5, decisions D45 + D46 + D47).
-- `0085` gave `loads.status` a default of 'offered' and scoped drivers with
-- `driver_id = auth_driver_id()` alone. Together those mean a row is on a driver's phone the instant
-- it is INSERTed — including anything a McLeod feed writes. There was no `draft`, no
-- `pending_approval`, no `approved_by`, and no transition guard: the CHECK constraint happily allowed
-- any status to become any other. Approval was not merely un-built; the model had nowhere to put it.
--
-- THE GATE. Driver visibility now starts at 'offered' and is expressed in the RLS predicate itself —
-- because RLS, not the API, is this app's authorization boundary (§1). If the gate were only an API
-- check, a driver holding the anon key + their JWT could read an unapproved load straight from
-- PostgREST. `rls.test.mjs` asserts exactly that it cannot.
--
-- THREE LAYERS OF TRANSITION ENFORCEMENT, on purpose:
--   1. `packages/shared/src/loadsContract.ts` — LOAD_TRANSITIONS + approvalChecklist(): the dispatch
--      UI disables Approve and names what is missing, so the operator is never guessing.
--   2. The API — one endpoint per transition, never a `PATCH status`.
--   3. `loads_status_guard` below — the backstop that holds even against a direct PostgREST write or
--      a service-role bug. The duplication with (1) is deliberate: the UI explains, the DB enforces.
--
-- ADDITIVE. Existing rows keep their status; only the DEFAULT changes. No column is dropped. Three
-- policies from `0085` are REPLACED (drop-then-create, the 0078 pattern) to add the status predicate.

-- ── org-level policy knobs ────────────────────────────────────────────────────
alter table organizations
  add column if not exists default_driver_type text not null default 'company',
  add column if not exists require_separate_approver boolean not null default false;
do $$ begin
  alter table organizations add constraint organizations_default_driver_type_check
    check (default_driver_type in ('company', 'owner_operator'));
exception when duplicate_object then null; end $$;

-- ── D46: company driver vs owner-operator ─────────────────────────────────────
-- One accept MECHANISM, two semantics. This column selects the copy the driver sees and whether a
-- decline auto-unassigns — never a second state machine. Resolution is `driver ?? org default`.
alter table drivers add column if not exists driver_type text;
do $$ begin
  alter table drivers add constraint drivers_driver_type_check
    check (driver_type is null or driver_type in ('company', 'owner_operator'));
exception when duplicate_object then null; end $$;

-- ── the lifecycle ─────────────────────────────────────────────────────────────
--   draft ─▶ pending_approval ─▶ approved ─▶ offered ─▶ accepted ─▶ in_transit ─▶ delivered
--                                    ▲                     │
--                                    └──── decline ────────┘         (any live state) ─▶ canceled
alter table loads drop constraint if exists loads_status_check;
alter table loads add constraint loads_status_check check (status in (
  'draft', 'pending_approval', 'approved', 'offered', 'accepted', 'in_transit', 'delivered', 'canceled'
));

-- THE line that stops an unreviewed row reaching a phone.
alter table loads alter column status set default 'draft';

alter table loads
  add column if not exists created_by      uuid references auth.users(id) on delete set null,
  add column if not exists submitted_at    timestamptz,
  add column if not exists approved_by     uuid references auth.users(id) on delete set null,
  add column if not exists approved_at     timestamptz,
  add column if not exists released_at     timestamptz,
  add column if not exists assigned_by     uuid references auth.users(id) on delete set null,
  add column if not exists assigned_at     timestamptz,
  add column if not exists declined_at     timestamptz,
  add column if not exists decline_reason  text,
  add column if not exists cancel_reason   text,
  -- The duty session the driver was in when they accepted: a stable historical join from a load to
  -- the equipment ACTUALLY used (0086). Nothing about equipment is denormalized onto the load —
  -- the segments already hold it exactly, per instant.
  add column if not exists duty_session_id uuid references driver_duty_sessions(id) on delete set null;

-- Dispatch's queue reads (org, status, first appointment); the driver's read is already covered by
-- idx_loads_driver from 0085.
create index if not exists idx_loads_pending on loads (org_id, status, created_at desc)
  where status in ('draft', 'pending_approval', 'approved');

-- ── load_events — the append-only timeline ────────────────────────────────────
-- `occurred_at` is when it HAPPENED (a driver may have been offline for hours); `recorded_at` is when
-- we learned. Keeping both is what makes the timeline honest about offline work.
create table if not exists load_events (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references organizations(id) on delete cascade,
  load_id         uuid not null references loads(id) on delete cascade,
  actor_user_id   uuid references auth.users(id) on delete set null,
  actor_role      text,
  actor_driver_id uuid references drivers(id) on delete set null,
  kind            text not null,
  from_status     text,
  to_status       text,
  payload         jsonb not null default '{}',
  occurred_at     timestamptz not null default now(),
  recorded_at     timestamptz not null default now(),
  constraint load_events_kind_check check (kind in (
    'created', 'submitted', 'approved', 'rejected', 'assigned', 'reassigned', 'released',
    'accepted', 'declined', 'started', 'stop_arrived', 'stop_completed', 'stop_skipped',
    'equipment_mismatch', 'amended', 'canceled', 'completed'
  ))
);
create index if not exists idx_load_events_load on load_events (load_id, occurred_at desc);
create index if not exists idx_load_events_org_kind on load_events (org_id, kind, occurred_at desc);

-- ── RLS ───────────────────────────────────────────────────────────────────────
alter table load_events enable row level security;

drop policy if exists load_events_select on load_events;
create policy load_events_select on load_events for select using (org_id = auth_org_id());

-- Dispatch may append (the API uses the service role, but the web dashboard talks PostgREST too).
drop policy if exists load_events_insert on load_events;
create policy load_events_insert on load_events for insert
  with check (org_id = auth_org_id() and auth_role() in ('admin', 'fleet_manager', 'dispatcher'));

-- NO update and NO delete policy for ANY role — this is evidence. A correction is a new row.
-- RLS alone would still let the service role rewrite history, so a trigger makes it true outright.
create or replace function load_events_append_only()
returns trigger language plpgsql as $$
begin
  raise exception 'load_events is append-only (attempted %)', tg_op using errcode = 'DL009';
end;
$$;
drop trigger if exists trg_load_events_append_only on load_events;
create trigger trg_load_events_append_only
  before update or delete on load_events
  for each row execute function load_events_append_only();

-- A driver reads only events on loads they can already see.
drop policy if exists load_events_driver_scope on load_events;
create policy load_events_driver_scope on load_events as restrictive
  for select using (
    auth_role() <> 'driver'
    or exists (
      select 1 from public.loads l
      where l.id = load_events.load_id
        and l.driver_id = public.auth_driver_id()
        and l.status in ('offered', 'accepted', 'in_transit', 'delivered', 'canceled')
    )
  );

-- ── THE APPROVAL GATE, expressed where it counts ──────────────────────────────
-- Replaces the 0085 scopes. Before: `driver_id = auth_driver_id()`. After: that AND a driver-visible
-- status. A `draft` or `pending_approval` row assigned to a driver is now invisible to them.
drop policy if exists loads_driver_scope on loads;
create policy loads_driver_scope on loads as restrictive
  for select using (
    auth_role() <> 'driver'
    or (
      driver_id = auth_driver_id()
      and status in ('offered', 'accepted', 'in_transit', 'delivered', 'canceled')
    )
  );

drop policy if exists load_stops_driver_scope on load_stops;
create policy load_stops_driver_scope on load_stops as restrictive
  for select using (
    auth_role() <> 'driver'
    or exists (
      select 1 from public.loads l
      where l.id = load_stops.load_id
        and l.driver_id = public.auth_driver_id()
        and l.status in ('offered', 'accepted', 'in_transit', 'delivered', 'canceled')
    )
  );

drop policy if exists load_stop_photos_driver_scope on load_stop_photos;
create policy load_stop_photos_driver_scope on load_stop_photos as restrictive
  for select using (
    auth_role() <> 'driver'
    or (
      driver_id = auth_driver_id()
      and exists (
        select 1 from public.loads l
        where l.id = load_stop_photos.load_id
          and l.driver_id = public.auth_driver_id()
          and l.status in ('offered', 'accepted', 'in_transit', 'delivered', 'canceled')
      )
    )
  );

-- ── the transition guard ──────────────────────────────────────────────────────
-- Mirrors LOAD_TRANSITIONS + approvalChecklist() in packages/shared/src/loadsContract.ts. Raises
-- DL010 for an illegal pair and DL011 when a gate's preconditions are unmet, so the API can tell an
-- operator "you can't do that from here" apart from "this load isn't ready yet".
create or replace function loads_status_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_allowed text[];
  v_pickups int;
  v_drops   int;
  v_no_appt int;
  v_open    int;
  v_sep     boolean;
begin
  if new.status is not distinct from old.status then
    return new;
  end if;

  v_allowed := case old.status
    when 'draft'            then array['pending_approval', 'canceled']
    when 'pending_approval' then array['approved', 'draft', 'canceled']
    -- 'approved' → 'pending_approval' is dispatch un-approving; a decline also lands back here.
    when 'approved'         then array['offered', 'pending_approval', 'canceled']
    when 'offered'          then array['accepted', 'approved', 'canceled']
    when 'accepted'         then array['in_transit', 'approved', 'canceled']
    when 'in_transit'       then array['delivered', 'canceled']
    else array[]::text[]     -- delivered and canceled are terminal
  end;

  if not (new.status = any (v_allowed)) then
    raise exception 'illegal load transition % -> %', old.status, new.status using errcode = 'DL010';
  end if;

  -- Gate 1 — approval. A load is only approvable once it is actually complete enough to work.
  if new.status = 'approved' and old.status = 'pending_approval' then
    select count(*) filter (where kind = 'pickup'),
           count(*) filter (where kind = 'dropoff'),
           count(*) filter (where appointment_start is null or appointment_end is null)
      into v_pickups, v_drops, v_no_appt
    from public.load_stops where load_id = new.id;

    if new.driver_id is null then
      raise exception 'cannot approve: no driver assigned' using errcode = 'DL011';
    end if;
    if new.vehicle_id is null then
      raise exception 'cannot approve: no truck assigned' using errcode = 'DL011';
    end if;
    if coalesce(v_pickups, 0) < 1 or coalesce(v_drops, 0) < 1 then
      raise exception 'cannot approve: need at least one pickup and one dropoff' using errcode = 'DL011';
    end if;
    if coalesce(v_no_appt, 0) > 0 then
      raise exception 'cannot approve: % stop(s) missing an appointment window', v_no_appt using errcode = 'DL011';
    end if;
    if new.approved_by is null then
      raise exception 'cannot approve: approved_by is required' using errcode = 'DL011';
    end if;

    select require_separate_approver into v_sep from public.organizations where id = new.org_id;
    if coalesce(v_sep, false) and new.approved_by is not distinct from new.created_by then
      raise exception 'cannot approve your own load (separation of duties is on for this org)'
        using errcode = 'DL011';
    end if;
    new.approved_at := coalesce(new.approved_at, now());
  end if;

  -- Gate 2 — release. Nothing reaches a phone without a driver and a release stamp.
  if new.status = 'offered' and old.status = 'approved' then
    if new.driver_id is null then
      raise exception 'cannot release: no driver assigned' using errcode = 'DL011';
    end if;
    new.released_at := coalesce(new.released_at, now());
  end if;

  -- Gate 3 — delivery. Every stop must be resolved (completed or explicitly skipped).
  if new.status = 'delivered' then
    select count(*) into v_open
    from public.load_stops
    where load_id = new.id and status not in ('completed', 'skipped');
    if coalesce(v_open, 0) > 0 then
      raise exception 'cannot deliver: % stop(s) still open', v_open using errcode = 'DL011';
    end if;
    new.completed_at := coalesce(new.completed_at, now());
  end if;

  if new.status = 'accepted' then new.accepted_at := coalesce(new.accepted_at, now()); end if;
  if new.status = 'pending_approval' and old.status = 'draft' then
    new.submitted_at := coalesce(new.submitted_at, now());
  end if;

  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_loads_status_guard on loads;
create trigger trg_loads_status_guard
  before update of status on loads
  for each row execute function loads_status_guard();

-- ═════════════════════════════════════════════════════════════════════════════
-- Atomic driver-side transitions (called by the driver-scoped API, service role).
--
-- Same reasoning as 0086: each of these writes the load AND one or more load_events AND, for a stop,
-- its photos — and supabase-js cannot span a transaction. Doing it in three calls would leave a load
-- accepted with no event, or photos recorded against a stop that never advanced.
--   DL001 not offered to you · DL002 not yours · DL003 wrong state · DL004 no active duty session
--   DL005 stop not on this load · DL006 required photo missing and no reason given
-- ═════════════════════════════════════════════════════════════════════════════

/** Resolve company vs owner-operator: driver override, else the org default (D46). */
create or replace function resolve_driver_type(p_org uuid, p_driver uuid)
returns text
language sql stable security definer set search_path = ''
as $$
  select coalesce(
    (select d.driver_type from public.drivers d where d.id = p_driver and d.org_id = p_org),
    (select o.default_driver_type from public.organizations o where o.id = p_org),
    'company'
  );
$$;

create or replace function driver_accept_load(
  p_org uuid, p_driver uuid, p_load uuid,
  p_actor_user uuid default null,
  p_occurred_at timestamptz default null
)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_at      timestamptz := coalesce(p_occurred_at, now());
  v_load    public.loads%rowtype;
  v_session uuid;
  v_seg     public.duty_equipment_segments%rowtype;
begin
  select * into v_load from public.loads where id = p_load and org_id = p_org;
  if v_load.id is null or v_load.driver_id is distinct from p_driver then
    raise exception 'load is not assigned to you' using errcode = 'DL002';
  end if;
  -- Idempotent: a replayed offline accept returns the same load rather than erroring.
  if v_load.status in ('accepted', 'in_transit') then return p_load; end if;
  if v_load.status <> 'offered' then
    raise exception 'load is % , not offered', v_load.status using errcode = 'DL001';
  end if;

  -- The duty session the driver is in right now — the stable join from load to actual equipment.
  select id into v_session from public.driver_duty_sessions
  where org_id = p_org and driver_id = p_driver and ended_at is null;

  update public.loads
     set status = 'accepted', duty_session_id = coalesce(v_session, duty_session_id), accepted_at = v_at
   where id = p_load;

  insert into public.load_events (org_id, load_id, actor_user_id, actor_role, actor_driver_id,
                                  kind, from_status, to_status, payload, occurred_at)
  values (p_org, p_load, p_actor_user, 'driver', p_driver, 'accepted', v_load.status, 'accepted',
          jsonb_build_object('driver_type', public.resolve_driver_type(p_org, p_driver),
                             'duty_session_id', v_session),
          v_at);

  -- D47 — planned vs actual equipment: FLAG, never overwrite, never block.
  if v_session is not null then
    select * into v_seg from public.duty_equipment_segments
    where session_id = v_session and to_at is null;
    if v_seg.id is not null and (
         (v_load.vehicle_id is not null and v_load.vehicle_id is distinct from v_seg.vehicle_id)
      or (v_load.trailer_id is not null and v_load.trailer_id is distinct from v_seg.trailer_id))
    then
      insert into public.load_events (org_id, load_id, actor_user_id, actor_role, actor_driver_id,
                                      kind, from_status, to_status, payload, occurred_at)
      values (p_org, p_load, p_actor_user, 'driver', p_driver, 'equipment_mismatch', 'accepted', 'accepted',
              jsonb_build_object(
                'planned_vehicle_id', v_load.vehicle_id, 'actual_vehicle_id', v_seg.vehicle_id,
                'planned_trailer_id', v_load.trailer_id, 'actual_trailer_id', v_seg.trailer_id),
              v_at);
    end if;
  end if;

  return p_load;
end;
$$;

create or replace function driver_decline_load(
  p_org uuid, p_driver uuid, p_load uuid,
  p_reason text,
  p_actor_user uuid default null,
  p_occurred_at timestamptz default null
)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_at    timestamptz := coalesce(p_occurred_at, now());
  v_load  public.loads%rowtype;
  v_type  text;
begin
  select * into v_load from public.loads where id = p_load and org_id = p_org;
  if v_load.id is null or v_load.driver_id is distinct from p_driver then
    raise exception 'load is not assigned to you' using errcode = 'DL002';
  end if;
  if v_load.status not in ('offered', 'accepted') then
    raise exception 'cannot decline a load that is %', v_load.status using errcode = 'DL003';
  end if;

  v_type := public.resolve_driver_type(p_org, p_driver);

  -- The ONLY behavioural difference between the two populations (D46): an owner-operator's decline
  -- returns the load to the dispatch queue; a company driver's is an exception dispatch resolves.
  if v_type = 'owner_operator' then
    update public.loads
       set status = 'approved', driver_id = null, duty_session_id = null,
           declined_at = v_at, decline_reason = p_reason, released_at = null
     where id = p_load;
  else
    update public.loads
       set declined_at = v_at, decline_reason = p_reason, updated_at = now()
     where id = p_load;
  end if;

  insert into public.load_events (org_id, load_id, actor_user_id, actor_role, actor_driver_id,
                                  kind, from_status, to_status, payload, occurred_at)
  values (p_org, p_load, p_actor_user, 'driver', p_driver, 'declined', v_load.status,
          case when v_type = 'owner_operator' then 'approved' else v_load.status end,
          jsonb_build_object('reason', p_reason, 'driver_type', v_type, 'unassigned', v_type = 'owner_operator'),
          v_at);
  return p_load;
end;
$$;

create or replace function driver_start_load(
  p_org uuid, p_driver uuid, p_load uuid,
  p_actor_user uuid default null,
  p_occurred_at timestamptz default null
)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_at   timestamptz := coalesce(p_occurred_at, now());
  v_load public.loads%rowtype;
begin
  select * into v_load from public.loads where id = p_load and org_id = p_org;
  if v_load.id is null or v_load.driver_id is distinct from p_driver then
    raise exception 'load is not assigned to you' using errcode = 'DL002';
  end if;
  if v_load.status = 'in_transit' then return p_load; end if;   -- idempotent replay
  if v_load.status <> 'accepted' then
    raise exception 'cannot start a load that is %', v_load.status using errcode = 'DL003';
  end if;

  update public.loads set status = 'in_transit' where id = p_load;
  insert into public.load_events (org_id, load_id, actor_user_id, actor_role, actor_driver_id,
                                  kind, from_status, to_status, occurred_at)
  values (p_org, p_load, p_actor_user, 'driver', p_driver, 'started', 'accepted', 'in_transit', v_at);
  return p_load;
end;
$$;

/**
 * Advance one stop and record its photos. `p_photos` is a JSON array of
 * {id, slot, storage_path, captured_at} — the `id` is the CLIENT UUID from the outbox and the row PK,
 * so a replayed sync collides and no-ops instead of double-posting.
 *
 * Also does the two implicit load transitions, which is why F1 ("in_transit was unreachable") is
 * closed here rather than in the app: the first worked stop moves an accepted load to in_transit, and
 * the last resolved stop moves it to delivered.
 */
create or replace function driver_complete_stop(
  p_org uuid, p_driver uuid, p_load uuid, p_stop uuid,
  p_status text,
  p_skip_reason text default null,
  p_photos jsonb default '[]'::jsonb,
  p_actor_user uuid default null,
  p_occurred_at timestamptz default null
)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_at      timestamptz := coalesce(p_occurred_at, now());
  v_load    public.loads%rowtype;
  v_stop    public.load_stops%rowtype;
  v_missing text[];
  v_open    int;
begin
  select * into v_load from public.loads where id = p_load and org_id = p_org;
  if v_load.id is null or v_load.driver_id is distinct from p_driver then
    raise exception 'load is not assigned to you' using errcode = 'DL002';
  end if;
  if v_load.status not in ('accepted', 'in_transit') then
    raise exception 'cannot work a load that is %', v_load.status using errcode = 'DL003';
  end if;

  select * into v_stop from public.load_stops where id = p_stop and load_id = p_load;
  if v_stop.id is null then
    raise exception 'stop is not on this load' using errcode = 'DL005';
  end if;

  -- Photos first, so the completeness check below sees what was just uploaded.
  insert into public.load_stop_photos (id, org_id, load_id, stop_id, driver_id, slot, storage_path, captured_at)
  select (p ->> 'id')::uuid, p_org, p_load, p_stop, p_driver, p ->> 'slot', p ->> 'storage_path',
         nullif(p ->> 'captured_at', '')::timestamptz
  from jsonb_array_elements(coalesce(p_photos, '[]'::jsonb)) as p
  on conflict (id) do nothing;

  -- Never a dead-end (D21): a missing required photo does not block the driver, but it does demand an
  -- explicit reason, and that reason is on the record.
  if p_status = 'completed' then
    select array_agg(slot) into v_missing
    from unnest(v_stop.required_photos) as slot
    where not exists (
      select 1 from public.load_stop_photos ph where ph.stop_id = p_stop and ph.slot = slot
    );
    if coalesce(array_length(v_missing, 1), 0) > 0 and coalesce(btrim(p_skip_reason), '') = '' then
      raise exception 'missing required photo(s): % — a reason is required',
        array_to_string(v_missing, ', ') using errcode = 'DL006';
    end if;
  end if;

  update public.load_stops
     set status = p_status,
         arrived_at = case when p_status = 'arrived' then coalesce(arrived_at, v_at) else arrived_at end,
         completed_at = case when p_status in ('completed', 'skipped') then coalesce(completed_at, v_at) else completed_at end,
         skip_reason = coalesce(nullif(btrim(coalesce(p_skip_reason, '')), ''), skip_reason),
         updated_at = now()
   where id = p_stop;

  insert into public.load_events (org_id, load_id, actor_user_id, actor_role, actor_driver_id,
                                  kind, payload, occurred_at)
  values (p_org, p_load, p_actor_user, 'driver', p_driver,
          case p_status when 'arrived' then 'stop_arrived'
                        when 'skipped' then 'stop_skipped'
                        else 'stop_completed' end,
          jsonb_build_object('stop_id', p_stop, 'seq', v_stop.seq,
                             'photos', jsonb_array_length(coalesce(p_photos, '[]'::jsonb)),
                             'missing', coalesce(v_missing, array[]::text[]),
                             'reason', p_skip_reason),
          v_at);

  -- F1: working the first stop is what makes a load Current. Nothing else ever set in_transit.
  if v_load.status = 'accepted' then
    update public.loads set status = 'in_transit' where id = p_load;
    insert into public.load_events (org_id, load_id, actor_user_id, actor_role, actor_driver_id,
                                    kind, from_status, to_status, occurred_at)
    values (p_org, p_load, p_actor_user, 'driver', p_driver, 'started', 'accepted', 'in_transit', v_at);
  end if;

  select count(*) into v_open from public.load_stops
  where load_id = p_load and status not in ('completed', 'skipped');
  if coalesce(v_open, 0) = 0 then
    update public.loads set status = 'delivered' where id = p_load;
    insert into public.load_events (org_id, load_id, actor_user_id, actor_role, actor_driver_id,
                                    kind, from_status, to_status, occurred_at)
    values (p_org, p_load, p_actor_user, 'driver', p_driver, 'completed', 'in_transit', 'delivered', v_at);
  end if;

  return p_stop;
end;
$$;
