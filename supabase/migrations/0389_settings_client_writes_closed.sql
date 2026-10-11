-- 0389 — the Settings tables stop taking writes from the browser (SETTINGS-PERMISSIONS-PLAN.md SP3).
--
-- ── WHY ─────────────────────────────────────────────────────────────────────────────────────────
-- Five Settings screens used to save by writing their table straight through PostgREST, gated only
-- by these policies. Each policy asks a ROLE or SECTION question (`auth_role() = 'admin'`, or
-- dispatch manage). The Permissions page answers a SCREEN question: Organization, Anomaly
-- thresholds, Driver performance and Planned fueling are each their own grant (Q-SET2). RLS
-- cannot ask that one, because screens are not in the JWT (D-SURF4). So a fleet manager granted
-- Organization was refused the save, and a dispatcher refused Planned fueling could still write
-- its row from the console.
--
-- SP2 (#1141, live on both services at 15e875a since 2026-09-30) moved every one of those saves to
-- an API endpoint on `requireSection` + `requireSurface`, writing with the service role:
--   organizations                 PUT /api/org-settings/profile, /notifications
--   anomaly_thresholds            POST /api/anomalies/thresholds
--   driver_performance_settings   POST /api/integrations/driver-performance/settings
--   route_fuel_settings           PUT /api/fueling/settings
--   fuel_discount_rules           POST /api/fueling/discount-rules
-- The gates on all six are in apps/api/src/settingsWrites.test.ts.
-- A sweep of apps/web, apps/driver and apps/admin found no client write left on any of the five
-- tables, only SELECTs (2026-09-30). These policies are now only a second door, and it answers the
-- wrong question. Closing it leaves the API as the one writer, which is the gate the owner edits.
--
-- ── WHAT STAYS ──────────────────────────────────────────────────────────────────────────────────
-- Every `*_select` policy stays, because the pages still READ through PostgREST (useOrgSettings,
-- useThresholds, …). anomaly_thresholds' RESTRICTIVE driver policies also stay
-- (`anomaly_thresholds_driver_insert`, `anomaly_thresholds_driver_scope`, `thresholds_driver_deny`).
-- A restrictive policy only narrows, and with no permissive write left it is moot but harmless.
--
-- ── DEPLOY WINDOW ───────────────────────────────────────────────────────────────────────────────
-- No column changes. The code that no longer needs these policies has been live since before
-- this merge, so the order MIGRATION-DISCIPLINE.md asks for is already met. Predicates re-read from
-- production pg_policies on 2026-09-30 and unchanged from 0004/0053/0300.

drop policy if exists organizations_update on public.organizations;
drop policy if exists thresholds_write on public.anomaly_thresholds;
drop policy if exists dps_write on public.driver_performance_settings;
drop policy if exists route_fuel_settings_write on public.route_fuel_settings;
drop policy if exists fuel_discount_write on public.fuel_discount_rules;
