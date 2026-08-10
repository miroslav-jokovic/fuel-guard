-- 0164: Idle evidence model (Phase 2).
--
-- These fields describe OBSERVED telemetry behavior only. They must not be interpreted as installed equipment:
-- engine_off_observed is intentionally different from APU, battery HVAC, or shore power. Manual vehicle
-- equipment fields remain the source of truth for avoidable-idle scoring.

alter table vehicles add column if not exists idle_observed_mode text not null default 'unknown';
alter table vehicles add column if not exists idle_evidence_status text not null default 'insufficient';
alter table vehicles add column if not exists idle_evidence_sessions int not null default 0;
alter table vehicles add column if not exists idle_evidence_parked_sec bigint not null default 0;
alter table vehicles add column if not exists idle_evidence_state_samples int not null default 0;
alter table vehicles add column if not exists idle_evidence_gps_state_samples int not null default 0;
alter table vehicles add column if not exists idle_evidence_confidence numeric(4,3);
alter table vehicles add column if not exists idle_evidence_version text not null default 'engine-states-v1';
alter table vehicles add column if not exists idle_evidence_at timestamptz;

alter table idle_park_sessions add column if not exists observed_mode text not null default 'unknown';
alter table idle_park_sessions add column if not exists evidence_status text not null default 'insufficient';
alter table idle_park_sessions add column if not exists evidence_confidence numeric(4,3);
alter table idle_park_sessions add column if not exists state_sample_count int not null default 0;
alter table idle_park_sessions add column if not exists gps_state_sample_count int not null default 0;
alter table idle_park_sessions add column if not exists source_coverage_sec int not null default 0;
alter table idle_park_sessions add column if not exists stationary_sec int not null default 0;
alter table idle_park_sessions add column if not exists max_speed_mph numeric(6,2);
alter table idle_park_sessions add column if not exists evidence_version text not null default 'engine-states-v1';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'vehicles_idle_observed_mode_check') then
    alter table vehicles add constraint vehicles_idle_observed_mode_check
      check (idle_observed_mode in ('continuous_main_engine', 'optimized_cycling_observed', 'engine_off_observed', 'unknown'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'vehicles_idle_evidence_status_check') then
    alter table vehicles add constraint vehicles_idle_evidence_status_check
      check (idle_evidence_status in ('sufficient', 'insufficient'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'vehicles_idle_evidence_counts_check') then
    alter table vehicles add constraint vehicles_idle_evidence_counts_check
      check (idle_evidence_sessions >= 0 and idle_evidence_parked_sec >= 0 and idle_evidence_state_samples >= 0 and idle_evidence_gps_state_samples >= 0);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'vehicles_idle_evidence_confidence_check') then
    alter table vehicles add constraint vehicles_idle_evidence_confidence_check
      check (idle_evidence_confidence is null or idle_evidence_confidence between 0 and 1);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'idle_park_sessions_observed_mode_check') then
    alter table idle_park_sessions add constraint idle_park_sessions_observed_mode_check
      check (observed_mode in ('continuous_main_engine', 'optimized_cycling_observed', 'engine_off_observed', 'unknown'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'idle_park_sessions_evidence_status_check') then
    alter table idle_park_sessions add constraint idle_park_sessions_evidence_status_check
      check (evidence_status in ('sufficient', 'insufficient'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'idle_park_sessions_evidence_counts_check') then
    alter table idle_park_sessions add constraint idle_park_sessions_evidence_counts_check
      check (state_sample_count >= 0 and gps_state_sample_count >= 0 and source_coverage_sec >= 0 and stationary_sec >= 0);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'idle_park_sessions_evidence_confidence_check') then
    alter table idle_park_sessions add constraint idle_park_sessions_evidence_confidence_check
      check (evidence_confidence is null or evidence_confidence between 0 and 1);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'idle_park_sessions_max_speed_check') then
    alter table idle_park_sessions add constraint idle_park_sessions_max_speed_check
      check (max_speed_mph is null or max_speed_mph >= 0);
  end if;
end;
$$;
