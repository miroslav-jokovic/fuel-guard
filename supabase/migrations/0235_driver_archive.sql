-- 0235 — a driver is ARCHIVED, never deleted.
--
-- ── THE ASK, AND THE CONSTRAINT IT RUNS INTO ──────────────────────────────────────────────────
-- Owner: the driver and applicant tables are confusing, and there is no way to get somebody out of
-- one. The obvious answer — delete the row — is unavailable here and has been since D-BD12:
-- `drivers` is in `RETENTION_FORBIDDEN` (`apps/api/src/services/dataRetention.ts`), because §391.51
-- measures retention in YEARS — the qualification file for as long as the driver is employed plus
-- three — and §390.32(d) requires an electronic record to still be reproducible when it is asked for.
--
-- So: `archived_at`. The row stays, whole; it stops appearing in the two lists somebody scans.
--
-- ── WHAT ARCHIVING IS NOT ─────────────────────────────────────────────────────────────────────
-- It is deliberately NOT a status. `drivers.status` is an employment lifecycle — applicant, active,
-- inactive, on_leave, terminated — guarded by 0213 because it starts the §391.51(c) retention clock
-- and decides driver-app access. "I do not want to look at this row" is not a fact about somebody's
-- employment, and encoding it as one would mean a recruiter tidying a list could end a driver's app
-- session. A separate nullable timestamp keeps the two vocabularies from contaminating each other.
--
-- It is also NOT a retention mechanism. Nothing prunes on `archived_at`, and `drivers` stays in
-- `RETENTION_FORBIDDEN`. An archived driver's file is reproducible on demand, for ever, exactly as it
-- was before somebody hid the row.
--
-- ── AND THE HARD DELETE IS CLOSED, ON 0096'S PRECEDENT ────────────────────────────────────────
-- 0096 gave `messages` a `deleted_at` and a trigger refusing DELETE outright, with the reasoning that
-- RLS alone would still let a service-role bug erase history. The same reasoning applies with more
-- force here: today there is NO delete path for a driver anywhere in the product (`.delete()` on
-- `drivers` appears in one recorder test and nowhere else), which is precisely when a guard is cheap
-- to add and nobody argues about it.
--
-- ⚠ **One caller is exempt, and it had to be, and it is safe because of 0234.** `merge_driver` ends
-- in `delete from drivers`. It is re-emitted below with a transaction-local flag around that one
-- statement — the only mechanism Postgres offers for "this specific DELETE, inside this specific
-- function". By the time it runs, 0234 has moved every reassignable table off the source row and has
-- REFUSED the whole merge if the source held a certified application, an e-sign consent or an SMS
-- consent. The row it deletes is empty of evidence. An exemption granted before 0234 would have been
-- an exemption for a data-destruction bug; granted after it, it is an exemption for a no-op.
--
-- ⚠ The function is reproduced here in full rather than patched, because `create or replace`
-- replaces the whole body and a function this consequential should be readable in one file. It is
-- 0234's text with three lines added and nothing else changed.
--
-- ── WHO MAY SET IT ────────────────────────────────────────────────────────────────────────────
-- The service role only, mirroring 0213's shape and its `auth_role() is null` exemption. 0212 grants
-- `recruiter` UPDATE on `drivers` by name, so without this a recruiter could archive somebody through
-- PostgREST directly and no audit row would exist for an act that hides a person from the roster.
-- Archiving therefore goes through the API, which writes `driver.archived` — the same argument 0213
-- makes about `status`, for the same reason.

alter table drivers add column if not exists archived_at timestamptz;

comment on column drivers.archived_at is
  'Hidden from the roster and the applicant board, and nothing more. NOT a status (0213 owns the employment lifecycle), NOT a retention signal (drivers stays in RETENTION_FORBIDDEN, D-BD12): the row, the qualification file and every signed instrument are untouched and reproducible. Set by the API only — guard_driver_archive_writer refuses a JWT-bearing writer so the act always carries its audit row.';

-- The two lists this exists to shorten both read (org_id, status) and both now add
-- `archived_at is null`. A partial index keeps the common read — the un-archived roster — off the
-- archived rows entirely rather than filtering them after the fact.
create index if not exists idx_drivers_org_roster_active
  on drivers (org_id, status)
  where archived_at is null;

-- ── ARCHIVING IS AN API ACT, SO THAT IT IS AN AUDITED ONE ─────────────────────────────────────
create or replace function public.guard_driver_archive_writer()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if public.auth_role() is not null
     and new.archived_at is distinct from old.archived_at
  then
    raise exception 'archiving a driver is an API action' using errcode = 'DR011';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_guard_driver_archive_writer on public.drivers;
create trigger trg_guard_driver_archive_writer
  before update on public.drivers
  for each row
  execute function public.guard_driver_archive_writer();

-- ── AND THE ROW IS NEVER REMOVED ──────────────────────────────────────────────────────────────
-- No `auth_role() is null` exemption here, unlike 0213 and unlike 0234's prunable-table style: this
-- is the EI010/DA010 family, where the trigger fires for the service role too, because the whole
-- point is that nothing — not a bug, not a script, not a future migration author in a hurry — erases
-- a driver's §391.51 file. The one legitimate deleter announces itself; see merge_driver below.
create or replace function public.guard_driver_hard_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(current_setting('fuelguard.merging_driver', true), 'off') <> 'on' then
    raise exception 'drivers are archived (set archived_at), never deleted'
      using errcode = 'DR010';
  end if;
  return old;
end;
$$;

drop trigger if exists trg_guard_driver_hard_delete on public.drivers;
create trigger trg_guard_driver_hard_delete
  before delete on public.drivers
  for each row
  execute function public.guard_driver_hard_delete();

-- ── merge_driver, re-emitted with its exemption (0234's body, three lines added) ──────────────
create or replace function public.merge_driver(p_org uuid, p_source uuid, p_canonical uuid)
returns void
language plpgsql
as $$
declare
  v_efs text;
  v_phone text;
  v_emp text;
begin
  if p_source is null or p_canonical is null or p_source = p_canonical then
    return;
  end if;
  if not exists (select 1 from public.drivers where id = p_source and org_id = p_org)
     or not exists (select 1 from public.drivers where id = p_canonical and org_id = p_org) then
    raise exception 'merge_driver: source % or canonical % not found in org %', p_source, p_canonical, p_org;
  end if;

  -- ── REFUSE RATHER THAN DESTROY ───────────────────────────────────────────────────────────────
  -- Three tables cannot follow the driver: `driver_applications` and `esign_consents` refuse UPDATE
  -- and DELETE outright (DA010/EC010), and `sms_consents` guards `driver_id` itself (SC010) while its
  -- trigger covers UPDATE only — so a cascade would take it silently. Checked BEFORE the first write,
  -- so the operator gets one sentence about the driver they named instead of a trigger's error about
  -- a table they did not.
  if exists (select 1 from public.driver_applications where driver_id = p_source and org_id = p_org)
     or exists (select 1 from public.esign_consents where driver_id = p_source and org_id = p_org)
     or exists (select 1 from public.sms_consents where driver_id = p_source and org_id = p_org)
  then
    raise exception
      'merge_driver: driver % has signed evidence that cannot be moved (a certified application, an e-sign consent or an SMS consent). Archive the duplicate instead of merging it.',
      p_source
      using errcode = 'MD010';
  end if;

  select efs_driver_id, phone, employee_id into v_efs, v_phone, v_emp
    from public.drivers where id = p_source;
  update public.drivers set efs_driver_id = null where id = p_source;
  update public.drivers
     set efs_driver_id = coalesce(efs_driver_id, v_efs),
         phone = coalesce(phone, v_phone),
         employee_id = coalesce(employee_id, v_emp)
   where id = p_canonical and org_id = p_org;

  update public.fuel_transactions set driver_id = p_canonical where driver_id = p_source;
  update public.fuel_cards set driver_id = p_canonical where driver_id = p_source;
  update public.declined_transactions set driver_id = p_canonical where driver_id = p_source;
  update public.idle_events set driver_id = p_canonical where driver_id = p_source;
  update public.hos_duty_segments set driver_id = p_canonical where driver_id = p_source;
  update public.driver_time_off set driver_id = p_canonical where driver_id = p_source;
  update public.loads set driver_id = p_canonical where driver_id = p_source;
  update public.load_stop_photos set driver_id = p_canonical where driver_id = p_source;
  update public.hazmat_loads set driver_id = p_canonical where driver_id = p_source;
  update public.invites set driver_id = p_canonical where driver_id = p_source;
  update public.vehicles set assigned_driver_id = p_canonical where assigned_driver_id = p_source;
  update public.vehicles set owner_driver_id = p_canonical where owner_driver_id = p_source;

  delete from public.driver_scores s
   where s.driver_id = p_source
     and exists (select 1 from public.driver_scores c
                  where c.driver_id = p_canonical and c.org_id = s.org_id and c.week_start = s.week_start);
  update public.driver_scores set driver_id = p_canonical where driver_id = p_source;

  delete from public.driver_performance_weeks s
   where s.driver_id = p_source
     and exists (select 1 from public.driver_performance_weeks c
                  where c.driver_id = p_canonical and c.org_id = s.org_id and c.week_start = s.week_start);
  update public.driver_performance_weeks set driver_id = p_canonical where driver_id = p_source;

  -- Certifications are temporal and append-only. When both drivers have a current row for the same
  -- kind/qualifier, preserve the source row as superseded history before moving it to the canonical id.
  update public.certifications s
     set superseded_by = c.id,
         superseded_at = coalesce(s.superseded_at, now()),
         updated_at = now()
    from public.certifications c
   where s.org_id = p_org
     and s.subject_type = 'driver'
     and s.subject_id = p_source
     and s.superseded_by is null
     and c.org_id = p_org
     and c.subject_type = 'driver'
     and c.subject_id = p_canonical
     and c.superseded_by is null
     and c.kind = s.kind
     and coalesce(c.qualifier, '') = coalesce(s.qualifier, '');
  update public.certifications
     set subject_id = p_canonical,
         updated_at = now()
   where org_id = p_org and subject_type = 'driver' and subject_id = p_source;

  -- ── RECRUITING EVIDENCE FOLLOWS THE DRIVER (0234) ────────────────────────────────────────────
  -- Every table added after 0203 that references drivers(id) on delete cascade and CAN be reassigned.
  -- Append-only stores with no per-driver uniqueness, so a plain move is safe and the merged history
  -- reads as one driver's, which is the premise of the merge.
  update public.driver_employment_history set driver_id = p_canonical
   where org_id = p_org and driver_id = p_source;
  -- `employer_inquiries.employment_id` points at a driver_employment_history ROW ID, which a
  -- reassignment does not change, so these two need no ordering between them.
  update public.employer_inquiries set driver_id = p_canonical
   where org_id = p_org and driver_id = p_source;
  update public.driver_authorizations set driver_id = p_canonical
   where org_id = p_org and driver_id = p_source;
  update public.psp_requests set driver_id = p_canonical
   where org_id = p_org and driver_id = p_source;
  update public.application_invitations set driver_id = p_canonical
   where org_id = p_org and driver_id = p_source;
  update public.application_drafts set driver_id = p_canonical
   where org_id = p_org and driver_id = p_source;
  update public.application_captures set driver_id = p_canonical
   where org_id = p_org and driver_id = p_source;

  -- §391.51 events and filed scans go with the driver. Append-only, no per-driver uniqueness, so the
  -- merged history reads exactly as if it had always been one driver. Without these two statements
  -- the drivers delete below cascades qualification_records away and strands documents on a dead id.
  update public.qualification_records
     set driver_id = p_canonical
   where org_id = p_org and driver_id = p_source;
  update public.documents
     set subject_id = p_canonical
   where org_id = p_org and subject_type = 'driver' and subject_id = p_source;

  delete from public.driver_duty_sessions s
   where s.driver_id = p_source and s.ended_at is null
     and exists (select 1 from public.driver_duty_sessions c
                  where c.driver_id = p_canonical and c.ended_at is null);
  update public.driver_duty_sessions set driver_id = p_canonical where driver_id = p_source;

  -- ── THE ONE DELETE THE 0235 GUARD LETS THROUGH ───────────────────────────────────────────────
  -- `guard_driver_hard_delete` (0235) refuses every DELETE on `drivers`, service role included. This
  -- function is the sole legitimate caller, and by the time control reaches this line it has EARNED
  -- the exemption: every reassignable table has been moved off the source above, and the three that
  -- cannot move refused the merge before the first write. The row being deleted holds nothing.
  --
  -- The flag is transaction-LOCAL (`set_config(..., true)`), so it cannot outlive the statement that
  -- set it — a supabase-js `rpc()` is one statement in one transaction. It is cleared immediately
  -- afterwards anyway, so that a caller who wraps several merges in one explicit transaction does not
  -- leave the guard disabled for whatever follows them.
  perform set_config('fuelguard.merging_driver', 'on', true);
  delete from public.drivers where id = p_source and org_id = p_org;
  perform set_config('fuelguard.merging_driver', 'off', true);
end;
$$;
comment on function public.merge_driver(uuid, uuid, uuid) is
  'Atomically folds a duplicate driver into the canonical driver. Temporal certifications are collision-safe; qualification_records, driver documents (0203) and the recruiting record — employment history, employer inquiries, authorizations, PSP requests, invitations, drafts and captures (0234) — are reassigned so a merge never destroys or strands evidence. Refuses with MD010 when the source carries a certified application, an e-sign consent or an SMS consent: those rows are immutable by design and the duplicate should be ARCHIVED instead. Holds the only exemption to guard_driver_hard_delete (0235), and holds it safely: by the delete, the source row carries no evidence.';
