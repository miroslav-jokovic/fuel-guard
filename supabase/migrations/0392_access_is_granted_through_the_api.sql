-- 0392 — access is granted in one place: the browser can no longer write memberships or invites,
-- and the database itself keeps every organisation at least one admin.
--
-- SP6 of docs/plans/permissions/SETTINGS-PERMISSIONS-PLAN.md (§4b.2 gaps 1 and 2; the enterprise
-- audit of 2026-09-30, ruled by the owner the same day).
--
-- ── WHY THE TWO POLICIES GO ───────────────────────────────────────────────────────────────────
-- 0004 wrote, and nothing since has dropped (re-read from production `pg_policies` 2026-09-30):
--
--     memberships_write  FOR ALL  using/with check ((org_id = auth_org_id()) and (auth_role() = 'admin'))
--     invites_admin_all  FOR ALL  using/with check ((org_id = auth_org_id()) and (auth_role() = 'admin'))
--
-- So an admin's OWN browser token could, through PostgREST and with no handler of ours in the path:
-- re-role any member (including to admin), delete members, and insert an invite for any email with
-- any role. Every one of those is also a Users-page action, and the Users page's versions are the
-- ones that write `member.role_changed` / `member.removed` / `invite.created` audit rows, refuse to
-- demote the last admin, and refuse an email outside `allowed_domains` (Q-SET4). The PostgREST path
-- did none of that. It was a second door onto the one table that decides who has access at all —
-- SP3's argument (0389) on the tables that grant access rather than the ones it governs.
--
-- Nothing uses it: a search of apps/web, apps/driver and apps/admin on 2026-09-30 found no
-- `from("memberships")` or `from("invites")` at all. Every writer is the API's service role, which
-- bypasses RLS, so dropping the policies costs no working path.
--
-- What stays: every SELECT policy on `memberships` (the member list, `memberships_auth_admin_read`
-- for the token hook, the driver-scope and driver-deny policies) and the restrictive
-- `memberships_driver_insert`, which now narrows nothing but is harmless and removing it would be a
-- change for its own sake. `invites` is left with NO policy, and RLS stays enabled, so every client
-- role is refused — the same deny-all `audit_logs` has held since 0391. The invite a person opens is
-- looked up by the API from its token (`/api/public/invites`), never read by the browser.
--
-- ── WHY THE LAST-ADMIN RULE MOVES INTO THE DATABASE ───────────────────────────────────────────
-- `PATCH /api/members/:userId` counts the admins and refuses a demotion that would leave none. That is
-- a count, then an update, with no lock: two admins demoting each other at the same moment both see
-- a count of 2 and both succeed, and the organisation has nobody who can open Users or Permissions —
-- a lockout only the platform team can repair by hand. With `memberships_write` it was also skipped
-- outright. The count stays in the handler, because it produces the sentence the admin reads; this is
-- the half that makes the rule TRUE.
--
-- A CONSTRAINT trigger, DEFERRABLE INITIALLY DEFERRED, so the question is asked at COMMIT and about
-- the organisation's final state, not about each row mid-flight:
--   · promoting B and demoting A in one transaction passes, in either order;
--   · deleting an organisation passes — `memberships.org_id` cascades from `organizations`, and at
--     commit the organisation no longer exists, so there is nobody left to lock out. (There is no
--     org-deletion path in the product today — 0329's header, re-checked 2026-09-30 — but a platform
--     support act must not be refused by this.)
--   · deleting the last admin's auth user (`memberships.user_id` cascades from `auth.users`) is
--     REFUSED, which is the point: that is exactly the lockout by another route.
--
-- An organisation with no admin at all can therefore never be reached from one that has one; it can
-- still be CREATED (an INSERT never fires this — the first membership is the admin's own, written by
-- provisioning). Production held two organisations on 2026-09-30, each with at least one admin, so
-- the rule starts true.
--
-- SECURITY DEFINER with an empty search_path, for 0329's reason: an invariant must read the same
-- `memberships` whoever's write fired it.
--
-- Rollback: create the two policies again from 0004;
--           drop trigger trg_memberships_keep_an_admin on memberships;
--           drop function public.memberships_keep_an_admin();

drop policy if exists memberships_write on memberships;
drop policy if exists invites_admin_all on invites;

create or replace function public.memberships_keep_an_admin()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Only a row that WAS an admin can take the last admin away. A driver or dispatcher row changing
  -- says nothing about who administers the organisation.
  if old.role <> 'admin' then
    return null;
  end if;

  -- The organisation itself is gone (its delete cascaded here): nobody is left to lock out.
  if not exists (select 1 from public.organizations o where o.id = old.org_id) then
    return null;
  end if;

  if not exists (
    select 1 from public.memberships m
    where m.org_id = old.org_id
      and m.role = 'admin'
  ) then
    raise exception
      'organization % would be left with no admin: promote someone else to admin first',
      old.org_id
      using errcode = 'AM010';
  end if;

  return null;
end;
$$;

comment on function public.memberships_keep_an_admin() is
  'SP6 (SETTINGS-PERMISSIONS-PLAN §4b): every organisation that exists keeps at least one admin
   membership. Deferred to commit, so an admin swap in one transaction passes and an organisation
   delete (which cascades here) passes; deleting or demoting the last admin, by any path including the
   auth.users cascade, raises AM010. The API''s count in PATCH /api/members is the half that words it.';

drop trigger if exists trg_memberships_keep_an_admin on memberships;
create constraint trigger trg_memberships_keep_an_admin
  after update or delete on memberships
  deferrable initially deferred
  for each row execute function public.memberships_keep_an_admin();
