-- 0133 — M6 driver capture provenance (DCE §7).
--
-- The driver app's self-built scanner records, per captured page, WHAT produced the image and HOW it was
-- gated on-device. `hazmat_documents.quality` (jsonb) already exists (0092) and holds the usability-gate
-- result; these additive, nullable columns carry the rest. hazmat_documents is insert-only evidence, so
-- there is NO backfill: existing rows and manager-registered documents simply have NULL capture provenance
-- (they were not produced by the driver scanner).
--
-- Safe to apply after 0132. No RLS change (0092 already scopes hazmat_documents by org + driver-own-load).

alter table public.hazmat_documents
  add column if not exists capture_config_version text,
  add column if not exists capture_mode           text,
  add column if not exists os_enhanced            boolean,
  add column if not exists integrity_hash         text,
  add column if not exists ocr_evidence           jsonb;

-- capture_mode is a small closed set (mirrors the engine's CaptureMode); NULL allowed for non-captured rows.
alter table public.hazmat_documents
  drop constraint if exists hazmat_documents_capture_mode_chk;
alter table public.hazmat_documents
  add constraint hazmat_documents_capture_mode_chk
  check (capture_mode is null or capture_mode in ('system_scanner', 'raw_capture', 'expo_camera'));

comment on column public.hazmat_documents.capture_config_version is
  'M6/DCE §8: the versioned capture config in force when this page was scanned + gated (provenance).';
comment on column public.hazmat_documents.capture_mode is
  'M6/DCE §2: system_scanner | raw_capture | expo_camera — how the original-of-record was produced.';
comment on column public.hazmat_documents.os_enhanced is
  'M6/DCE §3: true when the OS scanner cropped/enhanced the image (v1); false for our own raw-frame transform.';
comment on column public.hazmat_documents.integrity_hash is
  'M6: sha256 over the original-of-record bytes (integrity; equals sha256 unless a derivative was stored).';
comment on column public.hazmat_documents.ocr_evidence is
  'M6/DCE §5-§6: on-device OCR legibility metrics + digit tokens (a SIGNAL only; never authoritative content).';
