-- 0555 — the document reader's fourth profile, `mvr_report` (HIRING-WORKFLOW-AUDIT §14, OF6; DOCUMENT-READER-
-- PLAN D-DR1).
--
-- The owner (2026-11-03): "for checking PSP, MVR we will read them and our AI … we will use AI as checking
-- layer". The office pulls the motor vehicle record in SambaSafety's portal and drops the PDF on the
-- driving-record drawer; the reader proposes the licence, its status, the medical certification and every
-- violation and withdrawal; `mvrReportFindings` (shared) says what to check; a PERSON records the MVR. As 0478
-- and 0508 did, reading is a PROFILE and nothing else — a contract, a prompt, an evidence function and a gate —
-- so the only schema it needs is this word in the profile CHECK. `DOCUMENT_PROFILE_IDS` mirrors the list;
-- `document-reader-tables.test.mjs` holds the two equal.
--
-- DEPLOY ORDER. A CHECK widening: old code never writes the word. Its first writer is the driving-record
-- drawer's read (OF6b), a later merge, so on staging and in a release this migration is in place first.

alter table public.document_reads drop constraint if exists document_reads_profile_check;
alter table public.document_reads
  add constraint document_reads_profile_check
  check (profile in ('shipping_document', 'roadside_inspection_report', 'compliance_paper', 'mvr_report'));
