-- 0476 — `documents` can hold an inspection's paper (INSPECTION-CHALLENGE-PLAN IC2, §3).
--
-- WHAT THIS ADDS. One subject and five kinds, nothing else:
--   subject_type 'roadside_inspection' — subject_id is `roadside_inspections.id` (0458). The paper of
--     a roadside inspection belongs to the inspection, not to the driver or the truck: an older
--     inspection's driver is often not on our roster at all (IC5, measured 2026-10-14: 916 of the
--     1,117 Samsara drivers in our HOS history have no `drivers` row), and the truck may be one McLeod
--     retired (Q-IC10). Polymorphic like every other subject here (0146): no FK.
--   kinds 'roadside_inspection_report' (the officer's copy, D-IC1's cross-check), 'citation' (the
--     ticket), 'court_disposition' (the certified result the job aid asks for, R-ADJ1),
--     'dataqs_packet' and 'dataqs_correspondence' (IC4's filing, D-IC3). All five are the list §3
--     fixed; the two DataQs kinds are added now so IC4 does not rewrite this CHECK a second time.
--
-- WHY A DOCUMENT IS NOT TIED TO ONE VIOLATION. Measured on production 2026-10-15: 155 inspections carry
-- a citation number, 12 of them on more than one violation, and 5 with two different ticket numbers.
-- So which violation a court result answers is a fact about the RESULT, recorded by IC4's disposition
-- record citing this document — the same shape as `certifications.document_id` (0146): the scan first,
-- then the record that names it.
--
-- NOT RESTRICTED. None of the five is a testing or investigation record, so neither restrictive
-- policy (0211, 0237, 0376) names them; the API gates them by the `safety` section (D-IC12).
--
-- DEPLOY ORDER. Two CHECK widenings, safe in either order: old code never writes these words. Their
-- first writer (`POST /api/roadside-inspections/:id/documents`) ships in the next merge, so staging's
-- window between Railway serving and `migrate-staging` applying never meets a refused insert.
--
-- Matrix: supabase/tests/roadside-documents.test.mjs.

alter table public.documents drop constraint if exists documents_subject_type_check;
alter table public.documents add constraint documents_subject_type_check check (subject_type in (
  'driver','tractor','trailer','load','organization',
  'roadside_inspection'));

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
  'clearinghouse_portal_consent',
  'other',
  'roadside_inspection_report','citation','court_disposition',
  'dataqs_packet','dataqs_correspondence'));
