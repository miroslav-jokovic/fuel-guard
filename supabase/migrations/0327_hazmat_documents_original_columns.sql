-- 0327 — Phase 4a, corrected. `archive_storage_path` was the wrong column, and a second hash was
-- missing. Still no reader: 4b reads these, and 4b is the next merge.
--
-- ── WHAT 0326 GOT WRONG, AND HOW IT WAS FOUND ──────────────────────────────────────────────────
-- 0326 (yesterday's merge, applied 2026-09-07) added `archive_storage_path` on the plan's wording —
-- ORIGINAL keeps `storage_path`, the ARCHIVE derivative gets the new one. Tracing every existing
-- reader of this table before writing 4b showed that assignment is backwards, for two reasons that
-- are only visible from the readers rather than from the plan:
--
--   1. **`storage_path` is what extraction downloads and what `sha256` is verified against.**
--      `orchestrate.ts` reads `storage_path`, and `verifyIntegrityHash` compares `sha256` to THOSE
--      bytes (Step 1.3). D-SCAN11 defers the ORIGINAL's upload to an unmetered connection, so
--      putting the original in `storage_path` means extraction downloads an object that does not
--      exist yet — `document_unreadable` — and a driver's hazmat verdict waits for Wi-Fi.
--   2. **`listDocuments` signs a download URL for `storage_path`,** and `defensePacket.ts` reads it.
--      The office reviewing a load would get a broken image for as long as the driver stayed on
--      cellular. `storageBackup.ts` and the nightly `storageReconcile` sweep read it too.
--
-- The rule underneath all four: **the artifact whose upload is DEFERRED must be the one nothing
-- depends on.** That is the only thing that makes deferral safe, and it decides which column each
-- artifact gets. So `storage_path` / `sha256` / `content_type` keep meaning exactly what they have
-- always meant — the image that uploads immediately and that extraction reads, which under D-SCAN11
-- is the ARCHIVE — and the evidentiary ORIGINAL becomes purely additive: new path, new hash, read by
-- nobody until it is asked for.
--
-- D-SCAN6 is satisfied either way. It requires that the bytes the scanner produced are retained
-- untouched and that the integrity hash covers THOSE bytes. It says nothing about which column holds
-- them, and `original_sha256` covers them here.
--
-- ── WHY A SECOND HASH COLUMN, WHICH 0326 SIMPLY MISSED ─────────────────────────────────────────
-- A retained artifact with no hash is a file, not evidence: nothing can later say the original is
-- the original. `sha256` describes the bytes at `storage_path` and cannot describe two objects.
-- `original_sha256` is the second half of the pair, and it is what a future integrity check on the
-- original will compare against.
--
-- ── AND WHY THERE IS NO `original_media_type`, WHICH WAS CONSIDERED ────────────────────────────
-- It would be a constant. Android's `GmsDocumentScanner` hands back a JPEG file URI, which is what
-- "untouched" means there; iOS's `VNDocumentCameraScan` hands back a `UIImage` and never bytes, so
-- the closest thing to untouched is a maximum-quality JPEG encode. Both are `image/jpeg`, the
-- deterministic path `{org}/{load}/{id}.orig.jpg` already carries it, and a column whose value is
-- known before it is written is a copy. If a platform ever returns something else, that is a new
-- fact and it earns its own migration ahead of its own reader.
--
-- ── DROPPING A PRODUCTION COLUMN, AND WHY IT IS SAFE HERE ──────────────────────────────────────
-- Measured against production on 2026-09-07, before writing this: `hazmat_documents` holds **zero
-- rows** — no hazmat load, document or run has ever been recorded — and `archive_storage_path` was
-- applied one day earlier and is named by no code in the tree. So the drop loses nothing and no
-- rename dance is owed: a rename would also assert a continuity of MEANING that does not exist, the
-- archive path and the original path being different facts about different objects.
--
-- `original_bytes`, `archive_bytes` and `capture_metrics` from 0326 are unchanged and still correct:
-- `archive_bytes` sizes the object at `storage_path`, `original_bytes` the one at
-- `original_storage_path`.
--
-- No backfill (insert-only evidence, and there is nothing to backfill). No RLS change (0092 scopes by
-- org + driver-own-load). Every column nullable, because `registerDocument` upserts and Postgres
-- evaluates NOT NULL before conflict arbitration (`lint:upserts`).
--
-- Safe to apply after 0326.

alter table public.hazmat_documents
  drop column if exists archive_storage_path;

alter table public.hazmat_documents
  add column if not exists original_storage_path text,
  add column if not exists original_sha256       text;

comment on column public.hazmat_documents.original_storage_path is
  'D-SCAN6/D-SCAN11: bucket ''hazmat'' key for the untouched ORIGINAL of record — the bytes the OS scanner produced, uploaded on an unmetered connection. Read by nobody in the request path: `storage_path` stays the image extraction downloads, which is what makes deferring this one safe. NULL until Phase 4b, and NULL for any document a manager registered.';
comment on column public.hazmat_documents.original_sha256 is
  'D-SCAN6: sha256 over the ORIGINAL''s bytes. `sha256` describes the object at `storage_path` and cannot describe two objects; a retained artifact with no hash is a file rather than evidence.';
comment on column public.hazmat_documents.archive_bytes is
  'D-SCAN11: size of the object at `storage_path` — the ARCHIVE derivative that uploads immediately and that extraction reads. Pairs with original_bytes; MACHINE is computed for extraction and never stored, so it has no column.';
