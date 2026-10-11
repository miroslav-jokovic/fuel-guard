-- 0455 — a document read names the assembly it read (DOCUMENT-READER-PLAN.md §7A, D-DR14, step N1).
--
-- THE GAP THIS CLOSES. 0454 can say "these photos, in this order, are one BOL", but a read still names
-- one SOURCE (0448: `source_id not null`), so a read can only be of one file. Drivers send a BOL as
-- several photos, each its own source (D-DR14), so the read of a photographed two-page BOL has nowhere
-- to say which pages it was given. D-DR14: "the read names the assembly".
--
-- ── THE SHAPE ──────────────────────────────────────────────────────────────────────────────────────
--   assembly_id   the assembly this read was given, same org by composite FK (a read can never name
--                 another carrier's grouping). Fixed at insert, like `source_id`: what a read IS never
--                 changes (document_reads_guard below).
--   source_id     no longer NOT NULL. A read names EXACTLY ONE of the two (`document_reads_names_one`):
--                 an assembly spanning three photos has no one source to name, and naming the first
--                 page's source beside it would be a second, weaker answer to "what was read" that a
--                 reader could follow instead of the assembly. Every read before this migration names
--                 its source and keeps it; the check holds for all of them as they stand.
--
-- ── WHY THE SOURCE PATH STAYS ──────────────────────────────────────────────────────────────────────
-- Old code still requests a read by source, and in a release it serves this schema for the deploy
-- minutes (docs/MIGRATION-DISCIPLINE.md §the-deploy-window); relaxing a NOT NULL breaks no writer it
-- had. The reader that writes `assembly_id` ships in the next merge (`lint:migration-ordering`); once
-- every request goes through an assembly — a single uploaded file becomes a one-file `sender`
-- assembly — the source path is retired by its own migration, a release after its last reader.
--
-- ── WHAT WAS REJECTED ──────────────────────────────────────────────────────────────────────────────
--   • Both columns filled, the source as "the first page's file": a copy of a fact the assembly
--     already holds, and wrong the moment a reviewer reorders the pages (a new assembly, same read row).
--   • A join table read → pages: the assembly IS that list, versioned; a second list would be a second
--     source of truth for which pages a read was given.
--   • Backfilling an assembly for every past read: they were reads of one file, which `source_id`
--     states exactly; inventing a `sender` assembly would need an actor nobody was.

alter table public.document_reads add column if not exists assembly_id uuid;
alter table public.document_reads alter column source_id drop not null;

alter table public.document_reads drop constraint if exists document_reads_assembly_same_org;
alter table public.document_reads add constraint document_reads_assembly_same_org
  foreign key (assembly_id, org_id) references public.document_assemblies (id, org_id);

alter table public.document_reads drop constraint if exists document_reads_names_one;
alter table public.document_reads add constraint document_reads_names_one
  check (num_nonnulls(source_id, assembly_id) = 1);

-- "The reads of this assembly", newest first — the reuse lookup and the review screen, as
-- idx_document_reads_source is for a source.
create index if not exists idx_document_reads_assembly
  on public.document_reads (org_id, assembly_id, created_at desc) where assembly_id is not null;

comment on column public.document_reads.assembly_id is
  '0455, D-DR14: the assembly (ordered pages) this read was given; exactly one of source_id / assembly_id '
  '(document_reads_names_one); fixed at insert.';

-- 0448's guard, with `assembly_id` among the facts fixed at insert. Otherwise unchanged.
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
  if (new.id, new.org_id, new.source_id, new.assembly_id, new.profile, new.profile_version, new.requested_by, new.created_at)
     is distinct from
     (old.id, old.org_id, old.source_id, old.assembly_id, old.profile, old.profile_version, old.requested_by, old.created_at) then
    raise exception 'a document read''s source, assembly, profile and requester are fixed at insert' using errcode = 'DO012';
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

revoke all on function public.document_reads_guard() from public, anon, authenticated;
