-- 0236 — seven_day_statements: the §395.8(j)(2) record, obtained where its clock actually starts.
--
-- ── WHAT IT IS ────────────────────────────────────────────────────────────────────────────────
-- Page 21 of the carrier's application packet is a SEVEN DAY WORK STATEMENT: the seven days a driver
-- worked immediately before starting, the hours on each, and the moment they were last relieved from
-- duty. §395.8(j)(2) requires the carrier to obtain it from any driver being used for the first time
-- or occasionally, so that the driver's available hours can be computed from something other than
-- their word on the day.
--
-- ── WHY IT IS NOT PART OF THE APPLICATION (D-PKT7) ────────────────────────────────────────────
-- Because its answer EXPIRES. The regulation counts the seven days preceding the day the driver
-- BEGINS WORK; a statement filled in during an application is about the wrong week by the time
-- anybody is hired, and a driver hired three weeks later has a form that says nothing useful. The
-- owner moved it to the hire on 2026-08-23, which is where the hire date already lives and where
-- `HireDrawer` already measures the three-year employment window back from.
--
-- ── THE EVIDENCE LINE, DECLARED (RECRUITING-SYSTEM-PLAN §4) ───────────────────────────────────
-- IMMUTABLE ON UPDATE, PRUNABLE ON DELETE — and the split is the whole design, so it is stated here
-- rather than left to be inferred from the trigger.
--
--   • UPDATE of the CONTENT is refused for EVERYBODY, service role included (the EI010 family). A
--     driver signs this statement; a signed statement somebody can edit afterwards is not a
--     statement. A correction is a new row, exactly as 0220 says for the application itself.
--     ⚠ `driver_id` is deliberately NOT guarded — see the trigger, and 0234 for what happens to a
--     table that guards it.
--
--   • DELETE is NOT refused, unlike `drivers` (0235) or `driver_applications` (0220), and that is
--     deliberate rather than an oversight. This is a §395 supporting document, not a §391.51
--     qualification-file item: §395.8(k)(1) obliges the carrier to keep it for SIX MONTHS. Holding a
--     record of somebody's working hours for ever, when the rule asks for six months, is
--     over-retention of personal data dressed up as diligence. So it is prunable, and
--     `dataRetention.ts` gets a rule with a generous margin over the statutory floor.
--
-- ⚠ Consequently this table is NOT in RETENTION_FORBIDDEN, and must not be added to it: the guard
-- test pins that list, and a table in both places is a retention rule that can never run.
--
-- ── AND merge_driver LEARNS ABOUT IT IN THE SAME MIGRATION ────────────────────────────────────
-- 0234's lesson, applied on the day the table is created rather than two years later. `merge_driver`
-- ends in `delete from drivers`, so a new table referencing `drivers(id) on delete cascade` that the
-- function does not reassign is destroyed by the next roster dedup — silently, because nothing in the
-- gate set connects "new cascade" to "teach merge_driver". The function is re-emitted below with one
-- statement added and nothing else changed.

create table if not exists public.seven_day_statements (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null references public.organizations(id) on delete cascade,
  driver_id         uuid not null references public.drivers(id) on delete cascade,
  -- The day the statement was made — the packet's "Today's date". The seven days it describes are the
  -- seven ending the day before, which is why only one date is stored and not eight.
  statement_date    date not null,
  /**
   * Hours worked on each of the seven preceding days, most recent LAST.
   *
   * A jsonb array rather than seven columns: the shape is fixed at seven by the regulation and by the
   * form, and the check constraint enforces exactly that — but the ENTRIES carry a date each, because
   * a bare array of numbers cannot survive a reader asking "which day was the 14?".
   */
  days              jsonb not null,
  -- §395.8(j)(2)'s second half: "the date and time at which he/she was last relieved from duty".
  last_relieved_at  timestamptz not null,
  -- The driver's own signature on the paper, transcribed. `recorded_by` is the office user who
  -- entered it, and the two are never the same person's act.
  signed_name       text not null,
  signed_on         date not null,
  recorded_by       uuid references auth.users(id) on delete set null,
  created_at        timestamptz not null default now(),
  constraint seven_day_statements_days_shape check (
    jsonb_typeof(days) = 'array' and jsonb_array_length(days) = 7
  ),
  constraint seven_day_statements_signed_name_check check (length(btrim(signed_name)) > 0)
);

create index if not exists idx_seven_day_statements_driver
  on public.seven_day_statements (org_id, driver_id, statement_date desc);

comment on table public.seven_day_statements is
  'The §395.8(j)(2) seven-day work statement, obtained at the HIRE rather than with the application because the regulation counts the seven days before work BEGINS (D-PKT7). Immutable on UPDATE — a signed statement nobody can edit — and prunable on DELETE, because §395.8(k)(1) asks for six months and not for ever. Deliberately NOT in RETENTION_FORBIDDEN.';

alter table public.seven_day_statements enable row level security;

drop policy if exists seven_day_statements_select on public.seven_day_statements;
create policy seven_day_statements_select on public.seven_day_statements
  for select using (org_id = public.auth_org_id());

-- A driver may read their OWN statement and no one else's — 0129's restrictive shape, so the driver
-- app can show somebody what the office recorded about their hours without exposing the roster.
drop policy if exists seven_day_statements_driver_scope on public.seven_day_statements;
create policy seven_day_statements_driver_scope on public.seven_day_statements
  as restrictive for select using (
    public.auth_role() <> 'driver' or driver_id = public.auth_driver_id()
  );

-- Recording one is a hiring act, so it takes the fleet lifecycle roles — the same set 0213 allows to
-- move a driver through their employment status, and for the same reason: this is obtained because
-- somebody is being put to work.
drop policy if exists seven_day_statements_write on public.seven_day_statements;
create policy seven_day_statements_write on public.seven_day_statements
  for insert with check (
    org_id = public.auth_org_id()
    and public.auth_role() = any (array['admin','fleet_manager','safety_manager'])
  );

-- ── IMMUTABLE ON UPDATE, FOR EVERYBODY — BUT AS A COLUMN LIST ─────────────────────────────────
-- No `auth_role() is null` exemption: the service role is what bypasses RLS in the first place, and a
-- guard that trusts the API is a guard against typos rather than against the thing it is written for.
--
-- ⚠ **A COLUMN LIST rather than a blanket refusal, and 0234 is why.** The first draft of this trigger
-- raised on every UPDATE, and the matrix immediately caught what that means: `merge_driver` reassigns
-- `driver_id`, so a driver holding a statement could not be merged at all. That is the `sms_consents`
-- failure mode — a guard naming `driver_id` and thereby making its own table unmergeable — reproduced
-- one migration after it was documented.
--
-- The shape that is right here is `employer_inquiries`' (EI010, 0223): guard the CONTENT and leave
-- `driver_id` free. The guard exists to stop somebody rewriting what the driver signed. Carrying the
-- record to the surviving row of a merge is not that, and 0234 already proved every other table on
-- that path safe to move.
create or replace function public.guard_seven_day_statement_immutable()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.org_id is distinct from new.org_id
     or old.statement_date is distinct from new.statement_date
     or old.days is distinct from new.days
     or old.last_relieved_at is distinct from new.last_relieved_at
     or old.signed_name is distinct from new.signed_name
     or old.signed_on is distinct from new.signed_on
     or old.recorded_by is distinct from new.recorded_by
     or old.created_at is distinct from new.created_at
  then
    raise exception 'seven_day_statement_immutable: a correction is a new statement'
      using errcode = 'SD010';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_guard_seven_day_statement on public.seven_day_statements;
create trigger trg_guard_seven_day_statement
  before update on public.seven_day_statements
  for each row
  execute function public.guard_seven_day_statement_immutable();

-- ── merge_driver, re-emitted so the statement follows the driver (0234's lesson) ──────────────
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
  -- 0236. ⚠ The lesson from 0234, applied on the day the table is created rather than two years
  -- later: a new table referencing drivers(id) on delete cascade that merge_driver does not know
  -- about is destroyed by the next roster dedup, and nothing in the gate set connects the two.
  update public.seven_day_statements set driver_id = p_canonical
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
  'Atomically folds a duplicate driver into the canonical driver. Temporal certifications are collision-safe; qualification_records, driver documents (0203), the recruiting record (0234) and the seven-day work statement (0236) are reassigned so a merge never destroys or strands evidence. Refuses with MD010 when the source carries a certified application, an e-sign consent or an SMS consent: those rows are immutable by design and the duplicate should be ARCHIVED instead. Holds the only exemption to guard_driver_hard_delete (0235), and holds it safely: by the delete, the source row carries no evidence.';
