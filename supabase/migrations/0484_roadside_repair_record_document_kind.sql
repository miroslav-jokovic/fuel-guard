-- 0484 — the document kind for the repair record's rendering (INSPECTION-CHALLENGE-PLAN IC11, D-IC14;
-- Q-IC12 (a)). `roadside_repair_record` is OUR rendering of FleetPal's work order, jobs, parts and invoice,
-- filed on the inspection with the certification — FleetPal serves no files. Widened one merge before its
-- writer (IC11 B2). Split from 0483 because `lint:table-writers` keeps a migration to one module's tables:
-- this is `evidence`'s, 0483 is `messaging`'s. Mirrors `ROADSIDE_DOCUMENT_KINDS` (complianceContract.ts).

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
  'dataqs_packet','dataqs_correspondence',
  'roadside_repair_record'));
