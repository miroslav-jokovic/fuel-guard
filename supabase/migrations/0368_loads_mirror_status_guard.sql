-- 0368: a McLeod load's status is McLeod's, and it reaches a driver only when it is sent
-- (LOADS-MIRROR-PLAN.md LR4a; D-LMR2, D-LMR5, D-LMR7).
--
-- ── WHY THIS SHIPS ONE MERGE AHEAD OF THE PROJECTION ─────────────────────────────────────────────
-- LR4's projection writes `loads.status` from McLeod's movement status. Today's guard (0142) would
-- refuse almost every one of those writes: it allows only the office's approval chain
-- (pending_approval → approved → offered → accepted → in_transit → delivered), demands an approver
-- for `approved`, and lets a row be INSERTED only as draft or pending_approval. So the guard changes
-- first, and the projection follows once `pg_proc` shows this body in production. That check is by
-- hand: `lint:migration-ordering` sees columns, not function bodies (see
-- hold-a-function-reader-behind-its-migration).
--
-- ── 1. THE GUARD: FOR A `tms` LOAD, THE PROJECTED STATUSES ARE McLEOD'S TO SET ───────────────────
-- LR4 projects McLeod onto five statuses:
--   A (uncovered)                      → pending_approval  (shown as "Uncovered")
--   P, no stop departed                → approved          (shown as "Dispatched in McLeod")
--   P, a stop departed                 → in_transit
--   D                                  → delivered
--   V                                  → canceled
-- For a load whose `source` is 'tms', a move INTO one of those five is legal from any status, with
-- none of the office's readiness checks: McLeod already dispatched it, and a guard that refused
-- McLeod's word would leave our table showing something McLeod no longer says. A void load McLeod
-- reopens (V → A) is reopened here too, for the same reason.
-- Moves into the office's own statuses — `offered`, `accepted`, `draft` — keep the 0142 table
-- exactly, so the legacy Release path (until LR6 retires it) behaves as it did.
-- `completed_at` is NOT stamped when McLeod says delivered: it is the DRIVER's delivery (0366's
-- header), and McLeod's close is `external_closed_at`, written by the projection.
-- Manual loads are unaffected: every branch below for them is 0142's, byte for byte.
--
-- ── 2. `source` CAN NO LONGER CHANGE ─────────────────────────────────────────────────────────────
-- Branch 1 trusts `source = 'tms'`, so a row whose source could be flipped would carry a bypass of
-- the whole approval chain. Nothing in the code ever updates `source` (it is set on insert by the
-- ingest and by `mutations.ts`), so forbidding it costs nothing and closes the door.
--
-- ── 3. A McLEOD LOAD IS INVISIBLE TO A DRIVER UNTIL IT HAS BEEN SENT (D-LMR5) ────────────────────
-- The owner's ruling: a McLeod load reaches a driver when Silvicom's dispatcher sends it. The driver
-- app's Loads tab is on by default (`tab.loads`, featureCatalog.ts), and the driver scopes below
-- admit any load in a driver-visible status — so without this, projecting McLeod's `P`-and-departed
-- to `in_transit` would put the load on its driver's phone with nobody having sent it. For a `tms`
-- load the scopes therefore also require `released_at is not null`: the only "sent" we have today is
-- the legacy Release, which stamps it (0142). LR-D2's Dispatch will write `load_dispatches` and these
-- policies will then read that instead; `driverLoads.ts` applies the same predicate, because it reads
-- with the service role and must not become the one path that leaks.
-- Measured 2026-09-24: 0 of 303 production loads were ever released, so this hides nothing that
-- any driver can see today.

create or replace function loads_status_guard()
returns trigger
language plpgsql
as $$
declare
  v_pickups integer := 0;
  v_drops integer := 0;
  v_no_appt integer := 0;
  v_legal boolean;
  v_separate boolean := false;
  -- LR4a: the statuses LR4's projection writes from McLeod. A `tms` load may enter any of them freely.
  v_projected constant text[] := array['pending_approval', 'approved', 'in_transit', 'delivered', 'canceled'];
begin
  if new.status is null then
    new.status := 'draft';
  end if;

  if TG_OP = 'INSERT' then
    if new.source = 'tms' and new.status = any (v_projected) then
      if new.status = 'pending_approval' and new.submitted_at is null then
        new.submitted_at := now();
      end if;
      return new;
    end if;
    if new.status not in ('draft', 'pending_approval') then
      raise exception 'loads must be created in draft or pending_approval (got %)', new.status
        using errcode = 'DL010';
    end if;
    -- A TMS ingest can create straight into pending_approval (D48); it was submitted the moment it
    -- arrived. Stamped here so the fact holds no matter which path wrote the row.
    if new.status = 'pending_approval' and new.submitted_at is null then
      new.submitted_at := now();
    end if;
    return new;
  end if;

  if new.source is distinct from old.source then
    raise exception 'a load''s source cannot change (% -> %)', old.source, new.source
      using errcode = 'DL010';
  end if;

  if new.status is not distinct from old.status then
    return new;
  end if;

  -- McLeod's word, projected (LR4). No readiness checks and no completed_at stamp: see the header.
  if old.source = 'tms' and new.status = any (v_projected) then
    return new;
  end if;

  v_legal := case old.status
    when 'draft'            then new.status in ('pending_approval', 'canceled')
    when 'pending_approval' then new.status in ('approved', 'draft', 'canceled')
    when 'approved'         then new.status in ('offered', 'pending_approval', 'canceled')
    when 'offered'          then new.status in ('accepted', 'approved', 'canceled')
    when 'accepted'         then new.status in ('in_transit', 'approved', 'canceled')
    when 'in_transit'       then new.status in ('delivered', 'canceled')
    else false
  end;
  if not v_legal then
    raise exception '% -> % is not a legal transition', old.status, new.status
      using errcode = 'DL010';
  end if;

  -- Submission stamp. The API already sets it (`mutations.ts:116`), but an invariant enforced only by
  -- the one caller that remembers is not an invariant.
  if new.status = 'pending_approval' and old.status = 'draft' and new.submitted_at is null then
    new.submitted_at := now();
  end if;

  if new.status = 'approved' and old.status = 'pending_approval' then
    -- An approval with no recorded approver is the audit hole this whole gate exists to close: it is
    -- the difference between "somebody committed a truck and a delivery promise" and "we know who".
    if new.approved_by is null then
      raise exception 'not_ready: an approval must record who approved it' using errcode = 'DL011';
    end if;
    if new.approved_at is null then
      new.approved_at := now();
    end if;
    if new.driver_id is null then
      raise exception 'not_ready: no driver assigned' using errcode = 'DL011';
    end if;
    if new.vehicle_id is null then
      raise exception 'not_ready: no truck assigned' using errcode = 'DL011';
    end if;

    -- Separation of duties (0142). Checked before the stop checklist so the message a self-approver
    -- gets names the real problem rather than whichever appointment window happens to be missing.
    select o.require_separate_approver into v_separate
      from organizations o where o.id = new.org_id;
    if coalesce(v_separate, false)
       and new.created_by is not null
       and new.approved_by is not null
       and new.approved_by = new.created_by then
      raise exception 'not_ready: this organization requires a second person to approve a load'
        using errcode = 'DL011';
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

  if new.status = 'offered' and old.status = 'approved' then
    if new.driver_id is null then
      raise exception 'not_ready: cannot release without a driver' using errcode = 'DL011';
    end if;
    if new.released_at is null then
      new.released_at := now();
    end if;
  end if;

  if new.status = 'delivered' and new.completed_at is null then
    new.completed_at := now();
  end if;

  return new;
end;
$$;

-- ── 3. the driver scopes: a `tms` load only once it has been sent ────────────────────────────────
-- ⚠ On `load_stops` and `load_events` the added line is defence in depth, not the working guard: their
-- `exists (select 1 from loads l …)` runs under the driver's own RLS on `loads`, so `loads_driver_scope`
-- already hides an unsent McLeod load from it. Measured by mutation 2026-09-24 — removing the line from
-- either policy changes no result. It is kept so each policy states its own rule and stays right if
-- `loads_driver_scope` is ever loosened; it is not claimed as tested.
drop policy if exists loads_driver_scope on loads;
create policy loads_driver_scope on loads
  as restrictive for select
  using (
    auth_role() <> 'driver'
    or (
      driver_id = auth_driver_id()
      and status in ('offered', 'accepted', 'in_transit', 'delivered', 'canceled')
      and (source <> 'tms' or released_at is not null)
    )
  );

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
         and (l.source <> 'tms' or l.released_at is not null)
    )
  );

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
         and (l.source <> 'tms' or l.released_at is not null)
    )
  );
