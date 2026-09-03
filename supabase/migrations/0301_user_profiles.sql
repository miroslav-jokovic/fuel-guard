-- 0301 — user_profiles: a person's display name, and the one query that lists an org's members.
--
-- docs/plans/permissions/SURFACE-ENTITLEMENTS-PLAN.md step S9 (owner ruling 2026-09-03: "we should
-- have users' name displayed instead of [email] and we need to add this in our settings and users
-- feature and tables"). D-MEM1..D-MEM3 below.
--
-- ── WHAT WAS WRONG ─────────────────────────────────────────────────────────────────────────────
-- A member of an organisation has no name anywhere in the product. `auth.users` carries an email,
-- `memberships` carries a role, and every screen that has to say WHO — the Users table, the
-- permissions page's People picker, the sidebar's account menu, "requested by" on an export, "cleared
-- by" on a hazmat review — prints the email address, having fetched it one `auth.admin.getUserById`
-- at a time (seven call sites; `GET /api/members` alone does one round trip per member). Drivers are
-- the exception: `drivers.full_name` exists because the roster needs it, and the driver app's
-- membership is linked to that row through `drivers.user_id` (0102).
--
-- ── D-MEM1 — A name belongs to the PERSON, not to the membership ───────────────────────────────
-- Keyed by `user_id` alone, with no `org_id`. One person, one name; a person who belongs to two
-- organisations (the platform allows it) is not two people. It is the first user-keyed table since
-- `notification_reads` (0089) and, like it, is a documented exemption in the tenant-isolation harness
-- rather than an org-scoped row — scoping is by the FOREIGN KEY to auth.users and by the fact that
-- nothing but the service role can read it.
--
-- ── D-MEM2 — Written only by the API, read only through `org_member_directory()` ────────────────
-- RLS is enabled and there is deliberately no policy: a client cannot read a stranger's name by
-- guessing a uuid, and cannot rename anybody. The API writes a profile in exactly two acts, each with
-- an audit row — a person accepting an invitation says who they are, and an admin corrects a member's
-- name on the Users page — and READS every name through the function below, which is `security
-- definer` so it may join `auth.users` for the email, and is executable by the service role only. That
-- one function replaces the per-member auth round trip everywhere it was being made.
--
-- ── D-MEM3 — A driver's name is the roster's name, unless the person has said otherwise ─────────
-- `coalesce(user_profiles.full_name, drivers.full_name)`, in that order: the roster row is the
-- company's record of the driver and is right until the person themselves has typed a name, at which
-- point theirs wins. The join is on `drivers.user_id` AND `org_id`. 0098's unique index on
-- `drivers.user_id` already means one person has at most one roster row anywhere, so the org clause
-- is redundant today; it stays so that relaxing that index later cannot let a roster row in one
-- organisation name a membership in another.
--
-- ── `invites.full_name` — the admin usually knows who they are inviting ──────────────────────────
-- Nullable. Carried from the invitation to the acceptance so the person confirms a name rather than
-- typing one, and left null when the admin does not know. ⚠ This is a column on an EXISTING table, so
-- `lint:migration-ordering` requires its first reader to ship in a LATER merge than this file — the
-- API and web changes are the next PR, and this one adds no reader on purpose.
--
-- ── WHY NOTHING READS THIS ON THE MERGE THAT APPLIES IT ────────────────────────────────────────
-- D-SURF9: the directory is read by `GET /api/members` and the profile by `/api/me`, and a reader
-- deployed ~9 minutes ahead of its schema would break the Users page and (fail-open aside) the
-- bootstrap. The table, the column and the function merge here; the readers merge next, with `/api/me`
-- reading the name fail-open to null so a missing table can never take sign-in down.
--
-- Rollback: drop function org_member_directory(uuid); alter table invites drop column full_name;
-- drop table user_profiles.

create table if not exists user_profiles (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  -- 1–120 characters after trimming: an empty string is not a name, and a name longer than a line
  -- is a paste error. No format rule beyond that — a name is whatever the person says it is.
  full_name  text not null check (length(btrim(full_name)) between 1 and 120),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);

alter table user_profiles enable row level security;
-- No policies, on purpose (D-MEM2). The service role bypasses RLS; nobody else reads or writes here.

alter table invites
  add column if not exists full_name text
    check (full_name is null or length(btrim(full_name)) between 1 and 120);

-- ── The directory ───────────────────────────────────────────────────────────────────────────────
-- `security definer` because `auth.users` is not readable by anybody else, and `set search_path = ''`
-- for the reason 0088 gave (a definer must not resolve names through the caller's path). That setting
-- costs inlining, which does not matter here: this is one call per Users-page load, not a predicate
-- evaluated per row. Ordered by when the person joined, which is what the Users page has always shown.
create or replace function org_member_directory(p_org_id uuid)
returns table (user_id uuid, email text, full_name text, role user_role, joined_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select m.user_id,
         u.email::text,
         coalesce(p.full_name, d.full_name) as full_name,
         m.role,
         m.created_at as joined_at
    from public.memberships m
    join auth.users u on u.id = m.user_id
    left join public.user_profiles p on p.user_id = m.user_id
    left join public.drivers d on d.user_id = m.user_id and d.org_id = m.org_id
   where m.org_id = p_org_id
   order by m.created_at;
$$;

revoke all on function org_member_directory(uuid) from public, anon, authenticated;
grant execute on function org_member_directory(uuid) to service_role;

comment on table user_profiles is
  'A person''s display name (D-MEM1). Keyed by user, not by membership; written only by the API on invite acceptance and by an admin on the Users page; read only through org_member_directory().';
comment on function org_member_directory(uuid) is
  'Every member of one organisation with email, display name (profile, else the roster''s driver name), role and join date — the one read that replaces per-member auth.admin.getUserById calls. Service role only.';
