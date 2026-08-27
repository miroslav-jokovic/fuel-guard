-- The vehicles learner split — master data stops being a machine's scratchpad (D-SEP3,
-- docs/plans/architecture/SEPARATION-PROGRAM-PLAN.md P2.2; the 0261 pattern applied to the
-- second-worst mixed table).
--
-- The 2026-08-27 audit counted ~30 learner-computed columns on `vehicles` — tank calibration
-- from the anomalies engine, idle capability/evidence/envelopes from the idle pipeline —
-- written in place by three modules, none of them roster, the table's owner. The sharpest
-- case is 0119: a learner OVERWRITES the human-entered tank_capacity_gal, recoverable only
-- from audit_logs. Two per-domain satellites (one owner each, D-ARC3):
--
--   vehicle_tank_learned — the anomalies engine's calibration (odometer offset, fill ratio,
--     sensor capacity, residual sigma) + learned_tank_capacity_gal, the NEW home the 0119
--     autofix migrates to (writing it here and never master is that follow-up's contract;
--     until it lands the column stays null and tank_capacity_source keeps the provenance).
--   vehicle_idle_learned — the idle pipeline's capability classification, evidence rollup
--     and learned temperature envelope.
--
-- Same strangler mechanics as 0261: a row trigger mirrors every legacy write (whoever the
-- writer — app code or the 0174/0175 evidence RPCs), a backfill carries history, legacy
-- columns stay with DEPRECATED comments and retire when their writers migrate. Deny-all RLS.
-- Trigger DML is schema-qualified; no `set search_path` (the 46x inlining incident).
--
-- cross-module-waiver: roster's canonical table sheds learner columns into anomalies' and
-- idle's satellites — the split is the cross-module act.

create table vehicle_tank_learned (
  vehicle_id                uuid primary key references vehicles(id) on delete cascade,
  org_id                    uuid not null references organizations(id) on delete cascade,
  odometer_offset           numeric,
  odometer_offset_source    text,
  tank_fill_ratio           numeric,
  tank_sensor_reliable      boolean,
  observed_max_fill_gal     numeric,
  sensor_capacity_gal       numeric,
  sensor_capacity_samples   integer,
  tank_residual_sigma       numeric,
  -- unfilled until the 0119 autofix migrates here (P2.2 follow-up): the learner's capacity
  -- OPINION, never again an overwrite of the human's tank_capacity_gal.
  learned_tank_capacity_gal numeric,
  updated_at                timestamptz not null default now()
);
alter table vehicle_tank_learned enable row level security;
create index idx_vehicle_tank_learned_org on vehicle_tank_learned (org_id);
comment on table vehicle_tank_learned is
  'module=anomalies; layer=derived; rebuild=scoring learners re-derive from fill history. '
  'Tank calibration learned per truck, mirrored from vehicles'' legacy learner columns by '
  'trg_vehicle_learned_satellites since 0262 (D-SEP3).';

create table vehicle_idle_learned (
  vehicle_id                             uuid primary key references vehicles(id) on delete cascade,
  org_id                                 uuid not null references organizations(id) on delete cascade,
  idle_capability                        text,
  idle_optimized_pct                     numeric,
  idle_states_sec                        bigint,
  idle_states_window_days                int,
  idle_states_at                         timestamptz,
  idle_observed_mode                     text,
  idle_evidence_status                   text,
  idle_evidence_sessions                 int,
  idle_evidence_parked_sec               bigint,
  idle_evidence_state_samples            int,
  idle_evidence_gps_state_samples        int,
  idle_evidence_confidence               numeric,
  idle_evidence_version                  text,
  idle_evidence_at                       timestamptz,
  idle_learned_envelope_status           text,
  idle_learned_envelope_low_f            numeric,
  idle_learned_envelope_high_f           numeric,
  idle_learned_envelope_sessions         int,
  idle_learned_envelope_known_idle_sec   int,
  idle_learned_envelope_cycling_sec      int,
  idle_learned_envelope_continuous_sec   int,
  idle_learned_envelope_temperature_bins int,
  idle_learned_envelope_version          text,
  idle_learned_envelope_at               timestamptz,
  updated_at                             timestamptz not null default now()
);
alter table vehicle_idle_learned enable row level security;
create index idx_vehicle_idle_learned_org on vehicle_idle_learned (org_id);
comment on table vehicle_idle_learned is
  'module=idle; layer=derived; rebuild=idle capability/evidence/envelope syncs re-derive from telemetry. '
  'Idle learning per truck, mirrored from vehicles'' legacy learner columns by '
  'trg_vehicle_learned_satellites since 0262 (D-SEP3).';

-- ── the mirror ────────────────────────────────────────────────────────────────────────────────
-- Guards fire only on MEANINGFUL learner state: several legacy columns carry NOT NULL defaults
-- ('insufficient', 'unknown', 0), so "any non-null" would satellite every roster row. A plain
-- roster insert creates zero satellite rows — the matrix pins it.

create or replace function sync_vehicle_learned_satellites() returns trigger
language plpgsql as $$
begin
  if coalesce(new.odometer_offset, 0) <> 0 or new.tank_fill_ratio is not null
     or new.observed_max_fill_gal is not null or new.sensor_capacity_gal is not null
     or new.sensor_capacity_samples is not null or new.tank_residual_sigma is not null
     or coalesce(new.tank_sensor_reliable, false)
     or coalesce(new.odometer_offset_source, 'auto') <> 'auto' then
    insert into public.vehicle_tank_learned (
      vehicle_id, org_id, odometer_offset, odometer_offset_source, tank_fill_ratio,
      tank_sensor_reliable, observed_max_fill_gal, sensor_capacity_gal, sensor_capacity_samples,
      tank_residual_sigma, updated_at
    ) values (
      new.id, new.org_id, new.odometer_offset, new.odometer_offset_source, new.tank_fill_ratio,
      new.tank_sensor_reliable, new.observed_max_fill_gal, new.sensor_capacity_gal,
      new.sensor_capacity_samples, new.tank_residual_sigma, now()
    )
    on conflict (vehicle_id) do update set
      org_id = excluded.org_id,
      odometer_offset = excluded.odometer_offset,
      odometer_offset_source = excluded.odometer_offset_source,
      tank_fill_ratio = excluded.tank_fill_ratio,
      tank_sensor_reliable = excluded.tank_sensor_reliable,
      observed_max_fill_gal = excluded.observed_max_fill_gal,
      sensor_capacity_gal = excluded.sensor_capacity_gal,
      sensor_capacity_samples = excluded.sensor_capacity_samples,
      tank_residual_sigma = excluded.tank_residual_sigma,
      updated_at = now();
  end if;

  if new.idle_capability is not null or new.idle_optimized_pct is not null
     or new.idle_states_at is not null or new.idle_evidence_at is not null
     or new.idle_learned_envelope_at is not null
     or coalesce(new.idle_observed_mode, 'unknown') <> 'unknown'
     or coalesce(new.idle_evidence_status, 'insufficient') <> 'insufficient'
     or coalesce(new.idle_learned_envelope_status, 'not_applicable') <> 'not_applicable' then
    insert into public.vehicle_idle_learned (
      vehicle_id, org_id, idle_capability, idle_optimized_pct, idle_states_sec,
      idle_states_window_days, idle_states_at, idle_observed_mode, idle_evidence_status,
      idle_evidence_sessions, idle_evidence_parked_sec, idle_evidence_state_samples,
      idle_evidence_gps_state_samples, idle_evidence_confidence, idle_evidence_version,
      idle_evidence_at, idle_learned_envelope_status, idle_learned_envelope_low_f,
      idle_learned_envelope_high_f, idle_learned_envelope_sessions,
      idle_learned_envelope_known_idle_sec, idle_learned_envelope_cycling_sec,
      idle_learned_envelope_continuous_sec, idle_learned_envelope_temperature_bins,
      idle_learned_envelope_version, idle_learned_envelope_at, updated_at
    ) values (
      new.id, new.org_id, new.idle_capability, new.idle_optimized_pct, new.idle_states_sec,
      new.idle_states_window_days, new.idle_states_at, new.idle_observed_mode,
      new.idle_evidence_status, new.idle_evidence_sessions, new.idle_evidence_parked_sec,
      new.idle_evidence_state_samples, new.idle_evidence_gps_state_samples,
      new.idle_evidence_confidence, new.idle_evidence_version, new.idle_evidence_at,
      new.idle_learned_envelope_status, new.idle_learned_envelope_low_f,
      new.idle_learned_envelope_high_f, new.idle_learned_envelope_sessions,
      new.idle_learned_envelope_known_idle_sec, new.idle_learned_envelope_cycling_sec,
      new.idle_learned_envelope_continuous_sec, new.idle_learned_envelope_temperature_bins,
      new.idle_learned_envelope_version, new.idle_learned_envelope_at, now()
    )
    on conflict (vehicle_id) do update set
      org_id = excluded.org_id,
      idle_capability = excluded.idle_capability,
      idle_optimized_pct = excluded.idle_optimized_pct,
      idle_states_sec = excluded.idle_states_sec,
      idle_states_window_days = excluded.idle_states_window_days,
      idle_states_at = excluded.idle_states_at,
      idle_observed_mode = excluded.idle_observed_mode,
      idle_evidence_status = excluded.idle_evidence_status,
      idle_evidence_sessions = excluded.idle_evidence_sessions,
      idle_evidence_parked_sec = excluded.idle_evidence_parked_sec,
      idle_evidence_state_samples = excluded.idle_evidence_state_samples,
      idle_evidence_gps_state_samples = excluded.idle_evidence_gps_state_samples,
      idle_evidence_confidence = excluded.idle_evidence_confidence,
      idle_evidence_version = excluded.idle_evidence_version,
      idle_evidence_at = excluded.idle_evidence_at,
      idle_learned_envelope_status = excluded.idle_learned_envelope_status,
      idle_learned_envelope_low_f = excluded.idle_learned_envelope_low_f,
      idle_learned_envelope_high_f = excluded.idle_learned_envelope_high_f,
      idle_learned_envelope_sessions = excluded.idle_learned_envelope_sessions,
      idle_learned_envelope_known_idle_sec = excluded.idle_learned_envelope_known_idle_sec,
      idle_learned_envelope_cycling_sec = excluded.idle_learned_envelope_cycling_sec,
      idle_learned_envelope_continuous_sec = excluded.idle_learned_envelope_continuous_sec,
      idle_learned_envelope_temperature_bins = excluded.idle_learned_envelope_temperature_bins,
      idle_learned_envelope_version = excluded.idle_learned_envelope_version,
      idle_learned_envelope_at = excluded.idle_learned_envelope_at,
      updated_at = now();
  end if;

  return new;
end;
$$;

create trigger trg_vehicle_learned_satellites
  after insert or update on vehicles
  for each row execute function sync_vehicle_learned_satellites();

-- ── backfill, same predicates as the trigger ─────────────────────────────────────────────────

insert into vehicle_tank_learned (
  vehicle_id, org_id, odometer_offset, odometer_offset_source, tank_fill_ratio,
  tank_sensor_reliable, observed_max_fill_gal, sensor_capacity_gal, sensor_capacity_samples,
  tank_residual_sigma
)
select id, org_id, odometer_offset, odometer_offset_source, tank_fill_ratio,
       tank_sensor_reliable, observed_max_fill_gal, sensor_capacity_gal, sensor_capacity_samples,
       tank_residual_sigma
from vehicles
where coalesce(odometer_offset, 0) <> 0 or tank_fill_ratio is not null
   or observed_max_fill_gal is not null or sensor_capacity_gal is not null
   or sensor_capacity_samples is not null or tank_residual_sigma is not null
   or coalesce(tank_sensor_reliable, false)
   or coalesce(odometer_offset_source, 'auto') <> 'auto'
on conflict (vehicle_id) do nothing;

insert into vehicle_idle_learned (
  vehicle_id, org_id, idle_capability, idle_optimized_pct, idle_states_sec,
  idle_states_window_days, idle_states_at, idle_observed_mode, idle_evidence_status,
  idle_evidence_sessions, idle_evidence_parked_sec, idle_evidence_state_samples,
  idle_evidence_gps_state_samples, idle_evidence_confidence, idle_evidence_version,
  idle_evidence_at, idle_learned_envelope_status, idle_learned_envelope_low_f,
  idle_learned_envelope_high_f, idle_learned_envelope_sessions,
  idle_learned_envelope_known_idle_sec, idle_learned_envelope_cycling_sec,
  idle_learned_envelope_continuous_sec, idle_learned_envelope_temperature_bins,
  idle_learned_envelope_version, idle_learned_envelope_at
)
select id, org_id, idle_capability, idle_optimized_pct, idle_states_sec,
       idle_states_window_days, idle_states_at, idle_observed_mode, idle_evidence_status,
       idle_evidence_sessions, idle_evidence_parked_sec, idle_evidence_state_samples,
       idle_evidence_gps_state_samples, idle_evidence_confidence, idle_evidence_version,
       idle_evidence_at, idle_learned_envelope_status, idle_learned_envelope_low_f,
       idle_learned_envelope_high_f, idle_learned_envelope_sessions,
       idle_learned_envelope_known_idle_sec, idle_learned_envelope_cycling_sec,
       idle_learned_envelope_continuous_sec, idle_learned_envelope_temperature_bins,
       idle_learned_envelope_version, idle_learned_envelope_at
from vehicles
where idle_capability is not null or idle_optimized_pct is not null
   or idle_states_at is not null or idle_evidence_at is not null
   or idle_learned_envelope_at is not null
   or coalesce(idle_observed_mode, 'unknown') <> 'unknown'
   or coalesce(idle_evidence_status, 'insufficient') <> 'insufficient'
   or coalesce(idle_learned_envelope_status, 'not_applicable') <> 'not_applicable'
on conflict (vehicle_id) do nothing;

-- ── deprecation record on the legacy columns ─────────────────────────────────────────────────

do $$
declare c text;
begin
  foreach c in array array[
    'odometer_offset','odometer_offset_source','tank_fill_ratio','tank_sensor_reliable',
    'observed_max_fill_gal','sensor_capacity_gal','sensor_capacity_samples','tank_residual_sigma'
  ] loop
    execute format('comment on column vehicles.%I is %L', c,
      'DEPRECATED 0262 (D-SEP3): lives in vehicle_tank_learned; mirrored by trg_vehicle_learned_satellites until the last writer migrates.');
  end loop;
  foreach c in array array[
    'idle_capability','idle_optimized_pct','idle_states_sec','idle_states_window_days','idle_states_at',
    'idle_observed_mode','idle_evidence_status','idle_evidence_sessions','idle_evidence_parked_sec',
    'idle_evidence_state_samples','idle_evidence_gps_state_samples','idle_evidence_confidence',
    'idle_evidence_version','idle_evidence_at','idle_learned_envelope_status','idle_learned_envelope_low_f',
    'idle_learned_envelope_high_f','idle_learned_envelope_sessions','idle_learned_envelope_known_idle_sec',
    'idle_learned_envelope_cycling_sec','idle_learned_envelope_continuous_sec',
    'idle_learned_envelope_temperature_bins','idle_learned_envelope_version','idle_learned_envelope_at'
  ] loop
    execute format('comment on column vehicles.%I is %L', c,
      'DEPRECATED 0262 (D-SEP3): lives in vehicle_idle_learned; mirrored by trg_vehicle_learned_satellites until the last writer migrates.');
  end loop;
end $$;
