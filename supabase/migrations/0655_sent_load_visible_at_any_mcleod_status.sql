-- 0655: a McLeod load the office has SENT reaches its driver whatever McLeod's status, and reaches the
-- co-driver too (DRIVER-APP-ENTERPRISE-PLAN.md S1.1; DF-1, DF-7 of
-- drivers-app/redesign-2026/DRIVER-APP-FEATURE-LIST-FOR-RULING.md; D-LMR5; API Kit ruling O-3).
--
-- ── WHAT 0371 LEFT OUT ─────────────────────────────────────────────────────────────────────────────
-- 0371 made the office's Dispatch → Send the one act that releases a McLeod load (D-LMR5, re-confirmed
-- by the owner 2026-11-27). It kept 0087's driver STATUS list, though: offered, accepted, in_transit,
-- delivered, canceled. McLeod loads are never `offered` or `accepted` — the projection gives
-- pending_approval / approved until the first stop departs (mcleodLoadProjection.ts) — so a load the
-- office sent the evening before stayed invisible on the driver's phone until the truck was already
-- rolling. DF-1, in the owner's first build (2026-11-23): "see my load as soon as dispatch assigns it".
-- It also kept `loads.driver_id = auth_driver_id()`, which (a) hid the load from a team's second seat,
-- although O-3 (2026-11-20) rules that both seats see it, and (b) hid a load the office sent to somebody
-- other than McLeod's driver — the dispatch record is the office's decision (D-LMR6), so it decides.
--
-- ── THE RULE, FOR A McLEOD (`tms`) LOAD ───────────────────────────────────────────────────────────
-- Visible to a driver when the load's CURRENT dispatch (newest sent_at, then id — 0371's order) names
-- them, or names the load's McLeod driver while they are the load's McLeod co-driver. Any McLeod status
-- except `draft` (McLeod `A`, uncovered: there is nobody to send it to). A load re-sent to someone else
-- leaves both former seats at once. Manual loads keep 0087's rule unchanged.
--
-- Measured 2026-11-27 on production: 99 in-transit and 39 pending McLeod loads, 0 load_dispatches rows
-- ever — nobody has pressed Send yet, so this changes what no driver sees today; it changes what the
-- first Send reveals. `driverLoads.ts` restates this predicate for the service role and must not drift.
--
-- ── WHY A NEW HELPER ──────────────────────────────────────────────────────────────────────────────
-- `auth_dispatched_load_ids()` (0371) is granted by name elsewhere (0643's grant list) and means exactly
-- "the current dispatch names me"; widening it would change that meaning under its other readers. The
-- new helper follows 0371's rules for a policy helper: no parameter, caller's own claims only,
-- SECURITY DEFINER because the dispatch history is deny-all to clients, `set search_path = ''`.

create or replace function public.auth_visible_tms_load_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select cur.load_id
    from (
      select distinct on (d.load_id) d.load_id, d.driver_id
        from public.load_dispatches d
       where d.org_id = public.auth_org_id()
         and d.load_id in (
           select m.load_id from public.load_dispatches m
            where m.org_id = public.auth_org_id()
              and m.driver_id = public.auth_driver_id()
           union
           select l.id from public.loads l
            where l.org_id = public.auth_org_id()
              and l.co_driver_id = public.auth_driver_id()
         )
       order by d.load_id, d.sent_at desc, d.id desc
    ) cur
    join public.loads l on l.id = cur.load_id
   where cur.driver_id = public.auth_driver_id()
      or (cur.driver_id = l.driver_id and l.co_driver_id = public.auth_driver_id());
$$;

comment on function public.auth_visible_tms_load_ids() is
  'S1.1 (DF-1, O-3, D-LMR5): McLeod loads whose CURRENT dispatch names the calling driver, or names the '
  'load''s McLeod driver while the caller is its McLeod co-driver. Caller-scoped policy helper, no '
  'parameter. driverLoads.ts restates it for the service role.';

-- Same ACL as 0371's helper after 0643: a policy evaluates it as the REQUESTING role, so anon,
-- authenticated and service_role must be able to execute it (revoking would turn every read of loads
-- into an error, not a filter), and PUBLIC holds nothing (0643 §6: `mail_gateway` holds what PUBLIC holds).
revoke all on function public.auth_visible_tms_load_ids() from public;
grant execute on function public.auth_visible_tms_load_ids() to anon, authenticated, service_role;

-- ── the three driver scopes: 0371's bodies, with the tms branch replaced ───────────────────────────
drop policy if exists loads_driver_scope on loads;
create policy loads_driver_scope on loads
  as restrictive for select
  using (
    auth_role() <> 'driver'
    or (
      source <> 'tms'
      and driver_id = auth_driver_id()
      and status in ('offered', 'accepted', 'in_transit', 'delivered', 'canceled')
    )
    or (
      source = 'tms'
      and status in ('pending_approval', 'approved', 'in_transit', 'delivered', 'canceled')
      and id in (select public.auth_visible_tms_load_ids())
    )
  );

drop policy if exists load_stops_driver_scope on load_stops;
create policy load_stops_driver_scope on load_stops
  as restrictive for select
  using (
    auth_role() <> 'driver'
    or exists (
      select 1 from loads l
       where l.id = load_stops.load_id
         and (
           (l.source <> 'tms'
             and l.driver_id = auth_driver_id()
             and l.status in ('offered', 'accepted', 'in_transit', 'delivered', 'canceled'))
           or (l.source = 'tms'
             and l.status in ('pending_approval', 'approved', 'in_transit', 'delivered', 'canceled')
             and l.id in (select public.auth_visible_tms_load_ids()))
         )
    )
  );

drop policy if exists load_events_driver_scope on load_events;
create policy load_events_driver_scope on load_events
  as restrictive for select
  using (
    auth_role() <> 'driver'
    or exists (
      select 1 from loads l
       where l.id = load_events.load_id
         and (
           (l.source <> 'tms'
             and l.driver_id = auth_driver_id()
             and l.status in ('offered', 'accepted', 'in_transit', 'delivered', 'canceled'))
           or (l.source = 'tms'
             and l.status in ('pending_approval', 'approved', 'in_transit', 'delivered', 'canceled')
             and l.id in (select public.auth_visible_tms_load_ids()))
         )
    )
  );
