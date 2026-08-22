-- 0234 — merge_driver must carry the RECRUITING evidence too, and refuse when it cannot.
--
-- ── WHAT IS WRONG, MEASURED IN PGLITE AGAINST EVERY MIGRATION ─────────────────────────────────
-- 0203 fixed exactly this bug once: `merge_driver` ended in `delete from drivers`, and every table
-- referencing `drivers(id) on delete cascade` that it had not explicitly reassigned was destroyed as
-- a side effect of tidying the roster. It listed sixteen columns and it was right about all of them.
--
-- NINE tables have been added since, all of them `on delete cascade`, none of them in that list:
-- driver_employment_history (0208), driver_authorizations (0215), psp_requests (0216),
-- driver_applications (0220), employer_inquiries (0223), application_drafts (0226),
-- esign_consents (0227), application_captures (0230), sms_consents (0233). The whole recruiting and
-- application system, in other words, built after the function that deletes its subject.
--
-- Measured, not inferred — a probe run against the full migration set reproduced three outcomes:
--
--   LOST   driver_employment_history   had=1  onCanonical=0  rowsLeftAnywhere=0
--   LOST   driver_authorizations       had=1  onCanonical=0  rowsLeftAnywhere=0
--   LOST   psp_requests                had=1  onCanonical=0  rowsLeftAnywhere=0
--   RAISED driver_applications         'driver_applications is append-only' (DA010)
--   RAISED esign_consents              'esign_consent_immutable' (EC010)
--
-- So merging a duplicate driver TODAY either silently erases their §391.21(b)(10) employment history,
-- their signed FCRA/PSP/previous-employer/Clearinghouse authorizations and their PSP order ledger
-- (which carries `billed` rows — money), or it dies inside an append-only trigger with an error
-- naming a table the operator never asked about. Both outcomes are worse than the one 0203 fixed,
-- because the evidence destroyed here is the evidence a person SIGNED.
--
-- ── THE TWO KINDS OF TABLE, AND WHY THE ANSWER DIFFERS ────────────────────────────────────────
-- REASSIGNABLE — nothing guards `driver_id` against an UPDATE, so the row simply follows the driver,
-- exactly as 0203 did for qualification_records and documents. Seven tables, below.
-- ⚠ `employer_inquiries` (0223) belongs here on a detail worth stating: its EI010 guard is a COLUMN
-- LIST, and `driver_id` is not on it. The guard exists to stop somebody rewriting what was sent and
-- when; carrying the record to the surviving driver is not that.
--
-- IMMUTABLE — the row may not be updated OR deleted at all, by anybody, service role included:
-- `driver_applications` (DA010) and `esign_consents` (EC010) raise on both. `sms_consents` (SC010) is
-- a third case that looks different and behaves the same: its guard DOES name `driver_id`, so it
-- cannot be reassigned, and its trigger is `before update` only, so a cascade would delete it in
-- silence — the worst of the two failure modes.
--
-- For those three the honest act is to REFUSE THE MERGE, up front, with a named SQLSTATE and a
-- message that says what to do instead. A merge is not worth breaking the one guarantee those tables
-- exist to make. And there is now something to do instead: 0235 gives `drivers` an `archived_at`, so
-- a duplicate that carries a signed application is archived rather than folded — the roster stops
-- showing it and not one byte of what the person signed is touched.
--
-- ⚠ **Refusing early also fixes a second-order problem.** Today the DA010/EC010 raise happens at the
-- very END of the function, after a dozen tables have been re-pointed. It rolls back — plpgsql is one
-- statement — so no partial state escapes, but the operator gets 'driver_applications is append-only'
-- for an act they described as "merge these two duplicates". The check below runs before anything is
-- written and names the driver, the reason and the alternative.
--
-- Nothing else about 0203 changes: its sixteen columns, its collision-safe certification handling and
-- its org scoping are copied verbatim below, because a `create or replace` replaces the whole body
-- and a function this consequential should be readable in one file rather than diffed against three.

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

  delete from public.drivers where id = p_source and org_id = p_org;
end;
$$;


comment on function public.merge_driver(uuid, uuid, uuid) is
  'Atomically folds a duplicate driver into the canonical driver. Temporal certifications are collision-safe; qualification_records, driver documents (0203) and the recruiting record — employment history, employer inquiries, authorizations, PSP requests, invitations, drafts and captures (0234) — are reassigned so a merge never destroys or strands evidence. Refuses with MD010 when the source carries a certified application, an e-sign consent or an SMS consent: those rows are immutable by design and the duplicate should be ARCHIVED instead.';
