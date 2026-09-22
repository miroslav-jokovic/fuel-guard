-- 0352: the audit trigger stops recording telemetry (D-LIFE4, Q5(a), docs/plans/architecture/DATA-LIFECYCLE-PLAN.md)
--
-- ─────────────────────────────────────────────────────────────────────────────────────────────────
-- WHAT WAS MEASURED, 2026-09-21/22, production
--
-- `audit_logs` is 1,214 MB and growing at 3.10M rows/30d — 10.2 GB/year, the largest single line in a
-- ~31 GB/year database, and it is the ONE table retention may never touch: it is append-only evidence
-- pinned in RETENTION_FORBIDDEN, and pruning it would be evidence destruction.
--
-- 97% of that volume is `vehicle.update`: 924,628 rows in seven days, 20.2 per vehicle per hour,
-- across 272 of 272 vehicles, with `actor_id` null on 925,341 of 925,341 and **zero** `vehicle.insert`
-- or `vehicle.delete` in the same week. `driver.update` adds 294 rows/hour on the same shape.
--
-- ─────────────────────────────────────────────────────────────────────────────────────────────────
-- THREE THINGS THAT ARE NOT THE CAUSE, each checked before this was written
--
-- 1. NOT a runaway writer. The machine writers already diff-gate: `samsaraStatsFeed.ts` builds a patch
--    field by field and skips the UPDATE entirely when `Object.keys(patch).length === 0`.
-- 2. NOT a missing no-op guard. The rows are REAL column changes — `current_odometer` and
--    `samsara_fuel_percent` on a moving truck, which genuinely change every few minutes.
-- 3. NOT something a `where old is not distinct from new` guard would have fixed. That guard CANNOT
--    EVER FIRE on these tables: `set_updated_at()` is a BEFORE UPDATE trigger that sets
--    `updated_at = now()` unconditionally, so by the time this AFTER trigger runs, `new` always
--    differs from `old`. A version written without checking would have shipped, changed nothing and
--    looked correct. Hence `v_ignored` always contains `updated_at`.
--
-- THE ACTUAL CAUSE is that `vehicles` and `drivers` are `core` entity tables carrying live telemetry:
-- `current_odometer`, `samsara_fuel_percent`, `current_hos_status`, `current_location` and ~30
-- machine-derived `idle_*`/tank-learning columns sit beside `vin`, `plate`, `cdl_expires_at` and
-- `insurance_expires_at`. One table, two lifetimes — identity that changes a few times a year, and
-- telemetry that changes every three minutes — and `audit_row_change` could not tell them apart.
--
-- ─────────────────────────────────────────────────────────────────────────────────────────────────
-- ⚠ THIS IS Q5 ANSWER (a), AND IT IS A LABELLED WORKAROUND, NOT THE FIX
--
-- The honest fix is Q5(b): move telemetry OFF `vehicles`/`drivers` into their own `time`-growth tables
-- so the entity tables become what scripts/table-modules.json already calls them (`core`,
-- `growth: "fleet"`). That is a wide change — every reader of `current_odometer` and
-- `samsara_fuel_percent` across fuel, live map and dashboards moves — and it is planned separately.
-- **What removes this migration is Q5(b) landing.** Until then the ignore lists below are a filter in
-- front of a modelling error, and they are written out column by column so that the error is legible
-- rather than hidden behind a predicate.
--
-- ─────────────────────────────────────────────────────────────────────────────────────────────────
-- WHAT IS DELIBERATELY STILL AUDITED, AND WHY THE LIST IS NOT "COLUMNS MACHINES WRITE"
--
-- The tempting rule — ignore whatever the sync writes — is WRONG and was rejected after reading the
-- writers. `samsaraVehicleSync.ts` writes `vin`, `plate`, `unit_number`, `make`, `model`, `year` and
-- `status`; `samsaraDriverSync.ts` writes `cdl_number`; `equipmentInspection.ts` writes
-- `dot_annual_inspection_expires_at`. Those are identity and compliance facts, and a machine changing
-- one is MORE interesting to an auditor than a human doing it, not less. A VIN silently changing is
-- exactly the event this ledger exists for.
--
-- So the rule is by MEANING, not by author: ignore measurements and machine-derived state; audit
-- everything that describes what the truck or driver IS, who it belongs to, or what it is licensed,
-- insured and inspected to do. In particular `has_apu`, `apu_type` and `has_optimized_idle` stay
-- audited — they are admin-set flags that grant idle avoidability (docs/plans/fuel/
-- DATA-PRECISION-AUDIT-2026-09-20.md §3), so who set them and when is a real question.
--
-- INSERT and DELETE are never filtered. Only UPDATE consults the ignore list.
--
-- Rollback: create or replace the function with the tg_argv[1]-less body from 0009 and recreate both
-- triggers with a single argument.

create or replace function public.audit_row_change()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_org     uuid;
  v_id      uuid;
  v_actor   uuid;
  v_ignored text[];
begin
  -- tg_argv[1] is optional: a trigger created with one argument audits every column, which keeps the
  -- 0009 behaviour for any future table that wants it and makes the filter opt-in per trigger.
  v_ignored := case
                 when tg_nargs > 1 then string_to_array(tg_argv[1], ',')
                 else array[]::text[]
               end;

  if (tg_op = 'UPDATE' and array_length(v_ignored, 1) is not null) then
    -- Fire only if at least one NON-ignored column actually changed. `to_jsonb` renders both rows at
    -- once, so this is one comparison over the row rather than a hand-maintained column list in
    -- plpgsql, and a column added later is audited BY DEFAULT — the safe direction to fail.
    if not exists (
      select 1
      from jsonb_each(to_jsonb(new)) as n(key, value)
      join jsonb_each(to_jsonb(old)) as o(key, value) on o.key = n.key
      where n.value is distinct from o.value
        and not (n.key = any (v_ignored))
    ) then
      return new;
    end if;
  end if;

  if (tg_op = 'DELETE') then
    v_org := old.org_id; v_id := old.id;
  else
    v_org := new.org_id; v_id := new.id;
  end if;
  v_actor := nullif(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub', '')::uuid;

  insert into public.audit_logs (org_id, actor_id, action, entity, entity_id)
  values (v_org, v_actor, tg_argv[0] || '.' || lower(tg_op), tg_table_name, v_id);

  if (tg_op = 'DELETE') then return old; else return new; end if;
end;
$function$;

-- ── vehicles ─────────────────────────────────────────────────────────────────────────────────────
-- Ignored: live telemetry (Samsara feed), learned tank/odometer calibration (the scoring engine's own
-- outputs), and the whole derived idle-evidence/envelope family. NOT ignored and worth stating
-- explicitly because the next reader will look for them: unit_number, vin, plate, make, model, year,
-- status, fuel_type, tank_capacity_gal, assigned_driver_id, samsara_vehicle_id, has_apu, apu_type,
-- has_optimized_idle, ownership/title/lien, registration, insurance, dot_annual_inspection_*, next_pm_*,
-- engine/spec columns, eld_id, identity_source and the mcleod_* links.
drop trigger if exists audit_vehicles on public.vehicles;
create trigger audit_vehicles
after insert or delete or update on public.vehicles
for each row execute function public.audit_row_change('vehicle',
  'updated_at,'
  -- live feed
  'current_odometer,samsara_fuel_percent,samsara_fuel_at,samsara_missing_since,'
  -- learned calibration (learnVehicle.ts / persist.ts)
  'baseline_mpg,odometer_offset,odometer_offset_source,tank_sensor_reliable,tank_fill_ratio,'
  'monitored_tank_capacity_gal,observed_max_fill_gal,sensor_capacity_gal,sensor_capacity_samples,'
  'tank_capacity_source,tank_residual_sigma,'
  -- derived idle state (idleCapabilitySync.ts) — the admin FLAGS has_apu/apu_type/has_optimized_idle
  -- are deliberately absent from this list
  'idle_capability,idle_optimized_pct,idle_states_sec,idle_states_window_days,idle_states_at,'
  'idle_observed_mode,idle_evidence_status,idle_evidence_sessions,idle_evidence_parked_sec,'
  'idle_evidence_state_samples,idle_evidence_gps_state_samples,idle_evidence_confidence,'
  'idle_evidence_version,idle_evidence_at,idle_learned_envelope_status,idle_learned_envelope_low_f,'
  'idle_learned_envelope_high_f,idle_learned_envelope_sessions,idle_learned_envelope_known_idle_sec,'
  'idle_learned_envelope_cycling_sec,idle_learned_envelope_continuous_sec,'
  'idle_learned_envelope_temperature_bins,idle_learned_envelope_version,idle_learned_envelope_at');

-- ── drivers ──────────────────────────────────────────────────────────────────────────────────────
-- Ignored: the live HOS position block written by hosSync.ts. Everything identifying, licensing or
-- paying a driver stays audited — cdl_*, medical_card_expires_at, date_of_birth, address, pay_*,
-- status, archived_at, app_access_enabled and the identity links.
drop trigger if exists audit_drivers on public.drivers;
create trigger audit_drivers
after insert or delete or update on public.drivers
for each row execute function public.audit_row_change('driver',
  'updated_at,current_hos_status,current_hos_vehicle,current_hos_at,current_location');
