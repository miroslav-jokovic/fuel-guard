-- 0508 — the document reader's third profile, `compliance_paper` (UNIT-FILES-PLAN UF7b2; DOCUMENT-READER-
-- PLAN D-DR1).
--
-- Bulk upload's papers — cab cards, registrations, annuals, insurance certificates, medical cards — are read
-- to propose whose each paper is, what it is and until when it is good; a person files every one (D-UF8).
-- As 0478 did for the roadside report, reading is a PROFILE and nothing else (a contract, a prompt, an
-- evidence function and a gate), so the only schema it needs is this word in the profile CHECK. 0505 was
-- going to carry it with `file_intake_items` and left it to this step, which ships the profile that
-- writes it. `DOCUMENT_PROFILE_IDS` mirrors the list; `document-reader-tables.test.mjs` holds the two equal.
--
-- DEPLOY ORDER. A CHECK widening: old code never writes the word. Its first writer is UF7b3's intake
-- route, a later merge, so on staging and in a release this migration is in place before anything asks.

alter table public.document_reads drop constraint if exists document_reads_profile_check;
alter table public.document_reads
  add constraint document_reads_profile_check
  check (profile in ('shipping_document', 'roadside_inspection_report', 'compliance_paper'));
