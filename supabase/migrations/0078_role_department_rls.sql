-- 0078: wire the department roles (dispatcher, safety_manager) into RLS, mirroring the section-capability
-- matrix in packages/shared/src/auth.ts. This is the REAL enforcement behind the UI nav + API requireRole.
--
-- READS are unchanged: every table here has a separate *_select policy granting `org_id = auth_org_id()` to
-- all org members, so both new roles can already read their sections. We only broaden the *_write policies,
-- and only for the tables each role's UI writes DIRECTLY via the Supabase client (price uploads, plan
-- computation, anomaly resolution, etc. go through the service-role API and bypass RLS entirely).
--
-- Each policy is set to exactly rolesThatManage(section):
--   Dispatch → admin, fleet_manager, dispatcher      (also closes a gap: these were admin-only, though the
--                                                      matrix + nav already treat fleet_manager as a dispatch
--                                                      manager)
--   Fleet    → admin, fleet_manager, safety_manager
--   Safety   → admin, fleet_manager, safety_manager  (idle_settings = the comfort band on the Idling page)

-- ── Dispatch: fuel_discount_rules + route_fuel_settings ───────────────────────
drop policy if exists fuel_discount_write on fuel_discount_rules;
create policy fuel_discount_write on fuel_discount_rules for all
  using (org_id = auth_org_id() and auth_role() in ('admin', 'fleet_manager', 'dispatcher'))
  with check (org_id = auth_org_id() and auth_role() in ('admin', 'fleet_manager', 'dispatcher'));

drop policy if exists route_fuel_settings_write on route_fuel_settings;
create policy route_fuel_settings_write on route_fuel_settings for all
  using (org_id = auth_org_id() and auth_role() in ('admin', 'fleet_manager', 'dispatcher'))
  with check (org_id = auth_org_id() and auth_role() in ('admin', 'fleet_manager', 'dispatcher'));

-- ── Fleet: vehicles + drivers + trailers ──────────────────────────────────────
drop policy if exists vehicles_write on vehicles;
create policy vehicles_write on vehicles for all
  using (org_id = auth_org_id() and auth_role() in ('admin', 'fleet_manager', 'safety_manager'))
  with check (org_id = auth_org_id() and auth_role() in ('admin', 'fleet_manager', 'safety_manager'));

drop policy if exists drivers_write on drivers;
create policy drivers_write on drivers for all
  using (org_id = auth_org_id() and auth_role() in ('admin', 'fleet_manager', 'safety_manager'))
  with check (org_id = auth_org_id() and auth_role() in ('admin', 'fleet_manager', 'safety_manager'));

drop policy if exists trailers_write on trailers;
create policy trailers_write on trailers for all
  using (org_id = auth_org_id() and auth_role() in ('admin', 'fleet_manager', 'safety_manager'))
  with check (org_id = auth_org_id() and auth_role() in ('admin', 'fleet_manager', 'safety_manager'));

-- ── Safety: idle_settings (comfort band adopted from the Idling page) ──────────
drop policy if exists idle_settings_write on idle_settings;
create policy idle_settings_write on idle_settings for all
  using (org_id = auth_org_id() and auth_role() in ('admin', 'fleet_manager', 'safety_manager'))
  with check (org_id = auth_org_id() and auth_role() in ('admin', 'fleet_manager', 'safety_manager'));
