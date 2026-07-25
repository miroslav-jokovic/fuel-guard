-- FuelGuard — 0084 driver-scoped RLS (Driver App, Phase 1)
-- The driver app ships the anon key + a driver JWT, so a driver can call PostgREST directly — RLS,
-- not the API, is the authorization boundary (audit §21 D10). Existing *_select policies are
-- PERMISSIVE (OR-combined), so we ADD RESTRICTIVE policies (AND-combined) that constrain ONLY the
-- 'driver' role and leave manager/admin access untouched. See DRIVER-APP-PLAN.md §12.4 (D9/D10, SB1).

-- Resolve the caller's driver row from the verified JWT `sub` claim. SECURITY DEFINER so the internal
-- read of drivers bypasses RLS (otherwise the drivers restrictive policy below would recurse).
create or replace function auth_driver_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select d.id
  from public.drivers d
  where d.org_id = public.auth_org_id()
    and d.user_id = nullif(current_setting('request.jwt.claims', true)::jsonb ->> 'sub', '')::uuid
  limit 1;
$$;


-- ── drivers: a driver sees only their own row ────────────────────────────────
create policy drivers_driver_scope on drivers as restrictive
  for select using (auth_role() <> 'driver' or id = auth_driver_id());

-- ── vehicles: a driver sees only vehicle(s) assigned to them ──────────────────
create policy vehicles_driver_scope on vehicles as restrictive
  for select using (auth_role() <> 'driver' or assigned_driver_id = auth_driver_id());

-- ── fuel_transactions: a driver reads only their own fills ────────────────────
create policy ftxn_driver_select on fuel_transactions as restrictive
  for select using (auth_role() <> 'driver' or driver_id = auth_driver_id());

-- ── fuel_transactions: a driver may insert ONLY their own fill, on an assigned
--    vehicle, with source 'manual' (closes attribution forgery — audit §21 SB1) ─
create policy ftxn_driver_insert on fuel_transactions as restrictive
  for insert
  with check (
    auth_role() <> 'driver'
    or (
      driver_id = auth_driver_id()
      and source = 'manual'
      and exists (
        select 1 from public.vehicles v
        where v.id = fuel_transactions.vehicle_id
          and v.assigned_driver_id = auth_driver_id()
      )
    )
  );

-- ── driver_performance_weeks: a driver sees only their own settled week ────────
create policy dpw_driver_scope on driver_performance_weeks as restrictive
  for select using (auth_role() <> 'driver' or driver_id = auth_driver_id());

-- ── surfaces a driver has no business reading: deny the driver role outright ──
create policy anomalies_driver_deny on anomalies as restrictive
  for select using (auth_role() <> 'driver');
create policy memberships_driver_deny on memberships as restrictive
  for select using (auth_role() <> 'driver');
create policy thresholds_driver_deny on anomaly_thresholds as restrictive
  for select using (auth_role() <> 'driver');
