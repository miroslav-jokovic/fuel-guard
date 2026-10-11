-- 0445 — samsara_documents: the Samsara driver documents (DOCUMENT-READER-PLAN Step 0.1, D-DR12).
--
-- Drivers already submit their bills of lading through Samsara's driver app, under a document type
-- this carrier named "BOL, SECURMENT, PLACARDS", and their delivery copies under "Proof of Delivery".
-- Measured 2026-10-08 with the read-only token: 492 BOL-type submissions carrying 2,135 photos in the
-- last 30 days, 160 delivery submissions with 311 photos, plus ~3,100 text-only call forms (Empty /
-- Loaded / Stop Call) that carry the "Load #" a dispatcher needs to match a document to an order.
-- Nothing in this product read any of it. This table is the collector's staging copy, written only by
-- `modules/samsara/samsaraDocumentsSync.ts`; the document reader takes its intake from here (D-ARC1:
-- a collector owns its raw rows, nothing outside it parses the vendor payload).
--
-- ⚠ PHOTO URLS ARE DELIBERATELY NOT STORED. Samsara hands each photo as `{id, url}` with the url on
-- s3.samsara.com — a vendor link with its own expiry. A stored url is a promise this table cannot
-- keep, and the plan's D-DR9 is that a read whose source can vanish is not evidence: the bytes are
-- copied into our own bucket at intake (Step 3.2), which re-fetches the document for a fresh url.
-- `photo_ids` is what survives.
--
-- One row per (org, Samsara document id), refreshed in place: Samsara lets a driver edit a submitted
-- document, and `samsara_updated_at` moving is how the collector sees it. Staging, not evidence — the
-- evidence is the copied bytes in the reader's own tables, which are append-only.
--
-- A new table, so it is exempt from the column-before-reader rule (docs/MIGRATION-DISCIPLINE.md); its
-- writer ships in the same merge. RLS on, no client policies: the API serves it with org filters.

create table if not exists public.samsara_documents (
  org_id               uuid not null references public.organizations(id) on delete cascade,
  samsara_document_id  text not null,
  document_type_id     text,
  document_type_name   text not null,
  state                text,
  samsara_driver_id    text,
  driver_name          text,
  samsara_vehicle_id   text,
  vehicle_name         text,
  route_stop_id        text,
  route_stop_name      text,
  -- The value of a field labelled "Load #" when the document type has one; null otherwise. Samsara's
  -- BOL type has no such field today (plan Q-DR3), the call forms do.
  load_ref             text,
  photo_ids            text[] not null default '{}',
  photo_count          integer not null default 0,
  -- Every field as Samsara labelled it, values kept for text and choice fields; photo fields keep
  -- their ids only (see the header).
  fields               jsonb not null default '[]'::jsonb,
  samsara_created_at   timestamptz not null,
  samsara_updated_at   timestamptz not null,
  first_seen_at        timestamptz not null default now(),
  last_seen_at         timestamptz not null default now(),
  primary key (org_id, samsara_document_id)
);

comment on table public.samsara_documents is
  'Samsara driver documents (BOL, proof of delivery, call forms) staged by the samsara collector; '
  'photo ids only, never vendor urls. DOCUMENT-READER-PLAN Step 0.1.';

-- The reader's picker asks "this type, newest first, for this org"; the collector's watermark asks
-- "latest samsara_updated_at for this org".
create index if not exists samsara_documents_type_created_idx
  on public.samsara_documents (org_id, document_type_name, samsara_created_at desc);
create index if not exists samsara_documents_updated_idx
  on public.samsara_documents (org_id, samsara_updated_at desc);

alter table public.samsara_documents enable row level security;

-- raw-access-waiver: this migration CREATES the samsara raw staging table it names — the owning
-- collector's own DDL, no cross-module read.
