-- FuelGuard — 0142 separation of duties on load approval
--
-- WHY THIS EXISTS. `supabase/tests/load-lifecycle.test.mjs:122-136` has asserted since Phase 3B that
-- an organization can require a load's approver to be someone other than its creator:
--
--     "with separation OFF, the creator may approve their own load"
--     "with separation ON, the creator may NOT approve their own load (DL011)"
--     "...but another approver may"
--
-- The column those assertions set does not exist and the guard never checked it. The matrix has not
-- executed in months (stale migration filenames, repaired in the same change as this), so nobody
-- found out. Repairing the harness turned three passing-on-paper assertions into a missing control.
--
-- It is a control worth having rather than a test worth deleting: maker-checker on the object that
-- commits a truck, a driver and a delivery promise is standard in every enterprise TMS, and it is the
-- kind of thing an insurer or a customer's audit asks about. Off by default, so no existing
-- organization changes behaviour until someone turns it on deliberately.
--
-- SCOPE. Only `pending_approval -> approved` is gated. Creating, editing, releasing and cancelling are
-- untouched: the point is that the person who wrote the commitment is not the only person who checked
-- it, not that they cannot work on it.
--
-- `created_by` is nullable (TMS-ingested loads have no human creator), and a null creator can never
-- equal an approver, so ingested loads pass the gate unchanged — correct, since no person authored
-- them to be checked against.

alter table organizations
  add column if not exists require_separate_approver boolean not null default false;

comment on column organizations.require_separate_approver is
  'When true, a load''s creator may not be its approver (maker-checker). Enforced by loads_status_guard (0142).';

-- Replaces the 0087 body verbatim, plus the separation check inside the existing approval gate.
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
begin
  if new.status is null then
    new.status := 'draft';
  end if;

  if TG_OP = 'INSERT' then
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

  if new.status is not distinct from old.status then
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
