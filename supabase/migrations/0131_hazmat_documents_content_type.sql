-- 0131 — D1: `hazmat_documents.content_type` was selected by two call sites (hazmatLoads.ts,
-- orchestrate.ts) but existed in no FuelGuard migration, so both queries failed at runtime with
-- "column does not exist". The column is also required for D11's fix (the vision call must send the
-- real media type, not a hardcoded one). Additive + idempotent. (Ports HazmatGuard 0002.)
--
-- Nullable by design: rows registered before this migration have no recorded type; the extraction
-- path treats null as "sniff from bytes via sharp metadata" (never trusts, never hardcodes).

alter table public.hazmat_documents
  add column if not exists content_type text;

comment on column public.hazmat_documents.content_type is
  'MIME type as declared at registration (hazmatRegisterDocumentRequestSchema.contentType). Nullable: pre-0131 rows never recorded it; consumers must sniff, not assume.';
