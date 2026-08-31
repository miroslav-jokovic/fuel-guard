-- 0278 — saved views: a name and a query string, per person.
--
-- D-ROS14/15/16, docs/plans/roster/DRIVER-ROSTER-PLAN.md step R3c-2; owner ruling 2026-08-30
-- answering that plan's §6 Q3. The argument lives in packages/shared/src/savedViewContract.ts; this
-- file is only the part the database has to be told.
--
-- ── WHY A ROW AT ALL, WHEN THE COLUMN CHOICE IS localStorage ────────────────────────────────────
-- D-ROS15: a preference is device-local, an artefact the user AUTHORED is a row. Turning a column off
-- costs one click to redo. A named view is something a person made and expects to find on a new
-- laptop, and losing it loses work. That is the whole distinction, and it is why `fg.cols.*` stays in
-- the browser while this table exists.
--
-- ── PER USER, PRIVATE, AND DELIBERATELY NOT SHARED ──────────────────────────────────────────────
-- Measured before deciding: production carried 2 organisations and 6 memberships, 5 of them `admin`
-- in one org, plus one driver. There is no `safety_manager`, `recruiter` or `dispatcher` account in
-- existence. An org-shared view needs a policy for who may create, edit and delete one — a policy
-- written for a population that does not exist. Sharing a one-off view already works, because a view
-- IS a URL and a URL can be pasted into a message.
--
-- Adding sharing later is `alter table ... add column shared boolean not null default false`, one
-- extra clause in the select policy, and moving the primary key to a surrogate id. Recorded here so
-- the next person does not have to re-derive that it is cheap.
--
-- ── WHY THE PRIMARY KEY IS (user_id, table_id, name) ────────────────────────────────────────────
-- Saving over a name you already used REPLACES it, which is what "save" means to the person doing
-- it. Making that the key means the database enforces it rather than the endpoint remembering to,
-- and it removes the rename endpoint entirely: renaming is a save under the new name plus a delete,
-- which cannot leave a half-done state the way a two-call rename can.
--
-- ── NOT AN EVIDENCE TABLE ───────────────────────────────────────────────────────────────────────
-- `saved_views` is user convenience, not a §391.51 record. It is deliberately NOT added to
-- RETENTION_FORBIDDEN: rows here are the reader's to delete, and nothing legal reads them. The
-- cascade from auth.users is therefore correct — when an account goes, its bookmarks go with it.
--
-- Rollback: drop table public.saved_views;

create table if not exists saved_views (
  user_id     uuid        not null references auth.users(id) on delete cascade,
  org_id      uuid        not null references organizations(id) on delete cascade,
  -- A closed vocabulary in packages/shared (`SAVED_VIEW_TABLES`); the check keeps a crafted request
  -- from filling this table with rows no surface will ever list or clean up.
  table_id    text        not null check (table_id in ('roster.drivers')),
  name        text        not null check (length(btrim(name)) between 1 and 60),
  -- The query string without its leading `?`. The server cannot validate its MEANING — the
  -- vocabulary belongs to the page and changes with it — so every reader normalises what it reads.
  -- A saved view is exactly as trustworthy as a link somebody pastes, and is treated the same way.
  query       text        not null check (length(query) <= 2000),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  primary key (user_id, table_id, name)
);

-- The list a person opens is "my views for this table", newest first.
create index if not exists saved_views_user_table_idx
  on saved_views (user_id, table_id, updated_at desc);

alter table saved_views enable row level security;

-- A saved view is addressed to ONE person. An admin has no more business reading a colleague's
-- bookmarks than their inbox — the same reasoning `notification_events` records in 0089.
drop policy if exists saved_views_own on saved_views;
create policy saved_views_own on saved_views for all
  using (org_id = auth_org_id() and user_id = auth_user_id())
  with check (org_id = auth_org_id() and user_id = auth_user_id());

-- A row cannot be walked into another tenant by an update (0161's invariant, applied here too).
drop trigger if exists trg_saved_views_org_immutable on saved_views;
create trigger trg_saved_views_org_immutable
  before update on saved_views
  for each row execute function forbid_org_change();

comment on table saved_views is
  'A named query string per reader per table (D-ROS14). Not evidence: rows are the reader''s to delete.';
