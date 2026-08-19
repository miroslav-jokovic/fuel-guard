-- 0213 — a recruiter may edit a driver, but may not move them through their employment lifecycle.
--
-- 0212 gave `recruiter` UPDATE on `drivers`, by name, because an applicant IS a drivers row. That
-- grant is broader than it should be in one respect: `status` and `termination_date`.
--
--   • `resolveDriverUpdate` stamps `termination_date` on the way to `terminated`, which starts the
--     §391.51(c) retention clock.
--   • `auth_driver_id()` (0083) resolves only `active` drivers, so a status edit silently ends
--     somebody's driver-app access on their next request.
--
-- Neither is a hiring act. The API refuses it in routes/roster/drivers.ts via
-- canWriteDriverLifecycle(), and this trigger is the same rule on the PostgREST path — which matters
-- here rather than being belt-and-braces, because apps/web's older driver drawer writes `status`
-- through PostgREST directly (useUpdateDriver), not through the roster route.
--
-- WHY A TRIGGER AND NOT A POLICY. RLS cannot express "this column may not change": a policy's USING
-- clause sees the OLD row and WITH CHECK sees the NEW one, and nothing compares them. A WITH CHECK on
-- `status <> 'terminated'` would block terminating and still permit UN-terminating, and would also
-- freeze every edit to an already-terminated row. The rule is about the FIELD CHANGING, so it needs
-- a trigger. Same shape as 0071's append-only guard and 0086's lifecycle raises.
--
-- The allowed list is rolesThatManage('fleet') — admin, fleet_manager, safety_manager — mirroring
-- canWriteDriverLifecycle() in packages/shared/src/auth.ts, which derives it from the section matrix.
-- If the two ever disagree, shared wins and this is the one to fix.
--
-- `auth_role() is null` passes on purpose: that is the SERVICE ROLE (the API, which enforces this
-- itself and must still be able to terminate on an admin's behalf) and any path with no JWT claims,
-- which RLS has already refused for other reasons.

-- ── First, a latent bug this trigger surfaced ───────────────────────────────────────────────────
-- `auth_role()` (0002) casts request.jwt.claims to jsonb WITHOUT the empty-string guard its sibling
-- `auth_org_id()` has had since the same migration. When the setting is '' rather than absent —
-- which is what a rolled-back `set_local` leaves behind — the cast raises 22P02 instead of returning
-- null. Every RLS policy in the product calls this function, so the fragility was always there; it
-- had simply never been reached, because a policy is only evaluated for a role RLS applies to, and
-- the paths that leave an empty setting are owner/service paths that skip policies. A BEFORE UPDATE
-- trigger runs for EVERY writer, so it calls auth_role() where nothing did before, and the bug
-- became a broken `drivers` update in the RLS matrix.
--
-- Fixed here rather than worked around in the trigger: making one caller defensive would leave the
-- same trap for the next one, and `nullif` restores the behaviour the sibling function already
-- documents. Empty claims now read as "no role", which is what every policy already assumes.
create or replace function auth_role()
returns text
language sql
stable
as $$
  select nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'user_role';
$$;

create or replace function public.guard_driver_lifecycle()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if public.auth_role() is not null
     and public.auth_role() not in ('admin', 'fleet_manager', 'safety_manager')
     and (new.status is distinct from old.status
          or new.termination_date is distinct from old.termination_date)
  then
    raise exception 'driver_lifecycle_forbidden' using errcode = 'DL030';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_guard_driver_lifecycle on public.drivers;
create trigger trg_guard_driver_lifecycle
  before update on public.drivers
  for each row
  execute function public.guard_driver_lifecycle();
