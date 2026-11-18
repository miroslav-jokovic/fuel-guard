-- 0631 — the document kind for a vendor's bill frozen with a roadside repair's certification
-- (FLEETPAL-INTEGRATION-PLAN Q12 (a), ruled by the owner 2026-11-18; F16c; INSPECTION-CHALLENGE-PLAN IC11).
--
-- ── WHY A COPY, WHEN EVERY OTHER SCREEN READS THE BILL LIVE ─────────────────────────────────────────
-- D-FP28 reads the shop's scanned bills from FleetPal when someone opens a work order, and stores none:
-- FleetPal's link expires in an hour, and a nightly copy of ~2,400 PDFs a year would be a second,
-- unbacked archive nobody asked for. A CERTIFIED 396.9(d) repair record is the one exception — the
-- certification says "corrected, and here is the paper", and that paper must not change after the
-- signature. So at certification each file on the accepted work order's invoices is filed on the
-- inspection as `roadside_repair_bill`, beside `roadside_repair_record` (0484). `documents` is an evidence
-- table (append-only, RETENTION_FORBIDDEN), which is the point.
--
-- Widened one merge before its writer (the certification, F16c part 2), like 0484 before IC11 B2: until
-- then nothing writes the kind, so old code never meets it. Constraint only, no data change. Restates
-- 0565's list with the one kind appended. Mirrors `ROADSIDE_DOCUMENT_KINDS` (complianceContract.ts), which
-- `unit-file-kinds.test.mjs` holds equal to this check.

alter table public.documents drop constraint if exists documents_kind_check;
alter table public.documents add constraint documents_kind_check check (kind in (
  'cdl','medical_card','endorsement','hazmat_training','twic',
  'registration','annual_inspection','insurance','ifta','irp',
  'lease','permit',
  'phmsa_registration','hazmat_safety_permit','security_plan',
  'financial_responsibility','operating_authority',
  'employment_application','mvr','annual_mvr_review','road_test',
  'cdl_equivalency','previous_employer_inquiry','previous_employer_response',
  'clearinghouse_full','clearinghouse_limited','eldt','spe_certificate',
  'medical_registry_verification','drug_test','alcohol_test','accident',
  'psp_report','return_to_duty',
  'orientation','handbook',
  'clearinghouse_portal_consent',
  'title',
  'other',
  'roadside_inspection_report','citation','court_disposition',
  'dataqs_packet','dataqs_correspondence',
  'roadside_repair_record',
  'equipment_invoice',
  'passport','ssn_card','work_authorization','training_certificate','road_test_certificate',
  'drug_alcohol_policy',
  'roadside_repair_bill'));
