-- 0449 — a page's class is a ledger of verdicts, not two columns on the page (DOCUMENT-READER-PLAN.md
-- Q-DR12, owner's ruling 2026-10-09).
--
-- THE GAP THIS CLOSES. 0448 put `page_class` and `page_class_set_by` on `document_pages`, and made
-- `document_pages` append-only. Those two facts cannot both hold for the class:
--   • D-DR9 requires the page rows to exist before ANY read of the source, and the classifier (D-DR11)
--     is itself a model read of the page — so at the moment a page row is written there is no class to
--     write, and afterwards the trigger refuses the UPDATE that would record it.
--   • A dispatcher's override (D-DR11: "that is a label too") is a second verdict on the same page, and
--     a column holds one. Overwriting the classifier's answer would also destroy the one thing the
--     classifier is scored against (Step 1.5: `doc:score`'s confusion table).
-- Neither column was ever written or read — nothing in apps/ or packages/ names them (checked
-- 2026-10-09), and 0448 is on STAGING only, not yet released — so this migration drops them rather than
-- leaving two dead columns beside the table that replaces them.
--
-- ── THE SHAPE: ONE APPEND-ONLY LEDGER, NEWEST ROW PER PAGE WINS ─────────────────────────────────────
-- `document_page_classes` holds BOTH the classifier's verdict and every person's override, one row per
-- verdict. The current class of a page is its newest row — `asset_movements` → `rebuild_asset_holders`
-- (0333) and `part_movements` are the precedent: the ledger is the truth, "current" is a fold over it,
-- and a correction is a new row. Who-said-what is kept for good, which is what makes the classifier
-- scoreable against the people who corrected it.
--   set_by        PAGE_CLASS_SETTERS — classifier | reviewer (a dispatcher's override in the product) |
--                 labeller (the Step 0 corpus labeller).
--   actor         the person, for a reviewer or labeller; null for the classifier, which is no person.
--                 Required for a person, refused for the classifier (CHECK) — an override with nobody
--                 behind it is not evidence. auth.users WITHOUT `on delete set null`, as 0448's
--                 `uploaded_by` and `actor`: a set-null would be an UPDATE this table's trigger refuses.
--   model,        which model and which prompt produced a classifier verdict — required for it, null for a
--   prompt_version person (CHECK). The pair is what lets a verdict be re-scored after a prompt change and
--                 what tells two classifier rows on one page apart.
--   seq           an identity, and the ONLY thing "newest" is read from. Not `created_at`: `now()` is the
--                 transaction's start, so two verdicts written in one transaction (a classifier pass and an
--                 immediate override in one request) tie, and the tie would fall to `id`, a random uuid.
--                 `clock_timestamp()` was tried first and measured tying too — PGlite's clock moves in
--                 whole milliseconds, and two inserts fit in one. A sequence is allocated at INSERT, in
--                 the order the rows were written, and never ties. `created_at` stays as the human moment.
--
-- ── WHAT WAS REJECTED ───────────────────────────────────────────────────────────────────────────────
--   • A `read_id` / job reference. The classifier is not a `document_reads` row — that table's profile
--     CHECK is DOCUMENT_PROFILE_IDS, and a page class is not a profile — and the queue's jobs are pruned
--     while this is evidence, so a job id would dangle. model + prompt_version + created_at name the
--     verdict completely; a reference can be added beside them if Step 1.5 finds a reason.
--   • A `confidence` column: D-DR11 asks for a closed label, and Step 1.5 has not measured whether the
--     cheap model's confidence means anything. Adding it before that is a column nobody can interpret.
--   • `document_page_labels` (0448's own suggested name): a classifier verdict is not a label, and the
--     ruling puts both in the one table — the name says what the rows are, a page's class.
--   • A view for "current". `document_page_current_class` is a function so the org is a REQUIRED
--     argument: the API reads with the service role, which bypasses RLS, and a view would hand it every
--     carrier's pages unless each caller remembered the filter. Service-role only; no client path, as
--     every other document-reading object. It does not coalesce `p_org` to `auth_org_id()` (D-FC1),
--     because no browser calls it — `lint:rpc-org-default` therefore has nothing to check here.
--
-- ── SAME ORG, AS 0448's CHILDREN ────────────────────────────────────────────────────────────────────
-- `page_id` carries both FKs: the plain one (the matrices' tenant-isolation seeder follows single-column
-- FKs) and the composite (page_id, org_id) one, which is what makes a verdict on another carrier's page
-- impossible to insert. `document_pages` had no (id, org_id) key to point at; this migration adds it
-- (`uq_document_pages_id_org`, 0448's `uq_document_sources_id_org` idiom). ALTER TABLE … ADD CONSTRAINT
-- and DROP COLUMN fire no row triggers, so 0448's append-only guard on the page is not in the way.
--
-- New table: exempt from the column-before-reader rule. The two dropped columns had no reader ever, so
-- the drop-one-release-after-the-last-reader rule (docs/MIGRATION-DISCIPLINE.md §the-deploy-window) is
-- met trivially. RLS on, no client policies — deny-all on purpose.

-- ═════════════════════════════════════════════════════════════════════════════════════════════════════
-- 1. The page loses its two never-used class columns, and gains the key a child can point at
-- ═════════════════════════════════════════════════════════════════════════════════════════════════════
alter table public.document_pages drop constraint if exists document_pages_class_has_setter;
alter table public.document_pages drop column if exists page_class;
alter table public.document_pages drop column if exists page_class_set_by;

do $$
begin
  if not exists (select 1 from pg_constraint
                  where conrelid = 'public.document_pages'::regclass and conname = 'uq_document_pages_id_org') then
    alter table public.document_pages add constraint uq_document_pages_id_org unique (id, org_id);
  end if;
end;
$$;

comment on table public.document_pages is
  'module=document-reading; layer=core (0448, D-DR13: one canonical page of a source; append-only. '
  'Its class lives in document_page_classes, 0449).';

-- ═════════════════════════════════════════════════════════════════════════════════════════════════════
-- 2. The ledger
-- ═════════════════════════════════════════════════════════════════════════════════════════════════════
create table if not exists public.document_page_classes (
  id              uuid primary key default gen_random_uuid(),
  seq             bigint generated always as identity,
  org_id          uuid not null references public.organizations(id) on delete cascade,
  page_id         uuid not null references public.document_pages(id),
  page_class      text not null
    constraint document_page_classes_page_class_check
    check (page_class in ('bol', 'delivery_copy', 'placard', 'securement', 'other')),
  set_by          text not null
    constraint document_page_classes_set_by_check
    check (set_by in ('classifier', 'reviewer', 'labeller')),
  actor           uuid references auth.users(id),
  model           text constraint document_page_classes_model_nonempty check (btrim(model) <> ''),
  prompt_version  text constraint document_page_classes_prompt_version_nonempty check (btrim(prompt_version) <> ''),
  created_at      timestamptz not null default now(),
  -- A classifier verdict names its model and prompt and no person; a person's names the person and no
  -- model. One CHECK, so neither half can be relaxed without the other being read.
  constraint document_page_classes_provenance check (
    case when set_by = 'classifier'
      then model is not null and prompt_version is not null and actor is null
      else model is null and prompt_version is null and actor is not null
    end),
  constraint document_page_classes_page_same_org
    foreign key (page_id, org_id) references public.document_pages (id, org_id)
);

-- "Latest per page": the fold below is `distinct on (page_id) … order by page_id, seq desc` within one org,
-- and a single page's history is the same prefix.
create index if not exists idx_document_page_classes_latest
  on public.document_page_classes (org_id, page_id, seq desc);

comment on table public.document_page_classes is
  'module=document-reading; layer=core (0449, D-DR11/Q-DR12: every verdict on a page''s class — the '
  'classifier''s and each person''s override; append-only, newest per page wins, RETENTION_FORBIDDEN).';

drop trigger if exists trg_document_page_classes_append_only on public.document_page_classes;
create trigger trg_document_page_classes_append_only
  before update or delete on public.document_page_classes
  for each row execute function public.document_reader_append_only();

alter table public.document_page_classes enable row level security;

-- ═════════════════════════════════════════════════════════════════════════════════════════════════════
-- 3. The fold — a page's current class, for one org
-- ═════════════════════════════════════════════════════════════════════════════════════════════════════
-- `p_pages` narrows to some pages (one source's, for the reader); null means every page of the org. A
-- page with no verdict yet returns no row — "not classified" is the absence, as it was the null column.
create or replace function public.document_page_current_class(p_org uuid, p_pages uuid[] default null)
returns setof public.document_page_classes
language sql
stable
set search_path = ''
as $$
  select distinct on (c.page_id) c.*
    from public.document_page_classes c
   where c.org_id = p_org
     and (p_pages is null or c.page_id = any (p_pages))
   order by c.page_id, c.seq desc;
$$;

comment on function public.document_page_current_class(uuid, uuid[]) is
  '0449: the newest document_page_classes row per page of one org (optionally of the given pages). '
  'Service-role only; the org is required because the service role bypasses RLS.';

revoke all on function public.document_page_current_class(uuid, uuid[]) from public, anon, authenticated;
