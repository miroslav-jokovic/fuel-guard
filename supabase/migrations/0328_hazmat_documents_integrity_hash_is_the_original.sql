-- 0328 — `original_sha256` (0327) duplicates a column that has held this exact meaning since 0133.
-- Dropped, and 0133's column comment is restated now that Phase 4 makes its "unless" clause real.
--
-- ── WHAT WAS ALREADY THERE ─────────────────────────────────────────────────────────────────────
-- 0133 added `integrity_hash` and defined it, in its own comment, as:
--
--     'M6: sha256 over the original-of-record bytes (integrity; equals sha256 unless a derivative
--      was stored).'
--
-- That is precisely what 0327 added `original_sha256` for. The duplication was not obvious from the
-- migrations alone — the two columns only line up once you follow `integrity_hash` back to its
-- producer — so it is worth stating where it comes from: `registerDocument` writes it from
-- `req.capture.integrityHash`, which is `CapturedPage.integrityHash`, whose contract comment in
-- `packages/capture-engine/src/contracts.ts` reads "sha256 over originalOfRecord bytes". Three
-- places already agreed on the meaning before 0327 invented a fourth name for it.
--
-- `integrity_hash` is the one that stays, and not merely because it came first. `CapturedPage`'s
-- `integrityHash` is a cross-feature engine concept — the hazmat capture path and the web
-- application-captures provider both produce it — so retiring it would mean renaming a field through
-- the shared contract, both driver providers and the web provider, to gain a longer column name.
-- Dropping the one-hour-old duplicate is one line.
--
-- Two columns documented as the same hash is exactly the ambiguity `analysis_config_version` was
-- refused for in 0326's header, and on an evidence table it is worse than untidy: it is two answers
-- to "which hash proves this original is the original".
--
-- ── WHAT CHANGES IN MEANING, AND WHY THE COMMENT IS REWRITTEN RATHER THAN LEFT ─────────────────
-- 0133's "equals sha256 unless a derivative was stored" has been vacuously true for its whole life:
-- `hazmatCaptureModel.ts` sends the SAME value as both `sha256` and `capture.integrityHash`, because
-- until Phase 4 there was only ever one artifact (audit finding F1 — all four of `CapturedPage`'s
-- image fields aliased one object). Phase 4b makes the clause real for the first time: `sha256` will
-- describe the ARCHIVE at `storage_path`, which is what extraction downloads and verifies, and
-- `integrity_hash` will describe the untouched ORIGINAL at `original_storage_path`. Restating the
-- comment now means the schema says so before any row relies on it.
--
-- ── SAFE ───────────────────────────────────────────────────────────────────────────────────────
-- `original_sha256` was applied earlier today, is named by no code in the tree, and
-- `hazmat_documents` holds zero rows in production (measured 2026-09-07; see the plan's §6 Q5).
-- Nothing is lost. No RLS change. `original_storage_path`, `original_bytes`, `archive_bytes` and
-- `capture_metrics` are unchanged.
--
-- Safe to apply after 0327.

alter table public.hazmat_documents
  drop column if exists original_sha256;

comment on column public.hazmat_documents.integrity_hash is
  'M6/D-SCAN6: sha256 over the ORIGINAL-of-record bytes — the untouched image the OS scanner produced, stored at original_storage_path. Distinct from `sha256`, which describes the object at `storage_path` (the ARCHIVE that uploads immediately and that extraction downloads and verifies). The two were equal for every row written before Phase 4, when a capture produced only one artifact (audit finding F1).';
comment on column public.hazmat_documents.original_storage_path is
  'D-SCAN6/D-SCAN11: bucket ''hazmat'' key for the untouched ORIGINAL of record, uploaded on an unmetered connection. Its hash is `integrity_hash`, not `sha256`. Read by nobody in the request path: `storage_path` stays the image extraction downloads, which is what makes deferring this one safe. NULL until Phase 4b, and NULL for any document a manager registered.';
