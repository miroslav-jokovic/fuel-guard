-- FuelGuard — 0135 close the driver fuel-write gap (found by the Phase 9 release gate)
--
-- HOW THIS WAS FOUND. The offline RLS matrix (`supabase/tests/rls.test.mjs`) has asserted since
-- Phase 1 that a driver cannot insert a fill on a truck that is not theirs, nor spoof `source`.
-- Those two assertions had never actually executed: the harness referenced two migration files
-- under names they never shipped with, so it aborted before reaching them. Phase 9 repaired the
-- harness, the assertions ran for the first time, and both FAILED.
--
-- WHAT WAS OPEN. `0004.ftxn_insert` (PERMISSIVE) admits role in (admin, fleet_manager, driver) —
-- the pre-D41 contract, when the driver app still had manual fuel logging. `0084.
-- fuel_tx_driver_insert` (RESTRICTIVE) then narrowed the driver case to `driver_id = self` and
-- stopped there. So a driver JWT hitting PostgREST directly could insert a fill naming THEMSELVES,
-- on ANY vehicle in the org, with ANY `source` — including `'efs_feed'`, which is how the ingest
-- pipeline labels authoritative card data. That poisons MPG, idle and driver-score attribution and
-- could be used to paper over a discrepancy the theft detection is meant to surface. UPDATE and
-- DELETE were never open to drivers (0004 restricts both to admin/fleet_manager) — INSERT was the
-- whole gap.
--
-- WHY DENY OUTRIGHT rather than tighten to (own vehicle + source='manual'). D41 REMOVED manual
-- fuel logging from the driver app; fuel capture is a web/manager surface now. A repo-wide check
-- confirms `apps/driver` contains no reference to `fuel_transactions` at all — every write comes
-- from the API (service role) or the web app as an office role. So there is no legitimate driver
-- INSERT path to preserve, and 0084 already established the pattern for exactly this case:
--
--     "A driver has no legitimate INSERT path today — deny outright rather than gate on
--      driver_id, so a leaked route never quietly starts landing rows."   (0084, on `anomalies`)
--
-- This applies that same reasoning to fuel_transactions. If a driver-side fill capture is ever
-- reintroduced, replace this policy with the narrow form (driver_id = self AND the vehicle is the
-- driver's current duty-session truck AND source = 'manual') rather than simply dropping it.
--
-- Shape: RESTRICTIVE and driver-only, so it AND-combines with the existing PERMISSIVE policies and
-- is a no-op for every other role. Nothing changes for admin, fleet_manager, or the service role.

drop policy if exists fuel_tx_driver_insert on fuel_transactions;
create policy fuel_tx_driver_insert on fuel_transactions
  as restrictive for insert
  with check (
    auth_role() <> 'driver'
  );
