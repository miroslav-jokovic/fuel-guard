-- 0448 — the document reader's four tables and its bucket (DOCUMENT-READER-PLAN.md Step 1.2, §2 Tables).
--
-- THE GAP THIS CLOSES. The only path in this product that shows a document image to a model is the
-- hazmat extractor, and what it keeps of a read is the form it filled: no record of which bytes were
-- read, which model read them, what each reader said about each field, or what the dispatcher then
-- confirmed or corrected. The plan's module (`document-reading`, D-DR1) reads every paper the carrier
-- receives under a PROFILE, and these tables are its record: the bytes as received, the canonical pages
-- made from them, each read and its evidence, and each person's verdict on a field. Schema only — the
-- module's code arrives from Step 1.3, and nothing in apps/ reads or writes these tables yet.
--
-- ── THE FOUR TABLES ─────────────────────────────────────────────────────────────────────────────────
--   document_sources       one received file (or one Samsara submission), as bytes in `document-intake`:
--                          origin, the channel's own id for it, the sender as received and the driver
--                          the roster matched, sha256, mime, size, page count (D-DR9, D-DR12).
--   document_pages         one canonical page made from a source (D-DR13): its class and who set it
--                          (D-DR11), the lossless original and the working copy, size, text layer.
--   document_reads         one read of a source under a profile: the versions that make up the cache
--                          key (§4.6), the status, a typed failure, the result and its evidence, usage.
--   document_read_reviews  one person's verdict on one field of one read — the labels graduation counts
--                          (D-DR5).
--
-- ── EVERY VOCABULARY IS THE CONTRACT'S ──────────────────────────────────────────────────────────────
-- Each closed list below is an array in packages/shared/src/documentReadingContract.ts (DOCUMENT_ORIGINS,
-- PAGE_CLASSES, PAGE_CLASS_SETTERS, READ_STATUSES, READ_FAILURE_CODES, REVIEW_ACTIONS, REVIEW_CONSUMERS,
-- DOCUMENT_PROFILE_IDS), so the database and the API refuse the same values. A CHECK cannot import a
-- TypeScript array, so the two are held equal by a test instead: supabase/tests/document-reader-tables
-- reads every CHECK back out of the APPLIED catalog and compares it with the contract's array, item for
-- item ("every CHECK vocabulary equals its contract array"). The catalog, not this file, because a later
-- migration that re-issues one of these constraints is what that test exists to catch.
--
-- ── APPEND-ONLY, BY TRIGGER, FOR THE SERVICE ROLE TOO ───────────────────────────────────────────────
-- A read whose source can change under it is not evidence (D-DR9), and shipping papers carry retention
-- duties: §172.201(e) the offeror 2 years, §177.817(f) the carrier 1 year. So sources, pages and reviews
-- refuse UPDATE and DELETE whoever asks — RLS cannot do that, because the API holds the service role,
-- which bypasses it (the 0406 argument). A correction is a new row: a re-received file is deduplicated,
-- a re-classified page is a new label (see Q below), a changed mind on a field is a new review.
--   ONE exception, on document_sources: `matched_driver_id` may change, to null or to a driver of the
--   same org, and nothing else may change with it. That is the shape of the two things that must be able
--   to touch it: the roster merge, which moves the FK onto the surviving driver (mergeDriver.ts lists
--   it; 0370's load_dispatches guard is the precedent), and `on delete set null` behind it. A driver row
--   is only ever deleted by that merge (0235's guard refuses every other DELETE), so the set-null is the
--   belt to the merge's braces: a received document is never taken with a driver row, it falls back to
--   the Unmatched list (D-DR12).
--   The sender as received is untouched by either, so what the channel said is never lost.
--   `uploaded_by` and `actor` reference auth.users WITHOUT `on delete set null`, as audit_logs and
--   handbook_marks do: a person who has filed evidence is not hard-deleted out from under it, and a
--   set-null would be an UPDATE these triggers refuse anyway.
--   ⚠ Deleting an ORGANISATION that holds any of these rows is refused too (the cascade is a DELETE).
--   That is 0406's and 0395's posture, deliberately: evidence is the last thing that should disappear as
--   a side effect; an org's removal is an explicit, audited service-role act that disables the triggers.
--
-- ── document_reads: INSERT QUEUED, THEN ONE RPC ─────────────────────────────────────────────────────
-- A read is inserted `queued` with nothing yet known about its outcome, and changes only through
-- `document_read_transition`: queued → reading → done | failed. `failed` carries a READ_FAILURES code
-- (§4.7, typed and visible); `done` carries the result; both are terminal. The trigger enforces the
-- machine on its own (an illegal move fails even inside the RPC), and refuses any UPDATE that did not come
-- through the RPC, so there is one place a read's outcome is written. reading → reading is accepted as a
-- no-op: the queue retries a transient model error (§2 Queue) by running the job again, and a retried
-- job re-claims a read already `reading`; refusing that would strand it there.
--
-- ── DEDUPE (D-DR12) ─────────────────────────────────────────────────────────────────────────────────
-- A document that arrives on two channels — a driver texts it and uploads it to Samsara — is the same
-- bytes. `unique (org_id, sha256)` makes the second arrival a conflict the API answers with the first
-- source (`createSourceResponse.duplicate`). Within the org only: two carriers holding the same PDF are
-- two records.
--
-- ── WHAT WAS REJECTED ───────────────────────────────────────────────────────────────────────────────
--   • Storing `mime` against a CHECK list: the accepted formats are intake's refusal (§3, INTAKE_REFUSALS
--     `unsupported_format`), decided before any row exists, and the contract keeps that list private to
--     its request schema. A second copy here would be a restated vocabulary with no test to hold it.
--   • A `document_reads.updated_at`: started_at and finished_at are the two moments a read has; a
--     generic stamp moves on every write and so cannot say whether, or when, a read actually ran.
--   • Composite FKs only: the matrices' tenant-isolation seeder follows single-column FKs, so each child
--     carries both — the single-column one names the parent, the composite (id, org_id) one is what makes
--     a page, a read or a review of another org's source impossible to insert.
--
-- Q (for the plan's open questions, not answered here): a dispatcher's override of a page's class
-- (D-DR11) has no home while document_pages is append-only. Candidates: (a) an append-only
-- `document_page_labels` table, latest wins; (b) one guarded UPDATE of the two class columns; (c) a
-- review with field path `pages[n].class`. Recommendation (a) — a label is evidence like a review.
--
-- New tables only: exempt from the column-before-reader rule (docs/MIGRATION-DISCIPLINE.md). RLS on, no
-- client policies — deny-all on purpose; the module's API serves every row with its own org filter.

-- ═════════════════════════════════════════════════════════════════════════════════════════════════════
-- 1. Tables
-- ═════════════════════════════════════════════════════════════════════════════════════════════════════
create table if not exists public.document_sources (
  id                 uuid primary key default gen_random_uuid(),
  org_id             uuid not null references public.organizations(id) on delete cascade,
  origin             text not null
    constraint document_sources_origin_check
    check (origin in ('upload', 'samsara', 'sms', 'email', 'driver_scan')),
  -- The channel's own id for what it delivered: the Samsara document id, the Telnyx message id, the Graph
  -- message + attachment id. An upload has none.
  origin_ref         text,
  -- The phone number or address exactly as the channel gave it — shown, never trusted (D-DR12).
  sender             text,
  matched_driver_id  uuid references public.drivers(id) on delete set null,
  storage_path       text not null,
  sha256             text not null constraint document_sources_sha256_format check (sha256 ~ '^[0-9a-f]{64}$'),
  mime               text not null constraint document_sources_mime_nonempty check (btrim(mime) <> ''),
  byte_size          bigint not null constraint document_sources_byte_size_positive check (byte_size > 0),
  page_count         integer not null constraint document_sources_page_count_positive check (page_count >= 1),
  uploaded_by        uuid references auth.users(id),
  created_at         timestamptz not null default now(),
  constraint document_sources_ref_for_channels
    check (origin not in ('samsara', 'sms', 'email') or origin_ref is not null),
  constraint uq_document_sources_org_sha256 unique (org_id, sha256),
  constraint uq_document_sources_id_org unique (id, org_id)
);

create table if not exists public.document_pages (
  id                  uuid primary key default gen_random_uuid(),
  org_id              uuid not null references public.organizations(id) on delete cascade,
  source_id           uuid not null references public.document_sources(id),
  page_number         integer not null constraint document_pages_page_number_positive check (page_number >= 1),
  page_class          text
    constraint document_pages_page_class_check
    check (page_class in ('bol', 'delivery_copy', 'placard', 'securement', 'other')),
  page_class_set_by   text
    constraint document_pages_page_class_set_by_check
    check (page_class_set_by in ('classifier', 'reviewer', 'labeller')),
  -- D-DR13: the lossless canonical ORIGINAL (PNG) and its hash, beside the source's untouched bytes, and
  -- the working copy the readers see. Evidence bboxes are fractions of the working copy's size.
  original_path       text not null,
  original_sha256     text not null constraint document_pages_original_sha256_format check (original_sha256 ~ '^[0-9a-f]{64}$'),
  working_path        text not null,
  width               integer not null constraint document_pages_width_positive check (width > 0),
  height              integer not null constraint document_pages_height_positive check (height > 0),
  -- The normaliser that made this page; it is part of every read's cache key (§4.6).
  normaliser_version  text not null,
  -- A born-digital PDF's words and boxes (D-DR3); null for a photo.
  text_layer          jsonb,
  capture_metrics     jsonb,
  created_at          timestamptz not null default now(),
  constraint document_pages_class_has_setter check ((page_class is null) = (page_class_set_by is null)),
  constraint uq_document_pages_source_page unique (source_id, page_number),
  constraint document_pages_source_same_org
    foreign key (source_id, org_id) references public.document_sources (id, org_id)
);

create table if not exists public.document_reads (
  id                       uuid primary key default gen_random_uuid(),
  org_id                   uuid not null references public.organizations(id) on delete cascade,
  source_id                uuid not null references public.document_sources(id),
  profile                  text not null
    constraint document_reads_profile_check check (profile in ('shipping_document')),
  profile_version          text not null,
  status                   text not null default 'queued'
    constraint document_reads_status_check check (status in ('queued', 'reading', 'done', 'failed')),
  failure_code             text
    constraint document_reads_failure_code_check
    check (failure_code in ('refusal', 'max_tokens', 'schema_invalid', 'unusable_image', 'no_readable_page',
                            'budget_exhausted', 'integrity_mismatch')),
  -- The cache key's parts (§4.6) as they were for this read, and the key itself.
  models                   text[] not null default '{}',
  prompt_version           text,
  schema_hash              text,
  acceptance_rule_version  text,
  cache_key                text,
  -- The profile document (null until done) and one FieldEvidence per field.
  result                   jsonb,
  evidence                 jsonb not null default '[]'::jsonb
    constraint document_reads_evidence_is_array check (jsonb_typeof(evidence) = 'array'),
  input_tokens             integer constraint document_reads_input_tokens_nonneg check (input_tokens >= 0),
  output_tokens            integer constraint document_reads_output_tokens_nonneg check (output_tokens >= 0),
  requested_by             uuid references auth.users(id),
  created_at               timestamptz not null default now(),
  started_at               timestamptz,
  finished_at              timestamptz,
  -- A failure names its code and only a failure does; only a finished read has a result.
  constraint document_reads_failed_has_code check ((status = 'failed') = (failure_code is not null)),
  constraint document_reads_result_only_when_done check (result is null or status = 'done'),
  constraint document_reads_moments check (
    case status
      when 'queued'  then started_at is null and finished_at is null
      when 'reading' then started_at is not null and finished_at is null
      else started_at is not null and finished_at is not null
    end),
  constraint uq_document_reads_id_org unique (id, org_id),
  constraint document_reads_source_same_org
    foreign key (source_id, org_id) references public.document_sources (id, org_id)
);

create table if not exists public.document_read_reviews (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations(id) on delete cascade,
  read_id     uuid not null references public.document_reads(id),
  -- A FieldEvidence path (fieldEvidenceContract.ts), e.g. `hazmat.lines[0].unNumber`.
  field_path  text not null constraint document_read_reviews_field_path_nonempty check (btrim(field_path) <> ''),
  action      text not null
    constraint document_read_reviews_action_check check (action in ('confirmed', 'corrected', 'unreadable')),
  old_value   jsonb,
  new_value   jsonb,
  actor       uuid not null references auth.users(id),
  consumer    text not null
    constraint document_read_reviews_consumer_check check (consumer in ('hazmat_calculator')),
  created_at  timestamptz not null default now(),
  constraint document_read_reviews_read_same_org
    foreign key (read_id, org_id) references public.document_reads (id, org_id)
);

-- The Unmatched list and a driver's documents ask "this org, newest first", by driver or with none.
create index if not exists idx_document_sources_org_created on public.document_sources (org_id, created_at desc);
create index if not exists idx_document_sources_driver on public.document_sources (org_id, matched_driver_id, created_at desc);
create index if not exists idx_document_reads_source on public.document_reads (org_id, source_id, created_at desc);
-- The cache lookup (§4.6): a finished read under the same key is reused.
create index if not exists idx_document_reads_cache_key on public.document_reads (org_id, cache_key) where status = 'done';
create index if not exists idx_document_read_reviews_read on public.document_read_reviews (org_id, read_id, created_at);

comment on table public.document_sources is
  'module=document-reading; layer=core (0448, D-DR9/D-DR12: one received file as bytes in document-intake; '
  'append-only bar matched_driver_id, RETENTION_FORBIDDEN; scripts/table-modules.json is the machine-read source).';
comment on table public.document_pages is
  'module=document-reading; layer=core (0448, D-DR13/D-DR11: one canonical page of a source; append-only).';
comment on table public.document_reads is
  'module=document-reading; layer=derived (0448: one read of a source under a profile; inserted queued, '
  'then only document_read_transition moves it).';
comment on table public.document_read_reviews is
  'module=document-reading; layer=core (0448, D-DR5: one verdict on one field of a read; append-only, RETENTION_FORBIDDEN).';

-- ═════════════════════════════════════════════════════════════════════════════════════════════════════
-- 2. Append-only guards
-- ═════════════════════════════════════════════════════════════════════════════════════════════════════
-- One function for pages and reviews, which allow nothing (0406's shape); its own for sources, which
-- allows the one driver move described in the header (0370's shape).
create or replace function public.document_reader_append_only()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception '% is append-only: % is refused (a correction is a new row)', tg_table_name, tg_op
    using errcode = 'DO010';
end;
$$;

create or replace function public.document_sources_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_driver_org uuid;
begin
  if tg_op = 'DELETE' then
    raise exception 'document_sources is append-only: DELETE is refused (a received document is evidence)'
      using errcode = 'DO010';
  end if;
  if (to_jsonb(new) - 'matched_driver_id') is distinct from (to_jsonb(old) - 'matched_driver_id') then
    raise exception 'document_sources is append-only: only matched_driver_id may change'
      using errcode = 'DO010';
  end if;
  if new.matched_driver_id is not null then
    select d.org_id into v_driver_org from public.drivers d where d.id = new.matched_driver_id;
    if v_driver_org is distinct from new.org_id then
      raise exception 'a document and its matched driver must belong to one organization'
        using errcode = 'DO011';
    end if;
  end if;
  return new;
end;
$$;

-- The same-org rule on INSERT, for the one FK that is not composite (a driver row has no (id, org_id) key
-- to point at, and adding one to drivers is a roster migration, not this one).
create or replace function public.document_sources_driver_same_org()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_driver_org uuid;
begin
  if new.matched_driver_id is not null then
    select d.org_id into v_driver_org from public.drivers d where d.id = new.matched_driver_id;
    if v_driver_org is distinct from new.org_id then
      raise exception 'a document and its matched driver must belong to one organization'
        using errcode = 'DO011';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_document_sources_insert on public.document_sources;
create trigger trg_document_sources_insert
  before insert on public.document_sources
  for each row execute function public.document_sources_driver_same_org();
drop trigger if exists trg_document_sources_append_only on public.document_sources;
create trigger trg_document_sources_append_only
  before update or delete on public.document_sources
  for each row execute function public.document_sources_guard();

drop trigger if exists trg_document_pages_append_only on public.document_pages;
create trigger trg_document_pages_append_only
  before update or delete on public.document_pages
  for each row execute function public.document_reader_append_only();

drop trigger if exists trg_document_read_reviews_append_only on public.document_read_reviews;
create trigger trg_document_read_reviews_append_only
  before update or delete on public.document_read_reviews
  for each row execute function public.document_reader_append_only();

-- ═════════════════════════════════════════════════════════════════════════════════════════════════════
-- 3. document_reads: inserted queued, moved only by document_read_transition
-- ═════════════════════════════════════════════════════════════════════════════════════════════════════
create or replace function public.document_reads_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.status <> 'queued' then
      raise exception 'a document read is inserted queued, not %', new.status using errcode = 'DO012';
    end if;
    return new;
  end if;
  if tg_op = 'DELETE' then
    raise exception 'document_reads is append-only: DELETE is refused' using errcode = 'DO010';
  end if;
  if coalesce(current_setting('silvicom.document_read_transition', true), '') <> 'on' then
    raise exception 'a document read changes only through document_read_transition' using errcode = 'DO013';
  end if;
  -- What a read IS never changes; only its outcome is written.
  if (new.id, new.org_id, new.source_id, new.profile, new.profile_version, new.requested_by, new.created_at)
     is distinct from
     (old.id, old.org_id, old.source_id, old.profile, old.profile_version, old.requested_by, old.created_at) then
    raise exception 'a document read''s source, profile and requester are fixed at insert' using errcode = 'DO012';
  end if;
  if not (
       (old.status = 'queued'  and new.status = 'reading')
    or (old.status = 'reading' and new.status in ('reading', 'done', 'failed'))
  ) then
    raise exception 'a document read cannot move from % to %', old.status, new.status using errcode = 'DO014';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_document_reads_guard on public.document_reads;
create trigger trg_document_reads_guard
  before insert or update or delete on public.document_reads
  for each row execute function public.document_reads_guard();

-- The one writer of a read's outcome. Service-role only: the worker calls it with the org it claimed the
-- job for, and the row is matched on (id, org_id) so a wrong org finds nothing rather than another's read.
-- `p_failure_code` is required for `failed` and refused otherwise; `p_result` only for `done`. Usage and
-- versions are recorded on a failure too — a `max_tokens` failure spent its tokens.
create or replace function public.document_read_transition(
  p_org                      uuid,
  p_read                     uuid,
  p_to                       text,
  p_failure_code             text default null,
  p_result                   jsonb default null,
  p_evidence                 jsonb default null,
  p_models                   text[] default null,
  p_prompt_version           text default null,
  p_schema_hash              text default null,
  p_acceptance_rule_version  text default null,
  p_cache_key                text default null,
  p_input_tokens             integer default null,
  p_output_tokens            integer default null
)
returns public.document_reads
language plpgsql
set search_path = ''
as $$
declare
  v_old public.document_reads;
  v_new public.document_reads;
begin
  select * into v_old from public.document_reads r where r.id = p_read and r.org_id = p_org for update;
  if not found then
    raise exception 'document read % not found in this organization', p_read using errcode = 'DO015';
  end if;
  if (p_to = 'failed') <> (p_failure_code is not null) then
    raise exception 'a failed read needs a failure code, and only a failed read has one' using errcode = 'DO014';
  end if;
  if p_result is not null and p_to <> 'done' then
    raise exception 'only a done read has a result' using errcode = 'DO014';
  end if;
  -- reading → reading is the queue's retry re-claiming a read (header); it changes nothing.
  if v_old.status = 'reading' and p_to = 'reading' then
    return v_old;
  end if;

  perform set_config('silvicom.document_read_transition', 'on', true);
  update public.document_reads set
    status                  = p_to,
    failure_code            = p_failure_code,
    started_at              = case when p_to = 'reading' then now() else v_old.started_at end,
    finished_at             = case when p_to in ('done', 'failed') then now() else v_old.finished_at end,
    result                  = coalesce(p_result, v_old.result),
    evidence                = coalesce(p_evidence, v_old.evidence),
    models                  = coalesce(p_models, v_old.models),
    prompt_version          = coalesce(p_prompt_version, v_old.prompt_version),
    schema_hash             = coalesce(p_schema_hash, v_old.schema_hash),
    acceptance_rule_version = coalesce(p_acceptance_rule_version, v_old.acceptance_rule_version),
    cache_key               = coalesce(p_cache_key, v_old.cache_key),
    input_tokens            = coalesce(p_input_tokens, v_old.input_tokens),
    output_tokens           = coalesce(p_output_tokens, v_old.output_tokens)
  where id = p_read and org_id = p_org
  returning * into v_new;
  perform set_config('silvicom.document_read_transition', '', true);
  return v_new;
end;
$$;

comment on function public.document_read_transition(uuid, uuid, text, text, jsonb, jsonb, text[], text, text, text, text, integer, integer) is
  '0448: the only writer of a document read''s outcome — queued → reading → done | failed (failed carries a '
  'READ_FAILURES code; both terminal). Service-role only. Raises DO014 on an illegal move, DO015 on no such read.';

revoke all on function public.document_read_transition(uuid, uuid, text, text, jsonb, jsonb, text[], text, text, text, text, integer, integer)
  from public, anon, authenticated;
revoke all on function public.document_reader_append_only() from public, anon, authenticated;
revoke all on function public.document_sources_guard() from public, anon, authenticated;
revoke all on function public.document_sources_driver_same_org() from public, anon, authenticated;
revoke all on function public.document_reads_guard() from public, anon, authenticated;

-- ═════════════════════════════════════════════════════════════════════════════════════════════════════
-- 4. RLS — on, no client policies (deny-all on purpose; the module's API org-filters every query)
-- ═════════════════════════════════════════════════════════════════════════════════════════════════════
alter table public.document_sources enable row level security;
alter table public.document_pages enable row level security;
alter table public.document_reads enable row level security;
alter table public.document_read_reviews enable row level security;

-- ═════════════════════════════════════════════════════════════════════════════════════════════════════
-- 5. The bucket (D-DR9) — private, no storage.objects policy at all: deny-all for every client session,
-- bytes served only through the API's short-lived signed URLs, as the `hazmat` and `fuel-statements`
-- buckets are. The size cap is INTAKE_LIMITS.maxBytes (25 MB), held equal by the same matrix.
-- ═════════════════════════════════════════════════════════════════════════════════════════════════════
insert into storage.buckets (id, name, public, file_size_limit)
values ('document-intake', 'document-intake', false, 25 * 1024 * 1024)
on conflict (id) do nothing;
