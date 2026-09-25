-- 0371: a McLeod load reaches its driver when it has been DISPATCHED to them, not when it was released
-- (LOADS-MIRROR-PLAN.md LR-D2; D-LMR5, D-LMR6).
--
-- ── THE GAP ──────────────────────────────────────────────────────────────────────────────────────
-- 0368 hid a `tms` load from its driver until `released_at` was set, because the legacy Release was
-- the only "sent" there was. The owner's ruling replaces it: a McLeod load reaches a driver when
-- Silvicom's dispatcher presses Dispatch, which writes a `load_dispatches` row (0370) and never touches
-- the load. So the three driver scopes now ask the dispatch record, and `released_at` stops counting
-- for a `tms` load. Measured for 0368: 0 of 303 production loads were ever released, so nothing any
-- driver can see today disappears.
--
-- ── THE RULE: THE LOAD'S CURRENT DISPATCH NAMES THIS DRIVER ──────────────────────────────────────
-- "Current" is the newest row (sent_at, then id). A load re-sent to somebody else stops being visible
-- to the first driver at that moment — the office changed its mind, and the app must not keep showing
-- a load the office has taken back. `driverLoads.ts` restates exactly this order for the service role.
-- `loads.driver_id = auth_driver_id()` still applies too, so a load dispatched to someone OTHER than
-- McLeod's driver reaches nobody in the app yet: the driver app, and whose stop actions count
-- (Q-LMR2), are ruled when the app channel is built. The dispatch record is correct either way.
--
-- ── WHY A CALLER-SCOPED HELPER, AND NOT A POLICY ON load_dispatches ──────────────────────────────
-- 0370's header expected a driver-own-row select policy. It would not have worked: the scope needs the
-- load's LATEST row, and under a driver's RLS the rows naming other drivers are invisible, so "the
-- newest row I can see" would still name me after the load was re-sent to somebody else. So the
-- history is read by a SECURITY DEFINER helper, and `load_dispatches` stays deny-all to every client.
--
-- It takes NO parameter, on purpose. `rls.test.mjs` holds that a security-definer function taking an
-- argument is service-role only (0162: an argument is a door to somebody else's rows), while the
-- policy helpers — `auth_org_id`, `auth_driver_id` — read nothing but the caller's own claims and keep
-- EXECUTE for everybody, because a policy that calls a function its caller cannot execute ERRORS
-- rather than filtering. `auth_dispatched_load_ids()` is one of those: the loads whose current
-- dispatch names the calling driver, in the calling org, and nothing else. For anybody who is not a
-- driver it is empty. A first draft took the load as a parameter; the matrix refused it on both
-- counts (callable by `authenticated`, and an `anon` read of `loads` erroring on the revoke).
-- Used as `id in (select …)`, it is uncorrelated, so Postgres runs it once per query, not per row.
-- `set search_path = ''` with qualified names, as `auth_driver_id` is written.

create or replace function public.auth_dispatched_load_ids()
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
            where m.org_id = public.auth_org_id() and m.driver_id = public.auth_driver_id()
         )
       order by d.load_id, d.sent_at desc, d.id desc
    ) cur
   where cur.driver_id = public.auth_driver_id();
$$;

comment on function public.auth_dispatched_load_ids() is
  'LR-D2 (D-LMR5): the loads whose CURRENT dispatch (newest sent_at, then id) names the calling driver, in the calling org. Caller-scoped policy helper, no parameter. driverLoads.ts restates it for the service role.';

-- ── the driver scopes: 0368's bodies, with the dispatch in place of released_at ──────────────────
-- ⚠ As 0368 said: on `load_stops` and `load_events` the line is defence in depth — their `exists`
-- reads `loads` under the driver's own RLS, so `loads_driver_scope` already hides an unsent load.
drop policy if exists loads_driver_scope on loads;
create policy loads_driver_scope on loads
  as restrictive for select
  using (
    auth_role() <> 'driver'
    or (
      driver_id = auth_driver_id()
      and status in ('offered', 'accepted', 'in_transit', 'delivered', 'canceled')
      and (source <> 'tms' or id in (select public.auth_dispatched_load_ids()))
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
         and l.driver_id = auth_driver_id()
         and l.status in ('offered', 'accepted', 'in_transit', 'delivered', 'canceled')
         and (l.source <> 'tms' or l.id in (select public.auth_dispatched_load_ids()))
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
         and l.driver_id = auth_driver_id()
         and l.status in ('offered', 'accepted', 'in_transit', 'delivered', 'canceled')
         and (l.source <> 'tms' or l.id in (select public.auth_dispatched_load_ids()))
    )
  );
