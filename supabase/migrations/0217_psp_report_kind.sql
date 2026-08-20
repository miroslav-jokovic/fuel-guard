-- 0217 — `psp_report`: the PSP record as a qualification record and as a filed document.
--
-- P7. The report is evidence in the hiring file: a `documents` row for the PDF an auditor reads, and
-- a `qualification_records` row citing it, with the summary in `detail`. No new evidence table — the
-- kinds are what was missing, not the shape.
--
-- ── WHICH RESTRICTED CLASS IT JOINS, AND WHY IT MATTERS ─────────────────────────────────────────
-- 0211 split the restricted set along the two regulations behind it. `psp_report` belongs with
-- §391.53(a)(1)'s INVESTIGATION HISTORY, not §382.401(a)'s testing records, and the consequence is
-- concrete: `canReadInvestigationHistory` includes the recruiter, so the person who ordered the
-- report can read it. Filing it with the drug and alcohol records would have left a recruiter able
-- to spend money on a document they are not permitted to open.
--
-- That is also the right reading of the regulation rather than a convenience: a PSP record IS part
-- of the pre-employment investigation §391.23 describes, and §391.53(a)(1) is the rule about who in
-- the company may see that investigation.

alter table public.qualification_records drop constraint if exists qualification_records_kind_check;
alter table public.qualification_records add constraint qualification_records_kind_check check (kind in (
  'employment_application','mvr','annual_mvr_review','road_test',
  'cdl_equivalency','previous_employer_inquiry','previous_employer_response',
  'clearinghouse_full','clearinghouse_limited','eldt','spe_certificate',
  'medical_registry_verification','drug_test','alcohol_test','accident',
  'psp_report'));

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
  'psp_report',
  'other'));

-- Extend 0211's investigation-history policies rather than adding a third pair: the kind list and the
-- role list both mirror INVESTIGATION_HISTORY_KINDS / canReadInvestigationHistory in
-- packages/shared/src/auth.ts, and three policies asserting two rules is how they drift.
drop policy if exists qualification_records_restricted_investigation on public.qualification_records;
create policy qualification_records_restricted_investigation on public.qualification_records
  as restrictive for select
  using (
    kind not in ('previous_employer_inquiry','previous_employer_response','psp_report')
    or public.auth_role() in ('admin','safety_manager','recruiter')
  );

drop policy if exists documents_restricted_investigation on public.documents;
create policy documents_restricted_investigation on public.documents
  as restrictive for select
  using (
    kind not in ('previous_employer_inquiry','previous_employer_response','psp_report')
    or public.auth_role() in ('admin','safety_manager','recruiter')
  );
