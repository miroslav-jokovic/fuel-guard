-- FuelGuard — 0443 Silvicom's fuel queue owner is Miroslav Jokovic (Q-F1, ruled 2026-10-06; F02-F04
-- PLAN.md chunk 8b). The act itself; 0442 (chunk 8a) is the setting, the trigger and the function.
--
-- WHAT IT DOES. Calls `set_fuel_queue_owner` once, for Silvicom, with the owner as both the actor and the
-- queue's owner. That one call, in one transaction:
--   • sets `organizations.fuel_queue_owner`, so every new fill case, money finding and card fraud incident
--     is assigned to him from then on (0442's trigger);
--   • gives him every OPEN item nobody has taken. Measured on production, read-only, 2026-10-08: 157 open
--     money findings (14 disputable, 143 buying habits, which chunk 9 moves out of the queue), 0 open fill
--     cases, 0 card fraud incidents, none assigned;
--   • writes one `audit_logs` row, `fuel.queue_owner_set`, naming him and the counts.
--
-- WHY A MIGRATION. The house pattern for a one-off audited data act (0359, 0400, 0441): the owner approves
-- the release that carries it, the release train runs it, and it writes its own audit row.
--
-- ORDER. Unlike 0441, no code has to be served first: the rule is in the database (0442), and a release
-- applies 0442 before this file. They can ship in the same release.
--
-- WHO, AND WHY HIM. User 2607d9c1-9e12-47f4-ad53-aa5a5bde4713 (miki@silvicominc.com), an ADMIN of Silvicom
-- (looked up read-only 2026-10-08), named by Q-F1. 0442 does not check the owner's role, because section
-- access lives in the TypeScript matrix; an admin can close every fuel item in every section, so the
-- `rolesAssignableIn` check a future API must make is met here by construction.
--
-- ANY OTHER DATABASE. Staging and the PGlite matrices may not hold this org or this user, or the user may
-- not be a member there; and an org whose owner is already set is left alone. Each case skips with a
-- notice and changes nothing, so a database shaped differently can never block the train.
--
-- cross-module-waiver: the only tables touched are through `set_fuel_queue_owner` (0442, which carries its
-- own waiver); this file reads `organizations`, `memberships` and `auth.users` only to decide whether to
-- call it.
--
-- Proven in supabase/tests/fuel-queue-owner-run.test.mjs.
--
-- Rollback: `select * from set_fuel_queue_owner(<org>, <actor>, null)` clears the owner with its own audit
-- row; items already assigned stay with him until a person reassigns them.

do $$
declare
  v_org    constant uuid := '86d6b3ea-4361-4f71-877f-e8373615769b';
  v_owner  constant uuid := '2607d9c1-9e12-47f4-ad53-aa5a5bde4713';
  v_set    uuid;
  r        record;
begin
  if not exists (select 1 from public.organizations o where o.id = v_org) then
    raise notice '0443: organization % is not in this database — nothing done', v_org;
    return;
  end if;
  if not exists (select 1 from public.memberships m where m.org_id = v_org and m.user_id = v_owner) then
    raise notice '0443: user % is not a member of organization % here — nothing done', v_owner, v_org;
    return;
  end if;
  select o.fuel_queue_owner into v_set from public.organizations o where o.id = v_org;
  if v_set is not null then
    raise notice '0443: organization % already has fuel queue owner % — nothing done', v_org, v_set;
    return;
  end if;

  select * into r from public.set_fuel_queue_owner(v_org, v_owner, v_owner);
  raise notice '0443: fuel queue owner set; assigned % cases, % findings, % incidents',
    r.cases, r.findings, r.incidents;
end;
$$;
