-- 0329 — a driver's membership belongs to the roster, and the database now says so.
--
-- DC10 (docs/plans/drivers-app/DRIVER-CREDENTIALS-PLAN.md), owner ruling 2026-09-08. Two things:
-- a BACKFILL that heals every driver login whose membership has gone missing, and a TRIGGER that
-- stops the next one going missing at all.
--
-- ── THE INCIDENT, MEASURED ────────────────────────────────────────────────────────────────────
-- `custom_access_token_hook` (0006, extended by 0292/0299) reads ONE table to decide whether a
-- signed-in person has an org:
--
--     select m.org_id, m.role::text from public.memberships m where m.user_id = …
--
-- so for a driver the membership row IS the credential, not a permission attached to one. DC2's
-- synthetic auth user, DC7's `drivers.app_username`, the bcrypt password — none of them put `org_id`
-- in the token. Only the membership does.
--
-- On 2026-08-31 01:27:11+00 an admin removed `aaron@drivers.fuelguard.app` from the Users page
-- (`audit_logs`: action `member.removed`, entity_id 703c92e2-10b7-4419-9f0a-eec4fecccb9a). The Users
-- page listed him because `org_member_directory()` returns every membership, and it offered Remove
-- because `DELETE /api/members/:userId` had no idea some memberships are credentials. The delete
-- succeeded, and then:
--
--   · the auth user survived — he could still sign in, and did, as late as 2026-09-08 02:00;
--   · `drivers.user_id` and `app_access_enabled` survived — the Drivers page kept reporting
--     "app access: active", so no surface anywhere showed a problem;
--   · the app showed "Account almost ready … your fleet hasn't finished setting up your access",
--     which is what `SessionProvider` says when `org_id` is absent, and which was a lie: the fleet
--     had finished, eight weeks earlier;
--   · `resetDriverPassword` on 2026-09-07 21:45 could not repair it — it calls
--     `updateUserById({ password })` and touches no membership — and `createDriverLogin` refuses
--     outright while `drivers.user_id` is set ("already has a login — reset the password instead").
--
-- Eight days locked out, with no error message anywhere and no path out of it through the UI. The
-- Users page also carried a select-all bulk Remove, so the same click was available against every
-- driver in the fleet simultaneously.
--
-- ── WHY A TRIGGER AND NOT ONLY AN API GUARD ───────────────────────────────────────────────────
-- The API guard ships in this same PR and is the half that produces a good error message. It is not
-- the half that makes the invariant TRUE, and the reason is not a hypothetical about future writers:
--
--     policy memberships_write  FOR ALL  TO public
--       using ((org_id = auth_org_id()) and (auth_role() = 'admin'))
--
-- — verified against production `pg_policies` on 2026-09-08. An org admin's OWN browser token can
-- DELETE a driver's membership straight through PostgREST, with no handler of ours anywhere in the
-- path. `routes/members.ts` cannot guard a request it never sees. Add to that a service role that
-- bypasses RLS entirely, an `auth.users` cascade that runs with no application code at all, and
-- restores and support actions, and the rule that a driver credential cannot be deleted out from
-- under the roster plainly belongs where no caller can route around it. The matrix asserts the
-- PostgREST path from an admin JWT for exactly this reason.
--
-- The condition is `drivers.user_id`, DERIVED, not the literal role: the roster link is what makes a
-- membership roster-owned, and it is the same fact `createDriverLogin` writes and `revokeDriverLogin`
-- clears. Reading `role = 'driver'` instead would let one UPDATE to the role unlock the DELETE.
--
-- SECURITY DEFINER, so the answer cannot depend on who is asking. `drivers` has RLS enabled, and an
-- invoker function reads it with the caller's visibility — which means the invariant would hold or
-- not hold according to which role happened to reach the table. Definer makes the check see the same
-- roster in every path, which is the property an invariant needs.
--
-- ⚠ What this is NOT, because the first draft of this header said it was and was wrong: it is not
-- what covers the `auth.users(id) ON DELETE CASCADE` path. Measured 2026-09-08 in PGlite — a row
-- trigger fired by a referential CASCADE runs as the OWNER of the referencing table (`current_user`
-- came back `postgres` when the delete was issued by another role entirely), so that path bypasses
-- RLS and is covered whichever way this function is declared. The matrix asserts the cascade
-- behaviour; it does not, and cannot, discriminate definer from invoker. Flipping this line to
-- `security invoker` leaves all 22 assertions green.
--
-- ── WHAT STILL WORKS, DELIBERATELY ────────────────────────────────────────────────────────────
-- `revokeDriverLogin` already unlinks the roster row FIRST, then deletes the membership, then the
-- auth user (driverCredentials.ts, and 0116's FK made that order survivable). Offboarding therefore
-- passes this trigger untouched — the ordering that was written for a different reason turns out to
-- be exactly the ordering the invariant needs, so the ONE legitimate way to remove a driver's login
-- keeps working and every other way stops. `createDriverLogin` inserts the membership BEFORE it
-- writes `drivers.user_id`, so provisioning passes too, and so does its rollback.
--
-- ⚠ Known consequence, accepted: deleting an ORGANIZATION would now be refused while any of its
-- drivers still hold a link, because `memberships.org_id` cascades from `organizations`. There is no
-- org-deletion path in the product (verified 2026-09-08 across apps/api and apps/admin-api — no
-- handler deletes `organizations`), and if one is ever built it must unlink the roster first for the
-- same reason `revokeDriverLogin` does. Recorded here rather than defended against, because a guard
-- for a caller that does not exist is a guess about a shape nobody has designed.
--
-- Rollback: drop trigger trg_memberships_roster_owned on memberships;
--           drop function public.forbid_roster_membership_change();
--           (the backfilled rows are correct either way and are NOT rolled back — they are the
--            credentials the drivers already hold.)
--
-- cross-module-waiver: the invariant IS the join. `memberships` is org-owned and `drivers` is
-- roster-owned, and the whole defect was that the two modules each believed something the other
-- could silently falsify — org deleting a row roster still counted on. A rule about a boundary has
-- to be able to see both sides of it; putting it inside one module is what produced the incident.

-- ── The backfill: every roster link gets the membership it is supposed to have ─────────────────
-- Idempotent by the existing UNIQUE (org_id, user_id). `do nothing` rather than an update on
-- purpose: if a linked user somehow holds a NON-driver membership, that is a person this migration
-- does not understand, and quietly demoting them to `driver` would be a second incident on top of
-- the first. Zero such rows exist today (measured on production 2026-09-08, and the matrix pins the
-- claim); the trigger below then freezes whatever is there for a human to look at.
--
-- Measured on production the day this was written: one roster link (`aaron`, org 86d6b3ea…), zero
-- `driver` memberships in the entire database. This statement is what puts him back.
insert into memberships (org_id, user_id, role)
select d.org_id, d.user_id, 'driver'::user_role
from drivers d
where d.user_id is not null
on conflict (org_id, user_id) do nothing;

-- ── The guard ─────────────────────────────────────────────────────────────────────────────────
create or replace function public.forbid_roster_membership_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_linked boolean;
begin
  -- The roster link for THIS person in THIS org. Org-scoped like every other tenant read: a driver
  -- row for the same user in another organisation says nothing about this membership.
  select exists (
    select 1 from public.drivers d
    where d.user_id = old.user_id
      and d.org_id = old.org_id
  ) into v_linked;

  if not v_linked then
    return case tg_op when 'DELETE' then old else new end;
  end if;

  if tg_op = 'DELETE' then
    raise exception
      'membership for user % in org % is a driver-app credential owned by the roster: unlink the driver first (Drivers page -> App access -> Revoke login), which is what revokeDriverLogin does',
      old.user_id, old.org_id
      using errcode = 'TG002';
  end if;

  -- An UPDATE that re-roles a linked driver breaks the app just as completely as a delete does: the
  -- hook mints `user_role` from this column, and the driver app routes any non-driver role to its
  -- "wrong app" screen. Roles are the Users page's business for everybody else; for a linked driver
  -- the answer is fixed by the roster.
  if new.role is distinct from old.role then
    raise exception
      'membership role for user % in org % is fixed at driver while the roster link exists: it is a credential, not a permission',
      old.user_id, old.org_id
      using errcode = 'TG002';
  end if;

  -- Re-pointing the row at another person or tenant is the same delete wearing a hat.
  if new.user_id is distinct from old.user_id or new.org_id is distinct from old.org_id then
    raise exception
      'membership for user % in org % is bound to a roster link and cannot be moved',
      old.user_id, old.org_id
      using errcode = 'TG002';
  end if;

  return new;
end;
$$;

comment on function public.forbid_roster_membership_change() is
  'DC10: a membership whose user is linked from drivers.user_id in the same org is a driver-app
   CREDENTIAL (custom_access_token_hook reads memberships to mint org_id), so it may not be deleted
   or re-roled while the link stands. Unlink the roster row first — the order revokeDriverLogin
   already uses. SECURITY DEFINER so the check reads the same roster whatever the caller can see;
   the auth.users ON DELETE CASCADE path is covered either way (its trigger runs as the referencing
   table''s owner, measured 2026-09-08). Incident 2026-08-31.';

drop trigger if exists trg_memberships_roster_owned on memberships;
create trigger trg_memberships_roster_owned
  before delete or update on memberships
  for each row execute function public.forbid_roster_membership_change();
