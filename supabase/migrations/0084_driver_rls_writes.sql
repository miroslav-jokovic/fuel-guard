-- 0084: driver RLS matrix — the INSERT half.
--
-- Extends 0083 to the write path (audit §21 SB1, "attribution-forgery hardening"). Without this,
-- a driver with a raw PostgREST session could POST a `fuel_transactions` row that names ANOTHER
-- driver as its `driver_id`, and the manager PERMISSIVE INSERT policy — which only checks org_id —
-- would accept it. Every subsequent MPG / anomaly / score attribution would then be poisoned by a
-- row nobody in the app UI has any way to write.
--
-- Same shape as 0083: RESTRICTIVE, AND-combined with the existing PERMISSIVE, no-op for
-- non-drivers, tightens the driver case.

-- ── fuel_transactions ─────────────────────────────────────────────────────────
-- The one the audit named. A driver may only insert a fill whose `driver_id` is themselves.
drop policy if exists fuel_tx_driver_insert on fuel_transactions;
create policy fuel_tx_driver_insert on fuel_transactions
  as restrictive for insert
  with check (
    auth_role() <> 'driver'
    or driver_id = auth_driver_id()
  );

-- ── anomalies ─────────────────────────────────────────────────────────────────
-- Anomalies are written by the detection engine (service role) or by dispatch when they raise an
-- exception. A driver has no legitimate INSERT path today — deny outright rather than gate on
-- driver_id, so a leaked route never quietly starts landing rows.
drop policy if exists anomalies_driver_insert on anomalies;
create policy anomalies_driver_insert on anomalies
  as restrictive for insert
  with check (
    auth_role() <> 'driver'
  );

-- ── driver_performance_weeks ──────────────────────────────────────────────────
-- Same: computed by the scoring worker, never by a driver.
drop policy if exists dpw_driver_insert on driver_performance_weeks;
create policy dpw_driver_insert on driver_performance_weeks
  as restrictive for insert
  with check (
    auth_role() <> 'driver'
  );

-- ── memberships ───────────────────────────────────────────────────────────────
-- Invites happen server-side (POST /api/invites) — drivers never insert memberships.
drop policy if exists memberships_driver_insert on memberships;
create policy memberships_driver_insert on memberships
  as restrictive for insert
  with check (
    auth_role() <> 'driver'
  );

-- ── anomaly_thresholds ────────────────────────────────────────────────────────
-- Admin-only in the UI; drivers cannot write.
drop policy if exists anomaly_thresholds_driver_insert on anomaly_thresholds;
create policy anomaly_thresholds_driver_insert on anomaly_thresholds
  as restrictive for insert
  with check (
    auth_role() <> 'driver'
  );

-- ── drivers ───────────────────────────────────────────────────────────────────
-- A driver never creates or modifies rows in `drivers` — profile fields that reach here come from
-- admin invites / edits, and the driver app updates its OWN status via API endpoints running as
-- service role.
drop policy if exists drivers_driver_insert on drivers;
create policy drivers_driver_insert on drivers
  as restrictive for insert
  with check (
    auth_role() <> 'driver'
  );

-- ── vehicles ──────────────────────────────────────────────────────────────────
-- Drivers do not insert vehicles.
drop policy if exists vehicles_driver_insert on vehicles;
create policy vehicles_driver_insert on vehicles
  as restrictive for insert
  with check (
    auth_role() <> 'driver'
  );

-- ── audit / self-check ────────────────────────────────────────────────────────
--   role=driver      → INSERT is allowed only on rows they legitimately own (fuel_transactions),
--                       and denied outright on tables where they have no write path (all others).
--   role in (admin,fleet_manager,…)
--                    → RESTRICTIVE is a no-op; existing PERMISSIVE decides.
