-- 0490 — the truck and trailer files' missing paper kinds (UNIT-FILES-PLAN UF1, §4).
--
-- The equipment file's catalogue asks for seven papers per unit. Five already had a kind since 0127 /
-- 0146 (registration, irp, annual_inspection, insurance, ifta); three had none, so a title, a lease
-- or a permit could only have been filed as `other` — a scan nobody could later ask the file for.
--
--   certifications.kind  + lease, permit   — both EXPIRE, so they need a dated, superseding row
--                                            (a lease runs to an end date; a permit is issued for a
--                                            term, its state or kind in `qualifier`).
--   documents.kind       + lease, permit   — the paper behind each,
--                        + title           — paper only: a title never expires (`one_time`), so it is
--                                            proved by the document alone and gets no certification.
--
-- Rejected: one `equipment_paper` kind with the distinction in `qualifier`. The file engine matches
-- an item by kind (D-UF1), the binder orders by it, and an auditor asks for "the lease" — a kind that
-- means three things would push that question into every reader.
--
-- Both CHECKs are rewritten whole, as 0484 did for `documents`. Old code never writes the new words,
-- so the rewrite is safe under either deploy order (MIGRATION-DISCIPLINE §the-deploy-window). This is
-- the `evidence` module's two tables and nothing else (`lint:table-writers`). Mirrors
-- `CERTIFICATION_KINDS` / `EQUIPMENT_PAPER_ONLY_KINDS` (complianceContract.ts); the matrix
-- `unit-file-kinds.test.mjs` fails if the two sides drift.

alter table public.certifications drop constraint if exists certifications_kind_check;
alter table public.certifications add constraint certifications_kind_check check (kind in (
  'cdl','medical_card','endorsement','hazmat_training','twic',
  'registration','annual_inspection','insurance','ifta','irp',
  'lease','permit',
  'phmsa_registration','hazmat_safety_permit','security_plan',
  'financial_responsibility','operating_authority'));

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
  'roadside_repair_record'));
