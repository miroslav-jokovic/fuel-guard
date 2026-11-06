-- 0572 — scanned stacks of paper driver files, and the pieces they are cut into
-- (DRIVER-PAPER-INTAKE-PLAN PI2).
--
-- ── WHAT ARRIVES ────────────────────────────────────────────────────────────────────────────────
-- The office puts a printed cover sheet (PI1) on each driver's paper folder, feeds five to ten folders
-- through the Brother feeder scanner (Q-PI1), and uploads the one PDF it saves. The worker finds the
-- cover sheets, drops blank pages (duplex backs), and cuts the file into PIECES: one driver's pages, at
-- most ten at a time, because ten pages is the document reader's limit (`INTAKE_LIMITS.maxPages`). PI3
-- reads each piece; its papers become `file_intake_items` rows (0505) a person files or discards.
--
-- ── 1. THE BUCKET ───────────────────────────────────────────────────────────────────────────────
-- Its own, because a stack is neither a reader source (`document-intake` caps a file at 25 MB and ten
-- pages, and a stack is up to 50 MB and hundreds of pages) nor evidence (`compliance-docs`: a filed
-- paper is one paper, cut out of the stack at filing, PI5). 50 MB is the project's per-file upload
-- limit (supabase/config.toml), so a larger cap here could never be used. No client policies: the API
-- signs the upload and reads with the service role, the `document-intake` model.
insert into storage.buckets (id, name, public, file_size_limit)
values ('paper-intake', 'paper-intake', false, 50 * 1024 * 1024)
on conflict (id) do nothing;

-- ── 2. A STACK: one uploaded PDF ──────────────────────────────────────────────────────────────────
-- uploading → queued (bytes are in the bucket, the split job is dispatched) → splitting → split | failed.
-- The same bytes uploaded twice by an org are one stack (`unique (org_id, sha256)`): the second upload
-- is told it is a duplicate and shown the first, never split twice into two sets of review rows.
create table if not exists public.paper_intake_stacks (
  id uuid primary key,
  org_id uuid not null references public.organizations(id) on delete cascade,
  -- The browser's id for one drop of one or more files — the review page lists a batch together.
  batch_id uuid not null,
  file_name text not null check (length(btrim(file_name)) between 1 and 255),
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  byte_size integer not null check (byte_size between 1 and 50 * 1024 * 1024),
  status text not null default 'uploading'
    check (status in ('uploading', 'queued', 'splitting', 'split', 'failed')),
  failure_code text check (failure_code is null or length(failure_code) between 1 and 60),
  page_count integer check (page_count is null or page_count >= 1),
  cover_sheet_count integer check (cover_sheet_count is null or cover_sheet_count >= 0),
  blank_page_count integer check (blank_page_count is null or blank_page_count >= 0),
  -- auth.users, no FK (0485's reason: a removed member's stacks are still the org's record).
  uploaded_by uuid,
  created_at timestamptz not null default now(),
  split_at timestamptz,
  constraint paper_intake_stacks_failed check ((status = 'failed') = (failure_code is not null)),
  constraint paper_intake_stacks_split check ((status = 'split') = (split_at is not null and page_count is not null))
);

create unique index if not exists paper_intake_stacks_sha_idx on public.paper_intake_stacks (org_id, sha256);
create index if not exists paper_intake_stacks_batch_idx on public.paper_intake_stacks (org_id, batch_id, created_at);
alter table public.paper_intake_stacks enable row level security;

-- ── 3. A PIECE: one driver's pages of a stack, at most ten ────────────────────────────────────────
-- `driver_id` carries NO foreign key, on purpose (D-PI1): a table referencing `drivers(id) on delete
-- cascade` must join `merge_driver`'s list in the same migration or a merge destroys it silently (it
-- has twice). A piece is a work item, and a piece whose driver was merged away is reported as such and
-- assigned by hand — loud, never a wrong owner. The service checks the id is the org's own.
--   basis 'cover_sheet' — the pages followed this driver's cover sheet.
--   basis 'none'        — pages before the first sheet, or a stack with none: no owner until review.
-- `stack_pages` are 1-based page numbers in the STACK, in order, blank pages already left out — so
-- PI5 cuts the filed paper out of the original scan, never out of a re-encoded piece.
create table if not exists public.paper_intake_parts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  stack_id uuid not null references public.paper_intake_stacks(id) on delete cascade,
  part_index integer not null check (part_index >= 0),
  driver_id uuid,
  basis text not null check (basis in ('cover_sheet', 'none')),
  stack_pages integer[] not null check (cardinality(stack_pages) between 1 and 10),
  object_path text not null check (length(object_path) between 1 and 400),
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  constraint paper_intake_parts_basis check ((basis = 'cover_sheet') = (driver_id is not null))
);

create unique index if not exists paper_intake_parts_stack_idx on public.paper_intake_parts (stack_id, part_index);
create index if not exists paper_intake_parts_org_driver_idx on public.paper_intake_parts (org_id, driver_id);
alter table public.paper_intake_parts enable row level security;

comment on table public.paper_intake_stacks is
  'DRIVER-PAPER-INTAKE-PLAN PI2 (0572): one scanned PDF of paper driver files, split at its cover sheets into paper_intake_parts. A work queue, not evidence. No client policies: the API reads and writes with the service role.';
comment on table public.paper_intake_parts is
  'DRIVER-PAPER-INTAKE-PLAN PI2 (0572): up to ten pages of one stack, one driver''s (by cover sheet) or nobody''s yet. driver_id has no FK on purpose (D-PI1, merge_driver). PI3 reads each part.';
