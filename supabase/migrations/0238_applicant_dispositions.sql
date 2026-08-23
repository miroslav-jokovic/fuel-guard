-- 0238 — a way to say no. The applicant pipeline had one exit and it went one way.
--
-- ── WHAT WAS MISSING, AND HOW LONG IT HAD BEEN MISSING ────────────────────────────────────────
-- `ApplicantStage` runs `not_started -> history_incomplete -> awaiting_releases -> ready_to_screen`
-- and stops. `hire_applicant` is the only exit from the pipeline. **Nothing anywhere could record
-- that a carrier decided NOT to hire somebody** — not the reason, not the date, not who decided.
--
-- That is a gap in its own right (a recruiter's most common act was unrecordable), and it is also
-- the blocker underneath `RECRUITING-SYSTEM-PLAN.md` R10: FCRA adverse action is a consequence of a
-- decision, and there was no decision to hang it on. R10 stays unbuilt pending Q-REC8 and counsel;
-- this table is the half that is owed whatever those answers turn out to be.
--
-- ⚠ It is also the job packet page 17 does on paper — `Contracted or Rejected?`, `Interviewer`,
-- `Why?` — the page `APPLICATION-PACKET-PLAN.md` §2.4 classified NOT OURS because it is
-- carrier-filled after the application. Correct about the packet, and it named a hole in the product
-- that nobody wrote down.
--
-- ── WHY THERE IS NO `hired` OUTCOME ───────────────────────────────────────────────────────────
-- The obvious shape is four outcomes and symmetry between the two exits. It is the wrong shape:
-- `drivers.status = 'active'` plus `hire_date` already record a hire, definitively, and writing a
-- second row that says the same thing is the "one fact in two places" defect that ends with the two
-- disagreeing. So this table records the ways an application ends WITHOUT a hire, and its name says
-- so. Asking "was this person hired?" is a question about `drivers`; asking "why not?" is one about
-- this.
--
-- ── APPEND-ONLY, AND PRUNABLE, AND THE SECOND HALF IS THE DELIBERATE ONE ──────────────────────
-- IMMUTABLE ON UPDATE (`AD010`), on `employer_inquiries`' EI010 model: a COLUMN LIST, so the content
-- of the decision can never be rewritten while `driver_id` stays free for `merge_driver`. A
-- correction is a new row and the list is newest-first.
--
-- DELIBERATELY NOT IN `RETENTION_FORBIDDEN`. This is personal data about somebody the carrier did
-- not employ, held for a reason that expires. No window is set here, on purpose: it is the same
-- question as Q-REC7 (how long does a dispositioned lead's PII live?), it is the owner's to answer,
-- and D-REC2's posture is the right one — keep it prunable BY DESIGN (cascade FK, no immutability
-- exemption for the retention role) so the answer is one rule in `dataRetention.ts` rather than a
-- schema change. ⚠ A window guessed here would be a window nobody chose.
--
-- ── MERGE: THIS ONE NEEDS THE WORK, UNLIKE 0237 ───────────────────────────────────────────────
-- 0234's standing lesson, and the two cases a day apart are worth contrasting. 0237's flag needed
-- nothing, because it can only exist on a driver holding a `driver_applications` row and MD010
-- already refuses to merge one of those. **A disposition has no such shield**: an applicant can be
-- declined before they ever open the link, so a declined lead with no application is precisely the
-- row a routine roster dedup would cascade into nothing. `merge_driver` is re-emitted below and the
-- matrix asserts the reassignment.

create table if not exists public.applicant_dispositions (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.organizations(id) on delete cascade,
  driver_id     uuid not null references public.drivers(id) on delete cascade,
  -- The ways an application ends without a hire. No `hired` — see the header.
  outcome       text not null check (outcome in ('declined','withdrawn','no_response')),
  decided_on    date not null,
  -- The carrier's own words. Never a picklist: a reason chosen from a menu is the menu's reason, and
  -- the question a person asks about a decline is "why", not "which category".
  reason        text check (reason is null or length(reason) <= 2000),
  /**
   * Did this decision rest, in whole or in part, on a purchased report?
   *
   * ⚠ Recorded as a FACT at the moment of the decision, and it decides nothing yet. FCRA notices are
   * R10's, blocked on Q-REC8 and on Q7 (is a PSP report a consumer report at all?). What must not
   * happen is R10 arriving later and having to reconstruct this from a timeline — whether a
   * recruiter looked at a bought report before saying no is knowable now and unknowable afterwards.
   */
  rested_on_consumer_report boolean not null default false,
  -- Stamped server-side from the JWT, never taken from a request body.
  decided_by    uuid references auth.users(id) on delete set null,
  created_at    timestamptz not null default now()
);
create index if not exists idx_applicant_dispositions_driver
  on public.applicant_dispositions (org_id, driver_id, decided_on desc);

alter table public.applicant_dispositions enable row level security;
-- No client policies: deny-all on purpose. Read and written through the API, which org-filters every
-- query because the service role bypasses RLS. Same posture as every other recruiting table.

comment on table public.applicant_dispositions is
  'Why an application ended without a hire (0238). Append-only content (AD010); driver_id stays free so merge_driver can carry it. Deliberately prunable — retention window is Q-REC7''s, unanswered.';

create or replace function public.guard_applicant_disposition_immutable()
returns trigger
language plpgsql
as $$
begin
  -- A COLUMN LIST, on employer_inquiries' EI010 model. The guard exists to stop somebody rewriting
  -- what was decided and when; carrying the record to the surviving row of a merge is not that, so
  -- `driver_id` is absent from the list on purpose.
  if old.outcome is distinct from new.outcome
     or old.decided_on is distinct from new.decided_on
     or old.reason is distinct from new.reason
     or old.rested_on_consumer_report is distinct from new.rested_on_consumer_report
     or old.decided_by is distinct from new.decided_by
     or old.org_id is distinct from new.org_id
     or old.created_at is distinct from new.created_at
  then
    raise exception 'applicant_disposition_immutable: a correction is a new disposition'
      using errcode = 'AD010';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_guard_applicant_disposition on public.applicant_dispositions;
create trigger trg_guard_applicant_disposition
  before update on public.applicant_dispositions
  for each row
  execute function public.guard_applicant_disposition_immutable();

-- ── merge_driver, re-emitted so a declined applicant's record follows them (0234's lesson) ────
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
  -- 0238. ⚠ **MD010 does not cover this one, and that is the whole reason it is here.** The
  -- return-to-duty flag (0237) needed no merge work because it can only exist on a driver who has a
  -- `driver_applications` row, and MD010 already refuses to merge one of those away. A DISPOSITION
  -- has no such protection: an applicant can be declined before they ever open the link, so a
  -- declined lead with no application is exactly the row a roster dedup would cascade into nothing.
  update public.applicant_dispositions set driver_id = p_canonical
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
  'Atomically folds a duplicate driver into the canonical driver. Temporal certifications are collision-safe; qualification_records, driver documents (0203), the recruiting record (0234), the seven-day work statement (0236) and the applicant disposition (0238) are reassigned so a merge never destroys or strands evidence. Refuses with MD010 when the source carries a certified application, an e-sign consent or an SMS consent: those rows are immutable by design and the duplicate should be ARCHIVED instead. Holds the only exemption to guard_driver_hard_delete (0235), and holds it safely: by the delete, the source row carries no evidence.';
