-- 0146 — `documents`: the scan behind every compliance record (Safety/DQF plan, DQ0).
--
-- THE GAP THIS CLOSES. Until now there was no way to upload a driver document and nowhere to put
-- one. `certifications.document_id` (0127:35) and `qualification_records.document_id` (0129:20) are
-- unconstrained uuids pointing at a table that did not exist — 0127 says so in its own comment:
-- "FK added with the documents table (M1 roster); column reserved now." `master_documents` (0101)
-- looked like the answer, but it refers to a Storage bucket that was never created and has zero
-- application code outside a schema probe. 0147 retires it rather than leaving two answers standing.
--
-- SHAPE COPIED FROM THE PROVEN PATH, NOT INVENTED. `hazmat_documents` + the `hazmat` bucket (0092)
-- is the one document pipeline in this product that works end to end: register → signed upload →
-- batch signed read; insert-only; no client SELECT and no client DELETE, because originals are
-- served exclusively through short-lived API-issued signed URLs. This is that pipeline with a
-- polymorphic subject where `load_id` was.
--
-- WHY THE BUCKET IS NOT CALLED `driver-docs`. The plan drafted that name, but the subject vocabulary
-- this table has always been specified with — 0101's entity types, and DOCUMENT_SUBJECT_TYPES in
-- complianceContract.ts — covers tractors, trailers, dispatch loads and the carrier itself. A
-- trailer's annual inspection certificate filed in a bucket named "driver-docs" is a trap for
-- whoever reads it next, and a bucket cannot be renamed without moving every object in it.
--
-- APPEND-ONLY, LIKE THE RECORDS IT BACKS. §391.51 is a retention rule and §390.32(d) requires an
-- electronic record be reproducible later; a document a manager can quietly delete is not evidence.
-- There is deliberately no UPDATE and no DELETE policy — removal is a service-role operation
-- (retention job), exactly as with the `hazmat` bucket. A wrong upload is corrected by uploading the
-- right one and pointing the record at it; the orphan is swept by the reconciler, not by a user.

create table if not exists public.documents (
  id            uuid primary key,             -- CLIENT-generated: registration is an idempotent replay
  org_id        uuid not null references public.organizations(id) on delete cascade,
  -- Polymorphic by design, no FK — one query spans people, equipment, loads and the carrier. The
  -- deletion story is the reconciler's, not a cascade's: bytes outlive the row that referenced them
  -- until retention says otherwise.
  subject_type  text not null check (subject_type in ('driver','tractor','trailer','load','organization')),
  subject_id    uuid not null,                -- for subject_type='organization' this is the org id
  -- The union of what can be filed: every `certifications.kind` (0127), every
  -- `qualification_records.kind` (0129), plus 'other'. A document is uploaded BEFORE the record that
  -- cites it exists (scan the medical card, then record the certification), so it cannot borrow the
  -- parent's kind — it needs its own, and the Safety page answers "what is missing" by reading it.
  kind          text not null check (kind in (
                  -- certifications (0127)
                  'cdl','medical_card','endorsement','hazmat_training','twic',
                  'registration','annual_inspection','insurance','ifta','irp',
                  'phmsa_registration','hazmat_safety_permit','security_plan',
                  'financial_responsibility','operating_authority',
                  -- qualification_records (0129) — the §391.51 event set
                  'employment_application','mvr','annual_mvr_review','road_test',
                  'cdl_equivalency','previous_employer_inquiry','previous_employer_response',
                  'clearinghouse_full','clearinghouse_limited','eldt','spe_certificate',
                  'medical_registry_verification','drug_test','alcohol_test','accident',
                  -- a safety file lawfully holds things §391.51 does not enumerate
                  'other')),
  storage_path  text not null,                -- bucket 'compliance-docs', key org/subject_type/subject_id/{id}.{ext}
  -- Recorded at registration. `hazmat_documents` had to add this in 0131 because consumers were
  -- guessing from the extension; there is no reason to repeat that.
  content_type  text not null check (content_type in (
                  'application/pdf','image/jpeg','image/png','image/webp','image/heic')),
  bytes         bigint check (bytes is null or bytes > 0),
  -- Integrity evidence for §390.32(c). NOT NULL on purpose: the browser can compute this with
  -- crypto.subtle.digest before it uploads, and a nullable hash becomes a permanently empty column.
  sha256        text not null,
  page          int  not null default 1 check (page >= 1),
  variant       text not null default 'original' check (variant in ('original','normalized','thumb')),
  captured_at   timestamptz,                  -- when the paper was scanned, if known; not upload time
  uploaded_by   uuid references auth.users(id) on delete set null,
  created_at    timestamptz not null default now()
);

-- The Safety page's read: every document for one subject, newest first.
create index if not exists idx_documents_subject
  on public.documents (org_id, subject_type, subject_id, created_at desc);
-- "Which drivers have no current medical card scan" — one indexed pass, not a fleet-wide scan.
create index if not exists idx_documents_org_kind
  on public.documents (org_id, kind, subject_type);

-- The FKs 0127 and 0129 reserved their columns for. ON DELETE SET NULL, not CASCADE: a retention
-- purge of the scan must never take the certification row with it — the record outlives the image.
alter table public.certifications
  drop constraint if exists certifications_document_id_fkey;
alter table public.certifications
  add constraint certifications_document_id_fkey
  foreign key (document_id) references public.documents(id) on delete set null;

alter table public.qualification_records
  drop constraint if exists qualification_records_document_id_fkey;
alter table public.qualification_records
  add constraint qualification_records_document_id_fkey
  foreign key (document_id) references public.documents(id) on delete set null;

alter table public.documents enable row level security;

drop policy if exists documents_select on public.documents;
create policy documents_select on public.documents for select using (org_id = public.auth_org_id());

-- A driver may see their OWN documents and nothing else — the medical cards and drug-test results in
-- here are the most sensitive rows in the product. RESTRICTIVE, so it AND-combines with the org-wide
-- SELECT and stays transparent to every non-driver role (the 0083 pattern, mirrored from 0127:67).
drop policy if exists documents_driver_scope on public.documents;
create policy documents_driver_scope on public.documents as restrictive for select using (
  public.auth_role() <> 'driver'
  or (subject_type = 'driver' and subject_id = public.auth_driver_id())
);

-- INSERT only, and only for the roles that own the safety file. No UPDATE policy and no DELETE
-- policy: RLS denies both by default, which is the append-only property this table needs.
drop policy if exists documents_insert on public.documents;
create policy documents_insert on public.documents for insert with check (
  org_id = public.auth_org_id()
  and public.auth_role() = any (array['admin','fleet_manager','safety_manager'])
);

-- ═══════════════════════════════════════════════════════════════════════════════
-- Storage — bucket 'compliance-docs', keyed org_id/subject_type/subject_id/{doc}.{ext}
-- (folder[1] = org). INSERT-ONLY for the safety roles. NO client select, NO client delete:
-- originals are reachable only through API-issued signed URLs, on the 'hazmat' bucket's model
-- (0092) and deliberately NOT the member-deletable 'receipts' model.
-- ═══════════════════════════════════════════════════════════════════════════════
insert into storage.buckets (id, name, public, file_size_limit)
values ('compliance-docs', 'compliance-docs', false, 25 * 1024 * 1024)   -- a scanned multi-page DQF PDF
on conflict (id) do nothing;

drop policy if exists compliance_docs_write on storage.objects;
create policy compliance_docs_write on storage.objects for insert
  with check (
    bucket_id = 'compliance-docs'
    and (storage.foldername(name))[1]::uuid = public.auth_org_id()
    and public.auth_role() = any (array['admin','fleet_manager','safety_manager'])
  );

comment on table public.documents is
  'The scan behind any compliance record (DQF plan DQ0). Append-only: no UPDATE or DELETE policy —
   removal is a service-role retention operation. Bytes live in the private compliance-docs bucket
   and are served only through short-lived signed URLs.';
