-- 0237 — §40.25(j): the answer we started collecting, and the obligation nobody acted on.
--
-- ── WHAT EXISTS AND WHAT DOES NOT ─────────────────────────────────────────────────────────────
-- P8 (2026-08-23) added `prior_failed_pre_employment_test` to the application: *did you test positive
-- or refuse a pre-employment drug or alcohol test for a job you applied for but did not obtain, in
-- the past two years?* It is stored, it renders on packet page 26, and **nothing acts on a yes**.
--
-- 49 CFR §40.25(j) does not stop at asking. If the applicant admits a positive or a refusal, the
-- employer "must not use the employee to perform safety-sensitive functions" until the employee
-- documents successful completion of the return-to-duty process (§40.305). Recording the admission
-- and doing nothing with it is arguably worse than never asking, because the file now proves the
-- carrier knew.
--
-- ── WHERE THE GATE BITES, AND WHY NOT AT THE HIRE ─────────────────────────────────────────────
-- The regulation bars PERFORMING A SAFETY-SENSITIVE FUNCTION, not being hired. A carrier may lawfully
-- hire somebody in the middle of their return-to-duty process and put them in an office, and a gate
-- on `hire_applicant` would be stricter than the rule while leaving the thing the rule actually
-- forbids — putting them behind the wheel — wide open. So the hire WARNS (previewHire reports it)
-- and the LOAD ASSIGNMENT refuses.
--
-- ── THE TWO HALVES, AND WHY THEY LIVE IN DIFFERENT PLACES ─────────────────────────────────────
-- THE OBLIGATION is a fact about the driver, projected onto `drivers` from the document that created
-- it — the same treatment `other_names` (0231) gets, and for the same reason: the payload is the
-- evidence, and a derived fact that has to be read on a hot path does not belong inside a jsonb blob.
-- ⚠ It is projected by a TRIGGER rather than by the API, because there is exactly one way a
-- `driver_applications` row comes into existence and a trigger cannot forget. A service that
-- remembered today would be a service somebody adds a second write path around.
--
-- THE DISCHARGE is evidence, so it is a `qualification_records` row of the new kind `return_to_duty`
-- — §40.305 documentation, filed like everything else in the §391.51 file, with the scan attached.
-- Not a second boolean: "the obligation is discharged" and "here is the document that discharges it"
-- are the same fact, and storing it twice is how they come to disagree.
--
-- ── SET-ONLY, ON PURPOSE ──────────────────────────────────────────────────────────────────────
-- The flag is never cleared by a later application. A driver who applies twice and answers no the
-- second time has not unsigned the first statement, and §40.25(j)'s obligation attaches to the
-- ADMISSION. The only thing that discharges it is the documentation.
--
-- ── MERGE: NOTHING TO DO, AND THAT IS PROVED RATHER THAN ASSUMED ──────────────────────────────
-- 0234's standing lesson is that anything hanging off `drivers` must be checked against
-- `merge_driver` on the day it is created. Checked: the flag can only be set by an insert into
-- `driver_applications`, and `merge_driver` raises **MD010** for any source driver that has one —
-- signed evidence cannot be moved, the duplicate is archived instead. So a driver carrying this flag
-- can never be the source of a merge, and the flag can never be dropped in silence. The matrix
-- asserts that refusal rather than trusting this paragraph.

-- ── 1. the obligation ─────────────────────────────────────────────────────────────────────────

alter table public.drivers
  add column if not exists return_to_duty_required boolean not null default false;

comment on column public.drivers.return_to_duty_required is
  '49 CFR 40.25(j): this driver''s application admitted a positive or refused pre-employment test for a job they applied for but did not obtain, within the preceding two years. They may not perform a safety-sensitive function until 40.305 return-to-duty documentation is on file as a return_to_duty qualification record. Set by trigger from driver_applications; never cleared.';

create or replace function public.project_return_to_duty_obligation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Only a literal true. A missing key, a null and a false are three different facts and none of
  -- them is an admission: `null` means the form never asked (every application filed before P8),
  -- which is exactly why the contract field is nullish.
  if (new.payload ->> 'prior_failed_pre_employment_test') = 'true' then
    update public.drivers
       set return_to_duty_required = true
     where id = new.driver_id
       and org_id = new.org_id;
  end if;
  return new;
end;
$$;

drop trigger if exists driver_applications_project_rtd on public.driver_applications;
create trigger driver_applications_project_rtd
  after insert on public.driver_applications
  for each row execute function public.project_return_to_duty_obligation();

-- Applications already filed. Zero rows in production today — the flow has never been walked by a
-- real applicant — but a QA org may hold some, and a backfill that is empty costs nothing while a
-- backfill that is missing costs an unenforced obligation.
update public.drivers d
   set return_to_duty_required = true
  from public.driver_applications a
 where a.driver_id = d.id
   and a.org_id = d.org_id
   and (a.payload ->> 'prior_failed_pre_employment_test') = 'true';

-- ── 2. the discharge, as a filed record ───────────────────────────────────────────────────────

alter table public.qualification_records drop constraint if exists qualification_records_kind_check;
alter table public.qualification_records add constraint qualification_records_kind_check check (kind in (
  'employment_application','mvr','annual_mvr_review','road_test',
  'cdl_equivalency','previous_employer_inquiry','previous_employer_response',
  'clearinghouse_full','clearinghouse_limited','eldt','spe_certificate',
  'medical_registry_verification','drug_test','alcohol_test','accident',
  'psp_report','return_to_duty'));

alter table public.documents drop constraint if exists documents_kind_check;
alter table public.documents add constraint documents_kind_check check (kind in (
  'cdl','medical_card','endorsement','hazmat_training','twic',
  'registration','annual_inspection','insurance','ifta','irp',
  'phmsa_registration','hazmat_safety_permit','security_plan',
  'financial_responsibility','operating_authority',
  'employment_application','mvr','annual_mvr_review','road_test',
  'cdl_equivalency','previous_employer_inquiry','previous_employer_response',
  'clearinghouse_full','clearinghouse_limited','eldt','spe_certificate',
  'medical_registry_verification','drug_test','alcohol_test','accident',
  'psp_report','return_to_duty','other'));

-- ── 3. it is a testing record, so it joins §382.401(a)'s custody rule ─────────────────────────
--
-- Return-to-duty documentation names a driver's drug or alcohol programme violation and the SAP's
-- verdict on it. That is a controlled-substances-and-alcohol testing record in substance, exactly
-- the argument 0211 made for the Clearinghouse kinds — so admin and safety_manager, and not the
-- recruiter. ⚠ The policies are RECREATED rather than altered, because they enumerate their kinds:
-- 0217 had to do the same for `psp_report`, and a kind added to the CHECK and forgotten here is
-- readable by everybody through PostgREST.

drop policy if exists qualification_records_restricted_testing on public.qualification_records;
drop policy if exists documents_restricted_testing on public.documents;

create policy qualification_records_restricted_testing on public.qualification_records
  as restrictive for select
  using (
    kind not in ('drug_test','alcohol_test','clearinghouse_full','clearinghouse_limited','return_to_duty')
    or public.auth_role() in ('admin','safety_manager')
  );

create policy documents_restricted_testing on public.documents
  as restrictive for select
  using (
    kind not in ('drug_test','alcohol_test','clearinghouse_full','clearinghouse_limited','return_to_duty')
    or public.auth_role() in ('admin','safety_manager')
  );
