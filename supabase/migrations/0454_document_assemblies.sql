-- 0454 — a document is an ordered assembly of pages, not a file (DOCUMENT-READER-PLAN.md §7A, D-DR14,
-- step N1; owner's flow 2026-10-10).
--
-- THE GAP THIS CLOSES. 0448 made a source one file (`unique (org_id, sha256)`, NOT NULL `page_count`) and
-- a read names one source, so "the pages of this BOL" could only be "the pages of this file". Drivers do
-- not send files: they send photos — 4.3 per Samsara *BOL…* submission (§0.1), mixed with cargo, placard
-- and securement shots, retakes included — and the office uploads three phone photos of a two-page BOL
-- just as often as one PDF. Read file by file, page 2 of a photographed BOL is a document of its own and
-- fails the paper audit for what is printed on page 1.
--
-- ── THE SHAPE ──────────────────────────────────────────────────────────────────────────────────────
-- A file stays a source (per-file dedupe stays exact; one Samsara photo = one source). On top of the
-- pages, two append-only tables say "these pages, in this order, are one document":
--   document_assemblies       one row per version of the grouping, with who made it.
--   document_assembly_pages   (assembly, position) → page, positions 1..n.
-- Layer 1 (PREPARE, §7A.3) proposes an assembly; the dispatcher may untick, reorder or add a page from
-- another submission, and every edit is a NEW assembly naming the one it replaces (`supersedes_id`).
-- Nothing is updated, so what was read is always reconstructible.
--
--   made_by          ASSEMBLY_MAKERS — prepare (Layer 1's proposal) | sender (the order a person uploaded
--                    in) | reviewer (a person's edit). One provenance CHECK: prepare names its
--                    `prepare_version` and no person; sender and reviewer name the person and no version.
--   supersedes_id    the assembly this one replaces. `unique` — a version is replaced at most once, so the
--                    history is a line, never a fork: two dispatchers editing the same assembly at once
--                    makes the second insert conflict (23505), which the API answers "edited elsewhere".
--   seq              identity — "newest" is read from it, never from `created_at` (0449's measured tie).
--
-- ── ONE DOOR ───────────────────────────────────────────────────────────────────────────────────────
-- `document_assembly_create` writes an assembly and all its pages in one statement-level unit, because an
-- assembly with no pages is a document of nothing and an append-only parent cannot be filled in later.
-- It refuses an empty list, a repeated page, and any page not of the org — named codes, not a bare FK
-- error, so the route can say which. Positions are the array's order, so they are 1..n with no gap by
-- construction. Service-role only, org required: the API reads with the service role, which bypasses RLS.
-- A direct INSERT stays possible for the service role (a matrix, a backfill); the composite FKs still make
-- a cross-org row impossible either way.
--
-- ── WHAT WAS REJECTED ──────────────────────────────────────────────────────────────────────────────
--   • Several files under one source: breaks per-file dedupe and the append-only `page_count`, and one
--     photo could then never belong to two submissions' documents (a BOL split across two sends).
--   • Grouping by arrival time alone: retakes and two loads sent minutes apart make it guess.
--   • A `profile` on the assembly: what the pages ARE is not what a reader reads them FOR — the read
--     carries the profile, as it does today.
--   • `document_reads.assembly_id` in this migration: a column and its first reader ship in separate
--     merges (`lint:migration-ordering`). The next step adds it beside the route that writes it.
--
-- New tables only: exempt from the column-before-reader rule (docs/MIGRATION-DISCIPLINE.md). RLS on, no
-- client policies — deny-all on purpose. Both tables join RETENTION_FORBIDDEN: which photos made one
-- shipping paper is part of that paper's record (§172.201(e), §177.817(f); D-DR9).

-- ═════════════════════════════════════════════════════════════════════════════════════════════════════
-- 1. Tables
-- ═════════════════════════════════════════════════════════════════════════════════════════════════════
create table if not exists public.document_assemblies (
  id               uuid primary key default gen_random_uuid(),
  seq              bigint generated always as identity,
  org_id           uuid not null references public.organizations(id) on delete cascade,
  made_by          text not null
    constraint document_assemblies_made_by_check
    check (made_by in ('prepare', 'sender', 'reviewer')),
  actor            uuid references auth.users(id),
  prepare_version  text constraint document_assemblies_prepare_version_nonempty check (btrim(prepare_version) <> ''),
  supersedes_id    uuid references public.document_assemblies(id),
  created_at       timestamptz not null default now(),
  constraint document_assemblies_provenance check (
    case when made_by = 'prepare'
      then prepare_version is not null and actor is null
      else prepare_version is null and actor is not null
    end),
  constraint document_assemblies_not_self check (supersedes_id is distinct from id),
  constraint uq_document_assemblies_supersedes unique (supersedes_id),
  constraint uq_document_assemblies_id_org unique (id, org_id),
  constraint document_assemblies_supersedes_same_org
    foreign key (supersedes_id, org_id) references public.document_assemblies (id, org_id)
);

create table if not exists public.document_assembly_pages (
  assembly_id  uuid not null references public.document_assemblies(id),
  org_id       uuid not null references public.organizations(id) on delete cascade,
  position     integer not null constraint document_assembly_pages_position_positive check (position >= 1),
  page_id      uuid not null references public.document_pages(id),
  primary key (assembly_id, position),
  -- A page appears once in a document; a retake is a different page and may sit beside it.
  constraint uq_document_assembly_pages_page unique (assembly_id, page_id),
  constraint document_assembly_pages_assembly_same_org
    foreign key (assembly_id, org_id) references public.document_assemblies (id, org_id),
  constraint document_assembly_pages_page_same_org
    foreign key (page_id, org_id) references public.document_pages (id, org_id)
);

-- "Which documents use this page" (a reviewer opening a photo; the Samsara picker marking used photos).
create index if not exists idx_document_assembly_pages_page on public.document_assembly_pages (org_id, page_id);
create index if not exists idx_document_assemblies_org_seq on public.document_assemblies (org_id, seq desc);

comment on table public.document_assemblies is
  'module=document-reading; layer=core (0454, D-DR14: one version of "these pages, in this order, are one '
  'document"; an edit is a new row naming the one it supersedes; append-only, RETENTION_FORBIDDEN).';
comment on table public.document_assembly_pages is
  'module=document-reading; layer=core (0454, D-DR14: an assembly''s pages, positions 1..n; written with '
  'its assembly by document_assembly_create; append-only, RETENTION_FORBIDDEN).';

drop trigger if exists trg_document_assemblies_append_only on public.document_assemblies;
create trigger trg_document_assemblies_append_only
  before update or delete on public.document_assemblies
  for each row execute function public.document_reader_append_only();

drop trigger if exists trg_document_assembly_pages_append_only on public.document_assembly_pages;
create trigger trg_document_assembly_pages_append_only
  before update or delete on public.document_assembly_pages
  for each row execute function public.document_reader_append_only();

alter table public.document_assemblies enable row level security;
alter table public.document_assembly_pages enable row level security;

-- ═════════════════════════════════════════════════════════════════════════════════════════════════════
-- 2. The door — an assembly and its pages, together
-- ═════════════════════════════════════════════════════════════════════════════════════════════════════
-- DO016: the page list is empty, holds a null, or repeats a page.
-- DO017: a page is not one of this organization's (named before the FK would say it less clearly).
-- DO018: the superseded assembly is not this organization's.
create or replace function public.document_assembly_create(
  p_org              uuid,
  p_pages            uuid[],
  p_made_by          text,
  p_actor            uuid default null,
  p_prepare_version  text default null,
  p_supersedes       uuid default null
)
returns public.document_assemblies
language plpgsql
set search_path = ''
as $$
declare
  v_assembly public.document_assemblies;
  v_found    integer;
begin
  if p_pages is null or cardinality(p_pages) = 0 or array_position(p_pages, null) is not null then
    raise exception 'an assembly needs at least one page, and no empty entry' using errcode = 'DO016';
  end if;
  if (select count(distinct p) from unnest(p_pages) p) <> cardinality(p_pages) then
    raise exception 'an assembly lists each page once' using errcode = 'DO016';
  end if;
  select count(*) into v_found from public.document_pages dp where dp.org_id = p_org and dp.id = any (p_pages);
  if v_found <> cardinality(p_pages) then
    raise exception '% of % pages are not this organization''s', cardinality(p_pages) - v_found, cardinality(p_pages)
      using errcode = 'DO017';
  end if;
  if p_supersedes is not null
     and not exists (select 1 from public.document_assemblies a where a.id = p_supersedes and a.org_id = p_org) then
    raise exception 'assembly % is not this organization''s', p_supersedes using errcode = 'DO018';
  end if;

  insert into public.document_assemblies (org_id, made_by, actor, prepare_version, supersedes_id)
  values (p_org, p_made_by, p_actor, p_prepare_version, p_supersedes)
  returning * into v_assembly;

  insert into public.document_assembly_pages (assembly_id, org_id, position, page_id)
  select v_assembly.id, p_org, o.n::integer, o.page_id
    from unnest(p_pages) with ordinality as o(page_id, n);

  return v_assembly;
end;
$$;

comment on function public.document_assembly_create(uuid, uuid[], text, uuid, text, uuid) is
  '0454: writes one document assembly and its pages (positions = the array''s order) in one unit. '
  'Service-role only. DO016 empty/repeated pages, DO017 a page of another org, DO018 a superseded '
  'assembly of another org; 23505 when the superseded assembly was already replaced.';

revoke all on function public.document_assembly_create(uuid, uuid[], text, uuid, text, uuid)
  from public, anon, authenticated;
