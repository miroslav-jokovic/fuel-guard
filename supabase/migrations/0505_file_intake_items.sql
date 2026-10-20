-- 0505 — the bulk-upload review queue for driver, truck and trailer papers (UNIT-FILES-PLAN UF7a, D-UF8).
--
-- ── WHAT IT IS ──────────────────────────────────────────────────────────────────────────────────
-- An office drops a stack of papers — forty registrations at renewal, a scanned box of medical cards —
-- on the Drivers, Vehicles or Trailers list. Each file becomes a `document_sources` row (the document
-- reader's intake), one read segments it into papers and proposes, per paper, whose it is and what it
-- is; this table holds one row per proposed paper until a PERSON files or discards it. D-UF8: the AI
-- proposes, a person files. Nothing here is evidence — the filed `documents` and `certifications` rows
-- are — so rows are decided in place (pending → filed | discarded | duplicate) and are not append-only.
--
-- ── WHY IT IS KEPT AFTER IT IS DECIDED ──────────────────────────────────────────────────────────
-- `changed` is D-UF8's measurement: did the person alter any proposed field before filing? The rate at
-- which proposals are accepted untouched is the only evidence that would ever justify filing without
-- review, and the plan refuses to guess it. A decided row is that record, so no retention rule.
--
-- ── SHAPE ───────────────────────────────────────────────────────────────────────────────────────
--   batch_id          the browser's uuid for one drop — the review page is `/files/intake?batch=`.
--   source_id         the uploaded file. No FK: `document_sources` is document-reading's table, and
--                     this is evidence's (no FK across modules, 0480/0485). The service checks it.
--   page_from/to      the paper's pages within the source; null until the read has segmented it.
--   scope_subject_*   set when the drop was on one row's File cell: the subject is fixed, the read
--                     only says what the paper is (a contradicting identifier is a warning, not a move).
--   proposed_*        the read + matcher's answer, all nullable: "no proposal" is an answer (two
--                     equal candidates propose nobody, `fileSubjectMatch.ts`, UF7b).
--   match_basis       which identifier named the subject — vin, plate, unit_number, filename, cdl, name
--                     — or scope when the drop fixed it. Shown on the row, so a person knows how sure
--                     to be.
--   filed_*           what filing wrote: one `documents` original, and one certification per unit for a
--                     paper that names several (D-UF6). `filed_document_id` is evidence's own table, so
--                     it carries an FK; an array cannot. `decided_by` has none (auth.users, 0485).
--
-- ── DEPLOY ORDER ────────────────────────────────────────────────────────────────────────────────
-- A new table, exempt from the ordering rule: no old code reads or writes it. The plan put the
-- `compliance_paper` word for `document_reads.profile` in this migration too; it moves to UF7b's,
-- because document-reader-tables.test.mjs holds that CHECK equal to `DOCUMENT_PROFILE_IDS` and the
-- profile is UF7b's — the way 0478 shipped `roadside_inspection_report` with its own profile.

create table if not exists public.file_intake_items (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  batch_id uuid not null,
  source_id uuid not null,
  page_from integer,
  page_to integer,
  scope_subject_type text check (scope_subject_type in ('driver', 'tractor', 'trailer')),
  scope_subject_id uuid,
  proposed_subject_type text check (proposed_subject_type in ('driver', 'tractor', 'trailer')),
  proposed_subject_id uuid,
  proposed_kind text check (proposed_kind is null or length(proposed_kind) between 1 and 80),
  proposed_qualifier text check (proposed_qualifier is null or length(proposed_qualifier) between 1 and 80),
  proposed_issued_on date,
  proposed_expires_on date,
  read_identifiers jsonb not null default '{}'::jsonb check (jsonb_typeof(read_identifiers) = 'object'),
  match_basis text check (match_basis in ('vin', 'plate', 'unit_number', 'filename', 'cdl', 'name', 'scope')),
  confidence numeric(4, 3) check (confidence between 0 and 1),
  status text not null default 'pending' check (status in ('pending', 'filed', 'discarded', 'duplicate')),
  decided_by uuid,
  decided_at timestamptz,
  changed boolean,
  filed_document_id uuid references public.documents(id) on delete restrict,
  filed_certification_ids uuid[] not null default '{}',
  created_at timestamptz not null default now(),
  -- Written as a pair test plus a range test: `(1 >= 1 and null >= 1)` is NULL, which a CHECK passes.
  constraint file_intake_items_pages check (
    (page_from is null) = (page_to is null) and (page_from is null or (page_from >= 1 and page_to >= page_from))
  ),
  constraint file_intake_items_scope_pair check ((scope_subject_type is null) = (scope_subject_id is null)),
  constraint file_intake_items_proposed_pair check ((proposed_subject_type is null) = (proposed_subject_id is null)),
  -- A pending row has no decision; a decided one says who and when. `duplicate` is decided by the
  -- service (the same bytes already filed for the subject), so it carries no person.
  constraint file_intake_items_decision check (
    case status
      when 'pending' then decided_by is null and decided_at is null and changed is null
      when 'duplicate' then decided_at is not null and changed is null
      else decided_by is not null and decided_at is not null and changed is not null
    end
  ),
  -- Filing wrote a document, and only filing did.
  constraint file_intake_items_filed check ((status = 'filed') = (filed_document_id is not null)),
  constraint file_intake_items_certs_only_when_filed check (status = 'filed' or cardinality(filed_certification_ids) = 0)
);

create index if not exists file_intake_items_batch_idx on public.file_intake_items (org_id, batch_id, created_at);
create index if not exists file_intake_items_source_idx on public.file_intake_items (org_id, source_id);

alter table public.file_intake_items enable row level security;

comment on table public.file_intake_items is
  'UF7a (0505): one proposed paper from a bulk upload, waiting for a person to file or discard it (D-UF8). A work queue, not evidence — the filed documents/certifications rows are. Kept once decided: `changed` measures how often a proposal was altered. Service role only.';
