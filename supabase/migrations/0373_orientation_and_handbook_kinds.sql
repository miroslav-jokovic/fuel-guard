-- 0373 — `orientation` and `handbook` as qualification-record and document kinds (D3,
-- `docs/plans/recruitment/ORIENTATION-PLAN.md` OR0; Q-OR2 ruled (a) by the owner, 2026-09-25).
--
-- ── WHAT EACH KIND IS FOR ────────────────────────────────────────────────────────────────────
-- `orientation`: the carrier's page 24, `DRIVER SAFETY TRAINING` (seven named training areas, the
-- handbooks issued, a date, the driver's and the instructor's signatures), filed as a document and
-- cited by one `qualification_records` row per session, the way RT3 files the road test. D-PKT10 took
-- that page out of the application packet because an applicant cannot affirm training they have not
-- had. It is signed on the office day, after the training, and this is where it lands.
--
-- `handbook`: the carrier's DRIVER HANDBOOK (uploaded 2026-09-25). It carries its OWN signature
-- blocks (five of them: the memo, the hours-of-service and fines pages, the ELD charges, the policy
-- agreement countersigned by the carrier, and a "SAFETY STANDARDS AND POLICIES RECEIPT"). So D-HM10's
-- "separate process and document" is literal: a signed handbook is a filed document of its own.
-- ⚠ The same kind also holds the carrier's master copy, with `subject_type = 'organization'`, which
-- `documents_subject_type_check` has admitted since 0146. So one widening covers both the copy the
-- office uploads once and the copy each driver signs.
--
-- ── WHAT THIS DOES NOT DO ────────────────────────────────────────────────────────────────────
-- Nothing in the three RESTRICTIVE policies changes. Neither kind is a §382.401(a) testing record or
-- §391.53 investigation history, so both are readable by every role that reads the org's
-- qualification file, like `road_test`. No `purpose` is added to 0215: the handbook is not an
-- authorization and must never reach `APPLICATION_RELEASE_ORDER` (D-HM10).
--
-- ⚠ Schema only. Its first reader (the TS mirrors in `complianceContract.ts` and the recording path)
-- ships in the NEXT merge, after this is visible in production (`lint:migration-ordering`,
-- `docs/MIGRATION-DISCIPLINE.md` §the-deploy-window).

alter table public.qualification_records drop constraint if exists qualification_records_kind_check;
alter table public.qualification_records add constraint qualification_records_kind_check check (kind in (
  'employment_application','mvr','annual_mvr_review','road_test',
  'cdl_equivalency','previous_employer_inquiry','previous_employer_response',
  'clearinghouse_full','clearinghouse_limited','eldt','spe_certificate',
  'medical_registry_verification','drug_test','alcohol_test','accident',
  'psp_report','return_to_duty',
  'orientation','handbook'));

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
  'psp_report','return_to_duty',
  'orientation','handbook',
  'other'));
