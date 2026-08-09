-- FuelGuard — 0162 SECURITY DEFINER exposure closure (audit 2026-08-09, Stage 1)
--
-- start_duty_session, change_duty_equipment and end_duty_session are SECURITY DEFINER and were
-- granted to `authenticated` by 0086. They validate that the EQUIPMENT belongs to p_org and then
-- take p_org and p_driver on trust — there is no auth_driver_id()/auth_org_id()/auth_role() check in
-- any of the three. So with the public anon key and any signed-in user's JWT, PostgREST will start,
-- re-equip or end a duty session for ANY driver in ANY organization.
--
-- 0141 already diagnosed and fixed exactly this for the load RPCs, and said why:
--
--     "Service role only. These are reached exclusively through the API, which has already
--      authenticated the driver; granting them to `authenticated` (as 0087 did) would let any
--      signed-in user name any driver id in their own org and act as them."
--
-- The duty-session RPCs were left behind in that sweep, and they are worse than the load ones were:
-- with no org check at all their reach is cross-tenant, not intra-org. Only
-- apps/api/src/services/dutySessions.ts calls them, always with the service role, so revoking
-- `authenticated` removes the attack surface and changes no shipped behaviour.
--
-- The rest close the same door on the notification and entitlement helpers, which take an arbitrary
-- (p_org, p_user) and act on it. emit_notification is the sharp one: SECURITY DEFINER, no caller
-- check, writes straight into notification_events for any user in any tenant with an
-- attacker-controlled deep_link, and p_severity='critical' short-circuits quiet hours.
--
-- Twelve migrations already apply this convention (0072, 0095, 0115, 0140, 0141, 0148, 0149, 0151,
-- 0156-0159); these were simply missed. Postgres grants EXECUTE to PUBLIC by default on CREATE
-- FUNCTION, which is why each of those files revokes `from public` explicitly rather than only
-- naming roles.
--
-- Rollback: re-grant execute to authenticated on the functions listed below.

-- Enumerate the live catalog rather than hand-maintaining a list of function names. Existing
-- projects can legitimately lack a historical helper (for example, 0089's dedupe helper), while
-- later migrations can add another SECURITY DEFINER RPC without remembering this closure.
--
-- The only exceptions are caller-scoped policy helpers: they read the CALLER's own JWT claims, take
-- no tenant parameter, and are invoked from inside RLS policies — `authenticated` must keep EXECUTE
-- or every policy that calls them starts erroring instead of filtering.
do $$
declare
  sig  text;
begin
  -- Enumerate the live catalog rather than hand-maintaining a list of function names. Existing
  -- projects can legitimately lack a historical helper (for example, 0089's dedupe helper), while
  -- later migrations can add another SECURITY DEFINER RPC without remembering this closure.
  for sig in
    select p.oid::regprocedure::text
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.prosecdef
       and p.prorettype <> 'trigger'::regtype
       and p.proname not in (
         'auth_org_id', 'auth_role', 'auth_user_id', 'auth_driver_id', 'auth_in_thread', 'auth_module_enabled'
       )
  loop
    execute format('revoke all on function %s from public, anon, authenticated', sig);
    execute format('grant execute on function %s to service_role', sig);
  end loop;
end;
$$;
