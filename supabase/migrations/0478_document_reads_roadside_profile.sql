-- 0478 — the document reader's second profile, `roadside_inspection_report`
-- (DOCUMENT-READER-PLAN D-DR1; INSPECTION-CHALLENGE-PLAN IC10, D-IC13).
--
-- The officer's report a safety manager files on a roadside inspection is read to name the driver, which
-- FMCSA's open data never does (measured 2026-10-15: no name, licence or date of birth in any of its six
-- datasets). Reading it is a PROFILE and nothing else — a contract, a prompt, an evidence function and a
-- gate — so the only schema it needs is this word in the profile CHECK. `DOCUMENT_PROFILE_IDS` mirrors
-- the list; `document-reader-tables.test.mjs` holds the two equal.
--
-- DEPLOY ORDER. A CHECK widening: old code never writes the word. Its writer, the inspections module's
-- report pass (0479), retries hourly, so on staging a tick that runs before `migrate-staging` loses an
-- hour and nothing else. In a release the migration runs first.

alter table public.document_reads drop constraint if exists document_reads_profile_check;
alter table public.document_reads
  add constraint document_reads_profile_check check (profile in ('shipping_document', 'roadside_inspection_report'));
